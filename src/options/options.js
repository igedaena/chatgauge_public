(async function startOptions(global) {
  "use strict";
  const { t, localizeDocument } = global.Chatcouter.i18n;
  localizeDocument(document);
  const settings = global.Chatcouter.exportSettings;
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
  let selected;
  let inputMode;
  let filenameOptions;
  let sendShortcut;
  let loaded = false;
  let filenameRefresh = Promise.resolve();
  const revisions = { formats: 0, filename: 0, mode: 0, shortcut: 0 };
  const filenameInputs = { includeDate, includeTime, includeUnchecked };
  sendKeyInput.placeholder = t("send_key_placeholder");
  function disableSettings(disabled) {
    fieldset.disabled = disabled;
    refreshFieldset.disabled = disabled;
    filenameFieldset.disabled = disabled;
    sendKeyFieldset.disabled = disabled;
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
      // Read the effective value, including old-profile fallbacks and removals.
      filenameRefresh = settings.getExportPreferences().then(preferences => {
        if (revision !== revisions.filename) return;
        filenameOptions = preferences.filenameOptions;
        if (loaded) showFilenameOptions();
      }).catch(() => {
        if (revision === revisions.filename) status.textContent = t("settings_load_failed");
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
    disableSettings(false);
    status.textContent = t("settings_autosave");
  } catch {
    status.textContent = t("settings_load_failed");
    return;
  }
  fieldset.addEventListener("change", async () => {
    const next = inputs.filter((input) => input.checked).map((input) => input.value);
    if (!next.length) {
      showSelection();
      status.textContent = t("select_format_hint");
      return;
    }
    disableSettings(true);
    status.textContent = t("settings_saving");
    const revision = revisions.formats;
    try {
      const saved = await settings.setFormats(next);
      if (revision === revisions.formats) selected = saved;
      status.textContent = t("settings_saved");
    } catch {
      showSelection();
      status.textContent = t("settings_save_failed");
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
    status.textContent = t("settings_saving");
    const revision = revisions.filename;
    try {
      const saved = await settings.patchFilenameOptions(patch);
      if (revision === revisions.filename) filenameOptions = saved;
      status.textContent = t("filename_saved");
    } catch {
      showFilenameOptions();
      status.textContent = t("settings_save_failed");
    } finally {
      showFilenameOptions();
      disableSettings(false);
    }
  });
  refreshFieldset.addEventListener("change", async () => {
    disableSettings(true);
    status.textContent = t("settings_saving");
    const revision = revisions.mode;
    try {
      const saved = await settings.setUpdateOnUserInput(updateOnInput.checked);
      if (revision === revisions.mode) inputMode = saved;
      status.textContent = t("refresh_saved");
    } catch {
      updateOnInput.checked = inputMode;
      status.textContent = t("settings_save_failed");
    } finally {
      updateOnInput.checked = inputMode;
      disableSettings(false);
    }
  });
  async function saveSendShortcut(value) {
    disableSettings(true);
    status.textContent = t("settings_saving");
    const revision = revisions.shortcut;
    try {
      const saved = await settings.setSendShortcut(value);
      if (revision === revisions.shortcut) sendShortcut = saved;
      status.textContent = t("send_key_saved");
    } catch {
      status.textContent = t("settings_save_failed");
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
      status.textContent = t("send_key_invalid");
      return;
    }
    return saveSendShortcut(shortcut);
  });
  sendKeyClear.addEventListener("click", () => saveSendShortcut(null));
})(globalThis);
