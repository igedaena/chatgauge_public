(async function startThemeOptions(global) {
  "use strict";
  const ns = global.Chatcouter, settings = ns.themeSettings, { t } = ns.i18n;
  const $ = id => document.getElementById(id);
  const notice = ns.optionsNotice;
  let preferences, saving = false, revision = 0;
  function show() {
    $("theme-enabled").checked = preferences.enabled;
    $("entry-enabled").checked = preferences.entry;
    $("theme-controls").hidden = !preferences.enabled;
    $("capacity-limits").hidden = !$("capacity-enabled").checked;
    $("theme-file-status").textContent = t(preferences.stored ? "theme_loaded" : "theme_default_active");
    for (const id of ["theme-enabled", "entry-enabled", "theme-import"]) $(id).disabled = saving;
  }
  async function reload() {
    const token = ++revision, noticeToken = notice.current();
    try { const next = await settings.get(); if (token === revision) { preferences = next; show(); } }
    catch { notice.finish(noticeToken, t("settings_load_failed")); }
  }
  async function save(work) {
    if (saving) return;
    ns.optionsActions?.setBusy("theme", true);
    saving = true; show();
    const token = notice.begin(t("settings_saving"));
    try { await (ns.optionsActions ? ns.optionsActions.run(work) : work()); notice.finish(token, t("settings_saved")); }
    catch { notice.finish(token, t("theme_import_failed")); }
    finally { saving = false; await reload(); ns.optionsActions?.setBusy("theme", false); }
  }
  global.browser.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (settings.keys.some(key => Object.hasOwn(changes, key))) reload();
    if (Object.hasOwn(changes, ns.exportSettings.CAPACITY_ENABLED_KEY)) {
      $("capacity-limits").hidden = changes[ns.exportSettings.CAPACITY_ENABLED_KEY].newValue === false;
    }
  });
  $("theme-enabled").addEventListener("change", () => { const value = $("theme-enabled").checked; save(() => settings.setFlag(settings.ENABLED, value)); });
  $("entry-enabled").addEventListener("change", () => { const value = $("entry-enabled").checked; save(() => settings.setFlag(settings.ENTRY, value)); });
  $("capacity-enabled").addEventListener("change", () => { $("capacity-limits").hidden = !$("capacity-enabled").checked; });
  $("theme-import").addEventListener("click", () => $("theme-file").click());
  $("theme-file").addEventListener("change", () => {
    const file = $("theme-file").files[0]; $("theme-file").value = "";
    if (file) save(async () => {
      if (file.size > ns.themePackage.maxBytes) throw new Error("theme-zip");
      await settings.importZip(new Uint8Array(await file.arrayBuffer()));
    });
  });
  await reload();
  if (preferences) ns.optionsActions?.setBusy("theme", false);
})(globalThis);
