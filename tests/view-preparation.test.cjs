"use strict";
const assert = require("node:assert/strict"), test = require("node:test"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const i18n = require("./helpers/i18n.cjs");
function harness(locale) {
  const context = vm.createContext({ browser: { i18n: i18n(locale) }, TextEncoder });
  for (const file of ["i18n.js", "model.js", "vendor/marked.umd.js", "exporters/html.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
  const result = { title: "Synthetic <title>", messages: [{ role: "user", text: "한글 <script>" }, { role: "assistant", text: "**answer**\n\n```js\nconst a = 1;\n```" }] };
  let calls = 0, snapshot = { ok: true, result, unchecked: false, reason: "full" };
  context.Chatcouter.conversationSnapshot = { readExport: async () => { calls++; return snapshot; } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/exporters/fresh.js"), "utf8"), context);
  return { context, result, setSnapshot: next => { snapshot = next; }, calls: () => calls };
}
test("view header is localized, timestamped below title and reuses safe body/warning while default file output remains identical", () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(locale), create = h.context.Chatcouter.htmlExporter.createHtmlExport;
    const snapshot = { ...h.result, conversationId: "synthetic", exportedAt: "2026-10-10T01:02:03Z", preservation: { warning: "not completed <yet>", reason: "unchecked" } };
    const original = create(snapshot), explicitFile = create({ ...snapshot, view: false });
    assert.equal(original, explicitFile);
    const view = create({ ...snapshot, view: true });
    assert.match(view, new RegExp(`<h1>Synthetic &lt;title&gt;</h1>\\n<p class="summary">${locale === "ko" ? "펼친 시각" : "Opened"}:`));
    assert.ok(!view.includes("<details>")); assert.ok(view.includes("not completed &lt;yet&gt;"));
    assert.equal(view.slice(view.indexOf('<section class="message')), original.slice(original.indexOf('<section class="message')));
    assert.ok(!view.includes("<script>")); assert.ok(!view.includes('src="https:'));
  }
});
test("prepareView uses one independent snapshot and preserves rejection/currentness without file settings or serializers", async () => {
  const h = harness("en"), controller = new AbortController();
  const options = { signal: controller.signal, isCurrent: () => true, conversationId: "synthetic" };
  const prepared = await h.context.Chatcouter.freshExporter.prepareView(options);
  assert.equal(h.calls(), 1); assert.equal(prepared.ok, true); assert.ok(prepared.contents.includes("Opened:"));
  assert.equal(prepared.filename, undefined); assert.equal(prepared.result, h.result);
  h.setSnapshot({ ok: true, result: h.result, unchecked: true, reason: "not-final" });
  assert.ok((await h.context.Chatcouter.freshExporter.prepareView(options)).contents.includes("not-final"));
  h.setSnapshot({ ok: false, reason: "snapshot-unavailable" });
  assert.equal((await h.context.Chatcouter.freshExporter.prepareView(options)).reason, "snapshot-unavailable");
  h.setSnapshot({ ok: true, result: h.result });
  assert.equal((await h.context.Chatcouter.freshExporter.prepareView({ ...options, isCurrent: () => false })).ok, false);
  controller.abort(); assert.equal((await h.context.Chatcouter.freshExporter.prepareView(options)).ok, false);
});
