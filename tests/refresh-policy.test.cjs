"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/refresh-policy.js");

const {
  assessAssistantActionChange,
  assessResponseCandidate,
  classifyPage,
  coversLatestDomUser,
  createDiagnostics,
  createEpochGate,
  getLastAssistantId,
  includesCapturedDomUser,
  summarizeMessages,
  updateUnverifiedResponseStreak,
} = globalThis.Chatcouter.refreshPolicy;

test("a captured user may precede later server input, but must remain in the active branch", () => {
  const branch = [
    { id: "u1", role: "user", text: "repeated prompt" },
    { id: "a1", role: "assistant", text: "answer" },
    { id: "u2", role: "user", text: "later input" },
  ];
  assert.equal(includesCapturedDomUser(branch, [branch[0]]), true);
  assert.equal(coversLatestDomUser(branch, [branch[0]]), false, "Export and automatic verification retain latest-user checks");
  assert.equal(includesCapturedDomUser(branch, [{ id: "another-branch", role: "user", text: "repeated prompt" }]), false);
  assert.equal(includesCapturedDomUser(branch, [{ id: "user-0", role: "user", text: "repeated prompt" }]), true);
  assert.equal(includesCapturedDomUser(branch, [{ role: "user", text: "missing prompt" }]), false);
  assert.equal(includesCapturedDomUser(branch, []), null);
});

test("classifyPage separates conversations, new chats, and inactive pages", () => {
  assert.equal(classifyPage({ conversationId: "conversation-id", hasComposer: true }), "conversation");
  assert.equal(classifyPage({ hasComposer: true }), "new-chat");
  assert.equal(classifyPage(), "inactive");
});

test("epoch gate rejects results after an epoch, route, or conversation change", () => {
  const gate = createEpochGate();
  const token = gate.capture({ conversationId: "a", route: "/c/a" });

  assert.equal(gate.accepts(token, { conversationId: "a", route: "/c/a" }), true);
  assert.equal(gate.accepts(token, { conversationId: "b", route: "/c/b" }), false);
  assert.equal(gate.accepts(token, { conversationId: "a", route: "/c/other" }), false);

  gate.advance();
  assert.equal(gate.accepts(token, { conversationId: "a", route: "/c/a" }), false);
});

test("summarizeMessages records shape without retaining conversation text", () => {
  const summary = summarizeMessages([
    { role: "user", text: "private prompt" },
    { role: "assistant", text: "private answer" },
    { role: "assistant", text: "" },
  ]);

  assert.deepEqual(summary, {
    messages: 3,
    userMessages: 1,
    assistantMessages: 2,
    emptyMessages: 1,
    lastRole: "assistant",
  });
  assert.equal(JSON.stringify(summary).includes("private"), false);
});

test("getLastAssistantId returns identity without retaining message text in summaries", () => {
  const messages = [
    { id: "u1", role: "user", text: "private prompt" },
    { id: "a1", role: "assistant", text: "first" },
    { id: "a2", role: "assistant", text: "latest" },
  ];

  assert.equal(getLastAssistantId(messages), "a2");
  assert.equal(getLastAssistantId([{ id: "u1", role: "user", text: "only user" }]), "");
});

test("unverified response streak counts only final automatic lifecycle uncertainty", () => {
  assert.equal(updateUnverifiedResponseStreak({
    current: 2,
    outcome: "uncertain",
    responseMode: "new-turn",
  }), 3);
  assert.equal(updateUnverifiedResponseStreak({
    current: 2,
    outcome: "uncertain",
    responseMode: "regeneration",
  }), 3);
  assert.equal(updateUnverifiedResponseStreak({
    current: 2,
    outcome: "uncertain",
    responseMode: "recovery",
  }), 2);
  assert.equal(updateUnverifiedResponseStreak({
    current: 2,
    outcome: "cancelled",
    responseMode: "new-turn",
  }), 2);
  assert.equal(updateUnverifiedResponseStreak({
    current: 2,
    outcome: "retry",
    responseMode: "new-turn",
  }), 2);
  assert.equal(updateUnverifiedResponseStreak({
    current: 2,
    outcome: "verified-full",
    responseMode: "",
  }), 0);
});

