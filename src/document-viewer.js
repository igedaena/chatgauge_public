(function registerDocumentViewer(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const api = global.browser || global.chrome;

  function open({ html, signal }) {
    if (typeof html !== "string" || !html.trim()) return Promise.resolve({ ok: false, reason: "view-invalid-html" });
    if (signal?.aborted) return Promise.resolve({ ok: false, reason: "view-cancelled" });
    return new Promise(resolve => {
      let port, finished = false, timer;
      const finish = result => {
        if (finished) return;
        finished = true;
        global.clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        port?.onMessage.removeListener(onMessage);
        port?.onDisconnect.removeListener(disconnected);
        try { port?.disconnect(); } catch { /* Already disconnected. */ }
        resolve(result);
      };
      const cancel = () => finish({ ok: false, reason: "view-cancelled" });
      const disconnected = () => finish({ ok: false, reason: "view-connection-failed" });
      const onMessage = result => {
        if (typeof result?.ok === "boolean" && (result.ok || typeof result.reason === "string")) finish(result);
      };
      try {
        port = api.runtime.connect({ name: "chatgauge-view" });
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(disconnected);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) return cancel();
        timer = global.setTimeout(() => finish({ ok: false, reason: "view-display-timeout" }), 15000);
        port.postMessage({ type: "open", html });
      } catch { finish({ ok: false, reason: "view-connection-failed" }); }
    });
  }
  namespace.documentViewer = Object.freeze({ open });
})(globalThis);
