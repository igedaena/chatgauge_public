(function registerMeterUi(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { t } = namespace.i18n;
  const HOST_ID = "chatcouter-root";

  function compactCharacters(text) {
    // ko/en use comma-grouped digits. Keep the on-screen scope prefix intact.
    return String(text).replace(/\d[\d,]*/, number => Number(number.replaceAll(",", "")) >= 10000000 ? "10M+" : number);
  }

  function measureView({ pageKind, conversationId, state, display, title, lastMeasuredDisplay,
    exportBusy, recoveryFailureStreak, baselineFailureThreshold, unverifiedResponseStreak,
    automaticRecoveryThreshold, updateOnUserInput, expandBusy = false }) {
    const loading = state === "loading";
    const busy = exportBusy || expandBusy || loading;
    const indicator = recoveryFailureStreak >= baselineFailureThreshold ? "unavailable" : busy ? "busy"
      : unverifiedResponseStreak > 0 || ["fallback", "error"].includes(state)
        ? "attention" : state === "ready" ? "ready" : "idle";
    const exportDisplay = lastMeasuredDisplay?.conversationId === conversationId
      ? lastMeasuredDisplay : { primary: t("usage_unverified"), secondary: "" };
    const shown = exportBusy ? exportDisplay : display;
    const hideUsage = loading && !exportBusy;
    const primary = hideUsage ? t("measuring") : shown.primary;
    const secondary = hideUsage ? "" : shown.secondary;
    if (indicator === "unavailable") {
      title = t("unavailable_title", title);
    }
    if (!busy && ["attention", "unavailable"].includes(indicator)) {
      const recoveryHint = updateOnUserInput
        ? t("input_recovery_hint")
        : unverifiedResponseStreak >= automaticRecoveryThreshold
        ? t("automatic_recovery_hint")
        : t("next_verification_hint");
      title = `${title} · ${recoveryHint} ${t("manual_recovery_hint")}`;
    }
    return { primary, secondary, title, indicator, numeric: !hideUsage && shown.charactersText !== undefined, charactersText: shown.charactersText,
      mode: pageKind === "conversation" ? "active" : "idle" };
  }

  // onExpand is optional until the caller connects the document-opening action.
  function create({ document, window, getComposer, onMeasure, onExport, onExpand, onOptions }) {
    let uiPosition = null;
    function createUi() {
      let host = document.getElementById(HOST_ID);
      if (host) return host;

      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("data-chatcouter-owned", "true");

      const shadow = host.attachShadow({ mode: "open" });
      function element(tag, attributes = {}, text, svg = false) {
        const node = svg ? document.createElementNS("http://www.w3.org/2000/svg", tag)
          : document.createElement(tag);
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
        if (text !== undefined) node.textContent = text;
        return node;
      }
      const style = element("style", {}, `
        :host { color-scheme: inherit; font-family: system-ui, sans-serif; }
        .controls {
          --ink: light-dark(#34383d, #e5e7eb); --muted: light-dark(#6c727a, #aeb5be);
          --line: light-dark(#80878f, #929ba7); --idle: light-dark(#666d76, #adb6c1);
          --blue: light-dark(#4d73a5, #8cafd9);
          --amber: light-dark(#a77b32, #cfaa67); --off: light-dark(#737983, #808893);
          --status: var(--idle);
          position: relative; box-sizing: border-box; display: grid;
          grid-template-columns: 46px minmax(84px, max-content) max-content;
          grid-template-rows: 22px 24px; min-width: 222px; height: 58px;
          column-gap: 7px; padding: 7px 14px 5px 0; color: var(--ink);
          font-family: inherit; font-size: 12px; font-weight: 400; line-height: 20px;
        }
        button { appearance: none; background: transparent; border: 0; border-radius: 4px;
          box-sizing: border-box; color: inherit; cursor: pointer; display: flex;
          font-family: inherit; font-weight: 400; margin: 0; padding: 0; white-space: nowrap; }
        .measure { grid-column: 2; grid-row: 1 / 3; flex-direction: column; align-items: flex-start;
          justify-content: center; width: 100%; height: 46px; text-align: left; font-variant-numeric: tabular-nums; }
        .controls[data-mode="active"] .measure { transform: translateX(-6px); }
        .primary { font-size: 12px; line-height: 20px; }
        .brand-muted { color: var(--muted); }
        .measure[data-numeric="true"] .primary { font-size: 14px; font-weight: 500; }
        .unit { color: var(--muted); font-size: 12px; font-weight: 400; margin-left: 3px; }
        .secondary { color: var(--muted); font-size: 14px; line-height: 20px; }
        .action { grid-column: 3; align-items: center; width: 100%;
          height: 22px; font-size: 12px; line-height: 16px; color: var(--muted); }
        .expand { grid-row: 1; }
        .export { grid-row: 2; height: 24px; }
        .expand::after { content: ""; margin-left: 5px; width: 14px; height: 14px; flex-shrink: 0;
          background: currentColor;
          mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M3 1.5h5l3 3v8H3zM8 1.5v3h3M5 7h4M5 9.5h4' fill='none' stroke='black' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
        .export::after { content: ""; margin-left: 5px; width: 14px; height: 14px; flex-shrink: 0;
          background: currentColor;
          mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M7 1.5v7M4.5 6L7 8.5 9.5 6M2 9.5v3h10v-3' fill='none' stroke='black' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
        .export:disabled::after { display: none; }
        button:hover:enabled { color: var(--blue); background: color-mix(in srgb, var(--blue) 7%, transparent); }
        .measure:hover .secondary, .measure:hover .unit { color: inherit; }
        button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
        button:disabled { cursor: not-allowed; opacity: .65; }
        [hidden] { display: none !important; }
        .symbol { position: absolute; top: 0; left: -3px; width: 45px; height: 58px; pointer-events: none; overflow: visible; }
        .body { fill: none; stroke: var(--line); stroke-width: 1; stroke-linejoin: miter; }
        .light { fill: var(--status); filter: drop-shadow(0 0 2px color-mix(in srgb, var(--status) 10%, transparent)); }
        .idle-shape { display: none; }
        .ground { position: absolute; left: 32px; right: 0; top: 52.5px; height: 1px; pointer-events: none;
          background: linear-gradient(to right, var(--line) 68%, transparent); }
        .controls[data-indicator="ready"] { --status: var(--blue); }
        .controls[data-indicator="attention"] { --status: var(--amber); }
        .controls[data-indicator="unavailable"] { --status: var(--off); }
        .controls[data-indicator="busy"] { --status: var(--blue); }
        .controls[data-indicator="busy"] .active-shape .light { animation: pulse 1200ms ease-in-out infinite alternate; }
        .controls[data-indicator="unavailable"] .light { filter: none; }
        .controls[data-mode="idle"] { min-width: 177px; grid-template-columns: 39px max-content; grid-template-rows: 58px;
          padding-top: 0; padding-bottom: 0; --status: var(--idle); --line: var(--idle); }
        .controls[data-mode="idle"] .active-shape, .controls[data-mode="idle"] .ground { display: none; }
        .controls[data-mode="idle"] .idle-shape { display: inline; }
        .controls[data-mode="idle"] .light { filter: none; }
        .controls[data-mode="idle"] .measure { grid-row: 1; align-self: center; height: 24px; justify-content: center; }
        .action-description { display: none; }
        .controls[data-mode="idle"] .primary { font-size: 15px; font-weight: 400; letter-spacing: -.4px; }
        @keyframes pulse { to { opacity: .25; } }
        @media (pointer: coarse) {
          .controls[data-mode="active"] { height: 110px; grid-template-rows: 44px 44px; row-gap: 2px; }
          .controls[data-mode="active"] .symbol { top: 52px; }
          .controls[data-mode="active"] .ground { top: 104.5px; }
          .measure, .action { min-height: 44px; }
          .controls[data-mode="active"] .measure { height: 90px; }
          .controls[data-mode="idle"] .measure { height: 44px; }
        }
        @media (prefers-reduced-motion: reduce) { .light { animation: none !important; } }
        @media (forced-colors: active) {
          .controls { --ink: CanvasText; --muted: CanvasText; --line: CanvasText; --idle: CanvasText; }
          .body { stroke: CanvasText; } .light { fill: Highlight; filter: none; }
          .ground { background: CanvasText; }
        }
`);
      const controls = element("span", { class: "controls", "data-mode": "idle", "data-indicator": "idle" });
      const symbol = element("svg", { class: "symbol", viewBox: "0 0 45 58", "aria-hidden": "true" }, undefined, true);
      const idleShape = element("g", { class: "idle-shape", transform: "translate(-10.6743 3)" }, undefined, true);
      idleShape.append(
        element("path", { class: "body", d: "M21.4256 45 L26.656 25.48 H33.344 L38.5744 45" }, undefined, true),
        element("polygon", { class: "light", points: "30,13 32.8081,23.48 27.1919,23.48" }, undefined, true));
      const activeShape = element("g", { class: "active-shape" }, undefined, true);
      activeShape.append(
        element("path", { class: "body", d: "M10.7513 53 L25.3005 27.8 H35 V53" }, undefined, true),
        element("polygon", { class: "light", points: "35,11 35,24.8 27.0326,24.8" }, undefined, true));
      symbol.append(idleShape, activeShape);
      const measure = element("button", { class: "measure", type: "button", "data-state": "idle",
        "aria-live": "polite", title: t("automatic_measure_hint") });
      measure.append(element("span", { class: "primary" }, "ChatGauge"), element("span", { class: "secondary" }));
      const expand = element("button", { class: "action expand", type: "button", "aria-describedby": "expand-description" }, t("expand_button"));
      expand.hidden = true;
      expand.disabled = true;
      const exportControl = element("button", { class: "action export", type: "button", title: t("export_initial_hint") }, t("export_button"));
      exportControl.hidden = true;
      controls.append(symbol, element("span", { class: "ground", "aria-hidden": "true" }), measure,
        expand, element("span", { class: "action-description", id: "expand-description" }), exportControl);
      shadow.append(style, controls);

      const measureButton = shadow.querySelector(".measure");
      measureButton.addEventListener("click", () => {
        return measureButton.dataset.action === "options" ? onOptions() : onMeasure();
      });
      shadow.querySelector(".export").addEventListener("click", onExport);
      if (typeof onExpand === "function") shadow.querySelector(".expand").addEventListener("click", onExpand);
      document.documentElement.append(host);
      uiPosition?.destroy();
      uiPosition = namespace.uiPosition.create({
        host,
        getComposer,
        document,
        window,
      });
      return host;
    }

    function render(view) {
      const shadow = createUi().shadowRoot;
      const exportButton = shadow.querySelector(".export");
      exportButton.hidden = view.pageKind !== "conversation";
      exportButton.disabled = view.exportBusy || Boolean(view.expandBusy);
      exportButton.textContent = view.exportBusy ? t("export_preparing") : view.exportError ? t("export_retry") : t("export_button");
      exportButton.title = view.exportError
        ? t("export_failed_hint", view.exportError)
        : t("export_hint");
      const expandButton = shadow.querySelector(".expand");
      expandButton.hidden = view.pageKind !== "conversation";
      expandButton.disabled = typeof onExpand !== "function" || view.baselineBusy || view.exportBusy || Boolean(view.expandBusy);
      expandButton.textContent = view.expandBusy ? t("expand_preparing") : view.expandError ? t("expand_retry") : t("expand_button");
      expandButton.title = typeof onExpand !== "function" ? t("expand_unconnected_hint")
        : view.expandBusy ? t("expand_preparing_hint") : view.expandError ? t("expand_failed_hint", view.expandError) : t("expand_hint");
      shadow.querySelector("#expand-description").textContent = expandButton.title;
      const shown = measureView(view);
      const button = shadow.querySelector(".measure");
      button.dataset.action = ["home", "new-chat"].includes(view.pageKind)
        && shown.primary === "ChatGauge" && typeof onOptions === "function" ? "options" : "measure";
      button.disabled = view.baselineBusy || view.exportBusy || Boolean(view.expandBusy);
      button.dataset.state = view.state;
      button.dataset.indicator = shown.indicator;
      button.dataset.numeric = String(shown.numeric);
      const primaryLabel = button.querySelector(".primary");
      const charactersText = shown.numeric ? compactCharacters(shown.charactersText) : shown.primary;
      primaryLabel.textContent = charactersText;
      if (shown.numeric) {
        const unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = t("character_unit");
        primaryLabel.append(unit);
      } else if (shown.mode === "idle" && shown.primary === "ChatGauge") {
        primaryLabel.textContent = "Chat";
        const namePart = document.createElement("span");
        namePart.className = "brand-muted";
        namePart.textContent = "Gauge";
        primaryLabel.append(namePart);
      }
      button.querySelector(".secondary").textContent = shown.secondary;
      button.title = shown.numeric && charactersText !== shown.charactersText
        ? [shown.primary, shown.title].filter(Boolean).join(" · ") : shown.title;
      button.setAttribute("aria-label", [shown.primary, shown.secondary, shown.title].filter(Boolean).join(" · "));
      const controls = shadow.querySelector(".controls");
      controls.dataset.mode = shown.mode;
      controls.dataset.indicator = shown.indicator;
      controls.title = button.title;
      uiPosition?.schedule();
    }

    return Object.freeze({ render, schedule: () => uiPosition?.schedule() });
  }

  namespace.meterUi = Object.freeze({ create });
})(globalThis);
