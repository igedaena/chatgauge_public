(function registerThemeSettings(global) {
  "use strict";
  const ns = global.Chatcouter;
  const ENABLED = "userThemeEnabled", THEME = "userTheme", ENTRY = "showEntryTime";
  const keys = [ENABLED, THEME, ENTRY];
  const bytesFrom = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  function base64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  async function get() {
    const values = await global.browser.storage.local.get(keys);
    return { enabled: values[ENABLED] === true, entry: values[ENTRY] === true, stored: values[THEME] || null };
  }
  async function layout(stored) {
    if (!stored || typeof stored.png !== "string" || stored.png.length > Math.ceil(ns.themeContract.limits.pngBytes / 3) * 4) throw new Error("theme-storage");
    const pngBytes = bytesFrom(stored.png);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(stored.theme));
    const theme = await ns.themeContract.validatePair({ jsonBytes, pngBytes, decodePng: ns.themePackage.decodePng });
    return { ...ns.themeContract.upgrade(theme), atlasUrl: `data:image/png;base64,${stored.png}` };
  }
  async function importZip(bytes) {
    const result = await ns.themePackage.read(bytes);
    const stored = { theme: result.theme, png: base64(result.pngBytes) };
    // One replacement only after archive, image, hash, and component validation.
    await global.browser.storage.local.set({ [THEME]: stored });
    return stored;
  }
  async function setFlag(key, value) {
    if (![ENABLED, ENTRY].includes(key) || typeof value !== "boolean") throw new TypeError("Invalid theme preference");
    await global.browser.storage.local.set({ [key]: value });
  }
  ns.themeSettings = Object.freeze({ ENABLED, THEME, ENTRY, keys, get, layout, importZip, setFlag });
})(globalThis);
