"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const path = require("node:path");
const readZip = require("./helpers/read-zip.cjs");

function harness(formats = ["md"], { inputMode = false, modeRead, filenameOptions, sendShortcut, shortcutRead, locale = "ko" } = {}) {
  const messages = [
    { id: "u1", role: "user", text: "new prompt" },
    { id: "a1", role: "assistant", text: "fresh answer" },
  ];
  const result = {
    ok: true,
    title: "Fresh title",
    messages,
    completion: {
      lastAssistantStatus: "finished_successfully",
      currentNodeStatus: "finished_successfully",
      currentNodeRole: "assistant",
      currentNodeRecipient: "all",
      currentNodeEndTurn: true,
    },
  };
  let requests = 0;
  let extract = async () => result;
  const nodes = {};
  const downloads = [];
  const blobs = [];
  const viewPorts = [];
  let viewResult = { ok: true }, exportPreferenceReads = 0;
  const portEvent = () => {
    const listeners = new Set();
    return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
      emit: value => { for (const fn of [...listeners]) fn(value); } };
  };
  const handlers = {};
  const windowHandlers = {};
  const logs=[];
  const timers = new Map();
  let timerId = 0;
  let preferenceListener;
  const MeterElement = require("./helpers/meter-dom.cjs")(nodes);
  class Element extends MeterElement {
    click() { downloads.push(this.download); }
  }
  const document = {
    title: "Fallback title - ChatGPT",
    host: null,
    getElementById() { return this.host; },
    createElement(tag) { return new Element(tag); },
    createElementNS(ns, tag) { return new Element(tag, ns); },
    querySelector() { return null; },
    addEventListener(name, handler) { handlers[name] = handler; },
    documentElement: {
      append(node) { if (node.id === "chatcouter-root") document.host = node; },
    },
  };
  const context = vm.createContext({
    document,
    location: { pathname: "/c/one", search: "" },
    Element,
    AbortController,
    Blob,
    TextEncoder,
    browser: { i18n: require("./helpers/i18n.cjs")(locale), runtime: {
      connect({ name }) {
        const port = { name, onMessage: portEvent(), onDisconnect: portEvent(), messages: [], disconnected: false,
          postMessage(message) { this.messages.push(message); if (viewResult) queueMicrotask(() => this.onMessage.emit(viewResult)); },
          disconnect() { if (!this.disconnected) { this.disconnected = true; this.onDisconnect.emit(); } } };
        viewPorts.push(port); return port;
      },
    }, storage: {
      local: { get: async (key) => {
        if (Array.isArray(key)) exportPreferenceReads++;
        return key === "updateOnUserInput" && modeRead
          ? modeRead() : key === "sendShortcut" && shortcutRead ? shortcutRead()
            : ({ exportFormats: formats, updateOnUserInput: inputMode, filenameOptions, sendShortcut });
      } },
      onChanged: { addListener(fn) { preferenceListener = fn; } },
    } },
    URL: {
      createObjectURL(blob) { blobs.push(blob); return "blob:test"; },
      revokeObjectURL() {},
    },
    MutationObserver: class { constructor(callback) { context.observe = callback; } observe() {} },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    addEventListener(name, handler) { windowHandlers[name] = handler; },
    removeEventListener(name, handler) { if (windowHandlers[name] === handler) delete windowHandlers[name]; },
    console: { debug(...args) { logs.push(args); } },
  });
  function load(file) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  }
  const apiAdapter = {
    getConversationId: () => context.location.pathname.split("/").at(-1),
    extract: async (...args) => { requests++; return extract(...args); },
  };
  const domAdapter = {
    extract: () => ({ ok: true, messages }),
    hasStreamingControl: () => false,
    getAssistantActionKeys: () => [],
    mutationsNeedMeasurement: () => false,
    mutationsTouchActionControls: () => false,
  };
  // Follow the shipped IIFE registration order; replace only external observations.
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  for (const file of manifest.content_scripts[0].js) {
    if (file === "src/adapters/chatgpt-api.js") context.Chatcouter.chatGptApiAdapter = apiAdapter;
    else if (file === "src/adapters/chatgpt-dom.js") {
      load(file);
      context.Chatcouter.chatGptDomAdapter = { ...domAdapter, selectors: context.Chatcouter.chatGptDomAdapter.selectors };
    }
    else load(file);
  }
  return {
    context, nodes, result, downloads, blobs, handlers, windowHandlers, Element, logs, viewPorts,
    click: () => nodes[".export"].listeners.click(),
    clickView: () => nodes[".expand"].listeners.click(),
    setViewResult: value => { viewResult = value; },
    preferenceReads: () => exportPreferenceReads,
    requests: () => requests,
    unverified: () => logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "unverified-response-streak")?.current ?? 0,
    timerCount: () => timers.size,
    hasDelay: (delay) => [...timers.values()].some(timer => timer.delay === delay),
    setExtract: (fn) => { extract = fn; },
    changeMode(value, area = "local") {
      preferenceListener({ updateOnUserInput: { newValue: value } }, area);
    },
    changeShortcut(value, area = "local") {
      preferenceListener({ sendShortcut: { newValue: value } }, area);
    },
    runDelay(delay) {
      const [id, { fn }] = [...timers].find(([, timer]) => timer.delay === delay);
      timers.delete(id);
      return fn();
    },
    runTimer() {
      const [id, { fn }] = timers.entries().next().value;
      timers.delete(id);
      return fn();
    },
  };
}

test("home settings click is localized, independent of measurement and retryable without a stale failure overwriting another room", async () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(["md"], { locale });
    await flushAsync();
    const composer = { textContent: "", isConnected: true };
    h.context.document.querySelector = () => composer;
    h.context.location.pathname = "/";
    h.context.observe([]);
    const sent = [];
    h.context.browser.runtime.sendMessage = async message => { sent.push(message.type); return { ok: true }; };
    assert.equal(h.nodes[".measure"].title, h.context.Chatcouter.i18n.t("options_open_hint"));
    await h.nodes[".measure"].listeners.click();
    assert.deepEqual(sent, ["chatgauge-open-options"]);
    assert.equal(h.requests(), 0); assert.equal(h.downloads.length, 0); assert.equal(h.unverified(), 0);
    h.context.browser.runtime.sendMessage = async () => ({ ok: false });
    await h.nodes[".measure"].listeners.click();
    assert.equal(h.nodes[".measure"].title, h.context.Chatcouter.i18n.t("options_open_failed_hint"));
    h.context.browser.runtime.sendMessage = async () => ({ ok: true });
    await h.nodes[".measure"].listeners.click();
    assert.equal(h.nodes[".measure"].title, h.context.Chatcouter.i18n.t("options_open_hint"));
    let fail;
    h.context.browser.runtime.sendMessage = () => new Promise((_, reject) => { fail = reject; });
    const pending = h.nodes[".measure"].listeners.click();
    h.context.location.pathname = "/c/two"; h.context.observe([]);
    fail(Error("late options failure")); await pending;
    assert.equal(h.nodes[".measure"].dataset.state, "loading");
    assert.equal(h.nodes[".measure"].dataset.action, "measure");
    assert.notEqual(h.nodes[".measure"].title, h.context.Chatcouter.i18n.t("options_open_failed_hint"));
  }
});

test("Export fetches once without a cached snapshot and saves fresh MD without publishing measurement", async () => {
  const h = harness();
  assert.equal(h.nodes[".export"].textContent, "내보내기");
  assert.equal(h.nodes[".export"].disabled, false);
  await h.click();
  assert.equal(h.requests(), 1);
  assert.equal(h.downloads.length, 1);
  assert.match(h.downloads[0], /\.md$/);
  const md = await h.blobs[0].text();
  assert.match(md, /fresh answer/);
  assert.match(md, /Messages: 2 \(user 1, assistant 1\)/);
  assert.equal(h.nodes[".primary"].textContent, "ChatGauge");
  assert.equal(h.unverified(), 0);
  assert.equal(h.nodes[".export"].disabled, false);
});

test("View uses fresh HTML in both locales without file preferences, downloads or meter publication; repeated opens and later Export remain independent", async () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(["md"], { locale });
    const previous = h.nodes[".primary"].textContent;
    await h.clickView();
    assert.equal(h.requests(), 1);
    assert.equal(h.preferenceReads(), 0);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.viewPorts.length, 1);
    const html = h.viewPorts[0].messages[0].html;
    assert.match(html, locale === "ko" ? /펼친 시각:/ : /Opened:/);
    assert.ok(!html.includes("<details>"));
    assert.match(html, /fresh answer/);
    assert.equal(h.nodes[".primary"].textContent, previous);
    assert.equal(h.unverified(), 0);
    await h.clickView();
    assert.equal(h.viewPorts.length, 2);
    await h.click();
    assert.equal(h.requests(), 3);
    assert.equal(h.downloads.length, 1);
    assert.match(h.downloads[0], /\.md$/);
  }
});

test("pending View locks all document controls and keeps Export labels separate; transport failure is retryable without changing the meter", async () => {
  const h = harness();
  h.setViewResult(null);
  const task = h.clickView();
  await flushAsync();
  for (const selector of [".measure", ".expand", ".export"]) assert.equal(h.nodes[selector].disabled, true);
  assert.equal(h.nodes[".export"].textContent, h.context.Chatcouter.i18n.t("export_button"));
  assert.equal(h.nodes[".expand"].textContent, h.context.Chatcouter.i18n.t("expand_preparing"));
  await h.clickView(); await h.click(); h.nodes[".measure"].listeners.click();
  assert.equal(h.requests(), 1);
  h.viewPorts[0].onMessage.emit({ ok: false, reason: "view-tab-create-failed" });
  await task;
  assert.equal(h.nodes[".expand"].textContent, h.context.Chatcouter.i18n.t("expand_retry"));
  assert.equal(h.nodes[".export"].disabled, false);
  assert.equal(h.unverified(), 0);
  h.setViewResult({ ok: true }); await h.clickView();
  assert.equal(h.viewPorts.length, 2);
  assert.equal(h.nodes[".expand"].textContent, h.context.Chatcouter.i18n.t("expand_button"));
  assert.equal(h.downloads.length, 0);
});

test("new input and route navigation cancel View during lookup or delivery and late results cannot reopen it", async () => {
  for (const phase of ["lookup", "delivery"]) for (const trigger of ["input", "route"]) {
    const h = harness(); let release;
    if (phase === "lookup") h.setExtract(() => new Promise(resolve => { release = resolve; }));
    h.setViewResult(null);
    const task = h.clickView(); await flushAsync();
    if (trigger === "route") { h.context.location.pathname = "/c/two"; h.windowHandlers.popstate(); }
    else { const form = new h.Element(); form.querySelector = () => ({}); h.handlers.submit({ target: form }); }
    if (phase === "lookup") release(h.result);
    else { assert.equal(h.viewPorts[0].disconnected, true); h.viewPorts[0].onMessage.emit({ ok: true }); }
    await task; await flushAsync();
    assert.equal(h.downloads.length, 0);
    assert.ok(!h.logs.some(([, text]) => JSON.parse(text).event === "fresh-view-opened"));
    if (phase === "lookup") assert.equal(h.viewPorts.length, 0);
  }
});

