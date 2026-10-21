"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const mockI18n = require("./helpers/i18n.cjs");

function harness(locale, connected = false, optionsConnected = false, literalTranslation, layout = null) {
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/theme-contract.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/theme-layout.js"), "utf8"), context);
  context.Chatcouter.uiPosition = { create: () => ({ schedule: () => calls.schedule++, destroy() {} }) };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/meter-ui.js"), "utf8"), context);
  const ui = context.Chatcouter.meterUi.create({ document, window: {}, getComposer: () => null,
    layout: layout === true ? context.Chatcouter.themeLayout.guide : layout,
    onMeasure: () => calls.measure++, onExport: () => calls.export++,
    ...(connected ? { onExpand: () => calls.expand++ } : {}),
    ...(optionsConnected ? { onOptions: () => calls.options++ } : {}) });
  const view = { pageKind: "conversation", conversationId: "synthetic", state: "ready",
    display: { primary: "1,234 chars", charactersText: "1,234", secondary: "4.5 KB" }, title: "Synthetic checkpoint",
    baselineBusy: false, exportBusy: false, exportError: "", recoveryFailureStreak: 0,
    baselineFailureThreshold: 3, unverifiedResponseStreak: 0, automaticRecoveryThreshold: 3, updateOnUserInput: false };
  return { ui, nodes, calls, view, document, context, t: context.Chatcouter.i18n.t };
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
  assert.equal(h.nodes[".export"].textContent, h.t("export_button"));
  assert.equal(h.nodes[".primary"].textContent, h.t("export_preparing"));
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
  assert.equal(h.nodes[".primary"].textContent, h.t("export_preparing"));
  assert.ok(h.nodes[".measure"].attributes["aria-label"].includes(h.t("usage_unverified")));
  assert.equal(h.nodes[".controls"].dataset.indicator, "busy");
  h.ui.render({ ...h.view, exportBusy: true, lastMeasuredDisplay: { ...h.view.display, conversationId: "synthetic" } });
  assert.equal(h.nodes[".secondary"].textContent, "4.5 KB");
  h.ui.render({ ...h.view, documentAction: "export", exportError: "synthetic error" });
  assert.equal(h.nodes[".export"].textContent, h.t("export_button"));
  assert.equal(h.nodes[".primary"].textContent, h.t("export_failed_status"));
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
        assert.equal(h.nodes[".primary"].textContent, h.t("export_preparing"));
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
    assert.equal(h.nodes[".expand"].textContent, h.t("expand_button"));
    assert.equal(h.nodes[".primary"].textContent, h.t("expand_preparing"));
    assert.equal(h.nodes[".expand"].title, h.t("expand_preparing_hint"));
    assert.equal(h.nodes[".export"].textContent, h.t("export_button"));
    assert.equal(h.nodes[".secondary"].textContent, "4.5 KB");
    assert.equal(h.nodes[".controls"].dataset.indicator, "busy");
    h.ui.render({ ...h.view, documentAction: "expand", expandError: "view-tab-create-failed" });
    assert.equal(h.nodes[".expand"].disabled, false);
    assert.equal(h.nodes[".expand"].textContent, h.t("expand_button"));
    assert.equal(h.nodes[".primary"].textContent, h.t("expand_failed_status"));
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

test("guide components keep stable nodes, independent capacity and decorative icons", () => {
  const h = harness("ko", true, true, undefined, true);
  h.ui.render({ ...h.view, enteredAt: 1234567890000 });
  const shadow = h.document.getElementById().shadowRoot;
  const measure = shadow.querySelector(".measure");
  const capacity = shadow.querySelector(".secondary");
  assert.equal(measure.querySelector(".secondary"), null);
  assert.equal(capacity.tagName, "span");
  assert.equal(shadow.querySelector(".export-icon").listeners.click, undefined);
  assert.match(shadow.querySelector(".entry-time").textContent, /^\d{2}:\d{2}:\d{2}$/);
  h.ui.render({ ...h.view, exportBusy: true, enteredAt: 1234567890000 });
  assert.equal(shadow.querySelector(".measure"), measure);
  assert.equal(shadow.querySelector(".secondary"), capacity);
  assert.equal(measure.disabled, true);
  assert.equal(h.nodes[".primary"].textContent, h.t("export_preparing"));
  assert.equal(h.nodes[".export-icon"].textContent, "↓");
});

test("guide OFF nodes are absent and icon-only actions share locks and callbacks", () => {
  const seed = harness("en");
  const guide = seed.context.Chatcouter.themeLayout.guide;
  const layout = { conversation: { ...guide.conversation, components: {
    ...guide.conversation.components, expand: null, export: false,
    secondary: null, symbol: null, entryTime: false,
  } }, idle: { ...guide.idle, components: {} } };
  const h = harness("en", true, true, undefined, layout);
  h.ui.render(h.view);
  let shadow = h.document.getElementById().shadowRoot;
  for (const selector of [".expand", ".export", ".secondary", ".symbol", ".entry-time"]) {
    assert.equal(shadow.querySelector(selector), null);
  }
  shadow.querySelector(".expand-icon").click();
  shadow.querySelector(".export-icon").click();
  assert.equal(h.calls.expand, 1); assert.equal(h.calls.export, 1);
  h.ui.render({ ...h.view, baselineBusy: true });
  shadow.querySelector(".expand-icon").click();
  shadow.querySelector(".export-icon").click();
  assert.equal(h.calls.expand, 1); assert.equal(h.calls.export, 2);
  h.ui.render({ ...h.view, exportBusy: true });
  shadow.querySelector(".export-icon").click();
  assert.equal(h.calls.export, 2);
  h.ui.render({ ...h.view, pageKind: "home", enteredAt: null });
  shadow = h.document.getElementById().shadowRoot;
  assert.equal(shadow.querySelectorAll("button").length, 0);
  assert.equal(shadow.querySelector(".primary"), null);
  h.ui.render(h.view);
  h.document.getElementById().shadowRoot.querySelector(".export-icon").click();
  assert.equal(h.calls.export, 3);
});

test("missing background stages use the first image and entry hiding does not move other components", () => {
  const theme = JSON.parse(fs.readFileSync("src/themes/default-sample.json", "utf8"));
  theme.atlasUrl = "data:image/png;base64,synthetic";
  theme.conversation.background.sources = theme.conversation.background.sources.slice(0, 2);
  const h = harness("en", true, true, undefined, theme);
  const view = { ...h.view, enteredAt: 1234567890000, capacityBackground: { enabled: true, secondKB: 400, thirdKB: 800 },
    lastMeasuredDisplay: { conversationId: "synthetic", utf8Bytes: 900 * 1024 } };
  h.ui.render(view);
  const background = h.document.getElementById().shadowRoot.querySelector(".theme-background");
  const first = theme.conversation.background.sources[0];
  assert.equal(background.style[theme.conversation.background.color ? "maskPosition" : "backgroundPosition"], `${-first.x}px ${-first.y}px`);
  const measure = h.nodes[".measure"], initial = measure.attributes.style;
  h.ui.render({ ...view, showEntryTime: false });
  assert.equal(h.nodes[".entry-time"].hidden, true);
  assert.equal(h.nodes[".measure"], measure); assert.equal(measure.attributes.style, initial);
  h.ui.render({ ...view, showEntryTime: true });assert.equal(h.nodes[".entry-time"].hidden, false);
});

test("guide rectangles allow adjacency, exclude OFF slots and reject overlap/fractional bounds", () => {
  const h = harness("en");
  const { validate, guide } = h.context.Chatcouter.themeLayout;
  assert.equal(validate(guide.conversation), guide.conversation);
  assert.throws(() => validate({ ...guide.conversation, components: {
    measure: { x: 0, y: 300, width: 110, height: 40 },
  } }), /rectangle/);
  for (const background of [{ width: 257, height: 640 }, { width: 256, height: 641 }, { width: 256, height: 1.5 }]) {
    assert.throws(() => validate({ ...guide.conversation, background }), /background/);
  }
  const spec = components => ({ width: 20, height: 10, components });
  const box = { x: 0, y: 0, width: 10, height: 10 };
  assert.doesNotThrow(() => validate(spec({ measure: box, export: { ...box, x: 10 }, symbol: false })));
  assert.throws(() => validate(spec({ measure: box, export: { ...box, x: 9 } })), /Overlapping/);
  for (const change of [{ x: .5 }, { width: 4 }, { width: 21 }, { y: -1 }]) {
    assert.throws(() => validate(spec({ measure: { ...box, ...change } })), /rectangle/);
  }
});

test("home icon replaces the hidden name as the settings button and stays decorative beside a name", () => {
  const seed = harness("en");
  const guide = seed.context.Chatcouter.themeLayout.guide;
  const layout = { ...guide, idle: { ...guide.idle, components: { ...guide.idle.components, measure: false } } };
  const h = harness("en", true, true, undefined, layout);
  const home = { ...h.view, pageKind: "home", state: "idle",
    display: { primary: "ChatGauge", secondary: "" }, title: h.t("options_open_hint") };
  h.ui.render(home);
  let shadow = h.document.getElementById().shadowRoot;
  const icon = shadow.querySelector(".symbol");
  assert.equal(shadow.querySelector(".measure"), null);
  assert.equal(icon.tagName, "button");
  assert.equal(icon.attributes["aria-hidden"], undefined);
  assert.equal(icon.attributes["aria-label"], h.t("options_open_hint"));
  icon.click();
  h.ui.render(home); icon.click();
  assert.equal(h.calls.options, 2);
  assert.equal(h.calls.measure, 0);
  h.ui.render(h.view);
  shadow = h.document.getElementById().shadowRoot;
  assert.equal(shadow.querySelector(".symbol").tagName, "span");
  assert.equal(shadow.querySelector(".symbol").listeners.click, undefined);
  const named = harness("en", true, true, undefined, true);
  named.ui.render(home);
  shadow = named.document.getElementById().shadowRoot;
  assert.equal(shadow.querySelector(".symbol").tagName, "span");
  assert.equal(shadow.querySelector(".symbol").listeners.click, undefined);
  shadow.querySelector(".measure").click();
  assert.equal(named.calls.options, 1);
});

test("only the latest accepted action owns a failure and busy notices preserve measurement semantics", () => {
  const h = harness("en", true);
  const failure = { ...h.view, documentAction: "export", exportError: "first failure" };
  h.ui.render(failure);
  assert.equal(h.nodes[".primary"].textContent, h.t("export_failed_status"));
  assert.equal(h.nodes[".secondary"].textContent, h.view.display.secondary);
  assert.equal(h.nodes[".controls"].dataset.indicator, "ready");
  h.ui.render({ ...failure, documentAction: "expand", expandBusy: true });
  assert.equal(h.nodes[".primary"].textContent, h.t("expand_preparing"));
  h.ui.render({ ...failure, documentAction: "expand" });
  assert.equal(h.nodes[".primary"].textContent, "1,234" + h.t("character_unit"));
});

test("capacity colors use exact published bytes at both boundaries and can move down without replacing nodes", () => {
  const h = harness("en", true, true, undefined, true);
  h.ui.render(h.view);
  const canvas = h.document.getElementById().shadowRoot.querySelector(".guide-canvas");
  const measure = h.nodes[".measure"];
  for (const [bytes, stage] of [[0, "0"], [204799, "0"], [204800, "0"], [204801, "1"],
    [409600, "1"], [409601, "2"], [300000, "1"], [100, "0"]]) {
    h.ui.render({ ...h.view, lastMeasuredDisplay: { conversationId: "synthetic", utf8Bytes: bytes, secondary: "400.0 KB" } });
    assert.equal(canvas.dataset.capacityStage, stage);
    assert.equal(h.nodes[".measure"], measure);
  }
});

test("capacity colors retain same-room publication through notices and failures but ignore other rooms and home", () => {
  const h = harness("en", true, true, undefined, true);
  const view = { ...h.view, lastMeasuredDisplay: { conversationId: "synthetic", utf8Bytes: 900000, primary: "old", secondary: "old" } };
  for (const change of [{}, { state: "loading", baselineBusy: true }, { state: "error" }, { exportBusy: true }, { expandBusy: true }]) {
    h.ui.render({ ...view, ...change });
    assert.equal(h.nodes[".guide-canvas"].dataset.capacityStage, "2");
  }
  h.ui.render({ ...view, conversationId: "another", state: "loading" });
  assert.equal(h.nodes[".guide-canvas"].dataset.capacityStage, "0");
  h.ui.render({ ...view, pageKind: "home" });
  assert.equal(h.nodes[".guide-canvas"].dataset.capacityStage, "0");
  for (const utf8Bytes of [undefined, null, NaN, -1, Infinity]) {
    h.ui.render({ ...view, lastMeasuredDisplay: { conversationId: "synthetic", utf8Bytes } });
    assert.equal(h.nodes[".guide-canvas"].dataset.capacityStage, "0");
  }
});

test("entry background override changes only the picture, keeps the published tier and is ignored while editing", () => {
  const theme = JSON.parse(fs.readFileSync("src/themes/default-sample.json", "utf8")); theme.atlasUrl = "data:synthetic";
  const h = harness("en", true, true, undefined, theme);
  const view = { ...h.view, backgroundStageOverride: 1,
    lastMeasuredDisplay: { conversationId: "synthetic", utf8Bytes: 500000 } };
  h.ui.render(view);
  const canvas = h.nodes[".guide-canvas"], bg = h.document.getElementById().shadowRoot.querySelector(".theme-background");
  const property = theme.conversation.background.color ? "maskPosition" : "backgroundPosition";
  assert.equal(canvas.dataset.capacityStage, "2");
  assert.equal(canvas.dataset.backgroundStage, "1");
  assert.equal(bg.style[property], `${-theme.conversation.background.sources[1].x}px ${-theme.conversation.background.sources[1].y}px`);
  h.ui.render({ ...view, backgroundStageOverride: undefined });
  assert.equal(canvas.dataset.backgroundStage, "2");
  const editor = h.context.Chatcouter.meterUi.create({ document: h.document, window: {}, layout: theme, editing: true });
  editor.render(view);
  assert.equal(h.document.getElementById().shadowRoot.querySelector(".guide-canvas").dataset.backgroundStage, "2");
});