test("assistant action policy distinguishes new turns, regeneration, and virtualization", () => {
  assert.deepEqual(
    assessAssistantActionChange({
      baselineKey: "fallback-turn-7",
      mode: "new-turn",
      previousKeys: ["fallback-turn-5", "fallback-turn-6", "fallback-turn-7"],
      currentKeys: ["fallback-turn-5", "fallback-turn-6", "fallback-turn-7", "fallback-turn-8"],
    }),
    { completionSeen: true, completionKey: "fallback-turn-8", markerRemoved: false },
  );

  assert.deepEqual(
    assessAssistantActionChange({
      baselineKey: "fallback-turn-7",
      mode: "new-turn",
      previousKeys: ["fallback-turn-3", "fallback-turn-4", "fallback-turn-5", "fallback-turn-6", "fallback-turn-7"],
      currentKeys: ["fallback-turn-5", "fallback-turn-6", "fallback-turn-7"],
    }),
    { completionSeen: false, completionKey: "", markerRemoved: false },
  );

  const removed = assessAssistantActionChange({
    baselineKey: "fallback-turn-8",
    mode: "regeneration",
    previousKeys: ["fallback-turn-5", "fallback-turn-6", "fallback-turn-7", "fallback-turn-8"],
    currentKeys: ["fallback-turn-5", "fallback-turn-6", "fallback-turn-7"],
  });
  assert.deepEqual(removed, { completionSeen: false, completionKey: "", markerRemoved: true });
  assert.deepEqual(
    assessAssistantActionChange({
      baselineKey: "fallback-turn-8",
      mode: "regeneration",
      markerRemoved: removed.markerRemoved,
      previousKeys: ["fallback-turn-5", "fallback-turn-6", "fallback-turn-7"],
      currentKeys: ["fallback-turn-5", "fallback-turn-6", "fallback-turn-7", "fallback-turn-8"],
    }),
    { completionSeen: true, completionKey: "fallback-turn-8", markerRemoved: true },
  );
});

test("historical actions reappearing cannot complete a new response", () => {
  for (const currentKeys of [["older", "latest"], ["older", "next"]]) {
    assert.equal(assessAssistantActionChange({
      baselineKey: "latest", previousKeys: ["latest"], currentKeys,
    }).completionSeen, false);
  }
});

test("later completed tails can recover despite past assistant deficits without accepting stale tails", () => {
  const policy = globalThis.Chatcouter.refreshPolicy;
  const options = {
    baseline: { userMessages: 125, assistantMessages: 127 },
    candidate: { userMessages: 143, assistantMessages: 142, lastRole: "assistant" },
    expectedTurns: 18,
    expectedAssistantTurns: policy.expectedAssistantAdvance(18),
    completion: { currentNodeRole: "assistant", currentNodeRecipient: "all", currentNodeEndTurn: true, currentNodeStatus: "finished_successfully" },
  };
  assert.equal(assessResponseCandidate(options).publishable, true);
  assert.equal(assessResponseCandidate({ ...options, candidate: { ...options.candidate, lastRole: "user" } }).reason, "api-tail-not-assistant");
  assert.equal(assessResponseCandidate({ ...options, domUserCovered: false }).reason, "api-user-tail-behind-dom");
  assert.equal(assessResponseCandidate({ ...options, candidate: { ...options.candidate, userMessages: 142 } }).reason, "user-not-advanced");
  assert.equal(assessResponseCandidate({ ...options, completion: { ...options.completion, currentNodeStatus: "in_progress" } }).reason, "current-node-in-progress");
});

test("coversLatestDomUser detects an API snapshot behind the visible user turn", () => {
  const candidate = [
    { id: "api-user-1", role: "user", text: "first" },
    { id: "api-assistant-1", role: "assistant", text: "answer" },
  ];

  assert.equal(coversLatestDomUser(candidate, [
    { id: "dom-user-2", role: "user", text: "second" },
    { id: "dom-assistant-2", role: "assistant", text: "new answer" },
  ]), false);
  assert.equal(coversLatestDomUser(candidate, [
    { id: "user-0", role: "user", text: "first" },
  ]), true);
  assert.equal(coversLatestDomUser(candidate, [
    { id: "different-message-id", role: "user", text: "first" },
  ]), false, "a stable ID from another branch cannot match by repeated text");
  assert.equal(coversLatestDomUser(candidate, [
    { id: "image-user", role: "user", text: "" },
  ]), null);
});

test("response candidate must advance both visible roles beyond its baseline", () => {
  const baseline = {
    messages: 212,
    userMessages: 106,
    assistantMessages: 106,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      candidate: baseline,
      domCandidate: { messages: 214, userMessages: 107, assistantMessages: 107, lastRole: "assistant" },
    }),
    { publishable: false, reason: "user-not-advanced" },
  );

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      candidate: { ...baseline, messages: 213, userMessages: 107, lastRole: "user" },
      domCandidate: { messages: 214, userMessages: 107, assistantMessages: 107, lastRole: "assistant" },
    }),
    { publishable: false, reason: "assistant-not-advanced" },
  );

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      candidate: { ...baseline, messages: 214, userMessages: 107, assistantMessages: 107 },
      domCandidate: { messages: 214, userMessages: 107, assistantMessages: 107, lastRole: "assistant" },
    }),
    { publishable: true, reason: "response-advanced" },
  );
});