test("View rejects a snapshot behind the current user without opening a tab or publishing counts", async () => {
  const h = harness();
  h.setExtract(async () => ({ ...h.result, messages: h.result.messages.filter(message => message.role !== "user") }));
  await h.clickView();
  assert.equal(h.viewPorts.length, 0);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.unverified(), 0);
  assert.equal(h.nodes[".expand"].textContent, h.context.Chatcouter.i18n.t("expand_retry"));
});

async function enterBaselineRecovery(h) {
  h.runTimer();
  await h.runTimer();
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: false, reason: "no-dom-messages" });
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeStatus: "in_progress" } }));
  const form = new h.Element();
  form.querySelector = () => ({});
  const submit = () => h.handlers.submit({ target: form });
  const before = h.requests();
  submit();
  for (let step = 0; step < 12 && h.unverified() !== 1; step++) {
    await h.runTimer();
  }
  assert.equal(h.unverified(), 1);
  assert.equal(h.context.document.host.shadowRoot.querySelector(".reliability"), null);
  assert.match(h.nodes[".measure"].title, /자동 확인 미확인/);
  assert.match(h.nodes[".measure"].title, /다음 메시지를 보내면.*기준점 자동 복구를 시도/);
  assert.match(h.nodes[".measure"].title, /클릭하면 지금 수동으로 갱신/);
  assert.equal(h.nodes[".measure"].attributes["aria-label"],
    [h.nodes[".primary"].textContent, h.nodes[".secondary"].textContent, h.nodes[".measure"].title].filter(Boolean).join(" · "));
  assert.equal(h.requests() - before, 3, "internal verification retries count as one failure");
  assert.equal(h.logs.filter(([, text]) => JSON.parse(text).event === "baseline-refresh-started").length, 0);
  return submit;
}

const flushAsync = () => new Promise(setImmediate);

test("after one failure, streaming and Stop activity cannot start recovery before the next user input", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  const before = h.requests();
  h.context.Chatcouter.chatGptDomAdapter.mutationsNeedMeasurement = () => true;
  h.context.Chatcouter.chatGptDomAdapter.hasStreamingControl = () => true;
  h.context.observe([]);
  const stop = new h.Element();
  stop.closest = selector => selector.includes('button[data-testid="stop-button"]') ? stop : null;
  h.handlers.click({ target: stop });
  assert.equal(h.timerCount(), 0);
  assert.equal(h.requests(), before);
  h.setExtract(async () => h.result);
  submit();
  await flushAsync();
  assert.equal(h.requests(), before + 1);
  h.handlers.click({ target: stop });
  h.context.observe([]);
  assert.equal(h.timerCount(), 0);
});

test("one final automatic failure recovers once on the next turn, accepts incomplete storage and resets the baseline", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  const before = h.requests();
  const stored = {
    ...h.result,
    messages: [...h.result.messages, { id: "u2", role: "user", text: "stored prompt" }],
    completion: { currentNodeRole: "user" },
  };
  h.setExtract(async () => stored);
  h.context.Chatcouter.chatGptDomAdapter.hasStreamingControl = () => true;
  submit();
  await flushAsync();
  assert.equal(h.requests(), before + 1);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.blobs.length, 0);
  assert.equal(h.unverified(), 0);
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  assert.match(h.nodes[".measure"].title, /기준점 갱신/);
  assert.match(h.nodes[".measure"].title, /완료와 최신성은 미확인/);
  assert.doesNotMatch(h.nodes[".measure"].title, /기준점 자동 복구/);
  assert.equal(h.nodes[".primary"].textContent, `${h.context.Chatcouter.model.measureConversation(stored.messages).characters}자`);
  h.context.Chatcouter.chatGptDomAdapter.mutationsNeedMeasurement = () => true;
  h.context.observe([]);
  assert.equal(h.timerCount(), 0, "no completion tracking after recovery");
  h.context.Chatcouter.chatGptDomAdapter.hasStreamingControl = () => false;
  h.setExtract(async () => ({
    ...h.result,
    messages: [...stored.messages, { id: "u3", role: "user", text: "next prompt" }, { id: "a3", role: "assistant", text: "next answer" }],
  }));
  submit();
  for (let step = 0; step < 8 && h.nodes[".measure"].dataset.state !== "ready"; step++) await h.runTimer();
  assert.equal(h.requests(), before + 2);
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  const entries = h.logs.map(([, text]) => JSON.parse(text));
  const pending = entries.findLast(entry => entry.event === "response-pending");
  assert.equal(pending.expectedTurns, 1);
  assert.equal(pending.baselineUserMessages, 2);
});

test("a ready stored checkpoint survives Export and one later automatic failure enters recovery again", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeStatus: "in_progress" } }));
  submit();
  await flushAsync();
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  const value = h.nodes[".primary"].textContent;
  const title = h.nodes[".measure"].title;
  for (const completion of [h.result.completion, { currentNodeRole: "tool" }]) {
    h.setExtract(async () => ({ ...h.result, completion }));
    await h.click();
    assert.equal(h.nodes[".primary"].textContent, value);
    assert.equal(h.nodes[".measure"].title, title);
    assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
    assert.equal(h.unverified(), 0);
    await h.runTimer(); // Blob URL cleanup, not a measurement retry.
  }
  assert.equal(h.downloads.length, 2);
  assert.match(h.downloads[1], /_unchecked\.md$/);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "snapshot-published").scope, "server-stored-unverified");
  const before = h.requests();
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeStatus: "in_progress" } }));
  submit();
  for (let step = 0; step < 12 && h.unverified() !== 1; step++) await h.runTimer();
  assert.equal(h.unverified(), 1);
  assert.equal(h.nodes[".measure"].dataset.indicator, "attention");
  assert.equal(h.requests(), before + 3);
  const recoveryCount = h.logs.map(([, text]) => JSON.parse(text)).filter(entry => entry.event === "baseline-refresh-started").length;
  submit();
  await flushAsync();
  assert.equal(h.requests(), before + 4);
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  assert.equal(h.unverified(), 0);
  assert.equal(h.timerCount(), 0);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(entry => entry.event === "baseline-refresh-started").length, recoveryCount + 1);
});

test("three recovery failures switch the dot off, keep the reference and retry only on each new turn until success", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  const value = h.nodes[".primary"].textContent;
  const before = h.requests();
  h.setExtract(async () => ({ ok: false, reason: "conversation-request-timeout" }));
  for (let failure = 1; failure <= 4; failure++) {
    submit();
    await flushAsync();
    assert.equal(h.requests(), before + failure);
    assert.equal(h.nodes[".primary"].textContent, value);
    assert.equal(h.unverified(), 1);
    assert.equal(h.nodes[".measure"].dataset.indicator, failure >= 3 ? "unavailable" : "attention");
    assert.equal(h.timerCount(), 0);
  }
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeStatus: "in_progress" } }));
  submit();
  await flushAsync();
  assert.equal(h.unverified(), 0);
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  assert.equal(h.timerCount(), 0);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "baseline-refresh-succeeded").unchecked, true);
});

test("same-room input, mutations and completion controls do not cancel, duplicate or chase an in-flight recovery", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  let resolve;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  const startDom = { ok: true, messages: [{ id: "u1", role: "user", text: "new prompt" }] };
  h.context.Chatcouter.chatGptDomAdapter.extract = () => startDom;
  const before = h.requests();
  submit();
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true, messages: [{ id: "u99", role: "user", text: "later prompt" }] });
  submit();
  h.nodes[".measure"].listeners.click();
  h.context.Chatcouter.chatGptDomAdapter.mutationsNeedMeasurement = () => true;
  h.context.Chatcouter.chatGptDomAdapter.mutationsTouchActionControls = () => true;
  h.context.Chatcouter.chatGptDomAdapter.hasStreamingControl = () => true;
  h.context.observe([]);
  assert.equal(signal.aborted, false);
  assert.equal(h.requests(), before + 1);
  resolve({
    ...h.result,
    messages: [...h.result.messages, { id: "u99", role: "user", text: "later prompt" }],
    completion: { currentNodeRole: "tool" },
  });
  await flushAsync();
  assert.equal(h.unverified(), 0);
  assert.equal(h.timerCount(), 0);
  h.context.observe([]);
  assert.equal(h.timerCount(), 0);
  assert.equal(h.requests(), before + 1);
});

test("recovery still rejects a server snapshot missing the DOM user captured at its start", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true, messages: [{ id: "u99", role: "user", text: "missing prompt" }] });
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeStatus: "in_progress" } }));
  submit();
  await flushAsync();
  assert.equal(h.unverified(), 1);
  const failure = h.logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "baseline-refresh-failed");
  assert.equal(failure.reason, "api-user-tail-behind-dom");
  assert.equal(failure.recoveryFailureStreak, 1);
  assert.equal(h.downloads.length, 0);
});

test("navigation aborts recovery and prevents an old room checkpoint from publishing in a new room", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  let resolve;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  submit();
  h.context.location.pathname = "/c/two";
  h.context.observe([]);
  assert.equal(signal.aborted, true);
  assert.equal(h.unverified(), 0);
  resolve(h.result);
  await flushAsync();
  assert.equal(h.logs.filter(([, text]) => JSON.parse(text).event === "baseline-refresh-succeeded").length, 0);
  h.setExtract(async () => h.result);
  h.runTimer();
  await h.runTimer();
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
});

test("independent Export cancels recovery without changing either failure count and permits recovery next turn", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  let resolve;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  submit();
  h.setExtract(async () => h.result);
  await h.click();
  assert.equal(signal.aborted, true);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.unverified(), 1);
  assert.equal(h.timerCount(), 1, "only blob cleanup is scheduled, not a recovery retry");
  await h.runTimer();
  resolve(h.result);
  await flushAsync();
  assert.equal(h.logs.filter(([, text]) => JSON.parse(text).event === "baseline-refresh-failed").length, 0);
  assert.equal(h.logs.filter(([, text]) => JSON.parse(text).event === "baseline-refresh-succeeded").length, 0);
  submit();
  await flushAsync();
  assert.equal(h.unverified(), 0);
  assert.equal(h.downloads.length, 1, "recovery never downloads files");
});

test("Export preserves an unavailable recovery state, including while preparing files", async () => {
  const h = harness();
  const submit = await enterBaselineRecovery(h);
  h.setExtract(async () => ({ ok: false, reason: "conversation-request-timeout" }));
  for (let failure = 0; failure < 3; failure++) { submit(); await flushAsync(); }
  let resolve;
  h.setExtract(() => new Promise(done => { resolve = done; }));
  const exported = h.click();
  await flushAsync();
  assert.equal(h.nodes[".measure"].dataset.indicator, "unavailable");
  assert.match(h.nodes[".measure"].attributes["aria-label"], /확인 불가/);
  assert.doesNotMatch(h.nodes[".measure"].title, /확인 불가 · 확인 불가/);
  resolve(h.result);
  await exported;
  assert.equal(h.nodes[".measure"].dataset.indicator, "unavailable");
  assert.equal(h.unverified(), 1);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "baseline-refresh-failed").recoveryFailureStreak, 3);
});

function submitPrompt(h) {
  const form = new h.Element();
  form.querySelector = () => ({});
  h.handlers.submit({ target: form });
}

