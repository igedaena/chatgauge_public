(function registerI18n(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const api = global.browser?.i18n || global.chrome?.i18n;
  function t(key, ...substitutions) {
    return api?.getMessage(key, substitutions.map(String)) || key;
  }
  function locale() {
    const language = api?.getUILanguage() || api?.getMessage("@@ui_locale") || "en";
    return /^ko(?:-|$)/i.test(language) ? "ko" : "en";
  }
  function number(value) {
    return new Intl.NumberFormat(locale()).format(value);
  }
  function localizeDocument(document) {
    document.documentElement.lang = locale();
    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n);
    }
  }
  namespace.i18n = Object.freeze({ t, locale, number, localizeDocument });
})(globalThis);
