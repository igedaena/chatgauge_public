"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { webcrypto } = require("node:crypto");
function harness() {
  const context = vm.createContext({ structuredClone, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, DataView });
  for (const file of ["src/theme-contract.js", "tools/theme-editor/editor-model.js", "tools/theme-editor/editor-recovery.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), context);
  const theme = JSON.parse(fs.readFileSync("src/themes/default-sample.json"));
  return { ...context.Chatcouter, theme, state: context.Chatcouter.themeEditorModel.create(theme) };
}
test("recovery is offered only when both enabled background layers actually contribute", () => {
  const h = harness(), state = h.state, assets = new Map([["conversation.background.0", {}], ["conversation.placementBackground", {}]]);
  state.placementBackground.enabled = true;
  assert.equal(h.themeEditorRecovery.available(state, assets), true);
  state.backgroundEnabled.conversation = false;
  assert.equal(h.themeEditorRecovery.available(state, assets), false);
  state.backgroundEnabled.conversation = true; state.placementBackground.enabled = false;
  assert.equal(h.themeEditorRecovery.available(state, assets), false);
  state.placementBackground.enabled = true; assets.delete("conversation.background.0");
  assert.equal(h.themeEditorRecovery.available(state, assets), false, "an empty main background does not qualify");
  state.backgroundFill.conversation = "#123456";
  assert.equal(h.themeEditorRecovery.available(state, assets), true, "solid main fill also contributes");
  state.stageEnabled.conversation.fill(false);
  assert.equal(h.themeEditorRecovery.available(state, assets), false);
  state.stageEnabled.conversation.fill(true); state.placementBackground.x = 256;
  assert.equal(h.themeEditorRecovery.available(state, assets), false, "a fully clipped placement layer does not contribute");
});
function recovery(h) {
  return { format: h.themeEditorRecovery.format, theme: structuredClone(h.theme), editor: {
    backgrounds: { conversation: structuredClone(h.theme.conversation.background.sources), idle: [] },
    enabled: { conversation: true, idle: true }, stages: { conversation: [true, false, true], idle: [] },
    colors: { conversation: "line" }, fills: { conversation: null, idle: null },
    placement: { source: { x: 0, y: 0, width: 200, height: 100 }, x: 12, y: 8, width: 200, height: 100, locked: false, color: "#456789", fill: null }
  } };
}
test("recovery restores background visibility, per-stage flags and placement color without changing its input", async () => {
  const h = harness(), data = recovery(h), before = JSON.stringify(data), png = new Uint8Array(fs.readFileSync("src/themes/default-sample.png"));
  const restored = await h.themeEditorRecovery.read(data, png, h.theme, async () => ({ width: h.theme.atlas.width, height: h.theme.atlas.height }));
  assert.equal(restored.state.stageEnabled.conversation[1], false);
  assert.equal(restored.state.placementBackground.enabled, true);
  assert.equal(restored.state.placementBackground.color, "#456789");
  assert.equal(restored.state.placements.conversation[0].x, 0);
  assert.equal(restored.state.placementBackground.width, 200);
  assert.equal(restored.state.placementBackground.x, 12);
  assert.equal(restored.state.placementBackground.locked, false);
  assert.equal(JSON.stringify(data), before);
});
test("recovery rejects corrupt image pairs, out-of-bounds crops and malformed editor metadata", async () => {
  const h = harness(), png = new Uint8Array(fs.readFileSync("src/themes/default-sample.png"));
  const read = data => h.themeEditorRecovery.read(data, png, h.theme, async () => ({ width: h.theme.atlas.width, height: h.theme.atlas.height }));
  for (const change of [
    data => { data.theme.atlas.sha256 = "0".repeat(64); },
    data => { data.editor.placement.source.x = 2048; },
    data => { data.editor.placement.color = ["#ffffff"]; },
    data => { data.editor.enabled.conversation = "true"; },
    data => { data.editor.stages.conversation = [true]; },
    data => { data.editor.backgrounds.idle = [{ x: 0, y: 0, width: 1, height: 1 }]; },
    data => { data.editor.unexpected = true; },
    data => { data.editor.placement.source.height = 0; },
    data => { data.editor.placement.x = 100; },
  ]) { const data = recovery(h); change(data); await assert.rejects(read(data)); }
});
