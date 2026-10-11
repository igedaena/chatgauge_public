"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const domTurns = require("./helpers/dom-turns.cjs");
require("../src/model.js");
require("../src/adapters/chatgpt-api.js");
require("../src/adapters/chatgpt-dom.js");
require("../src/refresh-policy.js");
const { chatGptApiAdapter: api, chatGptDomAdapter: dom, refreshPolicy: policy } = globalThis.Chatcouter;
let candidate;
let currentDomRoot;
globalThis.Chatcouter.chatGptApiAdapter = { ...api, extract: async () => candidate };
globalThis.Chatcouter.chatGptDomAdapter = { ...dom,
  extract: () => dom.extract(currentDomRoot, { pathname: "/c/synthetic" }) };
require("../src/conversation-snapshot.js");

function branch(messages) {
  const mapping = {};
  messages.forEach((message, index) => {
    const nodeId = message.nodeId || `node-${index}`;
    mapping[nodeId] = { id: nodeId, parent: index ? messages[index - 1].nodeId || `node-${index - 1}` : null,
      message: { id: message.id, author: { role: message.role }, content: { parts: [message.text] },
        status: "finished_successfully", end_turn: true, recipient: "all" } };
  });
  return api.extractActiveBranch({ mapping, current_node: messages.at(-1).nodeId || `node-${messages.length - 1}` });
}

test("DOM/API/policy/checkpoint agree on message IDs despite UI turn labels and later input", async () => {
  const captured = { id: "captured", wrapperId: "wrapper", role: "user", text: "repeated prompt" };
  const snapshot = dom.extract(domTurns([captured]), { pathname: "/c/synthetic" });
  assert.equal(snapshot.messages[0].id, "captured");
  candidate = branch([captured, { id: "later", role: "user", text: "later prompt" }]);
  assert.equal(policy.includesCapturedDomUser(candidate.messages, snapshot.messages), true);
  assert.equal(policy.coversLatestDomUser(candidate.messages, snapshot.messages), false);
  const options = { signal: new AbortController().signal, isCurrent: () => true, domSnapshot: snapshot };
  assert.equal((await globalThis.Chatcouter.conversationSnapshot.readCheckpoint(options)).ok, true);
  candidate = branch([{ ...captured, id: "other-branch" }]);
  assert.equal(policy.includesCapturedDomUser(candidate.messages, snapshot.messages), false);
  assert.equal(policy.coversLatestDomUser(candidate.messages, snapshot.messages), false);
  assert.equal((await globalThis.Chatcouter.conversationSnapshot.readCheckpoint(options)).reason, "api-user-tail-behind-dom");
});

test("ordinal DOM fallback and API node ID fallback retain their distinct coverage contracts", async () => {
  const snapshot = dom.extract(domTurns([{ role: "user", text: "synthetic prompt" }]), { pathname: "/c/synthetic" });
  assert.equal(snapshot.messages[0].id, "user-0");
  candidate = branch([{ nodeId: "user-node", role: "user", text: "synthetic prompt" }]);
  assert.equal(candidate.messages[0].id, "user-node");
  assert.equal(policy.coversLatestDomUser(candidate.messages, snapshot.messages), true);
  const options = { signal: new AbortController().signal, isCurrent: () => true, domSnapshot: snapshot };
  assert.equal((await globalThis.Chatcouter.conversationSnapshot.readCheckpoint(options)).ok, true);
  const identified = dom.extract(domTurns([{ wrapperId: "user-node", role: "user", text: "synthetic prompt" }]), { pathname: "/c/synthetic" });
  assert.equal(policy.includesCapturedDomUser(candidate.messages, identified.messages), true);
  candidate = branch([{ role: "user", text: "missing prompt" }]);
  assert.equal((await globalThis.Chatcouter.conversationSnapshot.readCheckpoint(options)).ok, false);
});

test("checkpoint captures once while Export checks the current DOM and preserves null coverage", async () => {
  const captured = { id: "u1", role: "user", text: "initial prompt" };
  const later = { id: "u2", role: "user", text: "later prompt" };
  const domSnapshot = dom.extract(domTurns([captured]), { pathname: "/c/synthetic" });
  currentDomRoot = domTurns([captured, later]);
  candidate = branch([captured]);
  const options = { signal: new AbortController().signal, isCurrent: () => true };
  const reader = globalThis.Chatcouter.conversationSnapshot;
  assert.equal((await reader.readCheckpoint({ ...options, domSnapshot })).ok, true);
  assert.equal((await reader.readExport(options)).reason, "api-user-tail-behind-dom");
  candidate = branch([captured, later]);
  assert.equal((await reader.readExport(options)).ok, true);
  currentDomRoot = domTurns([]);
  assert.equal((await reader.readExport(options)).ok, true, "unobserved DOM does not become a known mismatch");
  const aborted = new AbortController();
  aborted.abort();
  assert.equal((await reader.readCheckpoint({ ...options, signal: aborted.signal, domSnapshot })).ok, false);
  assert.equal((await reader.readExport({ ...options, isCurrent: () => false })).ok, false);
});
