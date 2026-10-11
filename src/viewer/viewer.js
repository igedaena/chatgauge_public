(function displayDocument(global) {
  "use strict";
  const { t, locale } = global.Chatcouter.i18n;
  const api = global.browser || global.chrome;
  const notice = global.document.getElementById("notice");
  global.document.documentElement.lang = locale();
  global.document.title = t("view_page_title");
  notice.textContent = t("view_again_hint");
  if (!/^#[\da-f-]{36}$/i.test(global.location.hash)) return;
  let port, frame, displayed = false, received = false, finished = false, disconnected = false;
  const finish = success => {
    if (finished) return;
    finished = true;
    global.clearTimeout(timer);
    global.history.replaceState(null, "", global.location.pathname);
    if (!success) { frame?.remove(); notice.hidden = false; notice.textContent = t("view_again_hint"); }
    if (!disconnected) try { port?.disconnect(); } catch { /* Already disconnected. */ }
  };
  const timer = global.setTimeout(() => finish(false), 15000);
  notice.textContent = t("expand_preparing");
  try {
    port = api.runtime.connect({ name: "chatgauge-viewer" });
    port.onDisconnect.addListener(() => { disconnected = true; if (!finished) finish(false); });
    port.onMessage.addListener(message => {
      if (finished) return;
      if (message?.type === "accepted" && displayed) return finish(true);
      if (message?.type !== "document" || received || typeof message.html !== "string") return;
      received = true;
      try {
        // Remove the token only after the browser has identified this receiver.
        global.history.replaceState(null, "", global.location.pathname);
        global.document.title = new global.DOMParser().parseFromString(message.html, "text/html").title || t("view_page_title");
        frame = global.document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
        frame.title = t("view_document_label");
        frame.addEventListener("load", () => {
          if (finished || displayed) return;
          displayed = true;
          notice.hidden = true;
          try { port.postMessage({ type: "displayed" }); } catch { finish(false); }
        }, { once: true });
        frame.srcdoc = message.html;
        global.document.body.append(frame);
      } catch { port.postMessage({ type: "failed" }); finish(false); }
    });
    port.postMessage({ type: "ready" });
  } catch { finish(false); }
})(globalThis);
