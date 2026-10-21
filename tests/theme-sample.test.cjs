"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto");
// Preserve a fixed v1 fixture independently of the evolving bundled default.
const sample = () => JSON.parse(fs.readFileSync("tests/fixtures/theme-v1.json", "utf8"));
const png = () => new Uint8Array(fs.readFileSync("tests/fixtures/theme-v1.png"));
const json = theme => new TextEncoder().encode(JSON.stringify(theme));
function harness() {
  const c = vm.createContext({ TextDecoder, Uint8Array, crypto: crypto.webcrypto });
  for (const file of ["theme-contract", "theme-layout"]) vm.runInContext(fs.readFileSync("src/" + file + ".js", "utf8"), c);
  return c.Chatcouter;
}
function fixture() {
  return { runtime: { getURL: path => "moz-extension://test/" + path },
    fetch: async url => ({ ok: true, arrayBuffer: async () => url.endsWith(".png") ? png() : json(sample()) }),
    Image: class { naturalWidth = 864; naturalHeight = 168; async decode() {} } };
}

test("shared theme contract validates crops, bounds, mandatory roles and declared fields", () => {
  const { validateTheme } = harness().themeContract;
  const image = { width: 864, height: 168 };
  assert.doesNotThrow(() => validateTheme(sample(), image));
  for (const change of [s => s.atlas.width++, s => s.conversation.components.symbol.paint[0].source.x = 864,
    s => s.conversation.components.symbol.paint[0].source.width = 0,
    s => s.conversation.components.symbol.paint[0].color = "red;display:none",
    s => s.conversation.components.measure.text.family = "serif;position:fixed",
    s => s.conversation.components.measure.text.size = 100, s => s.conversation.components.measure.x = -1,
    s => s.conversation.components.measure.x = 0, s => s.conversation.components.measure = false,
    s => s.conversation.background.sources.push(...s.conversation.background.sources), s => s.version = "unknown",
    s => s.conversation.background.color = "status", s => s.conversation.components.exportIcon.paint[0].color = "status",
    s => s.conversation.components.symbol.paint[0].color = "status",
    s => s.conversation.components.symbol.paint[1].color = "line", s => s.extra = "ignored?",
    s => s.atlas.url = "https://example.invalid/image.png", s => s.conversation.components.measure.action = "javascript:evil()",
    s => s.conversation.components.measure.text.align = "stretch",
    s => s.conversation.components.entryTime.text.numericSize = 12, s => s.idle.components.export = false]) {
    const theme = sample(); change(theme); assert.throws(() => validateTheme(theme, image));
  }
  assert.throws(() => validateTheme(null));
  const optional = sample(); optional.conversation.components.expand = false;
  optional.idle.components = {}; assert.doesNotThrow(() => validateTheme(optional, image));
});

test("component minimum and canvas maximum preserve clipped text, adjacency and image reuse", () => {
  const { validateTheme } = harness().themeContract;
  const theme = sample(), usage = theme.conversation.components.measure;
  theme.conversation.components = { measure: { ...usage, x: 0, y: 0, width: 8, height: 8 } };
  theme.idle.components = {};
  assert.doesNotThrow(() => validateTheme(theme));
  theme.conversation.components.measure.width = 7; assert.throws(() => validateTheme(theme));
  Object.assign(theme.conversation.components.measure, { width: 256, height: 168 });
  assert.doesNotThrow(() => validateTheme(theme));
  theme.conversation.components.measure.height = 169; assert.throws(() => validateTheme(theme));
  const styles = sample(); styles.conversation.components.measure.text.family = "맑은 고딕";
  styles.conversation.components.measure.text.color = "#112233cc";
  styles.conversation.components.measure.text.align = "right";
  delete styles.conversation.components.exportIcon.paint[0].color;
  assert.doesNotThrow(() => validateTheme(styles));
});

test("JSON byte limits, UTF-8 and unknown fields fail before image work", () => {
  const { parseJson, limits } = harness().themeContract;
  const padded = new Uint8Array(limits.jsonBytes).fill(32); padded.set(json(sample()));
  assert.doesNotThrow(() => parseJson(padded));
  for (const [bytes, code] of [[new Uint8Array(limits.jsonBytes + 1), "theme-json-size"],
    [new Uint8Array(), "theme-json-size"], [new Uint8Array([255]), "theme-json"],
    [new TextEncoder().encode('{"version":'), "theme-json"]]) {
    assert.throws(() => parseJson(bytes), error => error.code === code);
  }
});

