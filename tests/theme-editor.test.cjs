"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const sample = () => JSON.parse(fs.readFileSync("tests/fixtures/theme-v1.json", "utf8"));
function harness() {
  const context = vm.createContext({ structuredClone });
  for (const file of ["src/theme-contract.js", "tools/theme-editor/editor-model.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), context);
  return context.Chatcouter.themeEditorModel;
}
test("editor preserves disabled settings across reopening and defers active overlap rejection to export", () => {
  const m = harness(), initial = m.create(sample());
  const edited = m.edit(initial, "conversation", "secondary", { text: { ...initial.theme.conversation.components.secondary.text, family: "맑은 고딕", size: 16 } });
  const off = m.toggle(edited, "conversation", "secondary", false);
  assert.equal(off.theme.conversation.components.secondary.enabled, false);
  const reopened = m.create(JSON.parse(JSON.stringify(off.theme)));
  assert.equal(m.toggle(reopened, "conversation", "secondary", true).theme.conversation.components.secondary.text.size, 16);
  assert.equal(m.toggle(off, "conversation", "secondary", true).theme.conversation.components.secondary.text.size, 16);
  assert.throws(() => m.toggle(initial, "conversation", "measure", false));
  const filled = m.edit(off, "conversation", "measure", { y: 35, height: 40 });
  const on = m.toggle(filled, "conversation", "secondary", true);
  const vmContext = vm.createContext({}); vm.runInContext(fs.readFileSync("src/theme-contract.js", "utf8"), vmContext);
  assert.throws(() => vmContext.Chatcouter.themeContract.validateTheme(on.theme));
  assert.equal(filled.theme.conversation.components.secondary.enabled, false);
  assert.equal(initial.theme.conversation.components.secondary.text.size, 14);
});
test("editor imports a minimal valid theme and prepares missing components from bundled defaults", () => {
  const m = harness(), theme = sample();
  theme.conversation.components = { measure: theme.conversation.components.measure };
  theme.idle.components = {};
  const state = m.create(theme, sample());
  assert.equal(state.theme.conversation.components.symbol.paint.length, 2);
  assert.equal(m.toggle(state, "idle", "symbol", true).theme.idle.components.symbol.width, 23);
  assert.equal(Object.keys(state.theme.idle.components).length, 2);
});
test("integer drag and all resize edges preserve the opposite anchor and clamp to canvas/minimum", () => {
  const m = harness(), spec = { width: 256, height: 168 }, box = { x: 40, y: 40, width: 80, height: 30 };
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(m.drag(box, "", 1.6, -1.4, spec)), { x: 42, y: 39, width: 80, height: 30 });
  assert.deepEqual(plain(m.drag(box, "", -1000, 1000, spec)), { x: 0, y: 138, width: 80, height: 30 });
  for (const edge of ["w", "e", "n", "s", "ne", "nw", "se", "sw"]) {
    const next = m.drag(box, edge, 1000, 1000, spec);
    assert.ok(next.x >= 0 && next.y >= 0 && next.x + next.width <= 256 && next.y + next.height <= 168);
    assert.ok(next.width >= 8 && next.height >= 8);
    if (edge.includes("w")) assert.equal(next.x + next.width, 120);
    if (edge.includes("s")) assert.equal(next.y + next.height, 70);
    if (edge.includes("e")) assert.equal(next.x, 40);
    if (edge.includes("n")) assert.equal(next.y, 40);
  }
});
test("editor uses shared bounds, overlap and font rules and leaves the accepted state unchanged on failure", () => {
  const m = harness(), state = m.create(sample()), before = JSON.stringify(state);
  for (const change of [{ x: -1 }, { width: 4 }, { y: 0.5 },
    { text: { family: "serif;display:none", size: 14, weight: 400, color: "ink" } }]) {
    assert.throws(() => m.edit(state, "conversation", "measure", change));
    assert.equal(JSON.stringify(state), before);
  }
  const changed = m.edit(state, "conversation", "entryTime", { text: { ...state.theme.conversation.components.entryTime.text, align: "right", color: "#123456aa" } });
  assert.equal(changed.theme.conversation.components.entryTime.text.align, "right");
});
test("atlas packing keeps graphics left, all crops bounded and distinct, including tall backgrounds", () => {
  const m = harness();
  const items = [{ key: "body", width: 26, height: 44 }, { key: "status", width: 26, height: 44 },
    ...Array.from({ length: 6 }, (_, i) => ({ key: `stage${i}`, width: 256, height: 640, background: true }))];
  const plan = m.pack(items);
  assert.ok(plan.width <= 2048 && plan.height <= 2048);
  assert.equal(plan.items[0].x, 0);
  for (const item of plan.items) {
    assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.width <= plan.width && item.y + item.height <= plan.height);
    if (item.background) assert.ok(item.x >= 26);
    for (const other of plan.items) if (other !== item) assert.ok(!(item.x < other.x + other.width && other.x < item.x + item.width
      && item.y < other.y + other.height && other.y < item.y + item.height));
  }
  assert.throws(() => m.pack([{ width: 2049, height: 1 }]));
  assert.throws(() => m.pack([{ width: 2048, height: 2048 }, { width: 1, height: 1, background: true }]));
  assert.throws(() => m.pack(Array.from({ length: 5 }, () => ({ width: 1024, height: 1024, background: true }))));
});

