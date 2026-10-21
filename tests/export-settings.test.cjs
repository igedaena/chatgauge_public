"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

async function harness(stored, { readFails = false, writeFails = false, inputMode, filenameOptions, sendShortcut, capacityBackground, locale = "ko", sharedStorage } = {}) {
  const inputs = ["md", "json", "html"].map((value) => ({ value, checked: false }));
  const handlers = {};
  const fieldset = { disabled: true, addEventListener: (name, fn) => { handlers[name] = fn; } };
  const refreshFieldset = { disabled: true, addEventListener: (name, fn) => { handlers[`refresh-${name}`] = fn; } };
  const filenameFieldset = { disabled: true, addEventListener: (name, fn) => { handlers[`filename-${name}`] = fn; } };
  const sendKeyFieldset = { disabled: true };
  const sendKeyInput = { value: "", addEventListener: (name, fn) => { handlers[`send-key-${name}`] = fn; } };
  const sendKeyClear = { disabled: true, addEventListener: (name, fn) => { handlers[`send-key-clear-${name}`] = fn; } };
  const dateInput = { checked: false };
  const timeInput = { checked: false };
  const uncheckedInput = { checked: false };
  const modeInput = { checked: false };
  const capacityFieldset = { disabled: true, addEventListener: (name, fn) => { handlers[`capacity-${name}`] = fn; } };
  const capacityEnabled = { checked: false };
  const capacityEntry = { checked: false }, capacityEntrySetting = { hidden: true }, capacityEntryHint = { hidden: true };
  const capacitySecond = { value: "" }, capacityThird = { value: "" }, capacityError = { hidden: true };
  const status = {};
  const writes = [];
  let preferences = stored;
  const filenameFields = { capacityBackgroundEnabled: capacityBackground?.enabled,
    capacityEntryTransition: capacityBackground?.entryTransition,
    capacityBackgroundLimitsKB: capacityBackground };
  const listeners = new Set();
  const context = vm.createContext({
    document: {
      documentElement: {},
      querySelector: () => fieldset,
      querySelectorAll: (selector) => selector === "[data-i18n]" ? [] : inputs,
      getElementById: (id) => ({ "export-formats": fieldset, "refresh-settings": refreshFieldset,
        "update-on-user-input": modeInput, "filename-settings": filenameFieldset,
        "filename-date": dateInput, "filename-time": timeInput, "filename-unchecked": uncheckedInput,
        "send-key-settings": sendKeyFieldset, "send-key": sendKeyInput, "send-key-clear": sendKeyClear,
        "capacity-settings": capacityFieldset, "capacity-enabled": capacityEnabled, "capacity-second": capacitySecond,
        "capacity-third": capacityThird, "capacity-error": capacityError, "capacity-entry": capacityEntry,
        "capacity-entry-setting": capacityEntrySetting, "capacity-entry-hint": capacityEntryHint, status })[id],
    },
    browser: { i18n: require("./helpers/i18n.cjs")(locale), storage: sharedStorage || { onChanged: {
      addListener: fn => listeners.add(fn),
    }, local: {
      get: async () => {
        if (readFails) throw new Error("read failure");
        return { exportFormats: preferences, updateOnUserInput: inputMode, filenameOptions, sendShortcut, ...filenameFields };
      },
      set: async (value) => {
        if (writeFails) throw new Error("write failure");
        writes.push(value);
        if (Object.hasOwn(value, "exportFormats")) preferences = value.exportFormats;
        if (Object.hasOwn(value, "updateOnUserInput")) inputMode = value.updateOnUserInput;
        if (Object.hasOwn(value, "filenameOptions")) filenameOptions = value.filenameOptions;
        if (Object.hasOwn(value, "sendShortcut")) sendShortcut = value.sendShortcut;
        for (const [key, field] of Object.entries(value)) {
          if (key.startsWith("filenameInclude") || key.startsWith("capacity")) filenameFields[key] = field;
        }
        const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }]));
        for (const listener of listeners) listener(changes, "local");
      },
    } } },
  });
  const load = (file) => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  load("src/i18n.js");
  load("src/export-settings.js");
  await load("src/options/options.js");
  return { context, inputs, fieldset, refreshFieldset, filenameFieldset, dateInput, timeInput, uncheckedInput, modeInput, status, writes,
    sendKeyFieldset, sendKeyInput, sendKeyClear,
    capacityFieldset, capacityEnabled, capacitySecond, capacityThird, capacityError, capacityEntry, capacityEntrySetting,
    changeCapacity: target => handlers["capacity-change"]({ target }),
    captureKey: (event) => handlers["send-key-keydown"]({ preventDefault() {}, ...event }),
    clearKey: () => handlers["send-key-clear-click"](),
    changeFilename: (target) => handlers["filename-change"](target ? { target } : undefined),
    change: () => handlers.change(), changeMode: () => handlers["refresh-change"]() };
}