test("PNG preflight bounds chunks and rejects animation, truncation and trailing data", () => {
  const { inspectPng, limits } = harness().themeContract;
  assert.deepEqual(JSON.parse(JSON.stringify(inspectPng(png()))), { width: 864, height: 168 });
  const animated = Buffer.concat([Buffer.from(png()).subarray(0, 33), Buffer.from([0,0,0,0,97,99,84,76,0,0,0,0]), Buffer.from(png()).subarray(33)]);
  for (const bytes of [new Uint8Array(limits.pngBytes + 1), png().subarray(0, 30),
    new Uint8Array(Buffer.concat([Buffer.from(png()), Buffer.from([0])])), animated]) assert.throws(() => inspectPng(bytes));
  const huge = png(); new DataView(huge.buffer).setUint32(16, 2049); assert.throws(() => inspectPng(huge));
});

test("file pairing checks PNG hash and decoded dimensions before returning a theme", async () => {
  const { validatePair } = harness().themeContract;
  let decodes = 0;
  const args = { jsonBytes: json(sample()), pngBytes: png(), decodePng: async () => { decodes++; return { width: 864, height: 168 }; } };
  assert.equal((await validatePair(args)).version, "chatgauge-theme-1"); assert.equal(decodes, 1);
  const changed = png(); changed[changed.length - 1] ^= 1;
  await assert.rejects(validatePair({ ...args, pngBytes: changed }), error => error.code === "theme-image-pair");
  assert.equal(decodes, 1);
  await assert.rejects(validatePair({ ...args, decodePng: async () => ({ width: 1, height: 1 }) }), error => error.code === "theme-image-size");
  await assert.rejects(validatePair({ ...args, decodePng: async () => { throw Error("decode failed"); } }));
});

test("PNG bytes from another realm validate and pair without accepting fake byte objects", async () => {
  const { inspectPng, validatePair } = harness().themeContract;
  const foreign = vm.runInNewContext("new Uint8Array(bytes)", { bytes: png() });
  assert.equal(foreign instanceof Uint8Array, false);
  assert.equal(inspectPng(foreign).width, 864);
  let decoded = false;
  await validatePair({ jsonBytes: json(sample()), pngBytes: foreign,
    decodePng: async () => { decoded = true; return { width: 864, height: 168 }; } });
  assert.equal(decoded, true);
  const guarded = png();
  Object.defineProperty(guarded, "constructor", { get() { throw Error("Permission denied to access constructor"); } });
  assert.equal(inspectPng(guarded).height, 168);
  await validatePair({ jsonBytes: json(sample()), pngBytes: guarded,
    decodePng: async () => ({ width: 864, height: 168 }) });
  for (const fake of [new DataView(png().buffer), new Uint16Array(3000),
    { byteLength: 4949, [Symbol.toStringTag]: "Uint8Array" }]) assert.throws(() => inspectPng(fake));
  const cut = foreign.subarray(0, 30);
  assert.throws(() => inspectPng(cut), error => error.code === "theme-png-size");
});

test("bundled loader shares the contract and waits for successful image decoding", async () => {
  const { loadSample } = harness().themeLayout;
  let decoded = false;
  const result = await loadSample({ ...fixture(), Image: class { naturalWidth = 864; naturalHeight = 168; async decode() { decoded = true; } } });
  assert.equal(decoded, true); assert.equal(result.atlasUrl, "moz-extension://test/src/themes/default-sample.png");
  for (const args of [{ fetch: async () => ({ ok: false }) },
    { Image: class { async decode() { throw Error("decode"); } } },
    { Image: class { naturalWidth = 1; naturalHeight = 1; async decode() {} } }]) await assert.rejects(loadSample({ ...fixture(), ...args }));
});

test("adopted bundled v2 default matches its PNG hash and satisfies the shared 8px minimum", async () => {
  const h = harness(), theme = JSON.parse(fs.readFileSync("src/themes/default-sample.json")), bytes = new Uint8Array(fs.readFileSync("src/themes/default-sample.png"));
  assert.equal(h.themeContract.limits.componentMin, 8);
  const result = await h.themeContract.validatePair({ jsonBytes: json(theme), pngBytes: bytes,
    decodePng: async png => h.themeContract.inspectPng(png) });
  assert.equal(result.version, "chatgauge-theme-2"); assert.equal(result.idle.background, null);
  assert.equal(result.atlas.sha256, "a4559a09a24b8fb0487d3012d664dc25ad8b7cda249d1799115cca29fad0280e");
  for (const mode of ["conversation", "idle"]) for (const box of Object.values(result[mode].components)) {
    assert.ok(box.width >= 8 && box.height >= 8);
  }
});
