"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function profile(initial) {
  const values = { ...initial }, listeners = new Set();
  let tail = Promise.resolve(), delay, failRemove = false;
  const emit = changes => { for (const fn of listeners) fn(changes, "local"); };
  return {
    values, listeners,
    locks: { request: (name, work) => { const next = tail.then(work); tail = next.catch(() => {}); return next; } },
    delayWrite: gate => { delay = gate; }, failRemove: value => { failRemove = value; },
    local: {
      get: async () => ({ ...values }),
      set: async patch => {
        if (delay) { const gate = delay; delay = null; await gate.promise; }
        const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: values[key], newValue }]));
        Object.assign(values, patch); emit(changes);
      },
      remove: async keys => {
        if (failRemove) throw new Error("remove failed");
        const changes = {};
        for (const key of keys) if (Object.hasOwn(values, key)) { changes[key] = { oldValue: values[key] }; delete values[key]; }
        emit(changes);
      },
    },
  };
}
async function page(shared, locale = "ko") {
  const nodes = new Map(), formats = ["md", "json", "html"].map(value => ({ value, checked: false }));
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: "", checked: false, disabled: true, hidden: false, files: [], handlers: {},
      addEventListener(name, fn) { this.handlers[name] = fn; }, click() { return this.handlers.click?.(); } });
    return nodes.get(id);
  }
  let confirm = true, importGate;
  const context = vm.createContext({
    document: { documentElement: {}, getElementById: node, querySelector: () => node("main"),
      querySelectorAll: selector => selector === "[data-i18n]" ? [] : formats },
    browser: { i18n: require("./helpers/i18n.cjs")(locale), storage: { local: shared.local, onChanged: { addListener: fn => shared.listeners.add(fn) } } },
    navigator: { locks: shared.locks }, confirm: () => confirm,
    Uint8Array, TextEncoder, atob, btoa,
  });
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  load("src/i18n.js"); load("src/export-settings.js"); load("src/theme-settings.js");
  context.Chatcouter.themePackage = { maxBytes: 1024, read: async () => {
    if (importGate) await importGate.promise;
    return { theme: { version: 2 }, pngBytes: Uint8Array.of(1, 2, 3) };
  } };
  load("src/options/options-reset.js");
  await load("src/options/options.js"); await load("src/options/theme-options.js"); await flush();
  return { node, formats, context, cancel: () => { confirm = false; }, allow: () => { confirm = true; },
    reset: () => node("reset-settings").click(),
    startImport(gate) { importGate = gate; node("theme-file").files = [{ size: 3, arrayBuffer: async () => new ArrayBuffer(3) }]; node("theme-file").handlers.change(); },
  };
}
const customized = {
  exportFormats: ["json", "html"], updateOnUserInput: true,
  filenameOptions: { includeDate: false, includeTime: false, includeUnchecked: false },
  filenameIncludeDate: false, filenameIncludeTime: false, filenameIncludeUnchecked: false,
  sendShortcut: { key: "k", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
  capacityBackgroundEnabled: false, capacityBackgroundLimitsKB: { secondKB: 333, thirdKB: 999 }, capacityEntryTransition: true,
  userThemeEnabled: true, showEntryTime: true, userTheme: { theme: {}, png: "old" }, unrelated: "keep",
};
test("reset removes only managed settings, including legacy filenames and theme, and updates open pages in both languages", async () => {
  for (const locale of ["ko", "en"]) {
    const shared = profile(customized), a = await page(shared, locale), b = await page(shared, locale);
    assert.equal(a.node("reset-settings").disabled, false);
    await a.reset(); await flush();
    assert.deepEqual(shared.values, { unrelated: "keep" });
    for (const p of [a, b, await page(shared, locale)]) {
      const ns = p.context.Chatcouter;
      assert.deepEqual(JSON.parse(JSON.stringify(await ns.exportSettings.getExportPreferences())), {
        formats: ["md"], filenameOptions: { includeDate: true, includeTime: true, includeUnchecked: true } });
      assert.deepEqual(JSON.parse(JSON.stringify(await ns.exportSettings.getCapacityBackground())),
        { enabled: true, secondKB: 200, thirdKB: 400, entryTransition: false });
      for (const id of ["update-on-user-input", "theme-enabled", "entry-enabled", "capacity-entry"]) assert.equal(p.node(id).checked, false);
      for (const id of ["filename-date", "filename-time", "filename-unchecked"]) assert.equal(p.node(id).checked, true);
      assert.equal(p.node("theme-controls").hidden, true);
      assert.equal(p.node("send-key").value, "");
      assert.equal(p.node("capacity-second").value, "200"); assert.equal(p.node("capacity-third").value, "400");
    }
  }
});
test("cancel and failed removal preserve settings and allow a later retry", async () => {
  const shared = profile(customized), p = await page(shared);
  p.cancel(); await p.reset(); assert.deepEqual(shared.values, customized);
  p.allow(); shared.failRemove(true); await p.reset();
  assert.deepEqual(shared.values, customized); assert.equal(p.node("main").inert, false); assert.equal(p.node("reset-settings").disabled, false);
  assert.equal(p.node("status").textContent, p.context.Chatcouter.i18n.t("settings_reset_failed"));
  shared.failRemove(false); await p.reset(); assert.deepEqual(shared.values, { unrelated: "keep" });
});
test("pending autosave locks local reset and another page resets after the earlier write", async () => {
  const shared = profile(customized), a = await page(shared), b = await page(shared), gate = deferred();
  shared.delayWrite(gate); a.formats[0].checked = true;
  const saving = a.node("export-formats").handlers.change(); await flush();
  assert.equal(a.node("reset-settings").disabled, true);
  await a.reset(); assert.ok(shared.values.userTheme);
  const resetting = b.reset(); await flush(); assert.equal(b.node("main").inert, true);
  gate.resolve(); await saving; await resetting; await flush();
  assert.deepEqual(shared.values, { unrelated: "keep" }); assert.equal(a.formats[0].checked, true); assert.equal(a.formats[1].checked, false);
});
test("pending theme decode/import locks local reset and cannot restore a theme after another page reset", async () => {
  const shared = profile(customized), a = await page(shared), b = await page(shared), gate = deferred();
  a.startImport(gate); await flush(); assert.equal(a.node("reset-settings").disabled, true);
  const resetting = b.reset(); await flush(); gate.resolve(); await resetting; await flush();
  assert.deepEqual(shared.values, { unrelated: "keep" }); assert.equal(a.node("reset-settings").disabled, false);
  assert.equal(a.node("theme-enabled").checked, false);
});
