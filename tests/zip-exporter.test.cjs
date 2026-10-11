"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const readZip = require("./helpers/read-zip.cjs");
require("../src/exporters/zip.js");
const { createZip } = globalThis.Chatcouter.zipExporter;

test("ZIP round trips Unicode filenames and text with independently verified CRCs", () => {
  const files = [
    { filename: "한글 😀.md", contents: "한글\n```js\n  1 < 2\n```" },
    { filename: "한글 😀.json", contents: '{"value":"시험"}\n' },
    { filename: "empty.html", contents: "" },
  ];
  assert.deepEqual(readZip(createZip(files, "2026-10-01T04:30:00Z")), files);
});

test("ZIP rejects duplicate or unsafe paths and invalid dates", () => {
  for (const filename of ["../escape.md", "dir/file.md", "..", "bad\u0000.md"]) {
    assert.throws(() => createZip([{ filename, contents: "x" }]), /Unsafe ZIP filename/);
  }
  assert.throws(() => createZip([{ filename: "a", contents: "" }, { filename: "a", contents: "" }]), /Unsafe ZIP filename/);
  assert.throws(() => createZip([]), /Invalid ZIP entries/);
  assert.throws(() => createZip([{ filename: "a", contents: "" }], "invalid"), /Invalid ZIP timestamp/);
});
