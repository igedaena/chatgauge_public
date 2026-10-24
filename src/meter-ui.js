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
    automaticRecoveryThreshold, updateOnUserInput, expandBusy = false,
    exportError = "", expandError = "", documentAction = "" }) {
    const loading = state === "loading";
    const busy = exportBusy || expandBusy || loading;
    const indicator = recoveryFailureStreak >= baselineFailureThreshold ? "unavailable" : busy ? "busy"
      : unverifiedResponseStreak > 0 || ["fallback", "error"].includes(state)
        ? "attention" : state === "ready" ? "ready" : "idle";
    const exportDisplay = lastMeasuredDisplay?.conversationId === conversationId
      ? lastMeasuredDisplay : { primary: t("usage_unverified"), secondary: "" };
    const shown = exportBusy ? exportDisplay : display;
    const hideUsage = loading && !exportBusy;
    let primary = hideUsage ? t("measuring") : shown.primary;
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
    // Only the latest accepted document action owns a failure notice. Retained
    // measurement data remains separate and is selected again after the notice.
    const actionError = documentAction === "expand" ? expandError : documentAction === "export" ? exportError : "";
    const notice = exportBusy || expandBusy || Boolean(actionError);
    let noticeTitle = "";
    if (exportBusy) { primary = t("export_preparing"); noticeTitle = t("export_hint"); }
    else if (expandBusy) { primary = t("expand_preparing"); noticeTitle = t("expand_preparing_hint"); }
    else if (actionError) {
      primary = documentAction === "expand" ? t("expand_failed_status") : t("export_failed_status");
      noticeTitle = documentAction === "expand" ? t("expand_failed_hint", actionError) : t("export_failed_hint", actionError);
    }
    if (noticeTitle) title = [noticeTitle, title].filter(Boolean).join(" · ");
    return { primary, secondary, title, indicator, usagePrimary: shown.primary,
      numeric: !notice && !hideUsage && shown.charactersText !== undefined, charactersText: shown.charactersText,
      mode: pageKind === "conversation" ? "active" : "idle" };
  }

  // onExpand is optional until the caller connects the document-opening action.
  function create({ document, window, getComposer, getOverlayRect, onMeasure, onExport, onExpand, onOptions, layout = null, editing = false }) {
    let uiPosition = null;
    let refs = null, currentHost = null, currentMode = null;
    let entryValue, entryLabel = "";
    let textObserver, textFrame, textAnimation, textAnimationKey = "";
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    function resetTextScroll() {
      textObserver?.disconnect();
      if (textFrame !== undefined) window.cancelAnimationFrame?.(textFrame);
      textFrame = undefined;
      textAnimation?.cancel(); textAnimation = null; textAnimationKey = "";
    }
    function scheduleTextScroll() {
      if (typeof window.requestAnimationFrame !== "function" || textFrame !== undefined) return;
      textFrame = window.requestAnimationFrame(() => {
        textFrame = undefined;
        const button = refs?.measure, label = refs?.primary;
        if (!layout || currentMode !== "conversation" || !button || !label || button.dataset.scrollText !== "true") return;
        // Measure CSS pixels, including the unit's actual font, independently of editor zoom.
        const width = button.clientWidth, distance = Math.max(0, label.scrollWidth - width);
        const overflow = width > 0 && distance > 1;
        button.dataset.marquee = String(overflow);
        const key = [label.textContent, width, distance, window.getComputedStyle(label).font, reducedMotion?.matches].join("|");
        if (key === textAnimationKey) return;
        textAnimationKey = key; textAnimation?.cancel(); textAnimation = null;
        if (!overflow || reducedMotion?.matches || typeof label.animate !== "function") return;
        const pause = 1400, travel = Math.max(1200, distance / 20 * 1000), duration = travel + pause * 2;
        const end = `translateX(-${distance}px)`;
        textAnimation = label.animate([
          { transform: "translateX(0)", offset: 0 },
          { transform: "translateX(0)", offset: pause / duration },
          { transform: end, offset: (pause + travel) / duration },
          { transform: end, offset: 1 },
        ], { duration, iterations: Infinity, easing: "linear" });
      });
    }
    document.fonts?.addEventListener?.("loadingdone", scheduleTextScroll);
    reducedMotion?.addEventListener?.("change", scheduleTextScroll);
    function element(tag, attributes = {}, text, svg = false) {
      const node = svg ? document.createElementNS("http://www.w3.org/2000/svg", tag)
        : document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function connect(host, mode) {
      resetTextScroll();
      const shadow = host.shadowRoot;
      refs = Object.fromEntries(["measure", "primary", "secondary", "symbol", "expand", "export", "expand-icon", "export-icon", "entry-time", "controls"]
        .map(role => [role, shadow.querySelector(`.${role}`)]));
      refs.description = shadow.querySelector("#expand-description");
      refs.canvas = shadow.querySelector(".guide-canvas");
      const measure = refs.measure;
      measure?.addEventListener("click", () => measure.dataset.action === "options" ? onOptions?.() : onMeasure());
      if (mode === "idle" && !measure) refs.symbol?.addEventListener("click", () => onOptions?.());
      refs.export?.addEventListener("click", onExport);
      if (typeof onExpand === "function") refs.expand?.addEventListener("click", onExpand);
      if (!refs.export) refs["export-icon"]?.addEventListener("click", onExport);
      if (!refs.expand && typeof onExpand === "function") refs["expand-icon"]?.addEventListener("click", onExpand);
      if (!document.getElementById(HOST_ID)) document.documentElement.append(host);
      uiPosition?.destroy();
      uiPosition = namespace.uiPosition.create({ host, getComposer, getOverlayRect, document, window,
        bottomOffset: layout?.[mode]?.bottomOffset ?? 0,
        verticalAlign: layout?.[mode]?.verticalAlign ?? "bottom",
        anchorHeight: layout?.[mode]?.height });
      currentHost = host;
      currentMode = mode;
      if (layout && mode === "conversation" && refs.primary && typeof window.ResizeObserver === "function") {
        textObserver = new window.ResizeObserver(scheduleTextScroll);
        textObserver.observe(refs.measure); textObserver.observe(refs.primary);
      }
      return host;
    }
    function createGuideUi(mode) {
      let host = document.getElementById(HOST_ID);
      if (host && host === currentHost && mode === currentMode) return host;
      if (!host) {
        host = element("div", { id: HOST_ID, "data-chatcouter-owned": "true" });
        host.attachShadow({ mode: "open" });
      }
      const spec = namespace.themeLayout.validate(layout[mode], { allowOverlap: editing });
      const sample = Boolean(layout.atlasUrl);
      const canvas = element("div", { class: "guide-canvas",
        style: `width:${spec.width}px;height:${Math.max(spec.height, spec.background?.height ?? 0)}px` });
      const controls = element("div", { class: "controls", "data-layout": "guide",
        style: `width:${spec.width}px;height:${spec.height}px` });
      const style = element("style", {}, `
        :host { pointer-events: none; font: 12px/1.4 system-ui, sans-serif; }
        .guide-canvas { position: relative; background: rgb(0,255,0); pointer-events: none; }
        .guide-canvas[data-capacity-stage="1"] { background: #ffff00; }
        .guide-canvas[data-capacity-stage="2"] { background: #87ceeb; }
        .controls { position: absolute; left: 0; bottom: 0; color: #111; pointer-events: none;
          --status: #666; }
        .controls::after { content: ""; position: absolute; inset: 0; z-index: 1;
          outline: 2px solid red; outline-offset: -2px; pointer-events: none; }
        .controls[data-indicator="ready"], .controls[data-indicator="busy"] { --status: #397bd1; }
        .controls[data-indicator="attention"] { --status: #c38816; }
        .controls[data-indicator="unavailable"] { --status: #777; }
        .component { position: absolute; box-sizing: border-box; outline: 1px solid red;
          outline-offset: -1px; pointer-events: none; }
        .component[data-display="true"] { outline-color: blue; }
        .content { position: absolute; inset: 2px; overflow: hidden; white-space: nowrap;
          font: inherit; color: inherit; margin: 0; padding: 0; box-sizing: border-box;
          border: 0; border-radius: 0; background: transparent; text-align: left;
          display: flex; align-items: center; min-width: 0; }
        button.content { appearance: none; cursor: pointer; pointer-events: auto;
          outline: 1px dashed #008080; outline-offset: -1px; }
        button:disabled { cursor: not-allowed; opacity: .65; }
        button:focus-visible { outline: 2px solid #111; outline-offset: -2px; }
        .symbol { color: var(--status); font-size: 28px; justify-content: center; }
        .primary { overflow: hidden; text-overflow: clip; }
          .measure[data-scroll-text="true"] .primary { flex: 0 0 auto; width: max-content; overflow: visible; }
          .measure[data-marquee="true"] { justify-content: flex-start !important; }
        .unit { margin-left: 3px; }
        .action-description, [hidden] { display: none !important; }
      `);
      if (sample) {
        controls.dataset.layout = "sample";
        style.textContent += `
          .guide-canvas { background: transparent !important; }
          .guide-canvas, .controls { --ink: light-dark(#34383d, #e5e7eb); --muted: light-dark(#6c727a, #aeb5be);
            --line: light-dark(#80878f, #929ba7); --status: light-dark(#666d76, #adb6c1); }
          .controls[data-indicator="ready"], .controls[data-indicator="busy"] { --status: light-dark(#4d73a5, #8cafd9); }
          .controls[data-indicator="attention"] { --status: light-dark(#a77b32, #cfaa67); }
          .controls[data-indicator="unavailable"] { --status: light-dark(#737983, #808893); }
          .controls[data-mode="idle"] { --line: light-dark(#666d76, #adb6c1); --status: var(--line); }
          .controls::after { display: none; }
          .component, button.content { outline: none; }
          .content { justify-content: flex-start; }
          .sprite { position: absolute; inset: 0; margin: auto; pointer-events: none; }
          .theme-background { position: absolute; left: 0; bottom: 0; pointer-events: none; }
          .content { line-height: 16px; }
          .measure { font-variant-numeric: tabular-nums; }
          .controls[data-mode="idle"] .primary { line-height: 20px; letter-spacing: -.4px; }
          .controls[data-mode="active"][data-indicator="busy"] .symbol .sprite[data-color="status"] {
            animation: theme-pulse 1200ms ease-in-out infinite alternate; }
          @keyframes theme-pulse { to { opacity: .25; } }
          @media (prefers-reduced-motion: reduce) { .symbol .sprite { animation: none !important; } }
          .measure[data-numeric="true"] .primary { font-size: var(--numeric-size); font-weight: var(--numeric-weight); }
          .unit { color: var(--muted); font-size: var(--unit-size, 12px); font-weight: var(--unit-weight, 400); }
          .brand-muted { color: var(--muted); }
          button:hover:enabled { color: var(--status); background-color: color-mix(in srgb, var(--status) 7%, transparent); }
          button:focus-visible { outline: 2px solid var(--status); outline-offset: -2px; }
        `;
        if (spec.background) {
        const background = element("div", { class: "theme-background", "aria-hidden": "true" });
        canvas.append(background);
        paint(background, spec.background.sources[0], spec.background.width, spec.background.height, spec.background.color);
        }
      }
      function paint(node, crop, width, height, color) {
        const sx = width / crop.width, sy = height / crop.height;
        const image = `url("${layout.atlasUrl}") ${-crop.x * sx}px ${-crop.y * sy}px / ${layout.atlas.width * sx}px ${layout.atlas.height * sy}px no-repeat`;
        node.setAttribute("style", `width:${width}px;height:${height}px;${color
          ? `background:${color.startsWith("#") ? color : `var(--${color})`};mask:${image};mask-mode:alpha`
          : `background:${image}`}`);
      }
      function component(role, className, tag, text) {
        const box = spec.components[role];
        if (!box || box.enabled === false) return null;
        const outer = element("div", { class: `component ${role}-box`,
          "data-display": String(tag !== "button"),
          style: `left:${box.x}px;bottom:${box.y}px;width:${box.width}px;height:${box.height}px` });
        const content = element(tag, { class: `content ${className}`,
          ...(tag === "button" ? { type: "button" } : {}) }, sample && box.paint ? undefined : text);
        if (sample && box.text) {
          const family = ["system-ui", "serif", "sans-serif", "monospace"].includes(box.text.family)
            ? box.text.family : `"${box.text.family}"`;
          const unitStyle = role === "measure" && box.text.numericSize === undefined && box.text.numericWeight === undefined
            ? `--unit-size:${box.text.size}px;--unit-weight:${box.text.weight};` : "";
          content.setAttribute("style",
            `${unitStyle}font-family:${family},sans-serif;font-size:${box.text.size}px;font-weight:${box.text.weight};color:${box.text.color.startsWith("#") ? box.text.color : `var(--${box.text.color})`};--numeric-size:${box.text.numericSize ?? box.text.size}px;--numeric-weight:${box.text.numericWeight ?? box.text.weight};justify-content:${({ left: "flex-start", center: "center", right: "flex-end" })[box.text.align ?? "left"]}`);
        }
        if (sample && box.paint && box.fill !== undefined) {
          const sprite = element("span", { class: "sprite", "aria-hidden": "true",
            style: `width:${box.width - 4}px;height:${box.height - 4}px;background:${box.fill.startsWith("#") ? box.fill : `var(--${box.fill})`}` });
          content.append(sprite);
        } else if (sample && box.paint) for (const layer of box.paint) {
          const sprite = element("span", { class: "sprite", "aria-hidden": "true",
            ...(layer.color !== undefined ? { "data-color": layer.color } : {}) });
          const scale = Math.min((box.width - 4) / layer.source.width, (box.height - 4) / layer.source.height);
          paint(sprite, layer.source, box.fit === "stretch" ? box.width - 4 : layer.source.width * scale,
            box.fit === "stretch" ? box.height - 4 : layer.source.height * scale, layer.color);
          content.append(sprite);
        }
        outer.append(content);
        controls.append(outer);
        return content;
      }
      const measure = component("measure", "measure", "button");
      if (measure) {
        measure.setAttribute("aria-live", "polite");
        if (sample && mode === "conversation") measure.dataset.scrollText = "true";
        measure.append(element("span", { class: "primary" }));
      }
      component("secondary", "secondary", "span");
      const isActive = box => Boolean(box && box.enabled !== false);
      const symbolButton = mode === "idle" && !isActive(spec.components.measure);
      const symbol = component("symbol", "symbol", symbolButton ? "button" : "span", "▲");
      if (!symbolButton) symbol?.setAttribute("aria-hidden", "true");
      component("expand", "action expand", "button", t("expand_button"));
      component("export", "action export", "button", t("export_button"));
      const expandIcon = component("expandIcon", "expand-icon", isActive(spec.components.expand) ? "span" : "button", "▤");
      const exportIcon = component("exportIcon", "export-icon", isActive(spec.components.export) ? "span" : "button", "↓");
      if (isActive(spec.components.expand)) expandIcon?.setAttribute("aria-hidden", "true");
      if (isActive(spec.components.export)) exportIcon?.setAttribute("aria-hidden", "true");
      component("entryTime", "entry-time", "span");
      controls.append(element("span", { id: "expand-description", class: "action-description" }));
      for (const target of [controls.querySelector(".expand"), !spec.components.expand && expandIcon]) {
        if (target) target.setAttribute("aria-describedby", "expand-description");
      }
      canvas.append(controls);
      host.shadowRoot.replaceChildren(style, canvas);
      return connect(host, mode);
    }
    function createUi(view) {
      if (layout) return createGuideUi(view.pageKind === "conversation" ? "conversation" : "idle");
      let host = document.getElementById(HOST_ID);
      if (host && host === currentHost) return host;

      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("data-chatcouter-owned", "true");

      const shadow = host.attachShadow({ mode: "open" });
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

      return connect(host, "legacy");
    }

    function render(view) {
      createUi(view);
      if (refs.canvas) {
        // Use published bytes, never rounded
        // text or document-export results; loading/errors retain this snapshot.
        const sample = view.pageKind === "conversation" && view.conversationId
          && view.lastMeasuredDisplay?.conversationId === view.conversationId ? view.lastMeasuredDisplay : null;
        const bytes = sample?.utf8Bytes;
        const settings = view.capacityBackground;
        const stage = settings?.enabled !== false && Number.isSafeInteger(bytes) && bytes >= 0
          ? bytes > (settings?.thirdKB ?? 400) * 1024 ? "2" : bytes > (settings?.secondKB ?? 200) * 1024 ? "1" : "0" : "0";
        if (refs.canvas.dataset.capacityStage !== stage) {
          refs.canvas.dataset.capacityStage = stage;
        }
        const backgroundStage = !editing && view.backgroundStageOverride === 1 && stage === "2" ? "1" : stage;
        if (refs.canvas.dataset.backgroundStage !== backgroundStage) {
          refs.canvas.dataset.backgroundStage = backgroundStage;
          const background = currentHost.shadowRoot.querySelector(".theme-background");
          if (background) {
            const crop = layout[currentMode].background.sources[Number(backgroundStage)] || layout[currentMode].background.sources[0];
            const property = layout[currentMode].background.color ? "maskPosition" : "backgroundPosition";
            background.style[property] = `${-crop.x}px ${-crop.y}px`;
          }
        }
      }
      const exportTitle = view.exportError ? t("export_failed_hint", view.exportError) : t("export_hint");
      const expandTitle = typeof onExpand !== "function" ? t("expand_unconnected_hint")
        : view.expandBusy ? t("expand_preparing_hint") : view.expandError ? t("expand_failed_hint", view.expandError) : t("expand_hint");
      for (const [action, title, disabled] of [
        ["export", exportTitle, view.exportBusy || Boolean(view.expandBusy)],
        ["expand", expandTitle, typeof onExpand !== "function" || view.baselineBusy || view.exportBusy || Boolean(view.expandBusy)],
      ]) {
        for (const node of [refs[action], refs[`${action}-icon`]]) {
          if (!node) continue;
          node.hidden = view.pageKind !== "conversation";
          node.title = title;
          if (node.tagName.toLowerCase() === "button") {
            node.disabled = disabled;
            node.setAttribute("aria-label", t(action === "export" ? "export_button" : "expand_button"));
          }
        }
        if (refs[action]) refs[action].textContent = t(action === "export" ? "export_button" : "expand_button");
      }
      if (refs.description) refs.description.textContent = expandTitle;
      const shown = measureView(view);
      if (currentMode === "idle" && !refs.measure && refs.symbol) {
        refs.symbol.disabled = typeof onOptions !== "function" || view.baselineBusy || view.exportBusy || Boolean(view.expandBusy);
        refs.symbol.title = shown.title;
        refs.symbol.setAttribute("aria-label", t("options_open_hint"));
      }
      const button = refs.measure;
      if (button) {
        button.dataset.action = ["home", "new-chat"].includes(view.pageKind)
          && shown.primary === "ChatGauge" && typeof onOptions === "function" ? "options" : "measure";
        button.disabled = view.baselineBusy || view.exportBusy || Boolean(view.expandBusy);
        button.dataset.state = view.state;
        button.dataset.indicator = shown.indicator;
        button.dataset.numeric = String(shown.numeric);
        const primaryLabel = refs.primary;
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
        button.title = shown.numeric && charactersText !== shown.charactersText
          ? [shown.primary, shown.title].filter(Boolean).join(" · ") : shown.title;
        button.setAttribute("aria-label", [...new Set([shown.primary, shown.usagePrimary, shown.secondary, shown.title].filter(Boolean))].join(" · "));
      }
      if (refs.secondary) refs.secondary.textContent = shown.secondary;
      if (refs["entry-time"]) {
        if (entryValue !== view.enteredAt) {
          entryValue = view.enteredAt;
          entryLabel = Number.isFinite(entryValue) ? new Date(entryValue).toLocaleTimeString(namespace.i18n.locale(),
            { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";
        }
        refs["entry-time"].textContent = entryLabel;
        refs["entry-time"].hidden = view.showEntryTime === false;
      }
      const controls = refs.controls;
      controls.dataset.mode = shown.mode;
      controls.dataset.indicator = shown.indicator;
      controls.title = button?.title || shown.title;
      uiPosition?.schedule();
      scheduleTextScroll();
    }

    function setLayout(next) {
      layout = next;
      currentMode = null;
    }
    return Object.freeze({ render, setLayout, schedule: () => uiPosition?.schedule() });
  }

  namespace.meterUi = Object.freeze({ create });
})(globalThis);
