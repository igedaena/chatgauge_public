"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/model.js");
require("../src/adapters/chatgpt-dom.js");

test("structural diagnostics distinguish messages outside main without retaining their content", () => {
  const composer = { textContent: "private draft", closest: () => null };
  const roles = [{ textContent: "private user" }, { textContent: "private answer" }];
  const root = {
    querySelector: selector => selector.includes("#prompt-textarea") ? composer : null,
    querySelectorAll: selector => selector === '[data-message-author-role="user"], [data-message-author-role="assistant"]' ? roles : [],
  };
  const summary = globalThis.Chatcouter.chatGptDomAdapter.diagnosticSummary(root);
  assert.equal(summary.roleElements, 2);
  assert.equal(summary.roleElementsInMain, 0);
  assert.equal(summary.matchedTurns, 0);
  assert.equal(summary.composerPresent, true);
  assert.equal(summary.composerFormPresent, false);
  assert.ok(!JSON.stringify(summary).includes("private"));
});

const {
  getAssistantActionKeys,
  hasStreamingControl,
  mutationsNeedMeasurement,
  mutationsTouchActionControls,
} = globalThis.Chatcouter.chatGptDomAdapter;

function actionControl({ fallbackKey, key, assistant }) {
  return {
    querySelector(selector) {
      return assistant && selector.includes('aria-label="Copy"') ? {} : null;
    },
    closest(selector) {
      if (selector === "[data-turn-key]" && key) {
        return { getAttribute: (name) => name === "data-turn-key" ? key : null };
      }
      if (selector === "[data-content-search-turn-key]" && fallbackKey) {
        return {
          getAttribute: (name) => name === "data-content-search-turn-key" ? fallbackKey : null,
        };
      }
      return null;
    },
  };
}

test("assistant action keys exclude user controls and retain document order", () => {
  const root = {
    querySelectorAll: () => [
      actionControl({ fallbackKey: "fallback-turn-7", key: "turn-7", assistant: false }),
      actionControl({ fallbackKey: "fallback-turn-7", key: "turn-7", assistant: true }),
      actionControl({ fallbackKey: "fallback-turn-8", key: "turn-8", assistant: false }),
      actionControl({ fallbackKey: "fallback-turn-8", key: "turn-8", assistant: true }),
      actionControl({ fallbackKey: "fallback-turn-8", key: "turn-8", assistant: true }),
    ],
  };

  assert.deepEqual(getAssistantActionKeys(root), ["turn-7", "turn-8"]);
});

test("assistant action keys fall back when a stable turn key is unavailable", () => {
  const root = {
    querySelectorAll: () => [
      actionControl({ fallbackKey: "fallback-turn-7", assistant: true }),
    ],
  };

  assert.deepEqual(getAssistantActionKeys(root), ["fallback-turn-7"]);
});

test("action mutation detection only reacts inside or around action controls", () => {
  const insideTarget = {
    nodeType: 1,
    closest: (selector) => selector === ".turn-action-controls" ? {} : null,
  };
  const addedWrapper = {
    nodeType: 1,
    matches: () => false,
    querySelector: (selector) => selector === ".turn-action-controls" ? {} : null,
  };
  const unrelated = {
    nodeType: 1,
    closest: () => null,
    matches: () => false,
    querySelector: () => null,
  };

  assert.equal(mutationsTouchActionControls([{ target: insideTarget }]), true);
  assert.equal(mutationsTouchActionControls([{
    target: unrelated,
    addedNodes: [addedWrapper],
    removedNodes: [],
  }]), true);
  assert.equal(mutationsTouchActionControls([{
    target: unrelated,
    addedNodes: [unrelated],
    removedNodes: [],
  }]), false);
});

test("measurement mutations ignore owned UI and unsent composer drafts", () => {
  function targetInside(selectorToMatch) {
    return {
      nodeType: 1,
      closest: (selector) => selector === selectorToMatch ? {} : null,
    };
  }

  const owned = targetInside("#chatcouter-root");
  const composer = targetInside([
    "#prompt-textarea",
    'textarea[data-id="root"]',
    'form [contenteditable="true"]',
  ].join(","));
  const composerForm = {
    querySelector: () => ({}),
  };
  const composerToolbar = {
    nodeType: 1,
    closest: (selector) => selector === "form" ? composerForm : null,
  };
  const conversation = {
    nodeType: 1,
    closest: (selector) => selector.includes("main article") ? {} : null,
  };
  const unrelatedPortal = targetInside("[role=menu]");
  const addedTurn = {
    nodeType: 1,
    matches: (selector) => selector.includes("conversation-turn-"),
    querySelector: () => null,
  };

  assert.equal(mutationsNeedMeasurement([{ target: owned }]), false);
  assert.equal(mutationsNeedMeasurement([{ target: composer }]), false);
  assert.equal(mutationsNeedMeasurement([{ target: composerToolbar }]), false);
  assert.equal(mutationsNeedMeasurement([{ target: conversation }]), true);
  assert.equal(mutationsNeedMeasurement([{ target: unrelatedPortal }]), false);
  assert.equal(mutationsNeedMeasurement([{
    target: unrelatedPortal,
    addedNodes: [addedTurn],
    removedNodes: [],
  }]), true);
});

test("streaming control fallback distinguishes idle, draft, and response composer states", () => {
  function rootState({ composerText = "", disabled = false, explicitStop = false } = {}) {
    const action = {
      disabled: false,
      getAttribute: (name) => name === "aria-disabled" && disabled ? "true" : null,
    };
    const form = {
      querySelector: () => action,
    };
    const composer = {
      textContent: composerText,
      closest: (selector) => selector === "form" ? form : null,
    };

    return {
      querySelector(selector) {
        if (selector.includes('data-testid="stop-button"')) {
          return explicitStop ? {} : null;
        }
        if (selector.includes("#prompt-textarea")) return composer;
        return null;
      },
    };
  }

  assert.equal(hasStreamingControl(rootState({ explicitStop: true })), true);
  assert.equal(hasStreamingControl(rootState(), {
    allowEmptyComposerFallback: true,
  }), true);
  assert.equal(hasStreamingControl(rootState({ disabled: true }), {
    allowEmptyComposerFallback: true,
  }), false);
  assert.equal(hasStreamingControl(rootState({ composerText: "draft" }), {
    allowEmptyComposerFallback: true,
  }), false);
  assert.equal(hasStreamingControl(rootState({ composerText: "next draft" }), {
    allowActiveComposerFallback: true,
  }), true);
  assert.equal(hasStreamingControl(rootState()), false);
});
