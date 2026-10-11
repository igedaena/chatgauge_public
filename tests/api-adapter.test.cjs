"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/model.js");
require("../src/adapters/chatgpt-api.js");

const { extract, extractActiveBranch, getConversationId, messageText } =
  globalThis.Chatcouter.chatGptApiAdapter;

test("getConversationId supports ordinary and project conversation routes", () => {
  assert.equal(
    getConversationId({ pathname: "/c/11111111-2222-3333-4444-555555555555" }),
    "11111111-2222-3333-4444-555555555555",
  );
  assert.equal(
    getConversationId({ pathname: "/g/g-p-project/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
});

test("messageText preserves text and ignores non-text multimodal parts", () => {
  assert.equal(
    messageText({
      content: {
        parts: [
          "describe this",
          { content_type: "image_asset_pointer", asset_pointer: "file-service://example" },
          { text: "caption" },
        ],
      },
    }),
    "describe this\ncaption",
  );
});

test("extractActiveBranch follows parents and excludes sibling branches", () => {
  const payload = {
    title: "Branched conversation",
    current_node: "assistant-new",
    mapping: {
      root: { id: "root", parent: null, message: { author: { role: "system" } } },
      user: {
        id: "user",
        parent: "root",
        message: {
          id: "message-user",
          author: { role: "user" },
          create_time: 1_750_000_000,
          content: { parts: ["question"] },
          metadata: {},
        },
      },
      "assistant-old": {
        id: "assistant-old",
        parent: "user",
        message: {
          author: { role: "assistant" },
          content: { parts: ["discarded answer"] },
          metadata: {},
        },
      },
      "assistant-tool": {
        id: "assistant-tool",
        parent: "user",
        message: {
          author: { role: "assistant" },
          recipient: "python",
          content: { content_type: "code", parts: ["private tool call"] },
          metadata: {},
        },
      },
      "assistant-thought": {
        id: "assistant-thought",
        parent: "assistant-tool",
        message: {
          author: { role: "assistant" },
          recipient: "all",
          content: { content_type: "thoughts", parts: ["private reasoning"] },
          metadata: {},
        },
      },
      "assistant-new": {
        id: "assistant-new",
        parent: "assistant-thought",
        message: {
          id: "message-assistant-new",
          author: { role: "assistant" },
          recipient: "all",
          status: "finished_successfully",
          end_turn: true,
          content: { content_type: "text", parts: ["active answer"] },
          metadata: { finish_details: { type: "stop" } },
        },
      },
    },
  };

  const result = extractActiveBranch(payload);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.messages.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "question" },
      { role: "assistant", text: "active answer" },
    ],
  );
  assert.equal(result.messages[0].createdAt, "2025-06-15T15:06:40.000Z");
  assert.deepEqual(result.completion, {
    lastAssistantStatus: "finished_successfully",
    lastAssistantEndTurn: true,
    lastAssistantFinishType: "stop",
    currentNodeRole: "assistant",
    currentNodeStatus: "finished_successfully",
    currentNodeEndTurn: true,
    currentNodeRecipient: "all",
    currentNodeContentType: "text",
    currentNodeFinishType: "stop",
  });
});

test("completion diagnostics distinguish an intermediary assistant from the tool tail", () => {
  const result = extractActiveBranch({
    current_node: "tool",
    mapping: {
      user: {
        id: "user",
        parent: null,
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["question"] },
          metadata: {},
        },
      },
      preamble: {
        id: "preamble",
        parent: "user",
        message: {
          author: { role: "assistant" },
          recipient: "all",
          status: "finished_successfully",
          end_turn: false,
          content: { content_type: "text", parts: ["working"] },
          metadata: {},
        },
      },
      tool: {
        id: "tool",
        parent: "preamble",
        message: {
          author: { role: "tool" },
          recipient: "assistant",
          status: "finished_successfully",
          end_turn: false,
          content: { content_type: "text", parts: ["private result"] },
          metadata: {},
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.messages.map(({ role }) => role), ["user", "assistant"]);
  assert.deepEqual(result.completion, {
    lastAssistantStatus: "finished_successfully",
    lastAssistantEndTurn: false,
    lastAssistantFinishType: "",
    currentNodeRole: "tool",
    currentNodeStatus: "finished_successfully",
    currentNodeEndTurn: false,
    currentNodeRecipient: "assistant",
    currentNodeContentType: "text",
    currentNodeFinishType: "",
  });
});

test("extract retries a protected conversation with an in-memory session token", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  const payload = {
    title: "Protected conversation",
    current_node: "answer",
    mapping: {
      question: {
        id: "question",
        parent: null,
        message: {
          author: { role: "user" },
          content: { parts: ["hello"] },
          metadata: {},
        },
      },
      answer: {
        id: "answer",
        parent: "question",
        message: {
          author: { role: "assistant" },
          content: { parts: ["hi"] },
          metadata: {},
        },
      },
    },
  };

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers?.Authorization || "" });
    if (String(url).endsWith("/api/auth/session")) {
      return new Response(JSON.stringify({ accessToken: "short-lived-test-token" }), { status: 200 });
    }
    if (options.headers?.Authorization) {
      return new Response(JSON.stringify(payload), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await extract({
    locationLike: {
      origin: "https://chatgpt.com",
      pathname: "/c/11111111-2222-3333-4444-555555555555",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.messages.length, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].authorization, "Bearer short-lived-test-token");
});

test("extract returns a finite timeout failure for a stalled conversation request", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  const result = await extract({
    locationLike: {
      origin: "https://chatgpt.com",
      pathname: "/c/11111111-2222-3333-4444-555555555555",
    },
    timeoutMs: 5,
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "conversation-request-timeout",
    messages: [],
  });
});

test("extract preserves caller cancellation separately from request timeout", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  const controller = new AbortController();
  const pending = extract({
    locationLike: {
      origin: "https://chatgpt.com",
      pathname: "/c/11111111-2222-3333-4444-555555555555",
    },
    signal: controller.signal,
    timeoutMs: 1000,
  });
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
});
