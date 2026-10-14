"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const mockI18n = require("./helpers/i18n.cjs");

function harness(locale, connected = false, optionsConnected = false, literalTranslation) {
  const nodes = {};
  const calls = { measure: 0, export: 0, expand: 0, options: 0, schedule: 0 };
  const Element = require("./helpers/meter-dom.cjs")(nodes);
  let host = null;
  const document = { getElementById: () => host, createElement: tag => new Element(tag), createElementNS: (ns, tag) => new Element(tag, ns), documentElement: { append: node => { host = node; } } };
  const i18n = mockI18n(locale);
  if (literalTranslation) {
    const getMessage = i18n.getMessage;
    i18n.getMessage = (key, args) => ["automatic_measure_hint", "expand_button", "export_initial_hint", "export_button"].includes(key)
      ? literalTranslation : getMessage(key, args);
  }
  const context = vm.createContext({ browser: { i18n } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/i18n.js"), "utf8"), context);
  context.Chatcouter.uiPosition = { create: () => ({ schedule: () => calls.schedule++, destroy() {} }) };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/meter-ui.js"), "utf8"), context);
  const ui = context.Chatcouter.meterUi.create({ document, window: {}, getComposer: () => null,
    onMeasure: () => calls.measure++, onExport: () => calls.export++,
    ...(connected ? { onExpand: () => calls.expand++ } : {}),
    ...(optionsConnected ? { onOptions: () => calls.options++ } : {}) });
  const view = { pageKind: "conversation", conversationId: "synthetic", state: "ready",
    display: { primary: "1,234 chars", charactersText: "1,234", secondary: "4.5 KB" }, title: "Synthetic checkpoint",
    baselineBusy: false, exportBusy: false, exportError: "", recoveryFailureStreak: 0,
    baselineFailureThreshold: 3, unverifiedResponseStreak: 0, automaticRecoveryThreshold: 3, updateOnUserInput: false };
  return { ui, nodes, calls, view, document, t: context.Chatcouter.i18n.t };
}

test("old callers keep refresh/export and an explained disabled document control in both locales", () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(locale);
    h.ui.render(h.view);
    assert.equal(h.nodes[".expand"].disabled, true);
    assert.equal(h.nodes[".expand"].hidden, false);
    assert.equal(h.nodes[".expand"].title, h.t("expand_unconnected_hint"));
    assert.equal(h.nodes["#expand-description"].textContent, h.t("expand_unconnected_hint"));
    h.nodes[".expand"].click(); h.nodes[".measure"].click(); h.nodes[".export"].click();
    assert.deepEqual([h.calls.measure, h.calls.export, h.calls.expand], [1, 1, 0]);
    h.ui.schedule();
    assert.equal(h.calls.schedule, 2);
    h.ui.render({ ...h.view, pageKind: "home", state: "idle", display: { primary: "ChatGauge", secondary: "" } });
    assert.equal(h.nodes[".expand"].hidden, true);
    assert.equal(h.nodes[".export"].hidden, true);
    assert.equal(h.nodes[".controls"].dataset.mode, "idle");
  }
});

test("home and new-chat name buttons open options while conversation usage remains a refresh button", () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(locale, true, true);
    for (const pageKind of ["home", "new-chat"]) {
      h.ui.render({ ...h.view, pageKind, state: "idle", display: { primary: "ChatGauge", secondary: "" },
        title: h.t("options_open_hint") });
      assert.equal(h.nodes[".measure"].dataset.action, "options");
      assert.equal(h.nodes[".measure"].title, h.t("options_open_hint"));
      h.nodes[".measure"].click();
    }
    assert.equal(h.calls.options, 2); assert.equal(h.calls.measure, 0);
    h.ui.render(h.view); h.nodes[".measure"].click();
    assert.equal(h.calls.options, 2); assert.equal(h.calls.measure, 1);
    h.ui.render({ ...h.view, pageKind: "new-chat", state: "loading", display: { primary: "", secondary: "" } });
    assert.equal(h.nodes[".measure"].dataset.action, "measure");
  }
});

test("optional document callback is separate and respects the existing exclusive operation locks", () => {
  const h = harness("en", true);
  h.ui.render(h.view);
  for (const selector of [".measure", ".expand", ".export"]) h.nodes[selector].click();
  assert.deepEqual([h.calls.measure, h.calls.expand, h.calls.export], [1, 1, 1]);
  h.ui.render({ ...h.view, baselineBusy: true });
  h.nodes[".measure"].click(); h.nodes[".expand"].click();
  assert.deepEqual([h.calls.measure, h.calls.expand], [1, 1]);
  assert.equal(h.nodes[".export"].disabled, false);
  h.ui.render({ ...h.view, exportBusy: true });
  for (const selector of [".measure", ".expand", ".export"]) h.nodes[selector].click();
  assert.deepEqual([h.calls.measure, h.calls.expand, h.calls.export], [1, 1, 1]);
  assert.equal(h.nodes[".export"].textContent, h.t("export_preparing"));
  h.ui.render(h.view);
  h.nodes[".expand"].click();
  assert.equal(h.calls.expand, 2);
});