test("capacity limits autosave as a valid pair, survive OFF and reject invalid drafts in both languages", async () => {
  for (const locale of ["ko", "en"]) {
    const h = await harness(["md"], { locale });
    const settings = h.context.Chatcouter.exportSettings;
    assert.equal(h.capacityEnabled.checked, true);
    assert.equal(h.capacitySecond.value, "200");
    assert.equal(h.capacityThird.value, "400");
    h.capacitySecond.value = "200"; h.capacityThird.value = "1000";
    await h.changeCapacity(h.capacityThird);
    assert.equal((await settings.getCapacityBackground()).secondKB, 200);
    assert.deepEqual(Object.keys(h.writes[0]), [settings.CAPACITY_LIMITS_KEY]);
    const count = h.writes.length;
    for (const value of ["", "-1", "0", "1.5", "1000", "1001"]) {
      h.capacitySecond.value = value;
      await h.changeCapacity(h.capacitySecond);
      assert.equal(h.writes.length, count);
      assert.equal(h.capacityError.hidden, false);
      assert.equal((await settings.getCapacityBackground()).secondKB, 200);
    }
    h.capacityEnabled.checked = false;
    await h.changeCapacity(h.capacityEnabled);
    assert.equal(h.capacitySecond.disabled, true);
    assert.equal(h.capacitySecond.value, "200");
    assert.equal(h.capacityThird.value, "1000");
    h.capacityEnabled.checked = true;
    await h.changeCapacity(h.capacityEnabled);
    assert.equal(h.capacitySecond.disabled, false);
    assert.equal(h.capacitySecond.value, "200");
    for (const limits of [{ secondKB: 1, thirdKB: 1.5 }, { secondKB: 1, thirdKB: "800" },
      { secondKB: 1, thirdKB: Infinity }, { secondKB: 1, thirdKB: Number.MAX_SAFE_INTEGER }]) {
      await assert.rejects(settings.setCapacityBackgroundLimits(limits));
    }
  }
});

test("capacity toggle and atomic limits stay synchronized across option windows and reopening", async () => {
  const shared = sharedPreferences();
  const a = await harness(undefined, { sharedStorage: shared.storage });
  const b = await harness(undefined, { sharedStorage: shared.storage });
  a.capacitySecond.value = "100"; a.capacityThird.value = "200";
  await a.changeCapacity(a.capacityThird);
  assert.equal(b.capacitySecond.value, "100");
  b.capacityEnabled.checked = false; await b.changeCapacity(b.capacityEnabled);
  assert.equal(a.capacityEnabled.checked, false);
  const reopened = await harness(undefined, { sharedStorage: shared.storage });
  assert.equal(reopened.capacitySecond.value, "100");
  assert.equal(reopened.capacityThird.value, "200");
  assert.equal(reopened.capacitySecond.disabled, true);
  shared.apply({ capacityBackgroundLimitsKB: undefined });
  assert.equal(a.capacitySecond.value, "200");
  assert.equal(a.capacityEnabled.checked, false);
});

