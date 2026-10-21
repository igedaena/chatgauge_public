"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto");
const sample = () => JSON.parse(fs.readFileSync("src/themes/default-sample.json", "utf8"));
const png = () => new Uint8Array(fs.readFileSync("src/themes/default-sample.png"));
function harness() {
  const stored = {}, writes = [];
  const context = vm.createContext({ structuredClone, TextEncoder, TextDecoder, Uint8Array, Blob, atob, btoa,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, crypto: crypto.webcrypto,
    Image: class { naturalWidth = sample().atlas.width; naturalHeight = sample().atlas.height; async decode() {} },
    browser: { storage: { local: { get: async () => structuredClone(stored), set: async patch => { writes.push(patch); Object.assign(stored, patch); } } } } });
  for (const file of ["src/exporters/zip.js", "src/theme-contract.js", "src/theme-package.js", "src/theme-settings.js", "tools/theme-editor/editor-model.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context);
  }
  return { ...context.Chatcouter, stored, writes };
}
test("theme ZIP preserves binary PNG and disabled component settings across reopening", async () => {
  const h = harness(), state = h.themeEditorModel.create(sample());
  const off = h.themeEditorModel.toggle(state, "conversation", "symbol", false);
  const bytes = h.themePackage.pack(off.theme, png()), pair = h.themePackage.unpack(bytes);
  assert.deepEqual(Buffer.from(pair.pngBytes), Buffer.from(png()));
  const result = await h.themePackage.read(bytes);
  assert.equal(result.theme.version, "chatgauge-theme-2");
  assert.equal(result.theme.conversation.components.symbol.enabled, false);
  assert.equal(result.theme.idle.background, null);
  const restored = h.themeEditorModel.toggle(h.themeEditorModel.create(result.theme), "conversation", "symbol", true);
  assert.equal(restored.theme.conversation.components.symbol.paint[0].source.width, sample().conversation.components.symbol.paint[0].source.width);
});
test("theme ZIP rejects corrupt records, CRC, unsafe composition, compression and image-pair mismatches", async () => {
  const h = harness(), bytes = h.themePackage.pack(sample(), png());
  const badCrc = bytes.slice(); badCrc[60] ^= 1;
  const compressed = bytes.slice(); compressed[8] = 8;
  const centralMismatch = bytes.slice(); centralMismatch[bytes.length - 6] ^= 1;
  for (const bad of [badCrc, compressed, centralMismatch, bytes.slice(0, -1), new Uint8Array(h.themePackage.maxBytes + 1)]) {
    assert.throws(() => h.themePackage.unpack(bad));
  }
  assert.throws(() => h.themePackage.unpack(h.zipExporter.createZip([{ filename: "extra.txt", contents: "x" }, { filename: "chatgauge-theme.png", contents: png() }])));
  const wrong = sample(); wrong.atlas.sha256 = "0".repeat(64);
  await assert.rejects(h.themePackage.read(h.themePackage.pack(wrong, png())));
  const overlap = sample(); overlap.conversation.components.secondary.y = overlap.conversation.components.measure.y;
  await assert.rejects(h.themePackage.read(h.themePackage.pack(overlap, png())));
});
test("disabled rectangles retain bounds/font/crop checks while overlap only counts active components", () => {
  const h = harness(), theme = h.themeContract.upgrade(sample());
  theme.conversation.components.secondary.enabled = false;
  theme.conversation.components.secondary.y = theme.conversation.components.measure.y;
  assert.doesNotThrow(() => h.themeContract.validateTheme(theme));
  theme.conversation.components.secondary.enabled = true;
  assert.throws(() => h.themeContract.validateTheme(theme));
  theme.conversation.components.secondary.enabled = false;
  theme.conversation.components.secondary.x = -1;
  assert.throws(() => h.themeContract.validateTheme(theme));
  theme.conversation.components.secondary.x = 45;
  theme.conversation.components.secondary.text.family = "bad;css";
  assert.throws(() => h.themeContract.validateTheme(theme));
  theme.conversation.components.secondary.text.family = "serif";
  theme.conversation.components.measure.enabled = false;
  assert.throws(() => h.themeContract.validateTheme(theme));
});
test("home can disable both components and stage holes are explicit optional slots", () => {
  const h = harness(), theme = h.themeContract.upgrade(sample());
  for (const box of Object.values(theme.idle.components)) box.enabled = false;
  theme.conversation.background.sources[1] = null;
  assert.doesNotThrow(() => h.themeContract.validateTheme(theme));
  theme.conversation.background.sources[0] = null;
  assert.throws(() => h.themeContract.validateTheme(theme));
});
test("theme import replaces storage only after validation and flags do not discard saved assets", async () => {
  const h = harness(), settings = h.themeSettings;
  const initial = await settings.get(); assert.equal(initial.enabled, false); assert.equal(initial.entry, false);
  const saved = await settings.importZip(h.themePackage.pack(sample(), png()));
  assert.equal(h.writes.length, 1);
  assert.equal((await settings.layout(saved)).version, "chatgauge-theme-2");
  await settings.setFlag(settings.ENABLED, true); await settings.setFlag(settings.ENTRY, true);
  await settings.setFlag(settings.ENABLED, false);
  assert.equal(h.stored.userTheme.png, saved.png); assert.equal((await settings.get()).entry, true);
  const before = JSON.stringify(h.stored), writes = h.writes.length;
  await assert.rejects(settings.importZip(new Uint8Array([1, 2, 3])));
  assert.equal(JSON.stringify(h.stored), before); assert.equal(h.writes.length, writes);
  await assert.rejects(settings.setFlag(settings.ENABLED, "true"));
});

test("v2 solid fill and stretched icons preserve original paint through ZIP/storage and reject status overrides", async () => {
  const h = harness(), theme = sample(), icon = theme.conversation.components.expandIcon, original = JSON.stringify(icon.paint);
  icon.fill = "#123456aa"; icon.fit = "stretch"; icon.enabled = false;
  const read = await h.themePackage.read(h.themePackage.pack(theme, png()));
  assert.equal(read.theme.conversation.components.expandIcon.fill, "#123456aa");
  assert.equal(read.theme.conversation.components.expandIcon.fit, "stretch");
  assert.equal(JSON.stringify(read.theme.conversation.components.expandIcon.paint), original);
  assert.equal(read.theme.conversation.components.expandIcon.enabled, false);
  for (const change of [t => t.conversation.components.expandIcon.fill = "status",
    t => t.conversation.components.symbol.fill = "ink", t => t.conversation.components.expandIcon.fit = "cover",
    t => t.conversation.components.expandIcon.fill = "red;background:red", t => t.conversation.components.measure.fill = "ink"]) {
    const bad = structuredClone(theme); change(bad); assert.throws(() => h.themeContract.validateTheme(bad));
  }
  const small = sample(); small.conversation.components.expandIcon.width = 7; small.conversation.components.expandIcon.enabled = false;
  assert.throws(() => h.themeContract.validateTheme(small));
});