test("response candidate accounts for multiple turns since the trusted baseline", () => {
  const baseline = {
    messages: 212,
    userMessages: 106,
    assistantMessages: 106,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      expectedTurns: 2,
      candidate: { ...baseline, messages: 214, userMessages: 107, assistantMessages: 107 },
      domCandidate: { messages: 216, userMessages: 108, assistantMessages: 108, lastRole: "assistant" },
    }),
    { publishable: false, reason: "user-not-advanced" },
  );

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      expectedTurns: 2,
      candidate: { ...baseline, messages: 216, userMessages: 108, assistantMessages: 108 },
      domCandidate: { messages: 216, userMessages: 108, assistantMessages: 108, lastRole: "assistant" },
    }),
    { publishable: true, reason: "response-advanced" },
  );
});

test("stopped turns do not permanently require a matching assistant message", () => {
  const baseline = {
    messages: 200,
    userMessages: 100,
    assistantMessages: 100,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      expectedTurns: 1,
      expectedAssistantTurns: 0,
      candidate: {
        messages: 201,
        userMessages: 101,
        assistantMessages: 100,
        lastRole: "user",
      },
      domCandidate: {
        messages: 201,
        userMessages: 101,
        assistantMessages: 100,
        lastRole: "user",
      },
      domUserCovered: true,
    }),
    { publishable: true, reason: "response-advanced" },
  );

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      expectedTurns: 2,
      expectedAssistantTurns: 1,
      candidate: {
        messages: 203,
        userMessages: 102,
        assistantMessages: 101,
        lastRole: "assistant",
      },
      domCandidate: {
        messages: 203,
        userMessages: 102,
        assistantMessages: 101,
        lastRole: "assistant",
      },
      domUserCovered: true,
    }),
    { publishable: true, reason: "response-advanced" },
  );
});

test("stopped-turn recovery still rejects a snapshot behind the latest user", () => {
  const baseline = {
    messages: 200,
    userMessages: 100,
    assistantMessages: 100,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      expectedTurns: 1,
      expectedAssistantTurns: 0,
      candidate: baseline,
      domUserCovered: false,
    }),
    { publishable: false, reason: "api-user-tail-behind-dom" },
  );
});

test("in-progress snapshots cannot publish with null end-turn markers", () => {
  const candidate = { messages: 2, userMessages: 1, assistantMessages: 1, lastRole: "assistant" };
  const completion = {
    lastAssistantEndTurn: null,
    currentNodeEndTurn: null,
    currentNodeRole: "assistant",
    currentNodeRecipient: "all",
  };
  assert.deepEqual(assessResponseCandidate({
    candidate,
    completion: { ...completion, lastAssistantStatus: "in_progress", currentNodeStatus: "in_progress" },
  }), { publishable: false, reason: "assistant-in-progress" });
  assert.deepEqual(assessResponseCandidate({
    candidate,
    completion: { ...completion, currentNodeStatus: "in_progress" },
  }), { publishable: false, reason: "current-node-in-progress" });
  assert.equal(assessResponseCandidate({
    candidate,
    completion: { ...completion, lastAssistantStatus: "finished_successfully", currentNodeStatus: "finished_successfully" },
  }).publishable, true);
  assert.equal(assessResponseCandidate({ candidate, completion }).publishable, true);
  assert.equal(assessResponseCandidate({
    candidate,
    allowIncompleteTurn: true,
    completion: { ...completion, lastAssistantStatus: "in_progress", currentNodeStatus: "in_progress" },
  }).publishable, true);
});

test("explicit interrupted tails allow saved partial turns while retaining freshness checks", () => {
  const baseline = { userMessages: 58, assistantMessages: 72 };
  const candidate = { userMessages: 59, assistantMessages: 73, lastRole: "assistant" };
  const completion = {
    lastAssistantStatus: "finished_successfully",
    lastAssistantEndTurn: false,
    currentNodeStatus: "finished_successfully",
    currentNodeRole: "assistant",
    currentNodeRecipient: "functions.exec",
    currentNodeEndTurn: null,
    currentNodeFinishType: "interrupted",
  };
  const options = { baseline, candidate, completion };
  assert.deepEqual(assessResponseCandidate(options), {
    publishable: true, reason: "response-interrupted",
  });
  // Stop may leave no new visible assistant message or regenerated identity.
  assert.equal(assessResponseCandidate({
    ...options,
    candidate: { userMessages: 59, assistantMessages: 72, lastRole: "user" },
    requireAssistantIdentityChange: true,
    baselineAssistantId: "old",
    candidateAssistantId: "old",
  }).publishable, true);
  assert.equal(assessResponseCandidate({ ...options, domUserCovered: false }).reason, "api-user-tail-behind-dom");
  assert.equal(assessResponseCandidate({
    ...options, candidate: { ...candidate, userMessages: 58 },
  }).reason, "user-not-advanced");
  assert.equal(assessResponseCandidate({
    ...options, completion: { ...completion, currentNodeStatus: "in_progress" },
  }).reason, "current-node-in-progress");
  assert.equal(assessResponseCandidate({
    ...options, completion: { ...completion, currentNodeFinishType: "" },
  }).publishable, false);
});

