"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/model.js");

const {
  createMessage,
  formatBytes,
  measureConversation,
  normalizeCreatedAt,
  normalizeText,
} = globalThis.Chatcouter.model;

test("normalizeText stabilizes newlines without changing internal paragraphs", () => {
  assert.equal(normalizeText("  hello  \r\n\r\n\r\nworld\t\r\n"), "hello\n\nworld");
});

test("createMessage accepts user and assistant roles only", () => {
  assert.equal(createMessage({ role: "user", text: " hi ", ordinal: 0 }).text, "hi");
  assert.throws(
    () => createMessage({ role: "tool", text: "hidden", ordinal: 1 }),
    /Unsupported message role/,
  );
});

test("createMessage normalizes API timestamps without inventing missing times", () => {
  assert.equal(
    createMessage({ role: "user", text: "hi", ordinal: 0, createdAt: 1_750_000_000 }).createdAt,
    "2025-06-15T15:06:40.000Z",
  );
  assert.equal(createMessage({ role: "assistant", text: "hi", ordinal: 1 }).createdAt, "");
  assert.equal(normalizeCreatedAt("not-a-date"), "");
});

test("measureConversation counts Unicode code points and UTF-8 bytes", () => {
  const messages = [
    createMessage({ role: "user", text: "가A", ordinal: 0 }),
    createMessage({ role: "assistant", text: "😀", ordinal: 1 }),
    createMessage({ role: "assistant", text: "", ordinal: 2 }),
  ];

  assert.deepEqual(measureConversation(messages), {
    characters: 3,
    utf8Bytes: 8,
    messages: 3,
    userMessages: 1,
    assistantMessages: 2,
    emptyMessages: 1,
  });
});

test("formatBytes chooses readable units", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.00 MB");
});

