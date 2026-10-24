(function registerThemeEditorModel(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const contract = namespace.themeContract;
  const clone = value => structuredClone(value);
  const modes = ["conversation", "idle"];
  const roles = mode => mode === "idle" ? ["symbol", "measure"] : contract.roles;
  const limits = Object.freeze({ sourceBytes: 20 * 1024 * 1024, sourceSide: 2048 });
  function normalize(theme) {
    const next = contract.upgrade(theme);
    for (const mode of modes) {
      for (const box of Object.values(next[mode].components)) if (box?.text) {
        // Collapse old numeric overrides into the one visible style, preserving the visible number size.
        box.text.size = box.text.numericSize ?? box.text.size;
        box.text.weight = box.text.numericWeight ?? box.text.weight;
        delete box.text.numericSize; delete box.text.numericWeight;
      }
    }
    return next;
  }
  function backgroundSize(width, height, mode) {
    const scale = Math.min(1, (mode === "idle" ? 168 : 256) / width, (mode === "idle" ? 64 : 640) / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  function create(theme, defaults = theme) {
    contract.validateTheme(theme);
    const state = { theme: normalize(theme), hidden: {}, backgrounds: {}, placements: {}, shapes: {},
      backgroundEnabled: {}, stageEnabled: {}, backgroundFill: {},
      backgroundColors: {}, placementBackground: { enabled: false, x: 0, y: 0, width: 256, height: 168, locked: true, fill: null } };
    defaults = normalize(defaults);
    for (const mode of modes) {
      state.hidden[mode] = {};
      state.backgrounds[mode] = clone(theme[mode].background?.sources || []);
      state.placements[mode] = state.backgrounds[mode].map(source => source ? { x: 0, y: 0,
        width: source.width, height: source.height, locked: true } : null);
      state.backgroundEnabled[mode] = true;
      state.stageEnabled[mode] = state.backgrounds[mode].map(() => true);
      state.backgroundFill[mode] = null;
      state.backgroundColors[mode] = state.theme[mode].background?.color;
      for (const role of roles(mode)) if (!theme[mode].components[role]) {
        const fallback = defaults[mode].components[role];
        if (fallback) state.theme[mode].components[role] = { ...clone(fallback), enabled: false };
      }
    }
    return state;
  }
  function expandBackground(state) {
    const next = clone(state), background = next.theme.conversation.background;
    for (const image of next.placements.conversation) if (image) image.y += 640 - background.height;
    Object.assign(background, { width: 256, height: 640 });
    return next;
  }
  function edit(state, mode, role, changes) {
    const next = clone(state), box = next.theme[mode].components[role];
    if (!contract.active(box)) throw new Error("editor-component-off");
    Object.assign(box, clone(changes));
    contract.validateTheme(next.theme, undefined, { allowOverlap: true });
    return next;
  }
  function toggle(state, mode, role, enabled) {
    if (mode === "conversation" && role === "measure" && !enabled) throw new Error("theme-usage-required");
    const next = clone(state), components = next.theme[mode].components;
    if (!components[role]) throw new Error("editor-component-missing");
    components[role].enabled = Boolean(enabled);
    contract.validateTheme(next.theme, undefined, { allowOverlap: true });
    return next;
  }
  function drag(box, edge, dx, dy, spec, keepRatio = false) {
    dx = Math.round(dx); dy = Math.round(dy);
    const min = contract.limits.componentMin;
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const next = { ...box };
    if (!edge) {
      next.x = clamp(box.x + dx, 0, spec.width - box.width);
      next.y = clamp(box.y + dy, 0, spec.height - box.height);
    } else {
      if (edge.includes("w")) { next.x = clamp(box.x + dx, 0, box.x + box.width - min); next.width = box.x + box.width - next.x; }
      if (edge.includes("e")) next.width = clamp(box.width + dx, min, spec.width - box.x);
      if (edge.includes("s")) { next.y = clamp(box.y + dy, 0, box.y + box.height - min); next.height = box.y + box.height - next.y; }
      if (edge.includes("n")) next.height = clamp(box.height + dy, min, spec.height - box.y);
    }
    if (edge && keepRatio) {
      const ratio = box.width / box.height;
      const horizontal = /[ew]/.test(edge), vertical = /[ns]/.test(edge);
      let width = horizontal ? next.width : next.height * ratio;
      if (horizontal && vertical && Math.abs(next.height / box.height - 1) > Math.abs(next.width / box.width - 1)) width = next.height * ratio;
      const maxWidth = edge.includes("w") ? box.x + box.width : spec.width - box.x;
      const maxHeight = edge.includes("s") ? box.y + box.height : spec.height - box.y;
      width = clamp(width, Math.max(min, min * ratio), Math.min(maxWidth, maxHeight * ratio));
      next.width = Math.round(width); next.height = Math.round(width / ratio);
      next.x = edge.includes("w") ? box.x + box.width - next.width : box.x;
      next.y = edge.includes("s") ? box.y + box.height - next.height : box.y;
    }
    return { x: next.x, y: next.y, width: next.width, height: next.height };
  }
  function placement(current, changes) {
    const next = { ...current, ...changes };
    if (current.locked && (changes.width !== undefined || changes.height !== undefined)) {
      if (changes.width !== undefined) next.height = Math.max(1, Math.round(changes.width * current.height / current.width));
      else next.width = Math.max(1, Math.round(changes.height * current.width / current.height));
    }
    if (![next.x, next.y, next.width, next.height].every(Number.isSafeInteger)
      || next.width < 1 || next.height < 1 || [next.x, next.y, next.width, next.height].some(n => Math.abs(n) > 16384)) throw new Error("editor-image-bounds");
    return next;
  }
  function filename(date = new Date()) {
    const pad = n => String(n).padStart(2, "0");
    return `chatgauge-theme-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, "0")}.zip`;
  }
  function graphicSize(width, height) {
    const scale = Math.min(1, 256 / width, 168 / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  function alignImage(current, frame, action) {
    if (action === "bottom") return placement(current, { y: frame.height - current.height });
    const scale = (action === "cover" ? Math.max : Math.min)(frame.width / current.width, frame.height / current.height);
    const width = Math.max(1, Math.round(current.width * scale)), height = Math.max(1, Math.round(current.height * scale));
    return placement({ ...current, locked: false }, { x: Math.round((frame.width - width) / 2),
      y: Math.round((frame.height - height) / 2), width, height, locked: current.locked });
  }
  // Background coordinates are top-left based and may extend outside the frame.
  function backgroundDrag(box, edge, dx, dy, frame, tolerance = 0) {
    const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
    const near = (n, target) => Math.abs(n - target) <= tolerance;
    dx = Math.round(dx); dy = Math.round(dy);
    if (!edge) {
      let x = clamp(box.x + dx, -16384, 16384), y = clamp(box.y + dy, -16384, 16384);
      const closest = values => values.filter(n => Math.abs(n) <= tolerance).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;
      x += closest([-x, frame.width - x - box.width]); y += closest([-y, frame.height - y - box.height]);
      return placement(box, { x, y });
    }
    const right = box.x + box.width, bottom = box.y + box.height;
    let left = edge.includes("w") ? Math.min(right - 1, box.x + dx) : box.x;
    let top = edge.includes("n") ? Math.min(bottom - 1, box.y + dy) : box.y;
    let endX = edge.includes("e") ? Math.max(left + 1, right + dx) : right;
    let endY = edge.includes("s") ? Math.max(top + 1, bottom + dy) : bottom;
    const snapX = edge.includes("w") ? near(left, 0) && right >= 1 : edge.includes("e") && near(endX, frame.width) && frame.width > left;
    const snapY = edge.includes("n") ? near(top, 0) && bottom >= 1 : edge.includes("s") && near(endY, frame.height) && frame.height > top;
    if (snapX) { if (edge.includes("w")) left = 0; else endX = frame.width; }
    if (snapY) { if (edge.includes("n")) top = 0; else endY = frame.height; }
    let width = endX - left, height = endY - top;
    if (box.locked) {
      const horizontal = /[ew]/.test(edge), vertical = /[ns]/.test(edge), ratio = box.width / box.height;
      const useX = snapX || (!snapY && horizontal && (!vertical || Math.abs(dx / box.width) >= Math.abs(dy / box.height)));
      if (useX) height = Math.max(1, Math.round(width / ratio)); else width = Math.max(1, Math.round(height * ratio));
    }
    if (box.locked) {
      const scale = Math.min(1, 16384 / width, 16384 / height);
      width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale));
    } else { width = clamp(width, 1, 16384); height = clamp(height, 1, 16384); }
    return placement({ ...box, locked: false }, { x: edge.includes("w") ? right - width : box.x,
      y: edge.includes("n") ? bottom - height : box.y, width, height, locked: box.locked });
  }
  // Reserve a left strip for component images and shelves on the right for backgrounds.
  function pack(items) {
    const side = contract.limits.atlasSide;
    if (items.some(item => !Number.isInteger(item.width) || !Number.isInteger(item.height)
      || item.width < 1 || item.height < 1 || item.width > side || item.height > side)) throw new Error("theme-image-size");
    const graphics = items.filter(item => !item.background), backgrounds = items.filter(item => item.background);
    const strip = graphics.length ? Math.max(...graphics.map(item => item.width)) : 0;
    const maxBackground = Math.max(1, ...backgrounds.map(item => item.width));
    const result = [];
    let x = 0, y = 0, columnWidth = 0, height = 1;
    for (const item of graphics) {
      if (y + item.height > side) { x += columnWidth; y = 0; columnWidth = 0; }
      result.push({ ...item, x, y });
      y += item.height; columnWidth = Math.max(columnWidth, item.width); height = Math.max(height, y);
    }
    const left = graphics.length ? x + Math.max(columnWidth, strip) : 0;
    if (left + maxBackground > side) throw new Error("editor-atlas-full");
    x = left; y = 0; let rowHeight = 0, width = Math.max(1, left);
    for (const item of backgrounds) {
      if (x + item.width > side) { x = left; y += rowHeight; rowHeight = 0; }
      if (y + item.height > side) throw new Error("editor-atlas-full");
      result.push({ ...item, x, y }); x += item.width;
      rowHeight = Math.max(rowHeight, item.height); width = Math.max(width, x); height = Math.max(height, y + item.height);
    }
    return { width, height, items: result };
  }
  function controlLayout(box, zoom) {
    const compact = Math.min(box.width, box.height) * zoom < 28, gap = compact ? 5 / zoom : 0;
    const handles = (compact ? ["ne", "nw", "se", "sw"] : ["n", "s", "e", "w", "ne", "nw", "se", "sw"]).map(edge => ({ edge,
      x: edge.includes("w") ? box.x - gap : edge.includes("e") ? box.x + box.width + gap : box.x + box.width / 2,
      y: edge.includes("n") ? box.y - gap : edge.includes("s") ? box.y + box.height + gap : box.y + box.height / 2 }));
    return { compact, handles };
  }
  function resizeEdge(rect, x, y) {
    // Tiny selections reserve their entire interior for moving; only explicit handles resize.
    if (Math.min(rect.width, rect.height) < 28) return "";
    return (Math.abs(y - rect.top) < 5 ? "n" : Math.abs(y - rect.bottom) < 5 ? "s" : "")
      + (Math.abs(x - rect.left) < 5 ? "w" : Math.abs(x - rect.right) < 5 ? "e" : "");
  }
  namespace.themeEditorModel = Object.freeze({ create, edit, toggle, drag, pack, roles, normalize, backgroundSize, placement, filename,
    limits, graphicSize, alignImage, backgroundDrag, expandBackground, controlLayout, resizeEdge });
})(globalThis);
