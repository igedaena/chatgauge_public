(function registerOptionsActions(global) {
  "use strict";
  const ns = global.Chatcouter, settings = ns.exportSettings, { t } = ns.i18n;
  const button = document.getElementById("reset-settings");
  const busy = new Set(["options", "theme"]);
  // Serialize writes across open options pages, including file reading/validation.
  const run = work => global.navigator.locks.request("chatcouter-options-write", work);
  const actions = ns.optionsActions = Object.freeze({
    run,
    setBusy(owner, value) {
      if (value) busy.add(owner); else busy.delete(owner);
      button.disabled = busy.size > 0;
    },
  });
  const keys = [settings.KEY, settings.UPDATE_ON_INPUT_KEY, settings.SEND_SHORTCUT_KEY,
    settings.FILENAME_OPTIONS_KEY, ...Object.values(settings.FILENAME_OPTION_KEYS),
    settings.CAPACITY_ENABLED_KEY, settings.CAPACITY_LIMITS_KEY, settings.CAPACITY_ENTRY_KEY,
    ...ns.themeSettings.keys];
  button.addEventListener("click", async () => {
    if (busy.size || !global.confirm(t("settings_reset_confirm"))) return;
    actions.setBusy("reset", true);
    const main = document.querySelector("main");
    main.inert = true;
    const token = ns.optionsNotice.begin(t("settings_resetting"));
    try {
      // Removal restores module defaults and clears old filename fallback keys.
      await run(() => global.browser.storage.local.remove(keys));
      ns.optionsNotice.finish(token, t("settings_reset_done"));
    } catch {
      ns.optionsNotice.finish(token, t("settings_reset_failed"));
    } finally {
      main.inert = false;
      actions.setBusy("reset", false);
    }
  });
})(globalThis);
