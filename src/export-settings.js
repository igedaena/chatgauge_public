(function registerExportSettings(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const FORMATS = Object.freeze(["md", "json", "html"]);
  const KEY = "exportFormats";
  const UPDATE_ON_INPUT_KEY = "updateOnUserInput";
  const FILENAME_OPTIONS_KEY = "filenameOptions";
  // Per-field keys prevent two option windows from overwriting unrelated edits.
  // The original object remains the fallback for profiles saved before this.
  const FILENAME_OPTION_KEYS = Object.freeze({
    includeDate: "filenameIncludeDate",
    includeTime: "filenameIncludeTime",
    includeUnchecked: "filenameIncludeUnchecked",
  });
  const SEND_SHORTCUT_KEY = "sendShortcut";
  const CAPACITY_ENABLED_KEY = "capacityBackgroundEnabled";
  const CAPACITY_LIMITS_KEY = "capacityBackgroundLimitsKB";
  const CAPACITY_ENTRY_KEY = "capacityEntryTransition";
  // One switch hides and disables the experiment, including previously saved ON values.
  const CAPACITY_ENTRY_AVAILABLE = true;
  const CAPACITY_DEFAULTS = Object.freeze({ enabled: true, secondKB: 200, thirdKB: 400 });
  const MODIFIERS = ["ctrlKey", "altKey", "shiftKey", "metaKey"];

  function normalizeFormats(value) {
    const selected = Array.isArray(value) ? FORMATS.filter((format) => value.includes(format)) : [];
    return selected.length ? selected : ["md"];
  }

  async function getFormats() {
    const stored = await global.browser.storage.local.get(KEY);
    return normalizeFormats(stored[KEY]);
  }

  async function setFormats(value) {
    if (!Array.isArray(value) || !value.length || value.some((format) => !FORMATS.includes(format))) {
      throw new TypeError("Select at least one supported export format");
    }
    const selected = normalizeFormats(value);
    await global.browser.storage.local.set({ [KEY]: selected });
    return selected;
  }

  function normalizeFilenameOptions(value) {
    const options = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      includeDate: typeof options.includeDate === "boolean" ? options.includeDate : true,
      includeTime: typeof options.includeTime === "boolean" ? options.includeTime : true,
      includeUnchecked: typeof options.includeUnchecked === "boolean" ? options.includeUnchecked : true,
    };
  }

  async function getExportPreferences() {
    const stored = await global.browser.storage.local.get([KEY, FILENAME_OPTIONS_KEY, ...Object.values(FILENAME_OPTION_KEYS)]);
    const filenameOptions = normalizeFilenameOptions(stored[FILENAME_OPTIONS_KEY]);
    for (const [field, key] of Object.entries(FILENAME_OPTION_KEYS)) {
      if (typeof stored[key] === "boolean") filenameOptions[field] = stored[key];
    }
    return { formats: normalizeFormats(stored[KEY]), filenameOptions };
  }

  async function setFilenameOptions(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.includeDate !== "boolean" || typeof value.includeTime !== "boolean"
      || (value.includeUnchecked !== undefined && typeof value.includeUnchecked !== "boolean")) {
      throw new TypeError("Filename options must be booleans");
    }
    const options = normalizeFilenameOptions(value);
    await global.browser.storage.local.set({ [FILENAME_OPTIONS_KEY]: options,
      ...Object.fromEntries(Object.entries(FILENAME_OPTION_KEYS).map(([field, key]) => [key, options[field]])) });
    return options;
  }

  async function patchFilenameOptions(patch) {
    const entries = Object.entries(patch || {});
    if (!entries.length || entries.some(([field, value]) => !Object.hasOwn(FILENAME_OPTION_KEYS, field)
      || typeof value !== "boolean")) throw new TypeError("Filename options patch must contain boolean fields");
    await global.browser.storage.local.set(Object.fromEntries(entries.map(([field, value]) => [FILENAME_OPTION_KEYS[field], value])));
    return (await getExportPreferences()).filenameOptions;
  }

  function normalizeUpdateOnUserInput(value) {
    return value === true;
  }

  async function getUpdateOnUserInput() {
    const stored = await global.browser.storage.local.get(UPDATE_ON_INPUT_KEY);
    return normalizeUpdateOnUserInput(stored[UPDATE_ON_INPUT_KEY]);
  }

  async function setUpdateOnUserInput(value) {
    if (typeof value !== "boolean") throw new TypeError("Update mode must be a boolean");
    await global.browser.storage.local.set({ [UPDATE_ON_INPUT_KEY]: value });
    return value;
  }

  function normalizeSendShortcut(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.key !== "string"
      || MODIFIERS.some((name) => typeof value[name] !== "boolean")) return null;
    // Editing/cancel keys can empty a composer without submitting a message.
    if (value.key !== "Enter"
      && (Array.from(value.key).length !== 1 || /[\p{C}]/u.test(value.key))) return null;
    const key = /^[A-Z]$/.test(value.key) ? value.key.toLowerCase() : value.key;
    return { key, ...Object.fromEntries(MODIFIERS.map((name) => [name, value[name]])) };
  }

  function sendShortcutFromEvent(event) {
    if (event.isComposing || event.repeat || event.keyCode === 229) return null;
    return normalizeSendShortcut({ key: event.key,
      ...Object.fromEntries(MODIFIERS.map((name) => [name, Boolean(event[name])])) });
  }

  function matchesSendShortcut(event, shortcut) {
    const pressed = shortcut && sendShortcutFromEvent(event);
    return Boolean(pressed && pressed.key === shortcut.key
      && MODIFIERS.every((name) => pressed[name] === shortcut[name]));
  }

  async function getSendShortcut() {
    const stored = await global.browser.storage.local.get(SEND_SHORTCUT_KEY);
    return normalizeSendShortcut(stored[SEND_SHORTCUT_KEY]);
  }

  async function setSendShortcut(value) {
    const shortcut = normalizeSendShortcut(value);
    if (value !== null && !shortcut) throw new TypeError("Unsupported send shortcut");
    await global.browser.storage.local.set({ [SEND_SHORTCUT_KEY]: shortcut });
    return shortcut;
  }

  function validCapacityLimits(value) {
    return Boolean(value && Number.isSafeInteger(value.secondKB) && value.secondKB > 0
      && Number.isSafeInteger(value.thirdKB) && Number.isSafeInteger(value.thirdKB * 1024)
      && value.secondKB < value.thirdKB);
  }

  function normalizeCapacityBackground(value) {
    const limits = validCapacityLimits(value) ? value : CAPACITY_DEFAULTS;
    return { enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
      secondKB: limits.secondKB, thirdKB: limits.thirdKB,
      entryTransition: CAPACITY_ENTRY_AVAILABLE && value?.entryTransition === true };
  }

  async function getCapacityBackground() {
    const stored = await global.browser.storage.local.get([CAPACITY_ENABLED_KEY, CAPACITY_LIMITS_KEY, CAPACITY_ENTRY_KEY]);
    return normalizeCapacityBackground({ ...stored[CAPACITY_LIMITS_KEY], enabled: stored[CAPACITY_ENABLED_KEY],
      entryTransition: stored[CAPACITY_ENTRY_KEY] });
  }

  async function setCapacityEntryTransition(value) {
    if (typeof value !== "boolean") throw new TypeError("Entry transition toggle must be a boolean");
    const enabled = CAPACITY_ENTRY_AVAILABLE && value;
    await global.browser.storage.local.set({ [CAPACITY_ENTRY_KEY]: enabled });
    return enabled;
  }

  async function setCapacityBackgroundEnabled(value) {
    if (typeof value !== "boolean") throw new TypeError("Capacity background toggle must be a boolean");
    await global.browser.storage.local.set({ [CAPACITY_ENABLED_KEY]: value });
    return value;
  }

  async function setCapacityBackgroundLimits(value) {
    if (!validCapacityLimits(value)) throw new TypeError("Capacity limits must be increasing positive integer KB");
    const limits = { secondKB: value.secondKB, thirdKB: value.thirdKB };
    await global.browser.storage.local.set({ [CAPACITY_LIMITS_KEY]: limits });
    return limits;
  }

  namespace.exportSettings = Object.freeze({
    CAPACITY_ENABLED_KEY, CAPACITY_LIMITS_KEY, CAPACITY_ENTRY_KEY, CAPACITY_ENTRY_AVAILABLE,
    setCapacityEntryTransition, CAPACITY_DEFAULTS, validCapacityLimits, normalizeCapacityBackground,
    getCapacityBackground, setCapacityBackgroundEnabled, setCapacityBackgroundLimits,
    FORMATS, KEY, normalizeFormats, getFormats, setFormats,
    FILENAME_OPTIONS_KEY, FILENAME_OPTION_KEYS, normalizeFilenameOptions, getExportPreferences, setFilenameOptions, patchFilenameOptions,
    UPDATE_ON_INPUT_KEY, normalizeUpdateOnUserInput, getUpdateOnUserInput, setUpdateOnUserInput,
    SEND_SHORTCUT_KEY, normalizeSendShortcut, sendShortcutFromEvent, matchesSendShortcut,
    getSendShortcut, setSendShortcut,
  });
})(globalThis);
