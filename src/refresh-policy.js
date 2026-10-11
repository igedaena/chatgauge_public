(function registerRefreshPolicy(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});

  function classifyPage({ conversationId = "", hasComposer = false } = {}) {
    if (conversationId) return "conversation";
    if (hasComposer) return "new-chat";
    return "inactive";
  }

  function createEpochGate() {
    let epoch = 0;

    function advance() {
      epoch += 1;
      return epoch;
    }

    function capture({ conversationId = "", route = "" } = {}) {
      return Object.freeze({ epoch, conversationId, route });
    }

    function accepts(token, { conversationId = "", route = "" } = {}) {
      return Boolean(
        token
        && token.epoch === epoch
        && token.conversationId === conversationId
        && token.route === route
      );
    }

    return Object.freeze({ accepts, advance, capture });
  }

  function summarizeMessages(messages = []) {
    const summary = {
      messages: messages.length,
      userMessages: 0,
      assistantMessages: 0,
      emptyMessages: 0,
      lastRole: "",
    };

    for (const message of messages) {
      if (message.role === "user") summary.userMessages += 1;
      if (message.role === "assistant") summary.assistantMessages += 1;
      if (!message.text) summary.emptyMessages += 1;
      summary.lastRole = message.role || summary.lastRole;
    }

    return Object.freeze(summary);
  }

  function getLastAssistantId(messages = []) {
    const assistant = [...messages].reverse().find((message) => message.role === "assistant");
    return assistant?.id || "";
  }

  function updateUnverifiedResponseStreak({
    current = 0,
    outcome = "unchanged",
    responseMode = "",
  } = {}) {
    if (outcome === "verified-full" || outcome === "baseline-recovered" || outcome === "route-reset") return 0;
    if (
      outcome === "uncertain"
      && (responseMode === "new-turn" || responseMode === "regeneration")
    ) {
      return current + 1;
    }
    return current;
  }

  function assessAssistantActionChange({
    baselineKey = "",
    mode = "new-turn",
    markerRemoved = false,
    previousKeys = [],
    currentKeys = [],
  } = {}) {
    const previous = new Set(previousKeys);
    const current = new Set(currentKeys);
    const baselineRemoved = Boolean(
      baselineKey
      && previous.has(baselineKey)
      && !current.has(baselineKey)
    );
    const nextMarkerRemoved = markerRemoved || baselineRemoved;
    let completionKey = "";

    if (mode === "regeneration") {
      if (
        baselineKey
        && nextMarkerRemoved
        && !previous.has(baselineKey)
        && current.has(baselineKey)
      ) {
        completionKey = baselineKey;
      }
    } else {
      // Older turns can reappear as the page virtualizes its history.
      // Only a new action after the still-visible baseline is a completion hint.
      const baselineIndex = currentKeys.indexOf(baselineKey);
      const addedKeys = baselineIndex < 0 ? []
        : currentKeys.slice(baselineIndex + 1).filter((key) => !previous.has(key));
      completionKey = [...addedKeys].reverse().find((key) => key !== baselineKey) || "";
    }

    return Object.freeze({
      completionSeen: Boolean(completionKey),
      completionKey,
      markerRemoved: nextMarkerRemoved,
    });
  }

  function expectedAssistantAdvance(turns, stoppedTurns = 0) {
    // Past unanswered turns must not permanently block a later completed tail.
    return Math.min(Math.max(turns - stoppedTurns, 0), 1);
  }

  function coversLatestDomUser(candidateMessages = [], domMessages = []) {
    const domUser = [...domMessages].reverse().find((message) => message.role === "user");
    if (!domUser) return null;

    const candidateUser = [...candidateMessages].reverse().find((message) => message.role === "user");
    if (!candidateUser) return false;
    if (domUser.id && candidateUser.id === domUser.id) return true;
    if (!domUser.text) return null;
    if (domUser.id && !/^user-\d+$/.test(domUser.id)) return false;
    return candidateUser.text === domUser.text;
  }

  function includesCapturedDomUser(candidateMessages = [], domMessages = []) {
    const user = [...domMessages].reverse().find((message) => message.role === "user");
    if (!user) return null;
    // The DOM adapter uses user-<ordinal> when no stable message ID exists.
    // A captured user can precede later input in the returned active branch.
    if (user.id && !/^user-\d+$/.test(user.id)) {
      return candidateMessages.some((message) => message.role === "user" && message.id === user.id);
    }
    if (!user.text) return null;
    return candidateMessages.some((message) => message.role === "user" && message.text === user.text);
  }

  function assessResponseCandidate({
    baseline,
    baselineAssistantId = "",
    candidate,
    candidateAssistantId = "",
    completion,
    domCandidate,
    domUserCovered = null,
    expectedTurns = 1,
    expectedAssistantTurns = expectedTurns,
    allowIncompleteTurn = false,
    requireAssistantIdentityChange = false,
  } = {}) {
    if (!candidate) {
      return Object.freeze({ publishable: false, reason: "candidate-missing" });
    }

    if (domUserCovered === false) {
      return Object.freeze({ publishable: false, reason: "api-user-tail-behind-dom" });
    }

    const interrupted = completion?.currentNodeFinishType === "interrupted";
    if (!allowIncompleteTurn && completion) {
      if (completion.lastAssistantStatus === "in_progress") {
        return Object.freeze({ publishable: false, reason: "assistant-in-progress" });
      }
      if (completion.currentNodeStatus === "in_progress") {
        return Object.freeze({ publishable: false, reason: "current-node-in-progress" });
      }
    }
    if (!allowIncompleteTurn && !interrupted && completion) {
      if (completion.lastAssistantEndTurn === false) {
        return Object.freeze({ publishable: false, reason: "assistant-end-turn-pending" });
      }
      if (completion.currentNodeEndTurn === false) {
        return Object.freeze({ publishable: false, reason: "current-node-end-turn-pending" });
      }
      if (
        completion.currentNodeRole
        && completion.currentNodeRole !== "assistant"
      ) {
        return Object.freeze({ publishable: false, reason: "current-node-not-assistant" });
      }
      if (
        completion.currentNodeRecipient
        && completion.currentNodeRecipient !== "all"
      ) {
        return Object.freeze({ publishable: false, reason: "current-node-not-visible" });
      }
    }

    if (baseline) {
      if (candidate.userMessages < baseline.userMessages + expectedTurns) {
        return Object.freeze({ publishable: false, reason: "user-not-advanced" });
      }
      if (!interrupted && candidate.assistantMessages < baseline.assistantMessages + expectedAssistantTurns) {
        return Object.freeze({ publishable: false, reason: "assistant-not-advanced" });
      }
    }

    if (
      requireAssistantIdentityChange
      && !interrupted
      && baselineAssistantId
      && candidateAssistantId === baselineAssistantId
    ) {
      return Object.freeze({ publishable: false, reason: "assistant-identity-unchanged" });
    }

    if (domCandidate?.lastRole === "assistant" && candidate.lastRole !== "assistant") {
      return Object.freeze({ publishable: false, reason: "api-tail-behind-dom" });
    }
    if (expectedAssistantTurns > 0 && !interrupted && !allowIncompleteTurn
      && candidate.lastRole !== "assistant") {
      return Object.freeze({ publishable: false, reason: "api-tail-not-assistant" });
    }

    return Object.freeze({ publishable: true, reason: interrupted ? "response-interrupted" : "response-advanced" });
  }

  function createDiagnostics({ clock = () => Date.now(), limit = 200 } = {}) {
    const entries = [];

    function record(event, details = {}) {
      const entry = Object.freeze({ at: clock(), event, ...details });
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      return entry;
    }

    function snapshot() {
      return entries.map((entry) => ({ ...entry }));
    }

    return Object.freeze({ record, snapshot });
  }

  namespace.refreshPolicy = Object.freeze({
    assessAssistantActionChange,
    assessResponseCandidate,
    classifyPage,
    coversLatestDomUser,
    createDiagnostics,
    createEpochGate,
    expectedAssistantAdvance,
    getLastAssistantId,
    includesCapturedDomUser,
    summarizeMessages,
    updateUnverifiedResponseStreak,
  });
})(globalThis);
