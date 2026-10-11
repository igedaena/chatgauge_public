"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

globalThis.browser = { i18n: require("./helpers/i18n.cjs")("en") };
require("../src/i18n.js");
require("../src/model.js");
require("../src/exporters/markdown.js");

const { createMessage } = globalThis.Chatcouter.model;
const { createMarkdownExport } = globalThis.Chatcouter.markdownExporter;

test("createMarkdownExport renders metadata and messages in active-branch order", () => {
  const messages = [
    createMessage({
      id: "u1",
      role: "user",
      text: "# question",
      ordinal: 0,
      createdAt: "2026-09-24T04:00:00.000Z",
    }),
    createMessage({ id: "a1", role: "assistant", text: "answer\n\n```js\n1\n```", ordinal: 1 }),
    createMessage({ id: "a2", role: "assistant", text: "", ordinal: 2 }),
  ];

  const output = createMarkdownExport({
    messages,
    title: "Line one\nLine two",
    conversationId: "conversation-1",
    source: "full",
    exportedAt: "2026-09-24T04:05:06.000Z",
  });

  assert.match(output, /^# Line one Line two\n/);
  assert.match(output, /- Messages: 3 \(user 1, assistant 2\)/);
  assert.match(output, /## Prompt:\n\n2026-09-24T04:00:00.000Z\n\n# question/);
  assert.match(output, /## Response:\n\nanswer\n\n```js\n1\n```/);
  assert.match(output, /## Response:\n\n<!-- Empty message body -->/);
  assert.ok(output.endsWith("\n"));
});
