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

  function create({ host, getComposer, document, window, bottomOffset = 0, verticalAlign = "bottom", anchorHeight }) {
    let composer = null;
    let layoutElements = [];
    let pending = false;
    let frame = null;
    const resizeObserver = typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(schedule) : null;

    function update() {
      pending = false;
      const next = getComposer();
      if (next !== composer) {
        for (const element of layoutElements) resizeObserver?.unobserve(element);
        layoutElements = [];
        composer = next;
        // Ancestor sizes cover sidebar/layout changes even when the form's
        // own max-width stays constant. No ChatGPT class names are needed.
        for (let element = composer; element && element !== document.documentElement; element = element.parentElement) {
          layoutElements.push(element);
          resizeObserver?.observe(element);
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
      }
      host.style.visibility = visible ? "visible" : "hidden";
      host.inert = !visible;
    }

    function schedule() {
      if (pending) return;
      pending = true;
      frame = window.requestAnimationFrame(update);
    }

    resizeObserver?.observe(host);
    resizeObserver?.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();
    return { schedule, destroy() {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (pending) window.cancelAnimationFrame(frame);
    } };
  }

  global.Chatcouter.uiPosition = Object.freeze({ besideComposer, create });
})(globalThis);
