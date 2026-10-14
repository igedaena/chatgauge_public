"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const manifest = require("../manifest.json");

test("manifest validation rejects missing and late runtime dependencies", async () => {
  const { validateContentScriptDependencies } = await import("../scripts/validate-manifest.mjs");
  const entry = manifest.content_scripts[0];
  assert.doesNotThrow(() => validateContentScriptDependencies(entry));
  for (const [dependency, consumer] of [
    ["src/document-viewer.js", "src/content.js"],
    ["src/adapters/chatgpt-dom.js", "src/content.js"],
    ["src/vendor/marked.umd.js", "src/exporters/html.js"],
    ["src/vendor/marked.umd.js", "src/exporters/display-markup.js"],
    ["src/exporters/display-markup.js", "src/exporters/markdown.js"],
    ["src/exporters/display-markup.js", "src/exporters/html.js"],
    ["src/model.js", "src/exporters/json.js"],
  ]) {
    const missing = entry.js.filter(file => file !== dependency);
    assert.throws(() => validateContentScriptDependencies({ ...entry, js: missing }));
    const late = missing.slice();
    late.splice(late.indexOf(consumer) + 1, 0, dependency);
    assert.throws(() => validateContentScriptDependencies({ ...entry, js: late }));
  }
});
