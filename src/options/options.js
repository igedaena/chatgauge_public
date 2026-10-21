(async function startOptions(global) {
  "use strict";
  const { t, localizeDocument } = global.Chatcouter.i18n;
  localizeDocument(document);
  const settings = global.Chatcouter.exportSettings;
  const actions = global.Chatcouter.optionsActions;
  const write = work => actions ? actions.run(work) : work();
  const fieldset = document.getElementById("export-formats");
  const refreshFieldset = document.getElementById("refresh-settings");
  const filenameFieldset = document.getElementById("filename-settings");
  const sendKeyFieldset = document.getElementById("send-key-settings");
  const sendKeyInput = document.getElementById("send-key");
  const sendKeyClear = document.getElementById("send-key-clear");
  const includeDate = document.getElementById("filename-date");
  const includeTime = document.getElementById("filename-time");
  const includeUnchecked = document.getElementById("filename-unchecked");
  const inputs = [...document.querySelectorAll('#export-formats input[type="checkbox"]')];
  const updateOnInput = document.getElementById("update-on-user-input");
  const status = document.getElementById("status");
  let noticeRevision = 0;
  const notice = global.Chatcouter.optionsNotice = Object.freeze({
    current: () => noticeRevision,
    begin(text) { status.textContent = text; return ++noticeRevision; },
    finish(token, text) { if (token === noticeRevision) status.textContent = text; },
  });
  const loadNotice = notice.current();
  const capacityFieldset = document.getElementById("capacity-settings");
  const capacityEnabled = document.getElementById("capacity-enabled");
  const capacitySecond = document.getElementById("capacity-second");
  const capacityThird = document.getElementById("capacity-third");
  const capacityEntry = document.getElementById("capacity-entry");
  const capacityError = document.getElementById("capacity-error");
  let capacity = settings.normalizeCapacityBackground();
  let selected;
  let inputMode;
  let filenameOptions;
  let sendShortcut;
  let loaded = false;
  let filenameRefresh = Promise.resolve();
  const revisions = { formats: 0, filename: 0, mode: 0, shortcut: 0, capacityEnabled: 0, capacityLimits: 0, capacityEntry: 0 };
  const filenameInputs = { includeDate, includeTime, includeUnchecked };
  sendKeyInput.placeholder = t("send_key_placeholder");
  function disableSettings(disabled) {
    actions?.setBusy("options", disabled);
    fieldset.disabled = disabled;
    refreshFieldset.disabled = disabled;
    filenameFieldset.disabled = disabled;
    sendKeyFieldset.disabled = disabled;
    capacityFieldset.disabled = disabled;
    capacitySecond.disabled = capacityThird.disabled = disabled || !capacity.enabled;
  }
  function showCapacity() {
    capacityEnabled.checked = capacity.enabled;
    const limitsPanel = document.getElementById("capacity-limits");
    if (limitsPanel) limitsPanel.hidden = !capacity.enabled;
    capacitySecond.value = String(capacity.secondKB);
    capacityThird.value = String(capacity.thirdKB);
    capacityEntry.checked = capacity.entryTransition;
    document.getElementById("capacity-entry-setting").hidden = !settings.CAPACITY_ENTRY_AVAILABLE;
    document.getElementById("capacity-entry-hint").hidden = !settings.CAPACITY_ENTRY_AVAILABLE;
    capacitySecond.disabled = capacityThird.disabled = !capacity.enabled;
    capacityError.hidden = true;
  }
  function showSelection() {
    for (const input of inputs) input.checked = selected.includes(input.value);
  }
  function showFilenameOptions() {
    includeDate.checked = filenameOptions.includeDate;
    includeTime.checked = filenameOptions.includeTime;
    includeUnchecked.checked = filenameOptions.includeUnchecked;
  }
  function showSendShortcut() {
    const labels = [["ctrlKey", "Ctrl"], ["altKey", "Alt"], ["shiftKey", "Shift"], ["metaKey", "Meta"]];
    sendKeyInput.value = sendShortcut ? [...labels.filter(([name]) => sendShortcut[name]).map(([, label]) => label),
      sendShortcut.key === " " ? "Space" : /^[a-z]$/.test(sendShortcut.key) ? sendShortcut.key.toUpperCase() : sendShortcut.key].join("+") : "";
    sendKeyClear.disabled = !sendShortcut;
  }
  global.browser.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (Object.hasOwn(changes, settings.CAPACITY_ENABLED_KEY)) {
      revisions.capacityEnabled++;
      capacity = settings.normalizeCapacityBackground({ ...capacity, enabled: changes[settings.CAPACITY_ENABLED_KEY].newValue });
      if (loaded) showCapacity();
    }
    if (Object.hasOwn(changes, settings.CAPACITY_LIMITS_KEY)) {
      revisions.capacityLimits++;
      capacity = settings.normalizeCapacityBackground({ ...changes[settings.CAPACITY_LIMITS_KEY].newValue,
        enabled: capacity.enabled, entryTransition: capacity.entryTransition });
      if (loaded) showCapacity();
    }
    if (Object.hasOwn(changes, settings.CAPACITY_ENTRY_KEY)) {
      revisions.capacityEntry++;
      capacity = settings.normalizeCapacityBackground({ ...capacity,
        entryTransition: changes[settings.CAPACITY_ENTRY_KEY].newValue });
      if (loaded) showCapacity();
    }
    if (Object.hasOwn(changes, settings.KEY)) {
      revisions.formats++;
      selected = settings.normalizeFormats(changes[settings.KEY].newValue);
      if (loaded) showSelection();
    }
    if (Object.hasOwn(changes, settings.UPDATE_ON_INPUT_KEY)) {
      revisions.mode++;
      inputMode = settings.normalizeUpdateOnUserInput(changes[settings.UPDATE_ON_INPUT_KEY].newValue);
      if (loaded) updateOnInput.checked = inputMode;
    }
    if (Object.hasOwn(changes, settings.SEND_SHORTCUT_KEY)) {
      revisions.shortcut++;
      sendShortcut = settings.normalizeSendShortcut(changes[settings.SEND_SHORTCUT_KEY].newValue);
      if (loaded) showSendShortcut();
    }
    if ([settings.FILENAME_OPTIONS_KEY, ...Object.values(settings.FILENAME_OPTION_KEYS)]
      .some(key => Object.hasOwn(changes, key))) {
      const revision = ++revisions.filename;
      const noticeToken = notice.current();
      // Read the effective value, including old-profile fallbacks and removals.
      filenameRefresh = settings.getExportPreferences().then(preferences => {
        if (revision !== revisions.filename) return;
        filenameOptions = preferences.filenameOptions;
        if (loaded) showFilenameOptions();
      }).catch(() => {
        if (revision === revisions.filename) notice.finish(noticeToken, t("settings_load_failed"));
        return false;
      });
    }
  });
  try {
    const preferences = await settings.getExportPreferences();
    if (!revisions.formats) selected = preferences.formats;
    if (!revisions.filename) filenameOptions = preferences.filenameOptions;
    const mode = await settings.getUpdateOnUserInput();
    if (!revisions.mode) inputMode = mode;
    const shortcut = await settings.getSendShortcut();
    if (!revisions.shortcut) sendShortcut = shortcut;
    const capacityValue = await settings.getCapacityBackground();
    capacity = settings.normalizeCapacityBackground({ ...(revisions.capacityLimits ? capacity : capacityValue),
      enabled: revisions.capacityEnabled ? capacity.enabled : capacityValue.enabled,
      entryTransition: revisions.capacityEntry ? capacity.entryTransition : capacityValue.entryTransition });
    // Follow replacement notifications without issuing additional reads. Check
    // identity in this continuation so a stale completion cannot unlock the UI.
    let refresh;
    do {
      refresh = filenameRefresh;
      const refreshed = await refresh;
      if (refresh === filenameRefresh && refreshed === false) {
        throw new Error("Filename preferences unavailable");
      }
    } while (refresh !== filenameRefresh);
    loaded = true;
    showSelection();
    showFilenameOptions();
    updateOnInput.checked = inputMode;
    showSendShortcut();
    showCapacity();
    disableSettings(false);
    notice.finish(loadNotice, t("settings_autosave"));
  } catch {
    notice.finish(loadNotice, t("settings_load_failed"));
    return;
  }
  fieldset.addEventListener("change", async () => {
    const next = inputs.filter((input) => input.checked).map((input) => input.value);
    if (!next.length) {
      showSelection();
      notice.begin(t("select_format_hint"));
      return;
    }
    disableSettings(true);
    const noticeToken = notice.begin(t("settings_saving"));
    const revision = revisions.formats;
    try {
      const saved = await write(() => settings.setFormats(next));
      if (revision === revisions.formats) selected = saved;
      notice.finish(noticeToken, t("settings_saved"));
    } catch {
      showSelection();
      notice.finish(noticeToken, t("settings_save_failed"));
    } finally {
      showSelection();
      disableSettings(false);
    }
  });
  filenameFieldset.addEventListener("change", async (event) => {
    const patch = Object.fromEntries(Object.entries(filenameInputs)
      .filter(([field, input]) => event?.target ? event.target === input : input.checked !== filenameOptions[field])
      .map(([field, input]) => [field, input.checked]));
    if (!Object.keys(patch).length) return;
    disableSettings(true);
    const noticeToken = notice.begin(t("settings_saving"));
    const revision = revisions.filename;
    try {
      const saved = await write(() => settings.patchFilenameOptions(patch));
      if (revision === revisions.filename) filenameOptions = saved;
      notice.finish(noticeToken, t("filename_saved"));
    } catch {
      showFilenameOptions();
      notice.finish(noticeToken, t("settings_save_failed"));
    } finally {
      showFilenameOptions();
      disableSettings(false);
    }
  });
  refreshFieldset.addEventListener("change", async () => {
    disableSettings(true);
    const noticeToken = notice.begin(t("settings_saving"));
    const revision = revisions.mode;
    try {
      const value = updateOnInput.checked;
      const saved = await write(() => settings.setUpdateOnUserInput(value));
      if (revision === revisions.mode) inputMode = saved;
      notice.finish(noticeToken, t("refresh_saved"));
    } catch {
      updateOnInput.checked = inputMode;
      notice.finish(noticeToken, t("settings_save_failed"));
    } finally {
      updateOnInput.checked = inputMode;
      disableSettings(false);
    }
  });
  async function saveSendShortcut(value) {
    disableSettings(true);
    const noticeToken = notice.begin(t("settings_saving"));
    const revision = revisions.shortcut;
    try {
      const saved = await write(() => settings.setSendShortcut(value));
      if (revision === revisions.shortcut) sendShortcut = saved;
      notice.finish(noticeToken, t("send_key_saved"));
    } catch {
      notice.finish(noticeToken, t("settings_save_failed"));
    } finally {
      showSendShortcut();
      disableSettings(false);
    }
  }
  sendKeyInput.addEventListener("keydown", (event) => {
    if (["Tab", "Escape", "Control", "Alt", "Shift", "Meta"].includes(event.key)
      || event.isComposing || event.repeat || event.keyCode === 229) return;
    event.preventDefault(); // Capture only inside this options field, never in chat.
    const shortcut = settings.sendShortcutFromEvent(event);
    if (!shortcut) {
      notice.begin(t("send_key_invalid"));
      return;
    }
    return saveSendShortcut(shortcut);
  });
  sendKeyClear.addEventListener("click", () => saveSendShortcut(null));
  capacityFieldset.addEventListener("change", async event => {
    const toggle = event.target === capacityEnabled;
    const entry = event.target === capacityEntry;
    const limits = { secondKB: Number(capacitySecond.value), thirdKB: Number(capacityThird.value) };
    if (!toggle && !entry && !settings.validCapacityLimits(limits)) {
      capacityError.hidden = false;
      notice.begin(t("capacity_invalid"));
      return;
    }
    const enabled = capacityEnabled.checked;
    const entryEnabled = capacityEntry.checked;
    const field = toggle ? "capacityEnabled" : entry ? "capacityEntry" : "capacityLimits";
    const revision = revisions[field];
    disableSettings(true);
    const noticeToken = notice.begin(t("settings_saving"));
    try {
      const saved = await write(() => toggle ? settings.setCapacityBackgroundEnabled(enabled)
        : entry ? settings.setCapacityEntryTransition(entryEnabled) : settings.setCapacityBackgroundLimits(limits));
      if (revision === revisions[field]) capacity = settings.normalizeCapacityBackground({ ...capacity,
        ...(toggle ? { enabled: saved } : entry ? { entryTransition: saved } : saved) });
      notice.finish(noticeToken, t("settings_saved"));
    } catch {
      notice.finish(noticeToken, t("settings_save_failed"));
    } finally {
      showCapacity();
      disableSettings(false);
    }
  });
})(globalThis);