test("manual refresh consistently accepts stored snapshots in ready, uncertain and streaming states without completion tracking", async () => {
  for (const state of ["ready", "uncertain", "streaming"]) {
    for (const completion of [{ currentNodeStatus: "in_progress" }, { currentNodeRole: "tool" }, {}]) {
      const h = harness();
      if (state === "uncertain") await enterBaselineRecovery(h);
      else { h.runTimer(); await h.runTimer(); }
      if (state === "streaming") {
        h.context.Chatcouter.chatGptDomAdapter.hasStreamingControl = () => true;
        submitPrompt(h);
      }
      const stored = { ...h.result, messages: [...h.result.messages, { id: "u2", role: "user", text: "stored input" }], completion };
      h.setExtract(async () => stored);
      const before = h.requests();
      h.nodes[".measure"].listeners.click();
      await flushAsync();
      assert.equal(h.requests(), before + 1, state);
      assert.equal(h.nodes[".primary"].textContent, `${h.context.Chatcouter.model.measureConversation(stored.messages).characters}자`);
      assert.equal(h.unverified(), 0);
      assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
      assert.match(h.nodes[".measure"].title, /서버 저장분 조회 성공/);
      assert.match(h.nodes[".measure"].title, /완료와 최신성은 미확인/);
      assert.equal(h.nodes[".measure"].disabled, false);
      assert.equal(h.downloads.length, 0);
      assert.equal(h.timerCount(), 0);
      const success = h.logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "baseline-refresh-succeeded");
      assert.equal(success.trigger, "manual");
      assert.equal(success.unchecked, true);
      h.context.Chatcouter.chatGptDomAdapter.mutationsNeedMeasurement = () => true;
      h.context.Chatcouter.chatGptDomAdapter.hasStreamingControl = () => true;
      h.context.observe([]);
      assert.equal(h.timerCount(), 0, "manual snapshot does not resume completion tracking");
    }
  }
});

test("manual refresh keeps the snapshot request on new input and resumes automatic verification only on a following turn", async () => {
  const h = harness();
  h.runTimer(); await h.runTimer();
  let resolve;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  const before = h.requests();
  h.nodes[".measure"].listeners.click();
  assert.equal(h.nodes[".measure"].disabled, true);
  h.nodes[".measure"].listeners.click();
  submitPrompt(h);
  assert.equal(h.requests(), before + 1);
  assert.equal(signal.aborted, false);
  const stored = { ...h.result, messages: [...h.result.messages, { id: "u2", role: "user", text: "arrived during lookup" }], completion: { currentNodeRole: "user" } };
  resolve(stored);
  await flushAsync();
  assert.equal(h.timerCount(), 0);
  const completed = { ...h.result, messages: [...stored.messages, { id: "u3", role: "user", text: "following turn" }, { id: "a3", role: "assistant", text: "complete answer" }] };
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true, messages: completed.messages });
  h.setExtract(async () => completed);
  submitPrompt(h);
  for (let step = 0; step < 8 && h.nodes[".measure"].dataset.state !== "ready"; step++) await h.runTimer();
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  assert.equal(h.requests(), before + 2);
  const pending = h.logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "response-pending");
  assert.equal(pending.expectedTurns, 1);
  assert.equal(pending.baselineUserMessages, 2);
});

test("manual failure preserves the reference and both counts; manual success clears the unavailable state", async () => {
  for (const unavailable of [false, true]) {
    const h = harness();
    const submit = await enterBaselineRecovery(h);
    h.setExtract(async () => ({ ok: false, reason: "conversation-request-timeout" }));
    if (unavailable) for (let failure = 0; failure < 3; failure++) { submit(); await flushAsync(); }
    const value = h.nodes[".primary"].textContent;
    h.setExtract(async () => { throw new Error("request failed"); });
    h.nodes[".measure"].listeners.click();
    await flushAsync();
    assert.equal(h.nodes[".primary"].textContent, value);
    assert.equal(h.unverified(), 1);
    assert.equal(h.nodes[".measure"].dataset.indicator, unavailable ? "unavailable" : "attention");
    const failure = h.logs.map(([, text]) => JSON.parse(text)).findLast(entry => entry.event === "baseline-refresh-failed");
    assert.equal(failure.trigger, "manual");
    assert.equal(failure.recoveryFailureStreak, unavailable ? 3 : 0);
    assert.equal(h.timerCount(), 0);
    h.setExtract(async () => h.result);
    h.nodes[".measure"].listeners.click();
    await flushAsync();
    assert.equal(h.unverified(), 0);
    assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
    assert.equal(h.nodes[".measure"].disabled, false);
    assert.equal(h.downloads.length, 0);
  }
});

test("new input cancels Export and starts required recovery even while Export is reading settings or server data", async () => {
  for (const phase of ["settings", "server"]) {
    const h = harness();
    const submit = await enterBaselineRecovery(h);
    let resolve;
    let signal;
    if (phase === "settings") h.context.browser.storage.local.get = () => new Promise(done => { resolve = done; });
    else h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
    const exported = h.click();
    await flushAsync();
    const before = h.requests();
    h.setExtract(async () => h.result);
    submit();
    await flushAsync();
    assert.equal(h.requests(), before + 1);
    if (signal) assert.equal(signal.aborted, true);
    assert.equal(h.unverified(), 0);
    assert.equal(h.nodes[".measure"].disabled, false);
    resolve(phase === "settings" ? { exportFormats: ["md"] } : h.result);
    await exported;
    assert.equal(h.downloads.length, 0, "old Export cannot save after new input even without DOM mutation detection");
    assert.equal(h.timerCount(), 0);
    assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(entry => entry.event === "baseline-refresh-started").length, 1);
  }
});

test("Export after a successful checkpoint cannot swallow the following automatic turn", async () => {
  for (const cause of ["manual", "safety"]) {
    const h = harness();
    if (cause === "safety") {
      const submit = await enterBaselineRecovery(h);
      h.setExtract(async () => h.result);
      submit();
    } else {
      h.runTimer(); await h.runTimer();
      h.nodes[".measure"].listeners.click();
    }
    await flushAsync();
    let resolve;
    let signal;
    h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
    const exported = h.click();
    await flushAsync();
    const completed = { ...h.result, messages: [...h.result.messages, { id: "u2", role: "user", text: "next input" }, { id: "a2", role: "assistant", text: "next answer" }] };
    h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true, messages: completed.messages });
    h.setExtract(async () => completed);
    submitPrompt(h);
    assert.equal(signal.aborted, true);
    resolve(h.result);
    await exported;
    for (let step = 0; step < 8 && h.nodes[".measure"].dataset.state !== "ready"; step++) await h.runTimer();
    assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
    assert.equal(h.downloads.length, 0);
    assert.equal(h.unverified(), 0);
  }
});

test("Export preempts manual checkpoint; canceled checkpoint cannot publish and navigation cancels a later manual request", async () => {
  const h = harness();
  h.runTimer(); await h.runTimer();
  const value = h.nodes[".primary"].textContent;
  let resolve;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  h.nodes[".measure"].listeners.click();
  h.setExtract(async () => h.result);
  await h.click();
  assert.equal(signal.aborted, true);
  assert.equal(h.downloads.length, 1);
  resolve({ ...h.result, messages: [] });
  await flushAsync();
  assert.equal(h.nodes[".primary"].textContent, value);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(entry => entry.event === "baseline-refresh-succeeded").length, 0);
  assert.equal(h.nodes[".measure"].dataset.indicator, "attention");
  assert.match(h.nodes[".measure"].title, /내보내기로 중지/);
  assert.match(h.nodes[".measure"].title, /다음 메시지부터 자동 확인을 다시 시도/);
  assert.doesNotMatch(h.nodes[".measure"].title, /기준점 자동 복구/);
  h.setExtract(options => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  h.nodes[".measure"].listeners.click();
  h.context.location.pathname = "/c/two";
  h.context.observe([]);
  assert.equal(signal.aborted, true);
  resolve({ ...h.result, messages: [] });
  await flushAsync();
  assert.equal(h.nodes[".measure"].dataset.state, "loading");
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(entry => entry.event === "baseline-refresh-succeeded").length, 0);
});

test("HTML fetches once, saves the fresh snapshot without updating measurement", async () => {
  const h = harness(["html"]);
  await h.click();
  assert.equal(h.requests(), 1);
  assert.match(h.downloads[0], /\.html$/);
  assert.equal(h.blobs[0].type, "text/html;charset=utf-8");
  const html = await h.blobs[0].text();
  assert.match(html, /fresh answer/);
  assert.match(html, /메시지: 2 \(사용자 1, AI 1\)/);
  assert.equal(h.nodes[".primary"].textContent, "ChatGauge");
  assert.equal(h.unverified(), 0);
});

test("all seven selections save only selected formats from one fresh snapshot", async () => {
  for (let mask = 1; mask < 8; mask++) {
    const formats = ["md", "json", "html"].filter((_, index) => mask & (1 << index));
    const h = harness(formats);
    await h.click();
    assert.equal(h.requests(), 1);
    assert.equal(h.downloads.length, 1);
    let files;
    if (formats.length === 1) {
      assert.ok(h.downloads[0].endsWith(`.${formats[0]}`));
      files = [{ filename: h.downloads[0], contents: await h.blobs[0].text() }];
    } else {
      assert.match(h.downloads[0], /\.zip$/);
      assert.equal(h.blobs[0].type, "application/zip");
      files = readZip(await h.blobs[0].arrayBuffer());
    }
    assert.deepEqual(files.map((file) => file.filename.split(".").at(-1)), formats);
    const timestamps = [];
    for (const file of files) {
      assert.match(file.contents, /fresh answer/);
      if (file.filename.endsWith(".json")) {
        const payload = JSON.parse(file.contents);
        assert.equal(payload.conversation.totals.messages, 2);
        assert.equal(payload.conversation.messages[1].text, h.result.messages[1].text);
        timestamps.push(payload.exportedAt);
      } else {
        assert.match(file.contents, file.filename.endsWith(".html")
          ? /메시지: 2 \(사용자 1, AI 1\)/ : /Messages: 2 \(user 1, assistant 1\)/);
        timestamps.push(file.contents.match(/(?:Exported|내보낸 시각): ([^<\n]+)/)[1]);
      }
    }
    assert.equal(new Set(timestamps).size, 1);
    assert.equal(h.nodes[".primary"].textContent, "ChatGauge");
  }
});

test("Export reads the latest saved preferences per click and fails safely on storage errors", async () => {
  const h = harness();
  await h.click();
  h.context.browser.storage.local.get = async () => ({ exportFormats: ["json"], filenameOptions: { includeDate: false, includeTime: false } });
  await h.click();
  assert.equal(h.downloads[1], "Fresh title.json");
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeRole: "tool" } }));
  h.context.browser.storage.local.get = async () => ({ exportFormats: ["json"],
    filenameOptions: { includeDate: false, includeTime: false, includeUnchecked: false } });
  await h.click();
  assert.equal(h.downloads[2], "Fresh title.json");
  assert.equal(JSON.parse(await h.blobs[2].text()).conversation.source, "server-stored-unverified");
  h.context.browser.storage.local.get = async () => { throw new Error("storage failed"); };
  await h.click();
  assert.equal(h.requests(), 3);
  assert.equal(h.downloads.length, 3);
  assert.equal(h.nodes[".export"].disabled, false);
  assert.equal(h.nodes[".export"].textContent, "내보내기 재시도");
});

