"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const mockI18n = require("./helpers/i18n.cjs");

function harness(language, useChrome = false) {
  const context = vm.createContext({ [useChrome ? "chrome" : "browser"]: { i18n: mockI18n(language) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/i18n.js"), "utf8"), context);
  return context.Chatcouter.i18n;
}

test("locales follow browser UI language with English fallback and retain substitutions as literal text", () => {
  for (const [language, locale, button] of [["ko-KR", "ko", "내보내기"], ["en-GB", "en", "Export"], ["ja", "en", "Export"]]) {
    const i18n = harness(language);
    assert.equal(i18n.locale(), locale);
    assert.equal(i18n.t("export_button"), button);
    assert.equal(i18n.number(1234567), "1,234,567");
    assert.ok(i18n.t("measurement_failed_hint", "literal $2", "<tag>").includes("literal $2; <tag>"));
  }
  assert.equal(harness("en", true).t("export_button"), "Export");
});

test("document localization sets its UI language and safely writes labels as text", () => {
  const document = { documentElement: {}, querySelectorAll: () => [
    { dataset: { i18n: "options_title" }, textContent: "" },
    { dataset: { i18n: "update_on_input" }, textContent: "" },
  ] };
  const nodes = document.querySelectorAll();
  document.querySelectorAll = () => nodes;
  harness("ko").localizeDocument(document);
  assert.equal(document.documentElement.lang, "ko");
  assert.equal(nodes[0].textContent, "ChatGauge 설정");
  assert.equal(nodes[1].textContent, "사용자 입력 시 갱신");
  harness("en").localizeDocument(document);
  assert.equal(document.documentElement.lang, "en");
  assert.equal(nodes[0].textContent, "ChatGauge settings");
  assert.equal(nodes[1].textContent, "Refresh on user input");
});