test("capacity save failures restore the last valid settings and keep the option controls usable", async () => {
  const h = await harness(undefined, { writeFails: true, capacityBackground: { enabled: true, secondKB: 10, thirdKB: 20 } });
  h.capacitySecond.value = "5";
  await h.changeCapacity(h.capacitySecond);
  assert.equal(h.capacitySecond.value, "10");
  assert.equal(h.status.textContent, h.context.Chatcouter.i18n.t("settings_save_failed"));
  assert.equal(h.capacityFieldset.disabled, false);
  h.capacityEnabled.checked = false;
  await h.changeCapacity(h.capacityEnabled);
  assert.equal(h.capacityEnabled.checked, true);
  assert.equal(h.capacitySecond.disabled, false);
});

test("English options preserve selection and storage behavior while reporting localized failures", async () => {
  const h = await harness(["html"], { locale: "en-US", writeFails: true });
  assert.equal(h.context.document.documentElement.lang, "en");
  assert.equal(h.status.textContent, "Your choices are saved automatically in this browser.");
  h.inputs[0].checked = true;
  await h.change();
  assert.equal(h.status.textContent, "Could not save. Please select your preferences again.");
  assert.deepEqual(h.inputs.map(input => input.checked), [false, false, true]);
  assert.equal(h.fieldset.disabled, false);
  const failed = await harness(undefined, { locale: "en-US", readFails: true });
  assert.equal(failed.status.textContent, "Could not load settings. Please reopen this window.");
});

test("additional shortcut captures one combination, reopens and clears without altering other preferences", async () => {
  for (const locale of ["ko", "en"]) {
    const h = await harness(["html"], { inputMode: true, locale });
    assert.equal(h.sendKeyInput.value, "");
    assert.equal(h.sendKeyClear.disabled, true);
    assert.equal(await h.context.Chatcouter.exportSettings.getSendShortcut(), null);
    await h.captureKey({ key: "\\" });
    assert.equal(h.sendKeyInput.value, "\\");
    assert.equal(h.sendKeyClear.disabled, false);
    assert.deepEqual(Object.keys(h.writes[0]), ["sendShortcut"]);
    assert.deepEqual(Array.from(await h.context.Chatcouter.exportSettings.getFormats()), ["html"]);
    assert.equal(await h.context.Chatcouter.exportSettings.getUpdateOnUserInput(), true);
    await h.captureKey({ key: "K", ctrlKey: true, shiftKey: true });
    const saved = await h.context.Chatcouter.exportSettings.getSendShortcut();
    assert.equal(h.sendKeyInput.value, "Ctrl+Shift+K");
    const reopened = await harness(["html"], { sendShortcut: saved, locale });
    assert.equal(reopened.sendKeyInput.value, "Ctrl+Shift+K");
    assert.ok(reopened.sendKeyInput.placeholder && !reopened.sendKeyInput.placeholder.startsWith("send_key_"));
    await reopened.clearKey();
    assert.equal(await reopened.context.Chatcouter.exportSettings.getSendShortcut(), null);
    assert.equal(reopened.sendKeyInput.value, "");
    assert.equal(reopened.sendKeyClear.disabled, true);
  }
});