test("filename preferences apply to every single format and ZIP while preserving unverified notices and timestamps", async () => {
  for (const includeDate of [true, false]) for (const includeTime of [true, false]) {
    for (const includeUnchecked of [true, false])
    for (const unchecked of [false, true]) for (const formats of [["md"], ["json"], ["html"], ["md", "json", "html"]]) {
      const h = harness(formats, { filenameOptions: { includeDate, includeTime, includeUnchecked } });
      if (unchecked) h.setExtract(async () => ({ ...h.result, completion: { currentNodeRole: "tool" } }));
      await h.click();
      assert.equal(h.requests(), 1);
      assert.equal(h.downloads.length, 1);
      const files = formats.length === 1
        ? [{ filename: h.downloads[0], contents: await h.blobs[0].text() }]
        : readZip(await h.blobs[0].arrayBuffer());
      const timestamps = files.map(file => file.filename.endsWith(".json")
        ? JSON.parse(file.contents).exportedAt : file.contents.match(/(?:Exported|내보낸 시각): ([^<\n]+)/)[1]);
      assert.equal(new Set(timestamps).size, 1);
      assert.ok(Number.isFinite(Date.parse(timestamps[0])), "content retains a valid full export timestamp");
      const stamp = timestamps[0].replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const [date, time] = stamp.split("-");
      const suffix = [includeDate ? date : "", includeTime ? time : ""].filter(Boolean).join("-");
      const base = `Fresh title${suffix ? `_${suffix}` : ""}${unchecked && includeUnchecked ? "_unchecked" : ""}`;
      assert.equal(h.downloads[0], `${base}.${formats.length === 1 ? formats[0] : "zip"}`);
      assert.deepEqual(files.map(file => file.filename), formats.map(format => `${base}.${format}`));
      if (unchecked) for (const file of files) {
        if (file.filename.endsWith(".json")) {
          const payload = JSON.parse(file.contents);
          assert.equal(payload.conversation.source, "server-stored-unverified");
          assert.equal(payload.conversation.preservation.mode, "server-stored-unverified");
          assert.ok(payload.conversation.preservation.warning);
        } else {
          assert.match(file.contents, /응답 완료와 최신성은 보장하지 않습니다/);
        }
      }
      assert.equal(h.nodes[".primary"].textContent, "ChatGauge");
    }
  }
});

test("a route change while reading settings cannot start a conversation lookup", async () => {
  const h = harness();
  let resolve;
  h.context.browser.storage.local.get = () => new Promise((done) => { resolve = done; });
  const pending = h.click();
  await new Promise(setImmediate);
  h.context.location.pathname = "/c/two";
  resolve({ exportFormats: ["html", "md"] });
  await pending;
  assert.equal(h.requests(), 0);
  assert.equal(h.downloads.length, 0);
});

test("selected HTML uses the common busy guard and rejects changed or failed snapshots", async () => {
  const h = harness(["html"]);
  let resolve;
  h.setExtract(() => new Promise((done) => { resolve = done; }));
  const pending = h.click();
  await new Promise(setImmediate);
  assert.equal(h.nodes[".export"].disabled, true);
  await h.click();
  await h.click();
  assert.equal(h.requests(), 1);
  h.context.location.pathname = "/c/two";
  resolve(h.result);
  await pending;
  assert.equal(h.downloads.length, 0);
  h.setExtract(async () => ({ ok: false, reason: "conversation-request-timeout" }));
  await h.click();
  assert.equal(h.downloads.length, 0);
});

test("Export can interrupt admission lookup and resume measurement independently", async () => {
  const h = harness();
  await flushAsync();
  let resolveAdmission;
  let admissionSignal;
  h.setExtract((options) => { admissionSignal = options.signal; return new Promise(done => { resolveAdmission = done; }); });
  h.runTimer();
  const admission = h.runTimer();
  assert.equal(h.nodes[".measure"].dataset.state, "loading");
  assert.equal(h.nodes[".export"].disabled, false);
  h.setExtract(async () => h.result);
  await h.click();
  assert.equal(admissionSignal.aborted, true);
  assert.equal(h.downloads.length, 1);
  resolveAdmission(h.result);
  await admission;
  for(let step=0;step<8 && h.nodes[".measure"].dataset.state!=="ready";step++) await h.runTimer();
  assert.equal(h.nodes[".measure"].dataset.state, "ready");
});

test("Export failure never saves DOM fallback and permits a fresh retry", async () => {
  const h = harness();
  h.setExtract(async () => ({ ok: false, reason: "conversation-request-timeout" }));
  await h.click();
  assert.equal(h.downloads.length, 0);
  assert.equal(h.nodes[".export"].textContent, "내보내기 재시도");
  assert.equal(h.nodes[".export"].disabled, false);
  h.setExtract(async () => h.result);
  await h.click();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.requests(), 2);
});

test("Export saves incomplete server data with suffix but rejects missing latest user", async () => {
  for (const completion of [
    {lastAssistantStatus:"in_progress", currentNodeEndTurn:null},
    {currentNodeRole:"user"},
    {currentNodeRole:"tool", currentNodeStatus:"finished_successfully"},
    {},
  ]) {
    const h=harness();
    h.setExtract(async()=>({...h.result,completion}));
    await h.click();
    assert.equal(h.downloads.length,1);
    assert.match(h.downloads[0], /_unchecked\.md$/);
    assert.match(await h.blobs[0].text(), /server-stored-unverified/);
  }
  const h=harness();
  h.setExtract(async()=>({...h.result,messages:[{role:"user",text:"old prompt"}]}));
  await h.click();
  assert.equal(h.downloads.length,0);
});

test("Export saves the visible snapshot of an explicitly interrupted tool turn", async () => {
  const h = harness();
  h.setExtract(async () => ({
    ...h.result,
    completion: {
      lastAssistantStatus: "finished_successfully",
      lastAssistantEndTurn: false,
      currentNodeStatus: "finished_successfully",
      currentNodeRole: "assistant",
      currentNodeRecipient: "functions.exec",
      currentNodeEndTurn: null,
      currentNodeFinishType: "interrupted",
    },
  }));
  await h.click();
  assert.equal(h.downloads.length, 1);
  assert.match(await h.blobs[0].text(), /fresh answer/);
});

test("single-click unchecked Export marks every selected format and ZIP entry", async () => {
  for (let mask=1;mask<8;mask++) {
    const formats=["md","json","html"].filter((_,i)=>mask & (1<<i));
    const h=harness(formats);
    const saved={...h.result,messages:[...h.result.messages,{id:"u2",role:"user",text:"unanswered prompt"}],completion:{currentNodeRole:"user"}};
    h.context.Chatcouter.chatGptDomAdapter.extract=()=>({ok:true,messages:saved.messages});
    h.setExtract(async()=>saved);
    await h.click();
    assert.equal(h.requests(),1);
    assert.equal(h.downloads.length,1);
    assert.match(h.downloads[0], /_unchecked\.(md|json|html|zip)$/);
    const files=formats.length===1 ? [{filename:h.downloads[0],contents:await h.blobs[0].text()}] : readZip(await h.blobs[0].arrayBuffer());
    for(const file of files) {
      assert.match(file.filename, /_unchecked\.(md|json|html)$/);
      assert.match(file.contents,/server-stored-unverified/);
      assert.match(file.contents,/current-node-not-assistant/);
      assert.match(file.contents,/마지막 AI 응답/);
      assert.match(file.contents,/unanswered prompt/);
    }
    assert.equal(h.nodes[".primary"].textContent,"ChatGauge");
    assert.equal(h.nodes[".measure"].dataset.indicator,"idle");
  }
});

test("Export blocks duplicate clicks and rejects a route change during lookup", async () => {
  const h = harness();
  let resolve;
  h.setExtract(() => new Promise((done) => { resolve = done; }));
  const pending = h.click();
  await new Promise(setImmediate);
  assert.equal(h.nodes[".export"].disabled, true);
  assert.equal(h.nodes[".export"].textContent, "파일 준비 중…");
  assert.equal(h.nodes[".primary"].textContent, "사용량 미확인");
  assert.equal(h.nodes[".secondary"].textContent, "");
  assert.equal(h.nodes[".measure"].disabled, true);
  assert.equal(h.nodes[".measure"].dataset.indicator, "busy");
  await h.click();
  assert.equal(h.requests(), 1);
  h.context.location.pathname = "/c/two";
  resolve(h.result);
  await pending;
  assert.equal(h.downloads.length, 0);
});

test("Export preparation cannot reuse usage from the previous conversation", async () => {
  const h = harness();
  h.runTimer(); await h.runTimer();
  assert.equal(h.nodes[".measure"].dataset.numeric, "true");
  h.context.location.pathname = "/c/two";
  h.context.observe([]);
  let resolve;
  h.setExtract(() => new Promise((done) => { resolve = done; }));
  const pending = h.click();
  await flushAsync();
  assert.equal(h.nodes[".export"].textContent, "파일 준비 중…");
  assert.equal(h.nodes[".primary"].textContent, "사용량 미확인");
  assert.equal(h.nodes[".secondary"].textContent, "");
  assert.equal(h.nodes[".measure"].dataset.numeric, "false");
  resolve(h.result);
  await pending;
});

test("both normal and unchecked Export preserve an uncertain meter; manual measurement recovers", async () => {
  const h=harness();
  h.runTimer(); await h.runTimer();
  const form=new h.Element(); form.querySelector=()=>({});
  h.setExtract(async()=>({ok:false,reason:"conversation-request-timeout"}));
  h.handlers.submit({target:form});
  for(let step=0;step<12 && h.unverified()!==1;step++) await h.runTimer();
  assert.equal(h.unverified(),1);
  const before=h.nodes[".primary"].textContent;
  const beforeTitle=h.nodes[".measure"].title;
  for(const completion of [{currentNodeRole:"user"},h.result.completion]) {
    h.setExtract(async()=>({...h.result,completion}));
    await h.click();
    assert.equal(h.nodes[".primary"].textContent,before);
    assert.equal(h.unverified(),1);
    assert.equal(h.nodes[".measure"].dataset.indicator,"attention");
    assert.equal(h.nodes[".measure"].title,beforeTitle,"Export must not duplicate or lose uncertainty guidance");
  }
  h.result.messages.push({id:"u2",role:"user",text:"next prompt"},{id:"a2",role:"assistant",text:"next answer"});
  h.setExtract(async()=>h.result);
  h.nodes[".measure"].listeners.click();
  await flushAsync();
  assert.equal(h.unverified(),0);
  assert.equal(h.nodes[".measure"].dataset.indicator,"ready");
});