test("response candidate rejects an explicitly incomplete tool-use tail", () => {
  const baseline = {
    messages: 64,
    userMessages: 31,
    assistantMessages: 33,
    emptyMessages: 0,
    lastRole: "assistant",
  };
  const candidate = {
    messages: 66,
    userMessages: 32,
    assistantMessages: 34,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      candidate,
      completion: {
        lastAssistantEndTurn: false,
        currentNodeRole: "tool",
        currentNodeEndTurn: false,
        currentNodeRecipient: "assistant",
      },
    }),
    { publishable: false, reason: "assistant-end-turn-pending" },
  );
});

test("response candidate accepts an explicitly completed tool-use tail", () => {
  const baseline = {
    messages: 67,
    userMessages: 32,
    assistantMessages: 35,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      candidate: {
        messages: 70,
        userMessages: 33,
        assistantMessages: 37,
        emptyMessages: 0,
        lastRole: "assistant",
      },
      completion: {
        lastAssistantEndTurn: true,
        currentNodeRole: "assistant",
        currentNodeEndTurn: true,
        currentNodeRecipient: "all",
      },
    }),
    { publishable: true, reason: "response-advanced" },
  );
});

test("stopped responses may publish without terminal assistant completion", () => {
  const baseline = {
    messages: 10,
    userMessages: 5,
    assistantMessages: 5,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      expectedAssistantTurns: 0,
      allowIncompleteTurn: true,
      candidate: {
        messages: 11,
        userMessages: 6,
        assistantMessages: 5,
        emptyMessages: 0,
        lastRole: "user",
      },
      completion: {
        lastAssistantEndTurn: true,
        currentNodeRole: "user",
        currentNodeEndTurn: true,
        currentNodeRecipient: "all",
      },
    }),
    { publishable: true, reason: "response-advanced" },
  );
});

test("response candidate without a baseline cannot trail a visible assistant tail", () => {
  assert.deepEqual(
    assessResponseCandidate({
      candidate: { messages: 1, userMessages: 1, assistantMessages: 0, lastRole: "user" },
      domCandidate: { messages: 2, userMessages: 1, assistantMessages: 1, lastRole: "assistant" },
    }),
    { publishable: false, reason: "api-tail-behind-dom" },
  );
});

test("response candidate rejects an API snapshot missing the visible user frontier", () => {
  assert.deepEqual(
    assessResponseCandidate({
      candidate: { messages: 2, userMessages: 1, assistantMessages: 1, lastRole: "assistant" },
      domCandidate: { messages: 4, userMessages: 2, assistantMessages: 2, lastRole: "assistant" },
      domUserCovered: false,
      expectedTurns: 0,
    }),
    { publishable: false, reason: "api-user-tail-behind-dom" },
  );
});

test("regeneration requires the latest assistant identity to change", () => {
  const baseline = {
    messages: 10,
    userMessages: 5,
    assistantMessages: 5,
    emptyMessages: 0,
    lastRole: "assistant",
  };

  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      baselineAssistantId: "assistant-old",
      candidate: baseline,
      candidateAssistantId: "assistant-old",
      expectedTurns: 0,
      requireAssistantIdentityChange: true,
    }),
    { publishable: false, reason: "assistant-identity-unchanged" },
  );
  assert.deepEqual(
    assessResponseCandidate({
      baseline,
      baselineAssistantId: "assistant-old",
      candidate: baseline,
      candidateAssistantId: "assistant-new",
      expectedTurns: 0,
      requireAssistantIdentityChange: true,
    }),
    { publishable: true, reason: "response-advanced" },
  );
});

test("diagnostics remain bounded and return detached snapshots", () => {
  let now = 10;
  const diagnostics = createDiagnostics({ clock: () => now++, limit: 2 });
  diagnostics.record("first");
  diagnostics.record("second", { messages: 2 });
  diagnostics.record("third", { reason: "fresh" });

  const snapshot = diagnostics.snapshot();
  assert.deepEqual(snapshot, [
    { at: 11, event: "second", messages: 2 },
    { at: 12, event: "third", reason: "fresh" },
  ]);
  snapshot[0].event = "changed";
  assert.equal(diagnostics.snapshot()[0].event, "second");
});
