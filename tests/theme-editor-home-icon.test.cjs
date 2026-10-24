"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), { webcrypto } = require("node:crypto");

// Exercise the editor's actual repacker. Canvas encoding is stubbed here;
// browser QA separately compares rendered pixels before and after a ZIP round trip.
function harness() {
  const png = new Uint8Array(fs.readFileSync("src/themes/default-sample.png"));
  const context = vm.createContext({ structuredClone, crypto: webcrypto, Uint8Array, Map,
    images: { draw: (ctx, ...args) => ctx.drawImage(...args) },
    canvas: (width, height) => ({ width, height, getContext: () => ({ drawImage() {} }) }),
    toBlob: async () => ({ arrayBuffer: async () => png.buffer }),
    backgroundImage: (input, assets, mode) => input.theme[mode].background,
    backgroundColor: (input, assets, mode) => input.theme[mode].background?.color,
  });
  for (const file of ["src/theme-contract.js", "tools/theme-editor/editor-model.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context);
  }
  const source = fs.readFileSync("tools/theme-editor/editor.js", "utf8");
  const start = source.indexOf("  async function packed("), end = source.indexOf("  function install(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext("const contract = Chatcouter.themeContract, model = Chatcouter.themeEditorModel; "
    + "const clone = structuredClone, modes = ['conversation', 'idle'];\n" + source.slice(start, end), context);
  return context;
}

for (const fit of ["contain", "stretch"]) test(`home icon repacking preserves layer colors and ${fit} without compositing`, async () => {
  const context = harness(), plain = value => JSON.parse(JSON.stringify(value));
  for (const colors of [["#ff0000", "#0000ff"], ["ink", "line"], [undefined, "#11223380"]]) {
    const theme = JSON.parse(fs.readFileSync("src/themes/default-sample.json", "utf8"));
    const icon = theme.idle.components.symbol;
    icon.fit = fit;
    icon.paint = colors.map((color, i) => ({ source: { x: 0, y: 0, width: i ? 4 : 16, height: i ? 16 : 4 },
      ...(color === undefined ? {} : { color }) }));
    const state = context.Chatcouter.themeEditorModel.create(theme), assets = new Map();
    for (const mode of ["conversation", "idle"]) for (const [role, box] of Object.entries(state.theme[mode].components)) {
      box?.paint?.forEach((layer, i) => assets.set(`${mode}.${role}.${i}`, { ...layer.source }));
    }
    const before = JSON.stringify(state);
    context.input = state; context.inputAssets = assets;
    for (const includeHidden of [true, false]) {
      context.includeHidden = includeHidden;
      const result = await vm.runInContext("packed(input, inputAssets, includeHidden)", context);
      const actual = result.state.theme.idle.components.symbol;
      assert.equal(actual.fit, fit);
      assert.equal(actual.paint.length, 2);
      assert.deepEqual(plain(actual.paint.map(layer => layer.color ?? null)), colors.map(color => color ?? null));
      assert.deepEqual(plain(actual.paint.map(layer => [layer.source.width, layer.source.height])), [[16, 4], [4, 16]]);
      assert.equal(result.assets.get("idle.symbol.0"), assets.get("idle.symbol.0"));
      assert.equal(result.assets.get("idle.symbol.1"), assets.get("idle.symbol.1"));
      assert.equal(JSON.stringify(state), before, "repacking must leave its input unchanged");
    }
  }
});