test("shortcut capture rejects editing keys, composition and repeats and preserves the last saved value on failure", async () => {
  const saved = { key: "\\", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  const h = await harness(["md"], { sendShortcut: saved, writeFails: true });
  for (const event of [{ key: "Backspace" }, { key: "Delete" }, { key: "ArrowLeft" }, { key: "Escape" },
    { key: "Tab" }, { key: "Control", ctrlKey: true }, { key: "Process" },
    { key: "k", isComposing: true }, { key: "k", keyCode: 229 }, { key: "k", repeat: true }]) {
    await h.captureKey(event);
    assert.equal(h.writes.length, 0);
    assert.equal(h.sendKeyInput.value, "\\");
  }
  await h.captureKey({ key: "Enter", altKey: true });
  assert.equal(h.sendKeyInput.value, "\\");
  assert.match(h.status.textContent, /저장하지 못/);
  await h.clearKey();
  assert.equal(h.sendKeyInput.value, "\\");
  assert.equal(h.sendKeyClear.disabled, false);
  const settings = h.context.Chatcouter.exportSettings;
  for (const value of [undefined, "\\", {}, { ...saved, key: "Delete" }, { ...saved, ctrlKey: "false" }]) {
    assert.equal(settings.normalizeSendShortcut(value), null);
  }
  await assert.rejects(settings.setSendShortcut({ ...saved, key: "Escape" }), /Unsupported/);
  const pending = await harness(["md"]);
  let finish;
  pending.context.browser.storage.local.set = () => new Promise(resolve => { finish = resolve; });
  const writing = pending.captureKey({ key: "\\" });
  for (const group of [pending.fieldset, pending.refreshFieldset, pending.filenameFieldset, pending.sendKeyFieldset]) {
    assert.equal(group.disabled, true);
  }
  finish();
  await writing;
  assert.equal(pending.sendKeyFieldset.disabled, false);
});

test("options start with Markdown and persist a canonical supported selection", async () => {
  const h = await harness(undefined);
  assert.deepEqual(h.inputs.map((input) => input.checked), [true, false, false]);
  assert.equal(h.fieldset.disabled, false);
  h.inputs[1].checked = true;
  h.inputs[2].checked = true;
  await h.change();
  assert.deepEqual(Array.from(await h.context.Chatcouter.exportSettings.getFormats()), ["md", "json", "html"]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.status.textContent, "저장했습니다.");
});

test("the last selected format cannot be unchecked and invalid stored selections fall back", async () => {
  const h = await harness(["html"]);
  h.inputs[2].checked = false;
  await h.change();
  assert.equal(h.inputs[2].checked, true);
  assert.equal(h.writes.length, 0);
  assert.match(h.status.textContent, /하나 이상/);
  const settings = h.context.Chatcouter.exportSettings;
  for (const value of [null, [], ["invalid"], "html"]) {
    assert.deepEqual(Array.from(settings.normalizeFormats(value)), ["md"]);
  }
  assert.deepEqual(Array.from(settings.normalizeFormats(["html", "md", "html", "invalid"])), ["md", "html"]);
  await assert.rejects(settings.setFormats([]), /at least one/);
});

test("options report storage errors and restore the saved selection after failed writes", async () => {
  const loadFailure = await harness(undefined, { readFails: true });
  assert.equal(loadFailure.fieldset.disabled, true);
  assert.match(loadFailure.status.textContent, /불러오지 못/);
  const h = await harness(["md"], { writeFails: true });
  h.inputs[1].checked = true;
  await h.change();
  assert.deepEqual(h.inputs.map((input) => input.checked), [true, false, false]);
  assert.equal(h.fieldset.disabled, false);
  assert.match(h.status.textContent, /저장하지 못/);
});

test("options disable changes while a preference write is pending", async () => {
  const h = await harness(["md"]);
  let resolve;
  h.context.browser.storage.local.set = () => new Promise((done) => { resolve = done; });
  h.inputs[2].checked = true;
  const pending = h.change();
  assert.equal(h.fieldset.disabled, true);
  resolve();
  await pending;
  assert.equal(h.fieldset.disabled, false);
});

test("update mode defaults off and persists separately without changing selected formats", async () => {
  const h = await harness(["html"]);
  assert.equal(h.modeInput.checked, false);
  h.modeInput.checked = true;
  await h.changeMode();
  assert.equal(await h.context.Chatcouter.exportSettings.getUpdateOnUserInput(), true);
  assert.deepEqual(Array.from(await h.context.Chatcouter.exportSettings.getFormats()), ["html"]);
  assert.deepEqual(Object.keys(h.writes[0]), ["updateOnUserInput"]);
  assert.match(h.status.textContent, /다음 입력/);
  h.inputs[0].checked = true;
  await h.change();
  assert.equal(await h.context.Chatcouter.exportSettings.getUpdateOnUserInput(), true);
  const reopened = await harness(["html"], { inputMode: true });
  assert.equal(reopened.modeInput.checked, true);
  for (const value of [undefined, null, "true", 1]) {
    assert.equal(reopened.context.Chatcouter.exportSettings.normalizeUpdateOnUserInput(value), false);
  }
});

test("failed mode writes restore the saved checkbox and block both setting groups while saving", async () => {
  const failed = await harness(["md"], { inputMode: true, writeFails: true });
  failed.modeInput.checked = false;
  await failed.changeMode();
  assert.equal(failed.modeInput.checked, true);
  assert.match(failed.status.textContent, /저장하지 못/);
  const h = await harness(["md"]);
  let finish;
  h.context.browser.storage.local.set = () => new Promise(resolve => { finish = resolve; });
  h.modeInput.checked = true;
  const pending = h.changeMode();
  assert.equal(h.fieldset.disabled, true);
  assert.equal(h.refreshFieldset.disabled, true);
  assert.equal(h.filenameFieldset.disabled, true);
  finish();
  await pending;
  assert.equal(h.fieldset.disabled, false);
  assert.equal(h.refreshFieldset.disabled, false);
  assert.equal(h.filenameFieldset.disabled, false);
});

test("filename settings default on, normalize older preferences and persist independently", async () => {
  const h = await harness(["html"], { inputMode: true });
  assert.equal(h.dateInput.checked, true);
  assert.equal(h.timeInput.checked, true);
  assert.equal(h.uncheckedInput.checked, true);
  const settings = h.context.Chatcouter.exportSettings;
  for (const value of [undefined, null, [], "invalid", { includeDate: "false", includeTime: 0 }]) {
    assert.deepEqual({ ...settings.normalizeFilenameOptions(value) }, { includeDate: true, includeTime: true, includeUnchecked: true });
  }
  assert.deepEqual({ ...settings.normalizeFilenameOptions({ includeDate: false }) }, { includeDate: false, includeTime: true, includeUnchecked: true });
  assert.deepEqual({ ...settings.normalizeFilenameOptions({ includeDate: false, includeTime: false }) },
    { includeDate: false, includeTime: false, includeUnchecked: true });
  assert.equal(settings.normalizeFilenameOptions({ includeUnchecked: "false" }).includeUnchecked, true);
  h.dateInput.checked = false;
  h.timeInput.checked = false;
  h.uncheckedInput.checked = false;
  await h.changeFilename();
  const saved = await settings.getExportPreferences();
  assert.deepEqual({ ...saved.filenameOptions }, { includeDate: false, includeTime: false, includeUnchecked: false });
  assert.deepEqual(Array.from(saved.formats), ["html"]);
  assert.equal(await settings.getUpdateOnUserInput(), true);
  assert.deepEqual(Object.keys(h.writes[0]), ["filenameIncludeDate", "filenameIncludeTime", "filenameIncludeUnchecked"]);
  assert.match(h.status.textContent, /다음 내보내기/);
  const reopened = await harness(["html"], { filenameOptions: saved.filenameOptions });
  assert.equal(reopened.dateInput.checked, false);
  assert.equal(reopened.timeInput.checked, false);
  assert.equal(reopened.uncheckedInput.checked, false);
  await assert.rejects(settings.setFilenameOptions({ includeDate: false }), /booleans/);
  await assert.rejects(settings.setFilenameOptions({ includeDate: true, includeTime: true, includeUnchecked: "false" }), /booleans/);
});

test("failed filename writes restore all saved checkboxes and block all settings while saving", async () => {
  const failed = await harness(["md"], { filenameOptions: { includeDate: false, includeTime: true, includeUnchecked: false }, writeFails: true });
  failed.dateInput.checked = true;
  failed.timeInput.checked = false;
  failed.uncheckedInput.checked = true;
  await failed.changeFilename();
  assert.equal(failed.dateInput.checked, false);
  assert.equal(failed.timeInput.checked, true);
  assert.equal(failed.uncheckedInput.checked, false);
  assert.match(failed.status.textContent, /저장하지 못/);
  const h = await harness(["md"]);
  let finish;
  h.context.browser.storage.local.set = () => new Promise(resolve => { finish = resolve; });
  h.timeInput.checked = false;
  const pending = h.changeFilename();
  for (const group of [h.fieldset, h.refreshFieldset, h.filenameFieldset]) assert.equal(group.disabled, true);
  finish();
  await pending;
  for (const group of [h.fieldset, h.refreshFieldset, h.filenameFieldset]) assert.equal(group.disabled, false);
});

test("unchecked filename preference reopens in both locales without changing the date and time choices", async () => {
  for (const locale of ["ko", "en"]) {
    const h = await harness(["md"], { filenameOptions: { includeDate: true, includeTime: false }, locale });
    assert.equal(h.uncheckedInput.checked, true);
    h.uncheckedInput.checked = false;
    await h.changeFilename();
    assert.deepEqual(Object.keys(h.writes[0]), ["filenameIncludeUnchecked"]);
    const saved = (await h.context.Chatcouter.exportSettings.getExportPreferences()).filenameOptions;
    assert.deepEqual({ ...saved }, { includeDate: true, includeTime: false, includeUnchecked: false });
    const reopened = await harness(["md"], { filenameOptions: saved, locale });
    assert.equal(reopened.dateInput.checked, true);
    assert.equal(reopened.timeInput.checked, false);
    assert.equal(reopened.uncheckedInput.checked, false);
  }
});

function sharedPreferences(initial = {}) {
  const stored = { exportFormats: ["md"], ...initial };
  const listeners = new Set();
  const apply = value => {
    const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { oldValue: stored[key], newValue }]));
    Object.assign(stored, value);
    for (const listener of listeners) listener(changes, "local");
  };
  return { stored, apply, storage: {
    local: { get: async () => ({ ...stored }), set: async value => apply(value) },
    onChanged: { addListener: fn => listeners.add(fn) },
  } };
}

