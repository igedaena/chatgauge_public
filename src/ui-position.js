(function registerUiPosition(global) {
  "use strict";

  function besideComposer(rect, size, viewport, gap = 8, bottomOffset = 0, verticalAlign = "bottom", anchorHeight = size.height) {
    if (!rect || rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) return null;
    const left = rect.right + gap;
    // Decoration may extend above the viewport; only the bottom control box
    // determines whether this placement is available.
    const anchorTop = (verticalAlign === "center" ? rect.top + (rect.height - anchorHeight) / 2
      : rect.bottom - anchorHeight) + bottomOffset;
    const top = anchorTop + anchorHeight - size.height;
    if (rect.left < 0 || rect.top < 0 || rect.bottom > viewport.height
      || anchorTop < gap || left >= viewport.width) return null;
    return { left, top };
  }

  function clippingBounds(composer, viewport, window, root, body) {
    const bounds = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
    // The form itself must not clip a meter deliberately placed beside it.
    // Only explicit overflow semantics establish a boundary; an ancestor's
    // width alone does not establish a chat pane or a side-panel boundary.
    // Root/body overflow can propagate to the viewport, including a body with
    // no in-flow height. The viewport above is their conservative boundary.
    for (let element = composer?.parentElement; element && element !== root && element !== body; element = element.parentElement) {
      const style = window.getComputedStyle(element);
      const clipsX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX);
      const clipsY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const rect = element.getBoundingClientRect();
      const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
      const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
      const left = rect.left + (element.clientLeft || 0) * scaleX;
      const top = rect.top + (element.clientTop || 0) * scaleY;
      if (clipsX) {
        bounds.left = Math.max(bounds.left, left);
        bounds.right = Math.min(bounds.right, left + (element.clientWidth ?? rect.width) * scaleX);
      }
      if (clipsY) {
        bounds.top = Math.max(bounds.top, top);
        bounds.bottom = Math.min(bounds.bottom, top + (element.clientHeight ?? rect.height) * scaleY);
      }
    }
    return bounds;
  }

  function create({ host, getComposer, getOverlayRect = () => null, document, window,
    bottomOffset = 0, verticalAlign = "bottom", anchorHeight }) {
    let composer = null;
    let layoutElements = [];
    let pending = false;
    let frame = null;
    let destroyed = false;
    const resizeObserver = typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(schedule) : null;
    // Observe only the layout chain, not attributes throughout the chat.
    // A translation or changed class can move a fixed-size form without resize.
    const layoutObserver = typeof window.MutationObserver === "function"
      ? new window.MutationObserver(schedule) : null;

    function update() {
      pending = false;
      if (destroyed) return;
      const next = getComposer();
      const nextElements = [];
      for (let element = next || document.documentElement; element; element = element.parentElement)
        nextElements.push(element);
      if (next !== composer || nextElements.length !== layoutElements.length
        || nextElements.some((element, index) => element !== layoutElements[index])) {
        for (const element of layoutElements) resizeObserver?.unobserve(element);
        layoutObserver?.disconnect();
        layoutElements = nextElements;
        composer = next;
        // Ancestor sizes cover sidebar/layout changes even when the form's
        // own max-width stays constant. No ChatGPT class names are needed.
        for (const element of layoutElements) {
          resizeObserver?.observe(element);
          layoutObserver?.observe(element, { attributes: true,
            attributeFilter: ["class", "style", "hidden", "data-state"] });
        }
      }
      if (composer) {
        // Match the input form's font rather than pinning the meter to one OS font.
        const fontFamily = window.getComputedStyle(composer).fontFamily;
        if (host.style.fontFamily !== fontFamily) host.style.fontFamily = fontFamily;
      }
      // Keep the box measurable while hidden so it can reappear after resizing.
      const size = host.getBoundingClientRect();
      const viewport = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      };
      const position = besideComposer(composer?.getBoundingClientRect(), size, viewport, 8, bottomOffset, verticalAlign, anchorHeight);
      let visible = false;
      if (position) {
        host.style.left = `${position.left}px`;
        host.style.top = `${position.top}px`;
        const bounds = clippingBounds(composer, viewport, window, document.documentElement, document.body);
        const top = Math.max(0, bounds.top - position.top);
        const right = Math.max(0, position.left + size.width - bounds.right);
        const bottom = Math.max(0, position.top + size.height - bounds.bottom);
        const left = Math.max(0, bounds.left - position.left);
        const anchorTop = position.top + size.height - (anchorHeight ?? size.height);
        visible = left + right < size.width
          && Math.max(bounds.top, anchorTop) < Math.min(bounds.bottom, position.top + size.height);
        host.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
        // Keep the host/controls in their existing document layer. Subtract a
        // visible site panel rather than moving below a full-pane hit target.
        const overlay = getOverlayRect();
        if (visible && overlay) {
          const x1 = Math.max(left, overlay.left - position.left);
          const x2 = Math.min(size.width - right, overlay.right - position.left);
          const y1 = Math.max(top, overlay.top - position.top);
          const y2 = Math.min(size.height - bottom, overlay.bottom - position.top);
          if (x1 < x2 && y1 < y2) {
            const outer = `M${left} ${top}H${size.width - right}V${size.height - bottom}H${left}Z`;
            const hole = `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
            host.style.clipPath = `path(evenodd, "${outer} ${hole}")`;
            // A completely covered control box must not retain keyboard focus.
            if (x1 <= left && x2 >= size.width - right
              && y1 <= Math.max(top, anchorTop - position.top) && y2 >= size.height - bottom)
              visible = false;
          }
        }
      }
      host.style.visibility = visible ? "visible" : "hidden";
      host.inert = !visible;
    }

    function schedule() {
      if (pending || destroyed) return;
      pending = true;
      frame = window.requestAnimationFrame(update);
    }

    function layoutTransition(event) {
      // A sibling panel can shift the form too. Recheck at both ends, including
      // cancellation, without polling every animation frame or watching text.
      if (event.target === host || host.contains?.(event.target)) return;
      if (/^(transform|translate|scale|rotate|((min|max)-)?(width|height)|margin($|-)|padding($|-)|inset($|-)|top$|right$|bottom$|left$|flex-basis$|grid-template-)/.test(event.propertyName))
        schedule();
    }

    const transitionEvents = ["transitionrun", "transitionend", "transitioncancel"];
    resizeObserver?.observe(host);
    resizeObserver?.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    for (const event of transitionEvents) window.addEventListener(event, layoutTransition, true);
    schedule();
    return { schedule, destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      layoutObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      for (const event of transitionEvents) window.removeEventListener(event, layoutTransition, true);
      if (pending) window.cancelAnimationFrame(frame);
    } };
  }

  global.Chatcouter.uiPosition = Object.freeze({ besideComposer, create });
})(globalThis);