test("a new submitted response cancels Export without counting an automatic failure", async () => {
  const h = harness();
  let resolve;
  let signal;
  h.setExtract((options) => {
    signal = options.signal;
    return new Promise((done) => { resolve = done; });
  });
  const pending = h.click();
  await new Promise(setImmediate);
  const form = new h.Element();
  form.querySelector = () => ({});
  h.handlers.submit({ target: form });
  assert.equal(signal.aborted, true);
  resolve(h.result);
  await pending;
  assert.equal(h.downloads.length, 0);
  assert.equal(h.unverified(), 0);
  assert.equal(h.nodes[".export"].disabled, false);
});

test("conversation mutation during Export rejects its snapshot", async () => {
  const h = harness();
  let resolve;
  h.setExtract(() => new Promise((done) => { resolve = done; }));
  const pending = h.click();
  await new Promise(setImmediate);
  h.context.Chatcouter.chatGptDomAdapter.mutationsNeedMeasurement = () => true;
  h.context.observe([]);
  resolve(h.result);
  await pending;
  assert.equal(h.downloads.length, 0);
});

test("the next input recovers stored data after an earlier unanswered turn", async () => {
  const h = harness();
  h.runTimer(); await h.runTimer();
  const form = new h.Element(); form.querySelector = () => ({});
  let current = { ...h.result,
    messages: [...h.result.messages, { id: "u2", role: "user", text: "unanswered" }],
    completion: { currentNodeRole: "user", currentNodeStatus: "finished_successfully" },
  };
  h.setExtract(async () => current);
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true, messages: current.messages });
  h.handlers.submit({ target: form });
  for (let step = 0; step < 12 && h.unverified() !== 1; step++) await h.runTimer();
  assert.equal(h.unverified(), 1);
  current = { ...h.result, messages: [...current.messages,
    { id: "u3", role: "user", text: "new prompt" },
    { id: "a3", role: "assistant", text: "completed new answer" },
  ] };
  h.handlers.submit({ target: form });
  await flushAsync();
  for (let step = 0; step < 12 && h.unverified() !== 0; step++) await h.runTimer();
  assert.equal(h.unverified(), 0);
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
});

test("Export works during an existing response and resumes its automatic lifecycle", async () => {
  const h = harness();
  h.runTimer(); await h.runTimer();
  const before = h.nodes[".primary"].textContent;
  const beforeBytes = h.nodes[".secondary"].textContent;
  const form = new h.Element(); form.querySelector = () => ({});
  h.handlers.submit({ target: form });
  assert.equal(h.nodes[".export"].disabled, false);
  let resolve;
  h.setExtract(() => new Promise((done) => { resolve = done; }));
  const pending = h.click();
  await flushAsync();
  assert.equal(h.nodes[".export"].textContent, "파일 준비 중…");
  assert.equal(h.nodes[".primary"].textContent, before);
  assert.equal(h.nodes[".secondary"].textContent, beforeBytes);
  assert.equal(h.nodes[".measure"].dataset.numeric, "true");
  assert.equal(h.nodes[".measure"].disabled, true);
  const requests = h.requests();
  h.nodes[".measure"].listeners.click();
  await h.click();
  assert.equal(h.requests(), requests, "busy controls cannot start another lookup");
  resolve({ ...h.result, completion: { currentNodeStatus: "in_progress" } });
  await pending;
  assert.match(h.downloads[0], /_unchecked\.md$/);
  assert.equal(h.nodes[".measure"].dataset.state, "loading");
  assert.equal(h.nodes[".primary"].textContent, "헤아리는 중…");
  h.result.messages.push({ id: "u2", role: "user", text: "next" }, { id: "a2", role: "assistant", text: "answer" });
  h.setExtract(async () => h.result);
  for (let step = 0; step < 12 && h.nodes[".measure"].dataset.state !== "ready"; step++) await h.runTimer();
  assert.equal(h.nodes[".measure"].dataset.state, "ready");
  assert.notEqual(h.nodes[".primary"].textContent, before);
});

test("diagnostic output is JSON text containing full fields without message bodies", async () => {
  const h = harness();
  await h.click();
  const entries = h.logs.map(([label, text]) => {
    assert.equal(label, "[ChatGauge]");
    return JSON.parse(text);
  });
  const downloaded = entries.find(entry => entry.event === "fresh-export-download-started");
  assert.equal(downloaded.assistantMessages, 1);
  assert.equal(downloaded.unchecked, false);
  assert.ok(!JSON.stringify(entries).includes("fresh answer"));
  assert.ok(!JSON.stringify(entries).includes("hello"));
  assert.doesNotMatch(h.downloads[0], /_unchecked/);
});

function submitPrompt(h) {
  const form = new h.Element();
  form.querySelector = () => ({});
  h.handlers.submit({ target: form });
}

async function finishAdmission(h) {
  await flushAsync();
  h.runTimer();
  await h.runTimer();
}

const events = h => h.logs.map(([, text]) => JSON.parse(text));
const publications = h => events(h).filter(e => e.event === "snapshot-published").length;

test("same-room return waits for generation before spending response verification budget", async () => {
  for (const reason of ["pageshow", "popstate"]) {
    const h = harness();
    let clock = 1000, streaming = true, candidates = 0;
    h.context.Date = class extends Date { static now() { return clock; } };
    await finishAdmission(h);
    const adapter = h.context.Chatcouter.chatGptDomAdapter;
    adapter.hasStreamingControl = () => streaming;
    adapter.extract = () => ({ ok: false, reason: "synthetic-no-dom" });
    h.setExtract(async () => {
      candidates++;
      return { ...h.result,
        messages: [...h.result.messages, { id: "u2", role: "user", text: "next" },
          { id: "a2", role: "assistant", text: "answer" }],
        completion: candidates === 1 ? { currentNodeStatus: "in_progress" } : h.result.completion };
    });
    submitPrompt(h);
    h.windowHandlers[reason]();
    for (let step = 0; step < 5; step++) {
      clock += 4000;
      await h.runTimer();
    }
    assert.equal(candidates, 0, "return cannot query a still generating response");
    streaming = false;
    for (let step = 0; step < 10 && h.nodes[".measure"].dataset.state !== "ready"; step++) {
      clock += 100;
      await h.runTimer();
    }
    assert.equal(candidates, 2);
    assert.equal(h.nodes[".measure"].dataset.state, "ready");
    assert.equal(h.unverified(), 0);
  }
});

test("weak composer inference reaches action fallback while explicit Stop keeps waiting", async () => {
  for (const explicitStop of [false, true]) {
    const h = harness();
    let clock = 1000, stopped = explicitStop;
    h.context.Date = class extends Date { static now() { return clock; } };
    await finishAdmission(h);
    const adapter = h.context.Chatcouter.chatGptDomAdapter;
    adapter.getAssistantActionKeys = () => ["a1"];
    // An enabled Send with a draft is weak; Stop is always strong.
    adapter.hasStreamingControl = (_, options = {}) => stopped || Boolean(options.allowActiveComposerFallback);
    adapter.extract = () => ({ ok: false, reason: "synthetic-no-dom" });
    h.result.messages.push({ id: "u2", role: "user", text: "next" },
      { id: "a2", role: "assistant", text: "answer" });
    submitPrompt(h);
    const requests = h.requests();
    for (let step = 0; step < 20 && h.nodes[".measure"].dataset.state !== "ready"; step++) {
      clock += 4000;
      await h.runTimer();
    }
    if (explicitStop) {
      assert.equal(h.requests(), requests, "a long real generation never times out on a weak-signal budget");
      assert.equal(events(h).some(e => e.event === "assistant-actions-fallback"), false);
      stopped = false;
      for (let step = 0; step < 20 && h.nodes[".measure"].dataset.state !== "ready"; step++) {
        clock += 4000;
        await h.runTimer();
      }
    }
    assert.equal(h.nodes[".measure"].dataset.state, "ready");
    assert.equal(h.requests(), requests + 1);
    assert.equal(events(h).filter(e => e.event === "assistant-actions-fallback").length, 1);
  }
});

test("mutation during export settings read reports the same rejection as server preparation", async () => {
  for (const phase of ["settings", "server"]) {
    const h = harness();
    await finishAdmission(h);
    let finish;
    if (phase === "settings") h.context.browser.storage.local.get = () => new Promise(resolve => { finish = resolve; });
    else h.setExtract(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.click();
    await flushAsync();
    h.context.Chatcouter.chatGptDomAdapter.mutationsNeedMeasurement = () => true;
    h.context.observe([{ type: "characterData" }]);
    finish(phase === "settings" ? { exportFormats: ["md"] } : h.result);
    await pending;
    assert.equal(h.downloads.length, 0);
    assert.equal(events(h).findLast(e => e.event === "fresh-export-rejected").reason, "export-context-changed");
    assert.match(h.nodes[".export"].title, /바뀌|changed/);
    assert.equal(h.requests(), phase === "settings" ? 1 : 2);
  }
});

test("page returns do not reset an already started verification time budget", async () => {
  const h = harness();
  let clock = 1000, finish;
  h.context.Date = class extends Date { static now() { return clock; } };
  await finishAdmission(h);
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: false, reason: "synthetic-no-dom" });
  h.setExtract(() => new Promise(resolve => { finish = resolve; }));
  submitPrompt(h);
  h.runDelay(4000);
  h.runDelay(0);
  const pending = h.runDelay(0);
  await flushAsync();
  clock += 9000;
  h.windowHandlers.pageshow();
  h.windowHandlers.popstate();
  finish({ ...h.result, completion: { currentNodeStatus: "in_progress" } });
  await pending;
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeStatus: "in_progress" } }));
  for (let step = 0; step < 6 && !h.unverified(); step++) await h.runTimer();
  assert.equal(events(h).findLast(e => e.event === "response-candidate-rejected").terminationReason, "time-budget");
  assert.equal(h.unverified(), 1);
});

test("long emoji titles use well-formed matching names for single files and ZIP entries", async () => {
  for (const formats of [["json"], ["md", "json", "html"]]) {
    for (const includeDate of [true, false]) for (const includeTime of [true, false]) {
      const h = harness(formats, { filenameOptions: { includeDate, includeTime } });
      h.result.title = "a".repeat(79) + "😀";
      h.result.completion.currentNodeStatus = "in_progress";
      await h.click();
      const files = formats.length > 1 ? readZip(await h.blobs[0].arrayBuffer()) : [{ filename: h.downloads[0] }];
      for (const name of [h.downloads[0], ...files.map(file => file.filename)]) {
        assert.equal(name.isWellFormed(), true);
        assert.ok(name.startsWith("a".repeat(79) + "_"));
        assert.match(name, /_unchecked\.(json|md|html|zip)$/);
        assert.ok(!name.includes("\ufffd"));
      }
      if (formats.length > 1) {
        const zipBase = h.downloads[0].replace(/\.zip$/, "");
        for (const file of files) assert.equal(file.filename.replace(/\.(md|json|html)$/, ""), zipBase);
      }
    }
  }
});