const flushChanges = async () => { for (let step = 0; step < 8; step++) await Promise.resolve(); };

test("two option windows preserve unrelated filename edits even with overlapping saves", async () => {
  const shared = sharedPreferences({ filenameOptions: { includeTime: false } });
  const a = await harness(undefined, { sharedStorage: shared.storage });
  const b = await harness(undefined, { sharedStorage: shared.storage });
  b.uncheckedInput.checked = false;
  await b.changeFilename(b.uncheckedInput);
  await flushChanges();
  assert.equal(a.uncheckedInput.checked, false);
  a.dateInput.checked = false;
  await a.changeFilename(a.dateInput);
  await flushChanges();
  assert.deepEqual({ ...(await b.context.Chatcouter.exportSettings.getExportPreferences()).filenameOptions },
    { includeDate: false, includeTime: false, includeUnchecked: false });
  assert.equal(b.dateInput.checked, false);
  // Start edits before either screen receives the other write notification.
  a.dateInput.checked = true;
  b.timeInput.checked = true;
  await Promise.all([a.changeFilename(a.dateInput), b.changeFilename(b.timeInput)]);
  await flushChanges();
  for (const window of [a, b]) {
    assert.equal(window.dateInput.checked, true);
    assert.equal(window.timeInput.checked, true);
    assert.equal(window.uncheckedInput.checked, false);
  }
  const reopened = await harness(undefined, { sharedStorage: shared.storage });
  assert.equal(reopened.uncheckedInput.checked, false);
  assert.equal(reopened.timeInput.checked, true);
});

