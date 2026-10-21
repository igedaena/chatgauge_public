(function registerStandaloneEnvironment(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const data = JSON.parse(document.getElementById("editor-data").textContent);
  const language = /^ko(?:-|$)/i.test(global.navigator.language) ? "ko" : "en";
  const catalog = data.locales[language];
  function t(key, ...values) {
    return (catalog[key]?.message || key).replace(/\$(\d+)/g, (match, index) => values[Number(index) - 1] ?? match);
  }
  namespace.i18n = Object.freeze({ t, locale: () => language,
    number: value => new Intl.NumberFormat(language).format(value),
    localizeDocument(document) {
      document.documentElement.lang = language;
      for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    } });
  namespace.themeLayout = Object.freeze({ validate: (layout, options) => namespace.themeContract.validateLayout(layout, options) });
  namespace.themeEditorBundle = Object.freeze({ theme: data.theme, png: data.png });
})(globalThis);