test("standalone distribution embeds its default PNG, both languages and executable scripts without external files", async () => {
  const { renderThemeEditor } = await import("../scripts/build-theme-editor.mjs");
  const html = await renderThemeEditor();
  assert.equal(html, await renderThemeEditor(), "The download must build reproducibly");
  assert.doesNotMatch(html, /<script\s+src=|<link\s+[^>]*href=|EDITOR_BUNDLE_DATA|browser\.runtime|chrome\.runtime/);
  const data = JSON.parse(html.match(/<script id="editor-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.theme.version, "chatgauge-theme-2");
  const png = Buffer.from(data.png, "base64");
  assert.deepEqual(png, fs.readFileSync("src/themes/default-sample.png"));
  assert.equal(require("node:crypto").createHash("sha256").update(png).digest("hex"), data.theme.atlas.sha256);
  assert.match(data.locales.ko.editor_title.message, /제작기/);
  assert.equal(data.locales.en.editor_title.message, "Theme editor");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 8);
  for (const [, source] of scripts) assert.doesNotThrow(() => new vm.Script(source));
});

test("editor catalogs and source remain outside the extension package", () => {
  const en = JSON.parse(fs.readFileSync("tools/theme-editor/locales/en.json"));
  const ko = JSON.parse(fs.readFileSync("tools/theme-editor/locales/ko.json"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  for (const locale of ["en", "ko"]) {
    const catalog = JSON.parse(fs.readFileSync(`_locales/${locale}/messages.json`));
    assert.ok(Object.keys(catalog).every(key => !key.startsWith("editor_")));
  }
  const packaging = fs.readFileSync("scripts/prepare-amo-package.mjs", "utf8");
  assert.doesNotMatch(packaging, /theme-editor/);
  assert.doesNotMatch(fs.readFileSync("src/options/options.html", "utf8"), /theme-editor/);
  assert.equal(fs.existsSync("src/theme-editor"), false);
});

test("editor unifies old numeric styles and removes the home background without changing the input", () => {
  const m = harness(), theme = sample(), before = JSON.stringify(theme);
  theme.idle.background.sources.push(structuredClone(theme.idle.background.sources[0]));
  const unified = m.normalize(theme), font = unified.conversation.components.measure.text;
  assert.equal(font.size, 14); assert.equal(font.weight, 500);
  assert.equal(font.numericSize, undefined); assert.equal(font.numericWeight, undefined);
  assert.equal(unified.idle.background, null);
  assert.equal(theme.idle.background.sources.length, 2);
  assert.equal(JSON.parse(before).conversation.components.measure.text.numericSize, theme.conversation.components.measure.text.numericSize);
});

test("loaded background sizes keep the image ratio while respecting conversation/home maximums", () => {
  const m = harness(), plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(m.backgroundSize(256, 640, "conversation")), { width: 256, height: 640 });
  assert.deepEqual(plain(m.backgroundSize(512, 1280, "conversation")), { width: 256, height: 640 });
  assert.deepEqual(plain(m.backgroundSize(100, 100, "idle")), { width: 64, height: 64 });
  assert.deepEqual(plain(m.backgroundSize(100, 300, "conversation")), { width: 100, height: 300 });
});

test("locked icon resize preserves aspect ratio, opposite anchors and bounds at every edge", () => {
  const m = harness(), box = { x: 40, y: 40, width: 80, height: 40 }, spec = { width: 256, height: 168 };
  for (const edge of ["w", "e", "n", "s", "ne", "nw", "se", "sw"]) for (const delta of [-1000, 10, 1000]) {
    const next = m.drag(box, edge, delta, delta, spec, true);
    assert.ok(next.width >= 8 && next.height >= 8);
    assert.ok(Math.abs(next.width / next.height - 2) < 0.1);
    assert.ok(next.x >= 0 && next.y >= 0 && next.x + next.width <= 256 && next.y + next.height <= 168);
    if (edge.includes("w")) assert.equal(next.x + next.width, 120);
    if (edge.includes("s")) assert.equal(next.y + next.height, 80);
  }
});

test("background transforms retain independent placements, allow outside-frame positions and reject unsafe drafts", () => {
  const m = harness(), initial = { x: 0, y: 0, width: 512, height: 256, locked: true };
  const resized = m.placement(initial, { width: 1024 });
  assert.equal(resized.height, 512); assert.equal(initial.width, 512);
  const unlocked = m.placement({ ...initial, locked: false }, { height: 100 });
  assert.equal(unlocked.width, 512); assert.equal(unlocked.height, 100);
  const moved = m.placement(initial, { x: -512, y: 2000 });
  assert.equal(moved.x, -512); assert.equal(moved.y, 2000);
  for (const changes of [{ width: 0 }, { x: 0.5 }, { height: NaN }, { x: Infinity }, { width: 20000 }]) assert.throws(() => m.placement(initial, changes));
  assert.equal(initial.x, 0);
  const state = m.create(JSON.parse(fs.readFileSync("src/themes/default-sample.json")));
  state.placements.conversation[1].x = -100;
  assert.equal(state.placements.conversation[0].x, 0);
  assert.equal(state.placements.conversation[2].x, 0);
  assert.equal(state.placements.idle.length, 0);
});

test("theme filenames use a local timestamp including milliseconds", () => {
  const m = harness(), date = new Date(2026, 9, 18, 7, 8, 9, 12);
  assert.equal(m.filename(date), "chatgauge-theme-20261018-070809-012.zip");
  assert.notEqual(m.filename(date), m.filename(new Date(date.getTime() + 1)));
});

test("fixed background conversion preserves the old bottom edge and does not mutate imported data", () => {
  const m = harness(), initial = m.create(sample()), before = JSON.stringify(initial);
  const expanded = m.expandBackground(initial), old = initial.theme.conversation.background;
  assert.equal(expanded.theme.conversation.background.width, 256);
  assert.equal(expanded.theme.conversation.background.height, 640);
  for (let i = 0; i < initial.placements.conversation.length; i++) {
    const a = initial.placements.conversation[i], b = expanded.placements.conversation[i];
    assert.equal(old.height - a.y - a.height, 640 - b.y - b.height);
    assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  }
  assert.equal(JSON.stringify(initial), before);
  assert.equal(JSON.stringify(initial.theme.conversation.components), JSON.stringify(expanded.theme.conversation.components));
});

test("large originals produce bounded graphic rasters without enlarging small images", () => {
  const m = harness();
  for (const [w, h] of [[2048, 2048], [2048, 256], [256, 2048], [32, 24]]) {
    const next = m.graphicSize(w, h);
    assert.ok(next.width <= 256 && next.height <= 168);
    assert.ok(next.width <= w && next.height <= h);
    assert.ok(Math.abs(next.width / w - next.height / h) <= 1 / Math.min(w, h));
  }
  assert.equal(m.graphicSize(32, 24).width, 32);
});

test("background placement commands preserve the ratio, center fit/cover and only move bottom alignment", () => {
  const m = harness(), image = { x: 4, y: 5, width: 100, height: 300, locked: true }, frame = { width: 256, height: 640 };
  const fit = m.alignImage(image, frame, "contain"), cover = m.alignImage(image, frame, "cover"), bottom = m.alignImage(image, frame, "bottom");
  assert.ok(fit.width <= 256 && fit.height <= 640); assert.equal(fit.height, 640);
  assert.ok(cover.width >= 256 && cover.height >= 640); assert.equal(cover.width, 256);
  assert.equal(bottom.x, 4); assert.equal(bottom.y, 340); assert.equal(bottom.width, 100); assert.equal(bottom.height, 300);
  assert.equal(fit.locked, true); assert.equal(cover.locked, true);
  assert.equal(image.y, 5);
});

test("background move snaps to frame edges within the supplied screen-adjusted distance without resizing", () => {
  const m = harness(), frame = { width: 256, height: 640 }, box = { x: 20, y: 20, width: 100, height: 300, locked: true };
  const snapped = m.backgroundDrag(box, "", -16, -16, frame, 6);
  assert.equal(snapped.x, 0); assert.equal(snapped.y, 0); assert.equal(snapped.width, 100); assert.equal(snapped.height, 300);
  assert.equal(m.backgroundDrag(box, "", -16, -16, frame, 3).x, 4);
  const right = m.backgroundDrag(box, "", 132, 316, frame, 6);
  assert.equal(right.x + right.width, 256); assert.equal(right.y + right.height, 640);
  assert.equal(m.backgroundDrag(box, "", -200, -200, frame).x, -180);
});

test("background resize preserves opposite anchors and supports ratio or independent axes outside frame", () => {
  const m = harness(), frame = { width: 256, height: 640 };
  for (const locked of [false, true]) for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    const box = { x: -20, y: 30, width: 200, height: 100, locked }, next = m.backgroundDrag(box, edge, 20, 10, frame, 0);
    assert.ok([next.x, next.y, next.width, next.height].every(Number.isInteger));
    assert.ok(next.width > 0 && next.height > 0);
    if (edge.includes("w")) assert.equal(next.x + next.width, box.x + box.width); else assert.equal(next.x, box.x);
    if (edge.includes("n")) assert.equal(next.y + next.height, box.y + box.height); else assert.equal(next.y, box.y);
    if (locked) assert.ok(Math.abs(next.width - next.height * 2) <= 1);
  }
  const snapped = m.backgroundDrag({ x: 20, y: 20, width: 232, height: 100, locked: false }, "e", 0, 0, frame, 6);
  assert.equal(snapped.width, 236);
  const huge = m.backgroundDrag({ x: 0, y: 0, width: 200, height: 100, locked: true }, "e", 20000, 0, frame, 0);
  assert.equal(huge.width, 16384); assert.equal(huge.height, 8192);
});

test("source PNG byte allowance does not relax default final-image or static-PNG checks", () => {
  const context = vm.createContext({ Uint8Array, DataView, ArrayBuffer });
  vm.runInContext(fs.readFileSync("src/theme-contract.js", "utf8"), context);
  const c = context.Chatcouter.themeContract, png = fs.readFileSync("tests/fixtures/theme-v1.png");
  const padding = Buffer.alloc(12 + 2 * 1024 * 1024); padding.writeUInt32BE(padding.length - 12); padding.write("npAD", 4);
  const large = new Uint8Array(Buffer.concat([png.subarray(0, -12), padding, png.subarray(-12)]));
  assert.throws(() => c.inspectPng(large), /theme-png-size/);
  assert.ok(c.inspectPng(large, { maxBytes: harness().limits.sourceBytes }).width > 0);
  const animated = new Uint8Array(large); animated.set(Buffer.from("acTL"), png.length - 12 + 4);
  assert.throws(() => c.inspectPng(animated, { maxBytes: harness().limits.sourceBytes }), /theme-png-static/);
  assert.throws(() => c.inspectPng(large), /theme-png-size/);
});