test("newer storage notifications survive an older pending save success or failure", async () => {
  for (const fails of [false, true]) {
    const shared = sharedPreferences();
    const h = await harness(undefined, { sharedStorage: shared.storage });
    let finish;
    shared.storage.local.set = () => new Promise((resolve, reject) => {
      finish = () => fails ? reject(Error("write failed")) : resolve();
    });
    h.dateInput.checked = false;
    const pending = h.changeFilename(h.dateInput);
    shared.apply({ filenameIncludeDate: true, filenameIncludeTime: false, filenameIncludeUnchecked: false });
    await flushChanges();
    finish();
    await pending;
    assert.equal(h.dateInput.checked, true);
    assert.equal(h.timeInput.checked, false);
    assert.equal(h.uncheckedInput.checked, false);
    assert.equal(h.filenameFieldset.disabled, false);
    if (fails) assert.match(h.status.textContent, /저장하지 못/);
  }
});

test("option windows follow format, mode and shortcut changes; same field uses last stored value", async () => {
  const shared = sharedPreferences();
  const a = await harness(undefined, { sharedStorage: shared.storage });
  const b = await harness(undefined, { sharedStorage: shared.storage });
  b.inputs[0].checked = false;
  b.inputs[2].checked = true;
  await b.change();
  b.modeInput.checked = true;
  await b.changeMode();
  await b.captureKey({ key: "k", ctrlKey: true });
  assert.deepEqual(a.inputs.map(input => input.checked), [false, false, true]);
  assert.equal(a.modeInput.checked, true);
  assert.equal(a.sendKeyInput.value, "Ctrl+K");
  a.dateInput.checked = false;
  await a.changeFilename(a.dateInput);
  b.dateInput.checked = true;
  await b.changeFilename(b.dateInput);
  await flushChanges();
  assert.equal(a.dateInput.checked, true);
  assert.equal(b.dateInput.checked, true);
  // Full setter remains available and deliberately replaces all three fields.
  await a.context.Chatcouter.exportSettings.setFilenameOptions({ includeDate: false, includeTime: false });
  await flushChanges();
  assert.equal(b.dateInput.checked, false);
  assert.equal(b.timeInput.checked, false);
  assert.equal(b.uncheckedInput.checked, true);
});

