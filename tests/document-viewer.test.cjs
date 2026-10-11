"use strict";
const assert = require("node:assert/strict"), test = require("node:test"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = file => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => { for (const fn of [...listeners]) fn(...args); }, request: (...args) => [...listeners][0]?.(...args) }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness({ delayed = false, createFailure = false, sender } = {}) {
  const runtime = { id: "synthetic-extension", onConnect: event(), onMessage: event(), onSuspend: event(), getURL: file => `moz-extension://synthetic/${file}`, openOptionsPage: async () => {} };
  const timers = new Map(); let nextTimer = 0, nextTab = 100, nextToken = 0;
  const clock = { setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
  const tabs = { onRemoved: event(), created: [], removed: [], create(options) {
    if (createFailure === "throw") throw Error("creation failure");
    if (createFailure) return Promise.reject(Error("creation failure"));
    const row = { id: nextTab++, options }; this.created.push(row);
    return delayed ? new Promise(resolve => { row.complete = () => resolve({ id: row.id }); }) : Promise.resolve({ id: row.id });
  }, remove(id) { this.removed.push(id); queueMicrotask(() => this.onRemoved.emit(id)); return Promise.resolve(); } };
  function connect(name, sender) {
    const client = { name, onMessage: event(), onDisconnect: event() }, server = { name, sender, onMessage: event(), onDisconnect: event() };
    let closed = false;
    for (const [a, b] of [[client, server], [server, client]]) {
      a.postMessage = message => { if (closed) throw Error("disconnected"); queueMicrotask(() => { if (!closed) b.onMessage.emit(message); }); };
      a.disconnect = () => { if (closed) return; closed = true; queueMicrotask(() => { client.onDisconnect.emit(); server.onDisconnect.emit(); }); };
    }
    queueMicrotask(() => runtime.onConnect.emit(server)); return client;
  }
  const background = vm.createContext({ browser: { runtime, tabs }, URL, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextToken).padStart(12, "0")}` }, ...clock });
  vm.runInContext(source("view-background.js").replace("const pending = new Map();", "const pending = global.pendingForTest = new Map();"), background);
  const content = vm.createContext({ browser: { runtime: { connect: ({ name }) => connect(name, sender || { id: runtime.id, tab: { id: 1, windowId: 4 }, url: "https://chatgpt.com/c/synthetic" }) } }, ...clock });
  vm.runInContext(source("document-viewer.js"), content);
  function viewer(row = tabs.created.at(-1), overrides = {}) {
    const port = connect("chatgauge-viewer", { id: runtime.id, tab: { id: row.id }, url: row.options.url, ...overrides });
    const documents = []; port.onMessage.addListener(message => { if (message.type === "document") documents.push(message.html); });
    port.postMessage({ type: "ready" }); return { port, documents };
  }
  return { open: content.Chatcouter.documentViewer.open, viewer, tabs, runtime, timers, pending: background.pendingForTest,
    timeout: () => { for (const [id, row] of [...timers]) if (row.ms === 10000) { timers.delete(id); row.fn(); } } };
}

test("options messages validate the source and use the browser API without disturbing a pending viewer", async () => {
  const h = harness(); let opened = 0;
  h.runtime.openOptionsPage = async () => { opened++; };
  const sender = { id: h.runtime.id, tab: { id: 1 }, url: "https://chatgpt.com/" };
  assert.equal(h.runtime.onMessage.request({ type: "other" }, sender), undefined);
  for (const overrides of [{ id: "other" }, { tab: undefined }, { url: "http://chatgpt.com/" },
    { url: "https://example.org/" }, { url: "moz-extension://synthetic/src/options/options.html" }]) {
    assert.equal((await h.runtime.onMessage.request({ type: "chatgauge-open-options" }, { ...sender, ...overrides })).ok, false);
  }
  assert.equal(opened, 0);
  const controller = new AbortController();
  const view = h.open({ html: "synthetic pending", signal: controller.signal }); await flush();
  for (const url of ["https://chatgpt.com/", "https://chat.openai.com/"]) {
    assert.equal((await h.runtime.onMessage.request({ type: "chatgauge-open-options" }, { ...sender, url })).ok, true);
  }
  assert.equal(opened, 2); assert.equal(h.pending.size, 1); assert.equal(h.tabs.created.length, 1);
  for (const fail of [() => Promise.reject(Error("failed")), () => { throw Error("failed"); }]) {
    h.runtime.openOptionsPage = fail;
    assert.equal((await h.runtime.onMessage.request({ type: "chatgauge-open-options" }, sender)).reason, "options-open-failed");
  }
  assert.equal(h.pending.size, 1);
  controller.abort(); await view;
});

test("each open creates a fresh tab and success requires owned receiver display ACK; success releases HTML/timers and ignores later abort", async () => {
  const h = harness(), abort = new AbortController();
  const first = h.open({ html: "<p>Synthetic first</p>", signal: abort.signal }); await flush();
  assert.equal(h.tabs.created.length, 1); assert.equal(h.tabs.created[0].options.active, true);
  const receiver = h.viewer(); await flush();
  assert.deepEqual(receiver.documents, ["<p>Synthetic first</p>"]);
  assert.equal([...h.pending.values()][0].html, null); // transferred, not cached
  assert.equal(h.pending.size, 1); // not yet acknowledged
  receiver.port.postMessage({ type: "displayed" }); await flush(); assert.equal((await first).ok, true);
  assert.equal(h.pending.size, 0); assert.equal(h.timers.size, 0);
  abort.abort(); await flush(); assert.deepEqual(h.tabs.removed, []);
  const replay = h.viewer(); await flush(); assert.deepEqual(replay.documents, []);
  const second = h.open({ html: "<p>Synthetic second</p>" }); await flush();
  assert.equal(h.tabs.created.length, 2); assert.notEqual(h.tabs.created[0].options.url, h.tabs.created[1].options.url);
  h.timeout(); await flush(); assert.equal((await second).reason, "view-display-timeout"); assert.equal(h.pending.size, 0);
});

test("token alone cannot claim a transfer: extension, source origin, receiver page and tab ownership are enforced", async () => {
  for (const sender of [
    { id: "other", tab: { id: 1 }, url: "https://chatgpt.com/c/synthetic" },
    { id: "synthetic-extension", tab: { id: 1 }, url: "https://example.com/" },
    { id: "synthetic-extension", url: "https://chatgpt.com/" },
  ]) { const h = harness({ sender }); const outcome = h.open({ html: "private synthetic" }); await flush(); assert.equal((await outcome).reason, "view-connection-failed"); assert.equal(h.tabs.created.length, 0); }
  const h = harness(), outcome = h.open({ html: "owned synthetic" }); await flush();
  for (const overrides of [{ id: "other" }, { tab: { id: 999 } }, { url: "moz-extension://synthetic/src/options/options.html" }]) {
    const wrong = h.viewer(undefined, overrides); await flush(); assert.deepEqual(wrong.documents, []); assert.equal(h.pending.size, 1);
  }
  const right = h.viewer(); await flush(); assert.deepEqual(right.documents, ["owned synthetic"]);
  right.port.postMessage({ type: "displayed" }); await flush(); assert.equal((await outcome).ok, true);
});

test("cancel before/after late create or after delivery closes only the unfinished new tab and late ACK cannot succeed", async () => {
  const early = harness(), already = new AbortController(); already.abort();
  assert.equal((await early.open({ html: "synthetic", signal: already.signal })).reason, "view-cancelled"); assert.equal(early.tabs.created.length, 0);
  const h = harness({ delayed: true }), controller = new AbortController();
  const outcome = h.open({ html: "late synthetic", signal: controller.signal }); await flush(); controller.abort(); await flush();
  assert.equal((await outcome).reason, "view-cancelled"); assert.equal(h.pending.size, 0); assert.equal(h.timers.size, 0);
  h.tabs.created[0].complete(); await flush(); assert.deepEqual(h.tabs.removed, [100]);
  const lateReceiver = h.viewer(); await flush(); assert.deepEqual(lateReceiver.documents, []);
  const after = harness(), cancel = new AbortController(), result = after.open({ html: "delivered synthetic", signal: cancel.signal }); await flush();
  const receiver = after.viewer(); await flush(); cancel.abort(); receiver.port.postMessage({ type: "displayed" }); await flush();
  assert.equal((await result).reason, "view-cancelled"); assert.deepEqual(after.tabs.removed, [100]); assert.equal(after.pending.size, 0);
});

test("creation errors, closed tabs, lost receivers, suspend and timeout have distinct bounded failures and cleanup", async () => {
  for (const createFailure of [true, "throw"]) { const h = harness({ createFailure }), result = h.open({ html: "synthetic" }); await flush(); assert.equal((await result).reason, "view-tab-create-failed"); assert.equal(h.pending.size, 0); assert.equal(h.timers.size, 0); }
  for (const mode of ["closed", "receiver", "suspend", "timeout", "display"]) {
    const h = harness(), result = h.open({ html: "synthetic" }); await flush();
    if (mode === "closed") h.tabs.onRemoved.emit(100);
    if (mode === "receiver" || mode === "display") { const r = h.viewer(); await flush(); mode === "receiver" ? r.port.disconnect() : r.port.postMessage({ type: "failed" }); }
    if (mode === "suspend") h.runtime.onSuspend.emit();
    if (mode === "timeout") h.timeout();
    await flush(); const reason = (await result).reason;
    assert.equal(reason, { closed: "view-tab-closed", receiver: "view-transfer-failed", suspend: "view-connection-failed", timeout: "view-display-timeout", display: "view-display-failed" }[mode]);
    assert.equal(h.pending.size, 0); assert.equal(h.timers.size, 0); assert.deepEqual(h.tabs.removed, [100]);
  }
  const h = harness({ delayed: true }), result = h.open({ html: "late timeout" }); await flush(); h.timeout(); await flush();
  assert.equal((await result).reason, "view-display-timeout"); h.tabs.created[0].complete(); await flush(); assert.deepEqual(h.tabs.removed, [100]);
});

test("viewer requires accepted ACK, removes an unaccepted frame on disconnect and reload has no replay or connection", () => {
  const i18n = require("./helpers/i18n.cjs");
  for (const accept of [false, true, "reload", "late-load", "late-throw"]) {
    const port = { onMessage: event(), onDisconnect: event(), sent: [], postMessage(m) { if (accept === "late-throw" && m.type === "displayed") throw Error("closed port"); this.sent.push(m); }, disconnect() {} };
    const notice = {}, frames = [], timers = new Map(); let connected = 0, replaced = 0;
    const context = vm.createContext({ browser: { i18n: i18n("en"), runtime: { connect: () => { connected++; return port; } } },
      location: { hash: accept === "reload" ? "" : "#00000000-0000-4000-8000-000000000001", pathname: "/src/viewer/viewer.html" },
      history: { replaceState() { replaced++; } }, document: { title: "", documentElement: {}, getElementById: () => notice,
        createElement: () => ({ setAttribute(k, v) { this[k] = v; }, addEventListener(k, fn) { this.load = fn; }, remove() { this.removed = true; } }), body: { append: frame => frames.push(frame) } },
      DOMParser: class { parseFromString() { return { title: "Synthetic" }; } }, setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) });
    vm.runInContext(source("i18n.js"), context); vm.runInContext(source("viewer/viewer.js"), context);
    if (accept === "reload") { assert.equal(connected, 0); assert.equal(frames.length, 0); assert.match(notice.textContent, /open it again/); continue; }
    port.onMessage.emit({ type: "document", html: "synthetic html" }); assert.equal(frames.length, 1);
    assert.equal(frames[0].sandbox, "allow-popups allow-popups-to-escape-sandbox");
    if (accept === "late-load") port.onDisconnect.emit();
    frames[0].load();
    if (accept === "late-load" || accept === "late-throw") { assert.equal(frames[0].removed, true); assert.equal(timers.size, 0); continue; }
    assert.equal(port.sent.at(-1).type, "displayed");
    if (accept) port.onMessage.emit({ type: "accepted" });
    port.onDisconnect.emit(); assert.equal(Boolean(frames[0].removed), !accept); assert.equal(timers.size, 0); assert.ok(replaced > 0);
  }
});
