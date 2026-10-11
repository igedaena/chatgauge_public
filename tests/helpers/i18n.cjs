"use strict";
const fs = require("node:fs");
const path = require("node:path");
function mockI18n(language = "ko") {
  const locale = /^ko(?:-|$)/i.test(language) ? "ko" : "en";
  const messages = JSON.parse(fs.readFileSync(path.join(__dirname, "../../_locales", locale, "messages.json"), "utf8"));
  return {
    getUILanguage: () => language,
    getMessage(key, substitutions = []) {
      if (key === "@@ui_locale") return locale;
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return (messages[key]?.message || "").replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1] ?? "");
    },
  };
}
module.exports = mockI18n;