test("storage changes arriving during initial load win over its stale snapshot", async () => {
  const shared = sharedPreferences();
  let finishInitial, firstRead = true;
  shared.storage.local.get = async () => {
    const snapshot = { ...shared.stored };
    if (!firstRead) return snapshot;
    firstRead = false;
    return new Promise(resolve => { finishInitial = () => resolve(snapshot); });
  };
  const loading = harness(undefined, { sharedStorage: shared.storage });
  shared.apply({ exportFormats: ["html"], filenameIncludeDate: false, updateOnUserInput: true,
    sendShortcut: { key: "k", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } });
  finishInitial();
  const h = await loading;
  assert.deepEqual(h.inputs.map(input => input.checked), [false, false, true]);
  assert.equal(h.dateInput.checked, false);
  assert.equal(h.modeInput.checked, true);
  assert.equal(h.sendKeyInput.value, "Ctrl+K");
});

test("late filename notification reads cannot roll back a newer effective value", async () => {
  const shared = sharedPreferences();
  const h = await harness(undefined, { sharedStorage: shared.storage });
  let finishOld, firstRead = true;
  shared.storage.local.get = async () => {
    const snapshot = { ...shared.stored };
    if (!firstRead) return snapshot;
    firstRead = false;
    return new Promise(resolve => { finishOld = () => resolve(snapshot); });
  };
  shared.apply({ filenameIncludeDate: false });
  shared.apply({ filenameIncludeTime: false });
  await flushChanges();
  assert.equal(h.timeInput.checked, false);
  finishOld();
  await flushChanges();
  assert.equal(h.dateInput.checked, false);
  assert.equal(h.timeInput.checked, false);
});

test("startup follows replaced filename reads and only enables settings after the latest succeeds", async () => {
  for (const latestFails of [false, true]) {
    const shared = sharedPreferences();
    const reads = [];
    const originalGet = shared.storage.local.get;
    shared.storage.local.get = key => {
      if (!Array.isArray(key) || !key.includes("exportFormats")) return originalGet(key);
      const snapshot = { ...shared.stored };
      return new Promise((resolve, reject) => reads.push({
        finish: () => resolve(snapshot), fail: () => reject(Error("latest read failed")),
      }));
    };
    const flush = async () => { for (let step = 0; step < 40; step++) await Promise.resolve(); };
    let startupSettled = false;
    const loading = harness(undefined, { sharedStorage: shared.storage, locale: "en" })
      .then(h => { startupSettled = true; return h; });
    shared.apply({ filenameIncludeDate: false });
    reads[0].finish(); await flush();
    shared.apply({ filenameIncludeTime: false });
    reads[1].finish(); await flush();
    shared.apply({ filenameIncludeUnchecked: false });
    reads[2].finish(); await flush();
    assert.equal(startupSettled, false, "initialization must keep waiting for the replacement read");
    if (latestFails) reads[3].fail();
    else reads[3].finish();
    const h = await loading;
    for (const group of [h.fieldset, h.refreshFieldset, h.filenameFieldset, h.sendKeyFieldset]) {
      assert.equal(group.disabled, latestFails);
    }
    if (latestFails) {
      assert.match(h.status.textContent, /Could not load settings/);
      continue;
    }
    assert.equal(h.dateInput.checked, false);
    assert.equal(h.timeInput.checked, false);
    assert.equal(h.uncheckedInput.checked, false);
    shared.storage.local.get = originalGet;
    h.timeInput.checked = true;
    await h.changeFilename(h.timeInput);
    const saved = (await h.context.Chatcouter.exportSettings.getExportPreferences()).filenameOptions;
    assert.deepEqual({ ...saved }, { includeDate: false, includeTime: true, includeUnchecked: false });
    assert.equal(h.filenameFieldset.disabled, false, "change handlers are registered and usable");
  }
});