for (const locale of ["ko-KR", "en-US", "fr-FR"]) {
  test(`${locale} keeps numeric usage, stored-checkpoint semantics and localized unchecked ZIP warnings`, async () => {
    const korean = locale.startsWith("ko");
    const h = harness(["md", "json", "html"], { locale });
    h.result.messages[0].text = "한국어 😀\n  user $1";
    h.result.messages[1].text = "English response\n\n```text\n원문 <literal>\n```";
    const original = JSON.stringify(h.result.messages);
    await finishAdmission(h);
    assert.equal(h.nodes[".measure"].dataset.state, "ready");
    assert.equal(h.nodes[".measure"].dataset.numeric, "true");
    const totals = h.context.Chatcouter.model.measureConversation(h.result.messages);
    assert.ok(h.nodes[".primary"].textContent.startsWith(String(totals.characters)));
    assert.ok(h.nodes[".primary"].textContent.endsWith(korean ? "자" : "chars"));
    h.nodes[".measure"].listeners.click();
    await flushAsync();
    assert.match(h.nodes[".measure"].title, korean ? /완료와 최신성은 미확인/ : /Completion and freshness.*unverified/);
    const meterValue = h.nodes[".primary"].textContent;
    const title = h.nodes[".measure"].title;
    h.setExtract(async () => ({ ...h.result, completion: { currentNodeRole: "tool" } }));
    await h.click();
    assert.equal(h.requests(), 3, "one admission, one manual checkpoint and one independent export");
    assert.match(h.downloads[0], /_unchecked\.zip$/);
    assert.equal(h.nodes[".primary"].textContent, meterValue);
    assert.equal(h.nodes[".measure"].title, title);
    assert.equal(h.unverified(), 0);
    const files = readZip(await h.blobs[0].arrayBuffer());
    const json = JSON.parse(files.find(file => file.filename.endsWith(".json")).contents);
    const html = files.find(file => file.filename.endsWith(".html")).contents;
    const md = files.find(file => file.filename.endsWith(".md")).contents;
    const warning = json.conversation.preservation.warning;
    assert.match(warning, korean ? /응답 완료와 최신성은 보장하지 않습니다/ : /Response completion and freshness are not guaranteed/);
    assert.equal(json.conversation.source, "server-stored-unverified");
    assert.equal(json.conversation.preservation.reason, "current-node-not-assistant");
    assert.equal(JSON.stringify(json.conversation.messages.map(({ text }) => text)),
      JSON.stringify(h.result.messages.map(({ text }) => text)));
    assert.ok(md.includes(warning));
    assert.ok(html.includes(warning));
    assert.ok(md.includes("## Prompt:"));
    assert.ok(md.includes(h.result.messages[0].text));
    assert.match(html, korean ? /<html lang="ko">/ : /<html lang="en">/);
    assert.ok(html.includes(korean ? "내보내기 정보" : "Export information"));
    assert.equal(JSON.stringify(h.result.messages), original);
  });
}

test("same-route return cancels checkpoints without extra queries, failure changes or late publication", async () => {
  for (const inputMode of [false, true]) for (const event of ["pageshow", "popstate"]) {
    for (const kind of ["manual", "automatic", "admission"]) {
      const h = harness(["md"], { inputMode });
      let submit;
      if (kind !== "admission") {
        if (!inputMode && kind === "automatic") submit = await enterBaselineRecovery(h);
        else await finishAdmission(h);
      }
      const previousValue = h.nodes[".primary"].textContent;
      const beforeCount = h.unverified();
      let finish, signal;
      h.setExtract(options => {
        signal = options.signal;
        return new Promise(resolve => { finish = resolve; });
      });
      if (kind === "admission") {
        // Default admission is ordinary measurement; exercise that separately.
        if (!inputMode) continue;
        await flushAsync();
        h.runDelay(0);
        h.runDelay(0); // Keep the admission request unresolved until the return.
      } else if (kind === "manual") h.nodes[".measure"].listeners.click();
      else (submit || (() => submitPrompt(h)))();
      const requests = h.requests();
      const published = publications(h);
      h.windowHandlers[event]();
      assert.equal(signal.aborted, true);
      assert.equal(h.nodes[".measure"].dataset.state, "error", `${inputMode}/${event}/${kind}`);
      assert.equal(h.nodes[".measure"].disabled, false);
      assert.equal(h.nodes[".primary"].textContent, kind === "admission" ? "확인 필요" : previousValue);
      assert.equal(h.unverified(), beforeCount);
      assert.equal(h.requests(), requests);
      assert.equal(h.timerCount(), 0);
      assert.equal(events(h).filter(e => e.event === "baseline-refresh-failed").length, 0);
      finish(h.result);
      await flushAsync();
      assert.equal(publications(h), published);
      h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true, messages: h.result.messages });
      h.setExtract(async () => h.result);
      await h.click();
      assert.equal(h.downloads.length, 1);
      h.runDelay(0); // Download URL cleanup is independent of measurement timers.
      h.nodes[".measure"].listeners.click();
      await flushAsync();
      assert.equal(h.nodes[".measure"].dataset.state, "ready");
      h.windowHandlers[event]();
      assert.equal(h.timerCount(), 0, "completed return does not add automatic lookup");
      const beforeInput = h.requests();
      submitPrompt(h);
      if (inputMode) await flushAsync();
      else {
        h.runDelay(4000);
        h.runDelay(0);
        await h.runDelay(0);
      }
      assert.equal(h.requests(), beforeInput + 1);
    }
  }
});

test("window navigation resets old checkpoint suppression and admits the new room once", async () => {
  for (const inputMode of [false, true]) for (const event of ["pageshow", "popstate"]) {
    for (const completed of [false, true]) {
      const h = harness(["md"], { inputMode });
      await finishAdmission(h);
      let finish, signal;
      if (!completed) h.setExtract(options => {
        signal = options.signal;
        return new Promise(resolve => { finish = resolve; });
      });
      h.nodes[".measure"].listeners.click();
      if (completed) await flushAsync();
      const published = publications(h);
      h.context.location.pathname = "/c/two";
      h.windowHandlers[event]();
      h.context.observe([]);
      if (!completed) {
        assert.equal(signal.aborted, true);
        finish(h.result);
        await flushAsync();
        assert.equal(publications(h), published);
      }
      h.setExtract(async () => ({ ...h.result, messages: [{ id: "u1", role: "user", text: "new room" }] }));
      h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: false });
      const requests = h.requests();
      await finishAdmission(h);
      assert.equal(h.requests(), requests + 1);
      assert.equal(h.nodes[".measure"].dataset.state, "ready");
      assert.equal(h.nodes[".primary"].textContent, "8자");
    }
  }
});

test("ordinary lookup returns and route transitions preserve admission and discard aborted data", async () => {
  for (const event of ["pageshow", "popstate"]) for (const sameRoute of [true, false]) {
    const h = harness();
    let finish, signal;
    h.setExtract(options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
    await flushAsync();
    h.runDelay(0);
    const oldLookup = h.runDelay(0);
    if (!sameRoute) h.context.location.pathname = "/c/two";
    h.windowHandlers[event]();
    assert.equal(signal.aborted, true);
    finish(h.result);
    await oldLookup;
    assert.equal(publications(h), 0);
    h.setExtract(async () => h.result);
    const requests = h.requests();
    await finishAdmission(h);
    assert.equal(h.requests(), requests + 1);
    assert.equal(h.nodes[".measure"].dataset.state, "ready");
  }
});

test("admission true/false/null keeps coverage, prior-room display and counter contracts", async () => {
  for (const inputMode of [false, true]) for (const entry of ["startup", "return", "route"]) {
    for (const coverage of [true, false, null]) {
      const h = harness(["md"], { inputMode });
      let oldValue;
      if (entry !== "startup") {
        await finishAdmission(h);
        oldValue = h.nodes[".primary"].textContent;
      }
      h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true, messages: coverage === null ? []
        : coverage ? h.result.messages : [...h.result.messages, { id: "u2", role: "user", text: "missing prompt" }] });
      const published = publications(h);
      const requests = h.requests();
      if (entry === "route") {
        h.context.location.pathname = "/c/two";
        h.context.observe([]);
      } else if (entry === "return") h.windowHandlers.pageshow();
      // A completed input checkpoint has no automatic return lookup.
      if (entry === "return" && inputMode) {
        assert.equal(h.requests(), requests);
        assert.equal(h.timerCount(), 0);
        continue;
      }
      await finishAdmission(h);
      assert.equal(h.requests(), requests + 1);
      assert.equal(h.timerCount(), 0);
      assert.equal(h.unverified(), 0);
      if (coverage === false) {
        assert.equal(publications(h), published);
        assert.equal(h.nodes[".measure"].dataset.state, "error");
        assert.equal(h.nodes[".primary"].textContent, entry === "return" ? oldValue : "확인 필요");
        assert.equal(events(h).findLast(e => e.event === "baseline-refresh-failed")?.recoveryFailureStreak ?? 0, 0);
        if (entry === "return" && !inputMode) {
          submitPrompt(h);
          assert.equal(events(h).findLast(e => e.event === "response-pending").baselineUserMessages, 1,
            "rejected admission cannot replace the trusted checkpoint with two visible users");
        }
      } else assert.equal(h.nodes[".measure"].dataset.state, "ready");
    }
  }
});

function pressEnter(h) {
  const composer = new h.Element();
  composer.value = "synthetic prompt";
  composer.closest = () => composer;
  h.handlers.keydown({ target: composer, key: "Enter", shiftKey: false, isComposing: false });
  composer.value = "";
  return composer;
}

const shortcut = (key, modifiers = {}) => ({ key, ctrlKey: false, altKey: false,
  shiftKey: false, metaKey: false, ...modifiers });

function pressTestKey(h, keyEvent, { before = "synthetic prompt", after = "" } = {}) {
  const composer = new h.Element();
  composer.value = before;
  composer.closest = () => composer;
  h.handlers.keydown({ target: composer, isComposing: false, ...keyEvent,
    preventDefault() { assert.fail("chat detection must not consume typing or send a message"); } });
  composer.value = after;
  return composer;
}

test("registered non-Enter and Shift combinations join the existing input flow in both refresh modes", async () => {
  for (const inputMode of [false, true]) for (const configured of [shortcut("\\"),
    shortcut("k", { ctrlKey: true, shiftKey: true }), shortcut("Enter", { shiftKey: true })]) {
    const h = harness(["md"], { inputMode, sendShortcut: configured });
    await finishAdmission(h);
    const startedBefore = events(h).filter(e => ["response-pending", "baseline-refresh-started"].includes(e.event)).length;
    pressTestKey(h, configured);
    h.runDelay(100);
    h.runDelay(150);
    await flushAsync();
    const started = events(h).filter(e => ["response-pending", "baseline-refresh-started"].includes(e.event)).slice(startedBefore);
    assert.equal(started.length, 1);
    assert.equal(started[0].trigger, inputMode ? "input-turn" : "custom-send-key");
    if (!inputMode) assert.equal(started[0].newTurn, true);
  }
});

