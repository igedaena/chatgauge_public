(function registerViewBackground(global) {
  "use strict";
  const api = global.browser || global.chrome;
  const VIEWER = api.runtime.getURL("src/viewer/viewer.html");
  // Only unacknowledged transfers live here. Displayed tabs are never tracked.
  const pending = new Map();
  const removeTab = id => { if (Number.isInteger(id)) api.tabs.remove(id).catch(() => {}); };
  const post = (port, message) => { try { port.postMessage(message); return true; } catch { return false; } };
  function finish(request, result) {
    if (request.done) return;
    request.done = true;
    pending.delete(request.token);
    global.clearTimeout(request.timer);
    request.html = null;
    if (result.ok) post(request.viewer, { type: "accepted" });
    post(request.source, result);
    if (!result.ok) removeTab(request.tabId);
    if (!result.ok) try { request.viewer?.disconnect(); } catch { /* Already disconnected. */ }
  }
  function sourceAllowed(sender) {
    if (sender?.id !== api.runtime.id || !Number.isInteger(sender.tab?.id)) return false;
    try { const url = new URL(sender.url); return url.protocol === "https:" && ["chatgpt.com", "chat.openai.com"].includes(url.hostname); }
    catch { return false; }
  }
  api.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "chatgauge-open-options") return undefined;
    if (!sourceAllowed(sender)) return Promise.resolve({ ok: false, reason: "options-source-rejected" });
    // Keep the standard options-page lifecycle under browser ownership.
    return Promise.resolve().then(() => api.runtime.openOptionsPage()).then(
      () => ({ ok: true }), () => ({ ok: false, reason: "options-open-failed" }));
  });
  api.runtime.onConnect.addListener(port => {
    if (port.name === "chatgauge-view") {
      if (!sourceAllowed(port.sender)) return port.disconnect();
      let request, started = false, disconnected = false;
      port.onDisconnect.addListener(() => { disconnected = true; if (request) finish(request, { ok: false, reason: "view-cancelled" }); });
      port.onMessage.addListener(message => {
        if (started || disconnected) return;
        started = true;
        if (message?.type !== "open" || typeof message.html !== "string" || !message.html.trim()) {
          post(port, { ok: false, reason: "view-invalid-html" }); return;
        }
        request = { token: global.crypto.randomUUID(), html: message.html, source: port, tabId: null, viewer: null, done: false };
        pending.set(request.token, request);
        request.timer = global.setTimeout(() => finish(request, { ok: false, reason: "view-display-timeout" }), 10000);
        // Create can resolve after cancellation. In that case close only this newly created tab.
        try {
          request.created = api.tabs.create({ url: `${VIEWER}#${request.token}`, active: true, windowId: port.sender.tab.windowId });
        } catch { return finish(request, { ok: false, reason: "view-tab-create-failed" }); }
        request.created.then(tab => {
          request.tabId = tab.id;
          if (request.done) removeTab(tab.id);
        }, () => finish(request, { ok: false, reason: "view-tab-create-failed" }));
      });
    } else if (port.name === "chatgauge-viewer") {
      let url;
      try { url = new URL(port.sender?.url); } catch { return port.disconnect(); }
      if (port.sender.id !== api.runtime.id || url.href.split("#")[0] !== VIEWER || !Number.isInteger(port.sender.tab?.id)) return port.disconnect();
      const request = pending.get(url.hash.slice(1));
      if (!request || request.done) return port.disconnect();
      let disconnected = false, ready = false;
      port.onDisconnect.addListener(() => {
        disconnected = true;
        if (request.viewer === port) finish(request, { ok: false, reason: "view-transfer-failed" });
      });
      port.onMessage.addListener(message => {
        if (message?.type === "ready" && !ready) {
          ready = true;
          request.created.then(tab => {
            if (disconnected || request.done || pending.get(request.token) !== request || request.viewer) return port.disconnect();
            // Token alone is insufficient: the browser-created tab must own the receiver.
            if (tab.id !== port.sender.tab.id) return port.disconnect();
            request.viewer = port;
            if (!post(port, { type: "document", html: request.html })) return finish(request, { ok: false, reason: "view-transfer-failed" });
            request.html = null;
          }, () => { try { port.disconnect(); } catch {} });
        } else if (request.viewer === port && !request.done) {
          if (message?.type === "displayed") finish(request, { ok: true });
          else if (message?.type === "failed") finish(request, { ok: false, reason: "view-display-failed" });
        }
      });
    }
  });
  api.tabs.onRemoved.addListener(id => {
    for (const request of pending.values()) if (request.tabId === id) finish(request, { ok: false, reason: "view-tab-closed" });
  });
  api.runtime.onSuspend?.addListener(() => {
    for (const request of pending.values()) finish(request, { ok: false, reason: "view-connection-failed" });
  });
})(globalThis);