test("shared options notice keeps the latest operation when earlier work finishes later", async () => {
  const h = await harness(["md"]), notice = h.context.Chatcouter.optionsNotice;
  const earlier = notice.begin("first save pending");
  const later = notice.begin("second save pending");
  notice.finish(later, "second saved");
  notice.finish(earlier, "first failed");
  assert.equal(h.status.textContent, "second saved");
  const passiveRead = notice.current();
  notice.begin("invalid draft");
  notice.finish(passiveRead, "old read failed");
  assert.equal(h.status.textContent, "invalid draft");
});

test("entry transition defaults OFF, persists independently and follows other windows and key removal", async () => {
  for (const locale of ["ko", "en"]) {
    const shared = sharedPreferences({ capacityBackgroundLimitsKB: { secondKB: 10, thirdKB: 20 } });
    const a = await harness(undefined, { locale, sharedStorage: shared.storage });
    const b = await harness(undefined, { locale, sharedStorage: shared.storage });
    assert.equal(a.capacityEntry.checked, false);
    assert.equal(a.capacityEntrySetting.hidden, false);
    a.capacitySecond.value = "invalid draft";
    a.capacityEntry.checked = true;
    await a.changeCapacity(a.capacityEntry);
    assert.equal(b.capacityEntry.checked, true);
    assert.equal(b.capacitySecond.value, "10");
    const reopened = await harness(undefined, { sharedStorage: shared.storage });
    assert.equal(reopened.capacityEntry.checked, true);
    b.capacitySecond.value = "11"; await b.changeCapacity(b.capacitySecond);
    assert.equal(a.capacityEntry.checked, true, "limit notifications preserve the independent toggle");
    b.capacityEnabled.checked = false; await b.changeCapacity(b.capacityEnabled);
    assert.equal(a.capacityEntry.checked, true, "background OFF preserves preference");
    shared.apply({ capacityEntryTransition: undefined });
    assert.equal(a.capacityEntry.checked, false);
    assert.equal(b.capacityEntry.checked, false);
    assert.equal((await a.context.Chatcouter.exportSettings.getCapacityBackground()).entryTransition, false);
  }
});

test("entry transition save failure restores OFF and disabling the experiment ignores saved ON", async () => {
  const h = await harness(undefined, { writeFails: true });
  h.capacityEntry.checked = true; await h.changeCapacity(h.capacityEntry);
  assert.equal(h.capacityEntry.checked, false);
  assert.equal(h.capacityFieldset.disabled, false);
  const context = vm.createContext({ browser: { storage: { local: {
    get: async () => ({ capacityEntryTransition: true }), set: async () => {},
  } } } });
  vm.runInContext(fs.readFileSync("src/export-settings.js", "utf8").replace("CAPACITY_ENTRY_AVAILABLE = true", "CAPACITY_ENTRY_AVAILABLE = false"), context);
  assert.equal((await context.Chatcouter.exportSettings.getCapacityBackground()).entryTransition, false);
  assert.equal(await context.Chatcouter.exportSettings.setCapacityEntryTransition(true), false);
});