test("registered keys ignore normal typing, changed modifiers, empty input, composition and repeats", async () => {
  for (const inputMode of [false, true]) {
    const h = harness(["md"], { inputMode, sendShortcut: shortcut("\\") });
    await finishAdmission(h);
    const count = events(h).filter(e => ["response-pending", "baseline-refresh-started"].includes(e.event)).length;
    for (const [event, values] of [[shortcut("\\"), { after: "synthetic prompt\\" }],
      [shortcut("\\"), { after: "\\" }], [shortcut("\\"), { before: "", after: "" }],
      [shortcut("\\", { ctrlKey: true }), {}], [shortcut("\\", { metaKey: true }), {}],
      [{ ...shortcut("\\"), isComposing: true }, {}], [{ ...shortcut("\\"), keyCode: 229 }, {}],
      [{ ...shortcut("\\"), repeat: true }, {}], [shortcut("Backspace"), {}], [shortcut("Delete"), {}]]) {
      pressTestKey(h, event, values);
      if (h.hasDelay(100)) h.runDelay(100);
      assert.equal(h.hasDelay(150), false);
    }
    const outside = new h.Element();
    h.handlers.keydown({ target: outside, ...shortcut("\\") });
    assert.equal(h.hasDelay(100), false);
    assert.equal(events(h).filter(e => ["response-pending", "baseline-refresh-started"].includes(e.event)).length, count);
    h.changeShortcut(null);
    pressTestKey(h, shortcut("\\"));
    assert.equal(h.hasDelay(100), false);
    pressEnter(h);
    h.runDelay(100);
    h.runDelay(150);
    await flushAsync();
    assert.equal(events(h).filter(e => ["response-pending", "baseline-refresh-started"].includes(e.event)).length, count + 1,
      "clearing the custom shortcut preserves the existing Enter detection");
  }
});

test("live shortcut changes beat a stale initial read and storage failure retains default Enter detection", async () => {
  let finish;
  const h = harness(["md"], { inputMode: true, shortcutRead: () => new Promise(resolve => { finish = resolve; }) });
  await finishAdmission(h);
  h.changeShortcut(shortcut("\\"), "sync");
  pressTestKey(h, shortcut("\\"));
  assert.equal(h.hasDelay(100), false);
  h.changeShortcut(shortcut("k", { altKey: true }));
  finish({ sendShortcut: shortcut("\\") });
  await flushAsync();
  pressTestKey(h, shortcut("\\"));
  assert.equal(h.hasDelay(100), false);
  const before = h.requests();
  pressTestKey(h, shortcut("K", { altKey: true }));
  h.runDelay(100);
  h.runDelay(150);
  await flushAsync();
  assert.equal(h.requests(), before + 1);
  h.changeShortcut({ ...shortcut("\\"), key: "Delete" });
  pressTestKey(h, shortcut("k", { altKey: true }));
  assert.equal(h.hasDelay(100), false);
  const failed = harness(["md"], { inputMode: true, shortcutRead: () => Promise.reject(new Error("synthetic storage failure")) });
  await finishAdmission(failed);
  assert.equal(events(failed).filter(e => e.event === "send-shortcut-settings-unavailable").length, 1);
  const count = failed.requests();
  pressEnter(failed);
  failed.runDelay(100);
  failed.runDelay(150);
  await flushAsync();
  assert.equal(failed.requests(), count + 1);
});

test("custom-key input cancels Export and preserves an in-flight input checkpoint", async () => {
  const h = harness(["md"], { inputMode: true, sendShortcut: shortcut("\\") });
  await finishAdmission(h);
  let finishExport;
  let exportSignal;
  h.setExtract(options => { exportSignal = options.signal; return new Promise(resolve => { finishExport = resolve; }); });
  const exporting = h.click();
  await flushAsync();
  h.setExtract(async () => h.result);
  pressTestKey(h, shortcut("\\"));
  h.runDelay(100);
  h.runDelay(150);
  await flushAsync();
  assert.equal(exportSignal.aborted, true);
  finishExport(h.result);
  await exporting;
  assert.equal(h.downloads.length, 0);
  let finishCheckpoint;
  let checkpointSignal;
  h.setExtract(options => { checkpointSignal = options.signal; return new Promise(resolve => { finishCheckpoint = resolve; }); });
  pressTestKey(h, shortcut("\\"));
  h.runDelay(100);
  h.runDelay(150);
  const requests = h.requests();
  pressTestKey(h, shortcut("\\"));
  h.runDelay(100);
  h.runDelay(150);
  assert.equal(checkpointSignal.aborted, false);
  assert.equal(h.requests(), requests);
  finishCheckpoint(h.result);
  await flushAsync();
});

test("UI host restoration only redraws presentation and never republishes a checkpoint", async () => {
  for (const inputMode of [false, true]) for (const exporting of [false, true]) {
    const h = harness(["md"], { inputMode });
    await finishAdmission(h);
    h.nodes[".measure"].listeners.click();
    await flushAsync();
    const title = h.nodes[".measure"].title;
    const value = h.nodes[".primary"].textContent;
    const published = publications(h);
    let finish;
    if (exporting) {
      h.setExtract(() => new Promise(resolve => { finish = resolve; }));
      h.click();
      await flushAsync();
    }
    const requestCount = h.requests();
    const countEvents = events(h).filter(e => e.event === "unverified-response-streak").length;
    h.context.document.host = null;
    h.context.observe([]);
    assert.equal(publications(h), published);
    assert.equal(events(h).filter(e => e.event === "unverified-response-streak").length, countEvents);
    assert.equal(h.requests(), requestCount);
    assert.equal(h.nodes[".primary"].textContent, value);
    assert.equal(h.nodes[".measure"].title, title);
    assert.equal(h.nodes[".export"].disabled, exporting);
    if (exporting) { finish(h.result); await flushAsync(); }
  }
});

test("keyboard fallback belongs to its route and composer and cannot duplicate submit", async () => {
  for (const inputMode of [false, true]) for (const key of ["Enter", "\\"])
    for (const transition of ["none", "before-100", "after-100", "submit", "detached", "unobserved"]) {
    const h = harness(["md"], { inputMode, sendShortcut: shortcut("\\") });
    await finishAdmission(h);
    const before = events(h).filter(e => e.event === "response-pending" || e.event === "baseline-refresh-started").length;
    const composer = key === "Enter" ? pressEnter(h) : pressTestKey(h, shortcut(key));
    if (transition === "before-100") {
      h.context.location.pathname = "/c/two";
      h.context.observe([]);
    } else if (transition === "submit") submitPrompt(h);
    else {
      if (transition === "detached") composer.isConnected = false;
      if (transition === "unobserved") h.context.location.pathname = "/c/two";
      h.runDelay(100);
      if (transition === "after-100") {
        h.context.location.pathname = "/c/two";
        h.context.observe([]);
      }
    }
    if (transition === "none") h.runDelay(150);
    await flushAsync();
    const started = events(h).filter(e => e.event === "response-pending" || e.event === "baseline-refresh-started").length - before;
    assert.equal(started, ["none", "submit"].includes(transition) ? 1 : 0, transition);
    if (!["none", "submit"].includes(transition)) assert.throws(() => h.runDelay(150));
  }
});

test("first chat ID via window events continues the actual keyboard turn once in both modes", async () => {
  for (const inputMode of [false, true]) for (const key of ["Enter", "\\"]) for (const event of ["pageshow", "popstate"]) {
    const h = harness(["md"], { inputMode, sendShortcut: shortcut("\\") });
    h.context.Chatcouter.chatGptApiAdapter.getConversationId = () => /^\/c\/(.+)/.exec(h.context.location.pathname)?.[1] || null;
    h.context.document.querySelector = () => ({});
    h.context.location.pathname = "/";
    h.context.observe([]);
    await flushAsync();
    assert.equal(h.timerCount(), 0);
    if (key === "Enter") pressEnter(h);
    else pressTestKey(h, shortcut(key));
    h.runDelay(100);
    h.runDelay(150);
    assert.equal(h.requests(), 0);
    h.context.location.pathname = "/c/new-room";
    h.windowHandlers[event]();
    h.context.observe([]);
    if (inputMode) await flushAsync();
    else {
      h.runDelay(4000);
      h.runDelay(0);
      await h.runDelay(0);
    }
    assert.equal(h.requests(), 1);
    assert.equal(h.nodes[".measure"].dataset.state, "ready");
    assert.equal(publications(h), 1);
  }
});

test("canceling an unavailable automatic checkpoint preserves both failure counts and the gray display", async () => {
  for (const inputMode of [false, true]) for (const event of ["pageshow", "popstate"]) {
    const h = harness(["md"], { inputMode });
    const submit = inputMode ? (() => submitPrompt(h)) : await enterBaselineRecovery(h);
    if (inputMode) await finishAdmission(h);
    h.setExtract(async () => ({ ok: false, reason: "synthetic-timeout" }));
    for (let i = 0; i < 3; i++) { submit(); await flushAsync(); }
    const count = h.unverified();
    let finish;
    h.setExtract(() => new Promise(resolve => { finish = resolve; }));
    submit();
    const requests = h.requests();
    h.windowHandlers[event]();
    assert.equal(h.requests(), requests);
    assert.equal(h.unverified(), count);
    assert.equal(h.nodes[".measure"].dataset.indicator, "unavailable");
    assert.equal(h.nodes[".measure"].disabled, false);
    assert.equal(events(h).findLast(e => e.event === "baseline-refresh-failed").recoveryFailureStreak, 3);
    finish(h.result);
    await flushAsync();
    assert.equal(h.nodes[".measure"].dataset.indicator, "unavailable");
    assert.equal(h.timerCount(), 0);
  }
});

test("canceled manual checkpoint without a prior value ends in attention and API failure retains DOM fallback", async () => {
  for (const inputMode of [false, true]) for (const event of ["pageshow", "popstate"]) {
    const h = harness(["md"], { inputMode });
    await flushAsync();
    let finish;
    h.setExtract(() => new Promise(resolve => { finish = resolve; }));
    h.nodes[".measure"].listeners.click();
    h.windowHandlers[event]();
    assert.equal(h.nodes[".primary"].textContent, "확인 필요");
    assert.equal(h.nodes[".measure"].dataset.indicator, "attention");
    assert.equal(h.timerCount(), 0);
    finish(h.result);
    await flushAsync();
    assert.equal(publications(h), 0);
  }
  const h = harness();
  h.setExtract(async () => ({ ok: false, reason: "synthetic-api-failure" }));
  await finishAdmission(h);
  assert.equal(h.nodes[".measure"].dataset.state, "fallback");
  assert.match(h.nodes[".primary"].textContent, /^화면 기준 /);
  assert.equal(h.unverified(), 0);
});

test("input mode reads admission and each input without waiting for completion or tracking later mutations", async () => {
  const h = harness(["md"], { inputMode: true });
  h.context.Chatcouter.chatGptDomAdapter.hasStreamingControl = () => true;
  h.setExtract(async () => ({ ...h.result, completion: { currentNodeRole: "tool" } }));
  await finishAdmission(h);
  assert.equal(h.requests(), 1);
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  assert.match(h.nodes[".measure"].title, /완료와 최신성은 미확인/);
  submitPrompt(h);
  await flushAsync();
  submitPrompt(h);
  await flushAsync();
  assert.equal(h.requests(), 3);
  assert.equal(h.timerCount(), 0);
  h.context.Chatcouter.chatGptDomAdapter.mutationsNeedMeasurement = () => true;
  h.context.Chatcouter.chatGptDomAdapter.mutationsTouchActionControls = () => true;
  h.context.observe([]);
  assert.equal(h.timerCount(), 0);
  const events = h.logs.map(([, text]) => JSON.parse(text));
  assert.equal(events.filter(e => e.event === "response-pending").length, 0);
  assert.equal(events.filter(e => e.event === "baseline-refresh-started" && e.trigger === "input-turn").length, 2);
  assert.equal(events.findLast(e => e.event === "snapshot-published").scope, "server-stored-unverified");
});

