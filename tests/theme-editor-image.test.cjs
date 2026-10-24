"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
function harness() {
  const allocated = [];
  const context = vm.createContext({ document: { createElement() {
    const node = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
    allocated.push(node); return node;
  } } });
  vm.runInContext(fs.readFileSync("tools/theme-editor/editor-image.js", "utf8"), context);
  return { draw: context.Chatcouter.themeEditorImage.draw, allocated };
}
test("large reduction preserves the destination, uses bounded intermediates and reuses only the same immutable source", () => {
  const h = harness(), source = { width: 1545, height: 1018 }, before = JSON.stringify(source), calls = [];
  const ctx = { drawImage: (...args) => calls.push(args) };
  h.draw(ctx, source, -20, 51, 255, 168);
  assert.ok(h.allocated.length > 0);
  for (const node of h.allocated) assert.ok(node.width <= source.width && node.height <= source.height);
  assert.deepEqual(calls[0].slice(1), [-20, 51, 255, 168]);
  assert.ok(calls[0][0].width <= 510 && calls[0][0].height <= 336);
  const allocated = h.allocated.length;
  h.draw(ctx, source, 4, 5, 256, 169);
  assert.equal(h.allocated.length, allocated, "The same reduction band is reusable while dragging");
  h.draw(ctx, { ...source }, 4, 5, 256, 169);
  assert.ok(h.allocated.length > allocated, "Different image pixels must not share a cached raster");
  assert.equal(JSON.stringify(source), before);
});
test("same-size and huge enlargements allocate no placement-size bitmap; one-axis reduction remains bounded", () => {
  const h = harness(), source = { width: 64, height: 64 }, calls = [], ctx = { drawImage: (...args) => calls.push(args) };
  h.draw(ctx, source, 0, 0, 64, 64); h.draw(ctx, source, -16384, -16384, 16384, 16384);
  assert.equal(h.allocated.length, 0); assert.equal(calls[0][0], source);
  h.draw(ctx, source, 0, 0, 1, 16384);
  assert.ok(h.allocated.every(node => node.width <= 64 && node.height === 64));
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => h.draw(ctx, source, 0, 0, width, 1));
});
