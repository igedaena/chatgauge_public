"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

globalThis.browser = { i18n: require("./helpers/i18n.cjs")("en") };
require("../src/i18n.js");
require("../src/model.js");
globalThis.marked = require("../src/vendor/marked.umd.js");
require("../src/exporters/display-markup.js");
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

const annotation = (kind, payload = "id") => "\uE200" + kind + "\uE202" + payload + "\uE201";
const clean = globalThis.Chatcouter.displayMarkup.cleanMarkdown;
const { t } = globalThis.Chatcouter.i18n;
const fileLabel = "\\[File citation\\]";
require("../src/exporters/json.js");

test("MD shares known annotation labels with HTML while JSON, measurements and notices retain source", () => {
  const text = [annotation("cite"), annotation("memcite"), annotation("filecite"), annotation("genui"),
    annotation("url", "Guide\uE202id"), annotation("entity", '["type","Name"]'),
    annotation("image_group", '{"query":"synthetic"}')].join(" / ");
  const messages = [createMessage({ role: "user", text, ordinal: 0 }), createMessage({ role: "assistant", text, ordinal: 1 })];
  const before = JSON.stringify(messages);
  const preservation = { warning: "Still unverified", reason: "completion-unverified" };
  const output = createMarkdownExport({ messages, preservation });
  const response = output.split("## Response:\n\n")[1];
  assert.equal(response.trimEnd(), ["", "", fileLabel, "\\[Additional UI element\\]", "Guide", "Name", "\\[Image group\\]"].join(" / "));
  assert.ok(output.includes("## Prompt:\n\n" + text));
  const totals = globalThis.Chatcouter.model.measureConversation(messages);
  assert.ok(output.includes(totals.characters + " characters, " + totals.utf8Bytes + " UTF-8 bytes"));
  assert.ok(output.includes(preservation.warning)); assert.ok(output.includes(preservation.reason));
  const json = globalThis.Chatcouter.jsonExporter.createJsonExport({ messages, preservation });
  assert.ok(json.includes(JSON.stringify(text)));
  assert.equal(JSON.stringify(messages), before);
});

test("MD preserves fenced and indented code, code spans, escapes, unknown and malformed annotations exactly", () => {
  const marker = annotation("filecite");
  const literal = ['\\' + marker, '\uE200cite\uE202unfinished', annotation("unknown", "**example**"),
    annotation("entity", "not-json"), annotation("image_group", "[]"), "\uE234"].join("\n\n");
  const code = "~~~md\n" + marker + "\n~~~\n\n    " + marker + "\n\n" + "`` " + marker + " ``";
  const source = code + "\n\n" + literal;
  assert.equal(clean(source), source);
  assert.equal(clean(marker + "\n\n" + code), fileLabel + "\n\n" + code);
  assert.equal(clean(code + "\n\n" + marker), code + "\n\n" + fileLabel);
});

test("MD cleans annotations in headings, emphasis, quotes, nested lists, tasks and table cells without rewriting syntax", () => {
  const marker = annotation("filecite");
  for (const source of ["# Title " + marker, "**bold " + marker + "** and _italic_", "> quote " + marker + "\n> next " + marker,
    "- item " + marker + "\n  next " + marker, "- first\n  - nested " + marker,
    "- [x] done " + marker, "| x | y |\n|---|---|\n| " + marker + " | x |", "[label " + marker + "](https://example.com)"]) {
    assert.equal(clean(source), source.split(marker).join(fileLabel));
  }
  const ordinary = '# Ordinary\n\n> quote\n> next\n\n- [x] first\n  - nested\n\n**bold** _italic_ &amp; <tag>\n\n[link](https://example.com)';
  assert.equal(clean(ordinary), ordinary);
});

test("MD removes only complete supported writing wrappers, retains body/code and protects literal variants", () => {
  const body = '**Body**\n\n```md\n:::\n' + annotation("filecite") + '\n```\n\nEnd\n';
  for (const variant of ["document", "chat_message"]) {
    const source = 'Before\n\n:::writing{variant="' + variant + '" title="Synthetic"}\n' + body + ':::\n\nAfter';
    assert.equal(clean(source), "Before\n\n" + body + "\nAfter");
  }
  for (const source of [':::writing{variant="document"}\nBody without end',
    ':::writing{variant="email"}\nBody\n:::', ':::writing{variant="document" title="unfinished}\nBody\n:::',
    ':::writing{variant="document"}\n:::writing{variant="chat_message"}\nBody\n:::\n:::',
    '```md\n:::writing{variant="document"}\nBody\n:::\n```',
    '\uE200unknown\uE202' + annotation("filecite")]) assert.equal(clean(source), source);
});

test("annotation labels stay literal Markdown rather than injecting formatting or links", () => {
  for (const label of ['[click](javascript:alert(1))', '<img src=x>', '**bold** | cell', '- new item', '1. new item']) {
    const output = clean(annotation("url", label + "\uE202id"));
    const rendered = globalThis.Chatcouter.displayMarkup.lexer(output);
    assert.ok(!JSON.stringify(rendered).includes('"type":"link"'));
    assert.ok(!JSON.stringify(rendered).includes('"type":"html"'));
    assert.ok(!JSON.stringify(rendered).includes('"type":"strong"'));
    assert.ok(!JSON.stringify(rendered).includes('"type":"list"'));
    assert.equal(clean(output), output);
  }
});

test("ambiguous writing containers and incomplete examples cannot partially lose wrappers or inner literals", () => {
  const marker = annotation("filecite");
  for (const source of ['> :::writing{variant="document"}\n> Body\n> :::',
    '- :::writing{variant="document"}\n  Body\n  :::',
    ':::writing{variant="email"}\n:::writing{variant="document"}\n' + marker + '\n:::\n:::',
    ':::writing{variant="document"}\n' + marker,
    ':::writing{variant="document" title="bad\\q"}\n' + marker + '\n:::']) assert.equal(clean(source), source);
});