test("input mode keeps one in-flight checkpoint across further inputs and applies a changed mode on later work", async () => {
  const h = harness(["md"], { inputMode: true });
  await finishAdmission(h);
  let finish;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  submitPrompt(h);
  assert.equal(h.nodes[".measure"].dataset.indicator, "busy");
  submitPrompt(h);
  h.changeMode(false);
  submitPrompt(h);
  h.nodes[".measure"].listeners.click();
  assert.equal(h.requests(), 2);
  assert.equal(signal.aborted, false);
  finish(h.result);
  await flushAsync();
  assert.equal(h.timerCount(), 0);
  submitPrompt(h);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "response-pending").trigger, "submit");
  assert.equal(h.timerCount(), 1);
});

test("switching to input mode cancels old completion work on the next input and ignores unrelated preference changes", async () => {
  const h = harness();
  await finishAdmission(h);
  submitPrompt(h);
  h.changeMode(true, "sync");
  h.changeMode(true);
  assert.equal(h.timerCount(), 1, "current response still has its completion timer");
  const eventsBefore = h.logs.map(([, text]) => JSON.parse(text));
  assert.equal(eventsBefore.filter(e => e.event === "baseline-refresh-started").length, 0);
  submitPrompt(h);
  await flushAsync();
  assert.equal(h.timerCount(), 0);
  assert.equal(h.requests(), 2);
  assert.equal(h.unverified(), 0, "mode change does not count cancellation as failure");
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "baseline-refresh-started").trigger, "input-turn");
});

test("input mode goes yellow then unavailable after three automatic failures and remains off until a successful input", async () => {
  const h = harness(["md"], { inputMode: true });
  await finishAdmission(h);
  const value = h.nodes[".primary"].textContent;
  h.setExtract(async () => ({ ok: false, reason: "synthetic-timeout" }));
  for (let i = 1; i <= 3; i++) {
    submitPrompt(h);
    await flushAsync();
    assert.equal(h.nodes[".measure"].dataset.indicator, i < 3 ? "attention" : "unavailable");
    assert.equal(h.nodes[".primary"].textContent, value);
    assert.equal(h.timerCount(), 0);
  }
  assert.match(h.nodes[".measure"].title, /다음 메시지.*서버 저장분을 다시 조회/);
  h.nodes[".measure"].listeners.click();
  await flushAsync();
  const failed = h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "baseline-refresh-failed");
  assert.equal(failed.recoveryFailureStreak, 3, "manual failure does not add to automatic failures");
  let finish;
  h.setExtract(() => new Promise(resolve => { finish = resolve; }));
  submitPrompt(h);
  assert.equal(h.nodes[".measure"].dataset.indicator, "unavailable");
  finish(h.result);
  await flushAsync();
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
  assert.equal(h.unverified(), 0);
  h.setExtract(async () => ({ ok: false, reason: "synthetic-timeout" }));
  submitPrompt(h);
  await flushAsync();
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "baseline-refresh-failed").recoveryFailureStreak, 1);
});

test("input mode treats admission failure separately and still rejects snapshots missing the captured user", async () => {
  const h = harness(["md"], { inputMode: true });
  h.setExtract(async () => ({ ok: false, reason: "synthetic-timeout" }));
  await finishAdmission(h);
  assert.equal(h.timerCount(), 0);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "baseline-refresh-failed").recoveryFailureStreak, 0);
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: true,
    messages: [{ id: "not-stored-yet", role: "user", text: "synthetic missing prompt" }] });
  h.setExtract(async () => h.result);
  submitPrompt(h);
  await flushAsync();
  const failed = h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "baseline-refresh-failed");
  assert.equal(failed.reason, "api-user-tail-behind-dom");
  assert.equal(failed.recoveryFailureStreak, 1);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(e => e.event === "snapshot-published").length, 0);
});

test("input mode waits for a new chat ID once and does not start a response completion cycle", async () => {
  const h = harness(["md"], { inputMode: true });
  h.context.Chatcouter.chatGptApiAdapter.getConversationId = () => /^\/c\/(.+)/.exec(h.context.location.pathname)?.[1] || null;
  h.context.document.querySelector = () => ({});
  h.context.location.pathname = "/";
  h.context.observe([]);
  await flushAsync();
  submitPrompt(h);
  assert.equal(h.requests(), 0);
  assert.equal(h.timerCount(), 0);
  h.context.location.pathname = "/c/new-room";
  h.context.observe([]);
  await flushAsync();
  h.context.observe([]);
  assert.equal(h.requests(), 1);
  assert.equal(h.timerCount(), 0);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(e => e.event === "response-pending").length, 0);
});

test("navigation cancels an input checkpoint and a late result cannot replace the new room admission", async () => {
  const h = harness(["md"], { inputMode: true });
  await finishAdmission(h);
  let finish;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  submitPrompt(h);
  h.context.location.pathname = "/c/two";
  h.context.observe([]);
  assert.equal(signal.aborted, true);
  const published = h.logs.map(([, text]) => JSON.parse(text)).filter(e => e.event === "snapshot-published").length;
  finish(h.result);
  await flushAsync();
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(e => e.event === "snapshot-published").length, published);
  h.setExtract(async () => h.result);
  h.runTimer();
  await h.runTimer();
  assert.equal(h.nodes[".measure"].dataset.indicator, "ready");
});

test("input checkpoint and Export preempt each other without altering counts or accepting canceled snapshots", async () => {
  const h = harness(["html"], { inputMode: true });
  await finishAdmission(h);
  const value = h.nodes[".primary"].textContent;
  let finish;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  submitPrompt(h);
  h.setExtract(async () => h.result);
  await h.click();
  assert.equal(signal.aborted, true);
  assert.equal(h.downloads.length, 1);
  finish(h.result);
  await flushAsync();
  assert.equal(h.nodes[".primary"].textContent, value);
  assert.equal(h.unverified(), 0);
  const pendingExport = h.click();
  submitPrompt(h);
  await pendingExport;
  await flushAsync();
  assert.equal(h.downloads.length, 1, "new input cancels Export even while preferences are being read");
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(e => e.event === "baseline-refresh-failed").length, 0);
});

test("settings load gates initial lookup, preserves a newer preference notification and does not block Export", async () => {
  let finishSettings;
  const h = harness(["md"], { modeRead: () => new Promise(resolve => { finishSettings = resolve; }) });
  h.runTimer();
  const admission = h.runTimer();
  assert.equal(h.requests(), 0);
  h.changeMode(true);
  await h.click();
  assert.equal(h.downloads.length, 1);
  finishSettings({ updateOnUserInput: false });
  await admission;
  for (let i = 0; i < 5 && h.timerCount(); i++) await h.runTimer();
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "baseline-refresh-started").trigger, "admission");
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).filter(e => e.event === "response-pending").length, 0);
});

test("unavailable mode storage defaults to the existing response mode", async () => {
  const h = harness(["md"], { modeRead: () => Promise.reject(new Error("synthetic storage failure")) });
  await finishAdmission(h);
  submitPrompt(h);
  assert.equal(h.logs.map(([, text]) => JSON.parse(text)).findLast(e => e.event === "response-pending").trigger, "submit");
});

test("an admission retry from an old room cannot cancel or duplicate the new room lookup", async () => {
  const h = harness();
  h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: false, reason: "synthetic-no-dom" });
  h.setExtract(async () => ({ ok: false, reason: "synthetic-failure" }));
  await finishAdmission(h);
  assert.equal(h.timerCount(), 1);
  h.context.location.pathname = "/c/two";
  h.context.observe([]);
  let finish;
  let signal;
  h.setExtract(options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  h.runTimer();
  const admission = h.runTimer();
  assert.equal(h.requests(), 2);
  assert.equal(signal.aborted, false);
  assert.equal(h.timerCount(), 0, "old retry was canceled rather than left to restart this request");
  finish(h.result);
  await admission;
});

test("verification diagnostics distinguish network time budget from retry limit and identify observation endings", async () => {
  for (const delay of [0, 9000]) {
    const h = harness();
    let clock = 1000;
    h.context.Date = class extends Date {
      static now() { return clock; }
    };
    await finishAdmission(h);
    h.context.Chatcouter.chatGptDomAdapter.extract = () => ({ ok: false, reason: "synthetic-no-dom" });
    h.setExtract(async () => {
      clock += delay;
      return { ...h.result, completion: { currentNodeStatus: "in_progress" } };
    });
    submitPrompt(h);
    for (let step = 0; step < 12 && !h.unverified(); step++) await h.runTimer();
    const events = h.logs.map(([, text]) => JSON.parse(text));
    const rejected = events.findLast(e => e.event === "response-candidate-rejected");
    assert.equal(rejected.terminationReason, delay ? "time-budget" : "retry-limit");
    assert.equal(rejected.retry, delay ? 1 : 3);
    assert.equal(rejected.elapsedMs, delay);
    assert.equal(events.findLast(e => e.event === "response-complete").operation, "response-observation");
    assert.equal(h.unverified(), 1);
  }
});

test("shared MD/HTML display cleanup in a three-format Export preserves JSON, original totals and unchecked notices in both locales", async () => {
  for (const locale of ["ko", "en"]) {
    const h = harness(["md", "json", "html"], { locale });
    await flushAsync();
    const marker = '\uE200filecite\uE202synthetic-file\uE201';
    const source = ':::writing{variant="document" title="Synthetic"}\nBody ' + marker + '\n:::';
    h.result.messages[1].text = source;
    h.result.completion = { currentNodeStatus: "in_progress" };
    const before = JSON.stringify(h.result.messages);
    const totals = h.context.Chatcouter.model.measureConversation(h.result.messages);
    const label = h.context.Chatcouter.i18n.t("annotation_file");
    await h.click();
    assert.equal(h.requests(), 1);
    assert.equal(h.downloads.length, 1);
    const entries = readZip(await h.blobs[0].arrayBuffer());
    const md = entries.find(entry => entry.filename.endsWith(".md")).contents;
    const html = entries.find(entry => entry.filename.endsWith(".html")).contents;
    const json = JSON.parse(entries.find(entry => entry.filename.endsWith(".json")).contents);
    assert.ok(!md.includes(':::writing')); assert.ok(!md.includes(marker));
    assert.ok(md.includes(label.slice(1, -1)));
    assert.ok(html.includes('class="writing-card"')); assert.ok(html.includes(label));
    assert.equal(json.conversation.messages[1].text, source);
    assert.deepEqual(json.conversation.totals, JSON.parse(JSON.stringify(totals)));
    assert.ok(md.includes(totals.characters + " characters, " + totals.utf8Bytes + " UTF-8 bytes"));
    const notice = json.conversation.preservation.warning;
    assert.ok(md.includes(notice)); assert.ok(html.includes(notice));
    assert.equal(JSON.stringify(h.result.messages), before);
    assert.equal(h.unverified(), 0);
    assert.ok(entries.every(entry => entry.filename.includes('_unchecked')));
  }
});
