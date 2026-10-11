"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/model.js");
require("../src/exporters/common.js");
require("../src/exporters/json.js");

const { createMessage } = globalThis.Chatcouter.model;
const { createFilename, safeFilePart } = globalThis.Chatcouter.exportUtils;
const { createJsonExport } = globalThis.Chatcouter.jsonExporter;

test("filenames keep an 80 UTF-16 limit without splitting emoji or leaving malformed characters", () => {
  assert.equal(safeFilePart("a".repeat(79) + "😀"), "a".repeat(79));
  assert.equal(safeFilePart("a".repeat(78) + "😀end"), "a".repeat(78) + "😀");
  assert.equal(safeFilePart("a".repeat(78) + ". x"), "a".repeat(78));
  assert.equal(safeFilePart("\ud800"), "conversation");
  assert.equal(safeFilePart("x\ud800y\udc00"), "xy");
  for (const extension of ["md", "json", "html", "zip"]) {
    const name = createFilename({ title: "a".repeat(79) + "😀", extension, includeDate: false, includeTime: false });
    assert.equal(name, "a".repeat(79) + "." + extension);
    assert.equal(name.isWellFormed(), true);
  }
});

test("createJsonExport preserves the shared message model and totals", () => {
  const messages = [
    createMessage({
      id: "u1",
      role: "user",
      text: "질문",
      ordinal: 0,
      createdAt: "2026-09-24T04:00:00.000Z",
    }),
    createMessage({ id: "a1", role: "assistant", text: "answer 😀", ordinal: 1 }),
  ];

  const output = JSON.parse(createJsonExport({
    messages,
    title: "테스트 대화",
    conversationId: "conversation-1",
    source: "full",
    exportedAt: "2026-09-24T04:05:06.000Z",
  }));

  assert.equal(output.schemaVersion, 1);
  assert.equal(output.exportedAt, "2026-09-24T04:05:06.000Z");
  assert.deepEqual(output.conversation.totals, {
    characters: 10,
    utf8Bytes: 17,
    messages: 2,
    userMessages: 1,
    assistantMessages: 1,
    emptyMessages: 0,
  });
  assert.deepEqual(output.conversation.messages, [
    {
      id: "u1",
      role: "user",
      text: "질문",
      ordinal: 0,
      createdAt: "2026-09-24T04:00:00.000Z",
    },
    { id: "a1", role: "assistant", text: "answer 😀", ordinal: 1, createdAt: "" },
  ]);
});

test("createFilename removes unsafe filename characters and uses UTC time", () => {
  assert.equal(
    createFilename({
      title: '  Project: "alpha" / beta?  ',
      exportedAt: "2026-09-24T04:05:06.000Z",
      extension: "json",
    }),
    "Project alpha beta_20260924-040506.json",
  );
  assert.equal(safeFilePart("..."), "conversation");
});

test("createFilename independently excludes date and time without stray separators", () => {
  for (const [includeDate, includeTime, expected] of [
    [true, true, "제목_20260924-040506.json"],
    [true, false, "제목_20260924.json"],
    [false, true, "제목_040506.json"],
    [false, false, "제목.json"],
  ]) {
    assert.equal(createFilename({ title: "제목", exportedAt: "2026-09-24T13:05:06+09:00",
      extension: "json", includeDate, includeTime }), expected);
  }
});
