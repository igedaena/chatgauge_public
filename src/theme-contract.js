(function registerThemeContract(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const VERSION = "chatgauge-theme-2";
  const active = box => Boolean(box && box.enabled !== false);
  const limits = Object.freeze({ jsonBytes: 64 * 1024, pngBytes: 2 * 1024 * 1024,
    atlasSide: 2048, componentMin: 8, fontMin: 8, fontMax: 32 });
  const roles = Object.freeze(["measure", "secondary", "symbol", "expand", "expandIcon", "export", "exportIcon", "entryTime"]);
  const graphicRoles = ["symbol", "expandIcon", "exportIcon"];
  const colors = ["ink", "muted", "line", "status"];
  const keys = (value, allowed, required = []) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !allowed.includes(key))
      || required.some(key => !Object.hasOwn(value, key))) fail("theme-fields");
  };
  function fail(code) { const error = new Error(code); error.code = code; throw error; }
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  const color = (value, status = true) => colors.filter(c => status || c !== "status").includes(value)
    || (typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value));

  // Also used by the old measurement guide; file-specific rules follow below.
  function validateLayout(layout, { allowOverlap = false } = {}) {
    if (!layout || !integer(layout.width, 1, 256) || !integer(layout.height, 1, 168)
      || !layout.components || typeof layout.components !== "object" || Array.isArray(layout.components)) throw new Error("Invalid guide canvas");
    if (layout.background && (!integer(layout.background.width, 1, layout.width)
      || !integer(layout.background.height, 1, 640))) throw new Error("Invalid guide background");
    const active = [];
    for (const [role, box] of Object.entries(layout.components)) {
      if (!roles.includes(role)) throw new Error("Unknown guide component");
      if (box === null || box === false) continue;
      if (!box || ![box.x, box.y, box.width, box.height].every(Number.isInteger)
        || box.x < 0 || box.y < 0 || box.width < limits.componentMin || box.height < limits.componentMin
        || box.x + box.width > layout.width || box.y + box.height > layout.height) throw new Error("Invalid guide rectangle");
      if (box.enabled === false) continue;
      if (!allowOverlap && active.some(other => box.x < other.x + other.width && other.x < box.x + box.width
        && box.y < other.y + other.height && other.y < box.y + box.height)) throw new Error("Overlapping guide rectangles");
      active.push(box);
    }
    return layout;
  }
  function validateTheme(theme, image, { allowOverlap = false } = {}) {
    keys(theme, ["version", "atlas", "conversation", "idle"], ["version", "atlas", "conversation", "idle"]);
    if (![VERSION, "chatgauge-theme-1"].includes(theme.version)) fail("theme-version");
    const modern = theme.version === VERSION;
    keys(theme.atlas, ["width", "height", "sha256"], ["width", "height", "sha256"]);
    if (!integer(theme.atlas.width, 1, limits.atlasSide) || !integer(theme.atlas.height, 1, limits.atlasSide)
      || typeof theme.atlas.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(theme.atlas.sha256)) fail("theme-atlas");
    if (image && (image.width !== theme.atlas.width || image.height !== theme.atlas.height)) fail("theme-image-size");
    function source(box) {
      keys(box, ["x", "y", "width", "height"], ["x", "y", "width", "height"]);
      if (!integer(box.x, 0, theme.atlas.width) || !integer(box.y, 0, theme.atlas.height)
        || !integer(box.width, 1, theme.atlas.width) || !integer(box.height, 1, theme.atlas.height)
        || box.x + box.width > theme.atlas.width || box.y + box.height > theme.atlas.height) fail("theme-crop");
    }
    for (const mode of ["conversation", "idle"]) {
      const spec = theme[mode];
      keys(spec, ["width", "height", mode === "conversation" ? "bottomOffset" : "verticalAlign", "background", "components"],
        ["width", "height", mode === "conversation" ? "bottomOffset" : "verticalAlign", "background", "components"]);
      if (spec.width !== (mode === "conversation" ? 256 : 168) || spec.height !== (mode === "conversation" ? 168 : 64)
        || (mode === "conversation" ? spec.bottomOffset !== 24 : spec.verticalAlign !== "center")) fail("theme-canvas");
      try { validateLayout(spec, { allowOverlap }); } catch { fail("theme-layout"); }
      keys(spec.components, mode === "conversation" ? roles : ["measure", "symbol"]);
      if (mode === "conversation" && !active(spec.components.measure)) fail("theme-usage-required");
      if (modern && mode === "idle" && spec.background !== null) fail("theme-background");
      if (!(modern && mode === "idle" && spec.background === null)) {
        keys(spec.background, ["width", "height", "sources", "color"], ["width", "height", "sources"]);
        if (mode === "idle" && spec.background.height > 64) fail("theme-background");
        if (spec.background.color !== undefined && !color(spec.background.color, false)) fail("theme-background-color");
        if (!Array.isArray(spec.background.sources) || spec.background.sources.length < 1 || spec.background.sources.length > 3) fail("theme-backgrounds");
        for (const [index, crop] of spec.background.sources.entries()) {
          if (modern && index > 0 && crop === null) continue;
          source(crop);
          if (crop.width !== spec.background.width || crop.height !== spec.background.height) fail("theme-background-size");
        }
      }
      for (const [role, box] of Object.entries(spec.components)) {
        if (box === null || box === false) continue;
        const graphic = graphicRoles.includes(role);
        keys(box, ["x", "y", "width", "height", ...(modern ? ["enabled", ...(graphic ? ["fill", "fit"] : [])] : []), graphic ? "paint" : "text"],
          ["x", "y", "width", "height", graphic ? "paint" : "text"]);
        if (box.enabled !== undefined && typeof box.enabled !== "boolean") fail("theme-fields");
        if (graphic) {
          if (box.fit !== undefined && !["contain", "stretch"].includes(box.fit)) fail("theme-paint");
          if (box.fill !== undefined && (!color(box.fill, false) || (mode === "conversation" && role === "symbol"))) fail("theme-paint-color");
          if (!Array.isArray(box.paint) || box.paint.length < 1 || box.paint.length > 2) fail("theme-paint");
          let statusLayers = 0;
          for (const layer of box.paint) {
            keys(layer, ["source", "color"], ["source"]);
            source(layer.source);
            if (layer.color !== undefined && !color(layer.color, role === "symbol" && !(modern && mode === "idle"))) fail("theme-paint-color");
            if (layer.color === "status") statusLayers++;
          }
          if (role === "symbol" && statusLayers !== (modern && mode === "idle" ? 0 : 1)) fail("theme-status-layers");
        } else {
          const font = box.text;
          keys(font, ["family", "size", "weight", "color", "align",
            ...(role === "measure" ? ["numericSize", "numericWeight"] : [])], ["family", "size", "weight", "color"]);
          if (typeof font.family !== "string" || !font.family.trim() || !/^[\p{L}\p{M}\p{N} _.()\-]{1,64}$/u.test(font.family)
            || !integer(font.size, limits.fontMin, limits.fontMax) || ![400, 500, 600, 700].includes(font.weight)
            || !color(font.color, false) || (font.align !== undefined && !["left", "center", "right"].includes(font.align))
            || (font.numericSize !== undefined && !integer(font.numericSize, limits.fontMin, limits.fontMax))
            || (font.numericWeight !== undefined && ![400, 500, 600, 700].includes(font.numericWeight))) fail("theme-font");
        }
      }
    }
    return theme;
  }
  function parseJson(bytes) {
    if (!bytes || !integer(bytes.byteLength, 1, limits.jsonBytes)) fail("theme-json-size");
    let value;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { fail("theme-json"); }
    return validateTheme(value);
  }
  function upgrade(theme) {
    const next = JSON.parse(JSON.stringify(theme));
    next.version = VERSION;
    next.idle.background = null;
    for (const mode of ["conversation", "idle"]) {
      for (const box of Object.values(next[mode].components)) if (box) {
        box.enabled ??= true;
        if (mode === "idle") for (const layer of box.paint || []) if (layer.color === "status") layer.color = "line";
      }
    }
    return next;
  }
  function inspectPng(bytes, { maxBytes = limits.pngBytes } = {}) {
    // Firefox extension scripts can hand us a Uint8Array from another realm.
    // Its prototype differs, but the byte view is still a valid PNG input.
    if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== "[object Uint8Array]"
      || !integer(bytes.byteLength, 45, maxBytes)) fail("theme-png-size");
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (signature.some((value, index) => bytes[index] !== value)) fail("theme-png");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8, first = true, ended = false, hasData = false, width, height;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), end = offset + 12 + length;
      if (end > bytes.length) fail("theme-png");
      // subarray() follows the input's constructor/species, which Firefox's
      // cross-realm wrapper can deny. Chunk tags only need four byte reads.
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (first) {
        if (type !== "IHDR" || length !== 13) fail("theme-png");
        width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
        if (!integer(width, 1, limits.atlasSide) || !integer(height, 1, limits.atlasSide)) fail("theme-image-size");
      } else if (type === "IHDR" || type === "acTL" || type === "fcTL" || type === "fdAT") fail("theme-png-static");
      if (type === "IDAT") hasData = true;
      if (type === "IEND") {
        if (length !== 0 || end !== bytes.length) fail("theme-png");
        ended = true; break;
      }
      first = false; offset = end;
    }
    if (!ended || !hasData) fail("theme-png");
    return { width, height };
  }
  async function validatePair({ jsonBytes, pngBytes, decodePng }) {
    const theme = parseJson(jsonBytes), image = inspectPng(pngBytes);
    validateTheme(theme, image);
    if (!global.crypto?.subtle) fail("theme-hash-unavailable");
    const hash = new Uint8Array(await global.crypto.subtle.digest("SHA-256", pngBytes));
    if (Array.from(hash, value => value.toString(16).padStart(2, "0")).join("") !== theme.atlas.sha256) fail("theme-image-pair");
    if (typeof decodePng !== "function") fail("theme-image-decoder");
    let decoded;
    try { decoded = await decodePng(pngBytes); } catch { fail("theme-image-decode"); }
    validateTheme(theme, decoded || {});
    return theme;
  }
  namespace.themeContract = Object.freeze({ VERSION, active, upgrade, limits, roles, validateLayout, validateTheme, parseJson, inspectPng, validatePair });
})(globalThis);