test("loading, uncertain recovery and export retain their existing usage and indicator meaning", () => {
  const h = harness("ko");
  h.ui.render({ ...h.view, state: "loading" });
  assert.equal(h.nodes[".primary"].textContent, h.t("measuring"));
  assert.equal(h.nodes[".secondary"].textContent, "");
  assert.equal(h.nodes[".controls"].dataset.indicator, "busy");
  h.ui.render({ ...h.view, unverifiedResponseStreak: 3, recoveryFailureStreak: 3 });
  assert.equal(h.nodes[".controls"].dataset.indicator, "unavailable");
  assert.match(h.nodes[".measure"].title, new RegExp(h.t("manual_recovery_hint")));
  assert.equal(h.nodes[".measure"].disabled, false);
  h.ui.render({ ...h.view, exportBusy: true, lastMeasuredDisplay: { ...h.view.display, conversationId: "other" } });
  assert.equal(h.nodes[".primary"].textContent, h.t("usage_unverified"));
  assert.equal(h.nodes[".controls"].dataset.indicator, "busy");
  h.ui.render({ ...h.view, exportBusy: true, lastMeasuredDisplay: { ...h.view.display, conversationId: "synthetic" } });
  assert.equal(h.nodes[".secondary"].textContent, "4.5 KB");
  h.ui.render({ ...h.view, exportError: "synthetic error" });
  assert.equal(h.nodes[".export"].textContent, h.t("export_retry"));
  assert.ok(h.nodes[".export"].title.includes("synthetic error"));
  assert.equal(h.nodes[".controls"].dataset.indicator, "ready");
});

test("ten-million display cap preserves exact counts, scope and frozen export usage in both locales", () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(locale);
    for (const value of [1283633, 9999999, 10000000, 123456789123456]) {
      for (const screen of [false, true]) {
        const exact = value.toLocaleString("en");
        const charactersText = screen ? h.t("screen_number", exact) : exact;
        const display = Object.freeze({ primary: h.t("character_count", charactersText), charactersText, secondary: "2.69 MB" });
        const short = value >= 10000000 ? "10M+" : exact;
        const expected = screen ? h.t("screen_number", short) : short;
        h.ui.render({ ...h.view, display, state: screen ? "fallback" : "ready" });
        assert.equal(h.nodes[".primary"].textContent, expected + h.t("character_unit"));
        assert.ok(h.nodes[".measure"].attributes["aria-label"].includes(display.primary));
        if (value >= 10000000) assert.ok(h.nodes[".measure"].title.includes(display.primary));
        assert.equal(display.charactersText, charactersText);
        h.ui.render({ ...h.view, exportBusy: true, lastMeasuredDisplay: { ...display, conversationId: "synthetic" } });
        assert.equal(h.nodes[".primary"].textContent, expected + h.t("character_unit"));
        assert.ok(h.nodes[".measure"].attributes["aria-label"].includes(display.primary));
      }
    }
  }
});

test("view preparation exclusively locks three actions without changing Export labels or retained usage", () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(locale, true);
    h.ui.render({ ...h.view, expandBusy: true, expandError: "old failure" });
    for (const selector of [".measure", ".expand", ".export"]) assert.equal(h.nodes[selector].disabled, true);
    assert.equal(h.nodes[".expand"].textContent, h.t("expand_preparing"));
    assert.equal(h.nodes[".expand"].title, h.t("expand_preparing_hint"));
    assert.equal(h.nodes[".export"].textContent, h.t("export_button"));
    assert.equal(h.nodes[".secondary"].textContent, "4.5 KB");
    assert.equal(h.nodes[".controls"].dataset.indicator, "busy");
    h.ui.render({ ...h.view, expandError: "view-tab-create-failed" });
    assert.equal(h.nodes[".expand"].disabled, false);
    assert.equal(h.nodes[".expand"].textContent, h.t("expand_retry"));
    assert.ok(h.nodes[".expand"].title.includes("view-tab-create-failed"));
    h.ui.render(h.view);
    assert.equal(h.nodes[".expand"].textContent, h.t("expand_button"));
  }
});

test("native meter DOM preserves CSS, SVG namespaces, action structure and literal translations", () => {
  const literal = '<img src=x onerror=alert(1)> & "quoted"';
  for (const locale of ["ko", "en"]) {
    const h = harness(locale, true, true, literal);
    h.ui.render(h.view);
    const shadow = h.document.getElementById().shadowRoot;
    assert.deepEqual(shadow.children.map(node => node.tagName), ["style", "span"]);
    const css = shadow.querySelector("style").textContent;
    assert.ok(css.includes('grid-template-columns: 46px minmax(84px, max-content) max-content'));
    assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
    assert.ok(css.includes('translateX(-6px)'));
    const svg = shadow.querySelector("svg");
    assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
    assert.equal(svg.attributes.viewBox, "0 0 45 58");
    for (const tag of ["g", "path", "polygon"]) {
      assert.equal(svg.querySelectorAll(tag).length, 2);
      for (const node of svg.querySelectorAll(tag)) assert.equal(node.namespaceURI, svg.namespaceURI);
    }
    assert.equal(svg.querySelector(".idle-shape").attributes.transform, "translate(-10.6743 3)");
    assert.equal(shadow.querySelectorAll("button").length, 3);
    assert.equal(h.nodes[".expand"].attributes["aria-describedby"], "expand-description");
    assert.equal(h.nodes[".expand"].textContent, literal);
    assert.equal(h.nodes[".export"].textContent, literal);
    assert.equal(shadow.querySelectorAll("img").length, 0);
    assert.equal(h.nodes[".primary"].children[0].className, "unit");
    h.ui.render(h.view);
    assert.equal(h.nodes[".primary"].children.length, 1);
    assert.equal(h.nodes[".primary"].textContent, "1,234" + h.t("character_unit"));
  }
});
