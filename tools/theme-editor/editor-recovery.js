(function registerEditorRecovery(global) {
  "use strict";
  const ns = global.Chatcouter, contract = ns.themeContract, model = ns.themeEditorModel;
  const format = "chatgauge-editor-recovery-1", modes = ["conversation", "idle"];
  const clone = value => structuredClone(value);
  const color = value => value === undefined || typeof value === "string" && (["ink", "muted", "line"].includes(value) || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value));
  const fill = value => value === null || typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
  function fail() { throw new Error("editor-recovery-file"); }
  function keys(value, names) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !names.includes(key))) fail();
  }
  function source(value, size) {
    keys(value, ["x", "y", "width", "height"]);
    if (![value.x, value.y, value.width, value.height].every(Number.isInteger) || value.x < 0 || value.y < 0
      || value.width < 1 || value.height < 1 || value.x + value.width > size.width || value.y + value.height > size.height) fail();
  }
  function canvas(width, height) {
    const node = global.document.createElement("canvas"); node.width = width; node.height = height; return node;
  }
  const pngBlob = node => new Promise((resolve, reject) => node.toBlob(blob => blob ? resolve(blob) : reject(new Error("editor-recovery-file")), "image/png"));
  function visiblePlacement(box) {
    const x = Math.max(0, box.x), y = Math.max(0, box.y);
    return { x, y, width: Math.max(0, Math.min(256, box.x + box.width) - x), height: Math.max(0, Math.min(168, box.y + box.height) - y) };
  }
  function available(state, assets) {
    if (!state.placementBackground.enabled || !assets.has("conversation.placementBackground") || !state.backgroundEnabled.conversation) return false;
    const visible = visiblePlacement(state.placementBackground); if (!visible.width || !visible.height) return false;
    return state.theme.conversation.background.sources.some((_, stage) => {
      if (state.stageEnabled.conversation[stage] === false) return false;
      if (state.backgroundFill.conversation !== null) return true;
      const index = state.backgrounds.conversation[stage] ? stage : 0;
      return state.stageEnabled.conversation[index] !== false && Boolean(state.placements.conversation[index]) && assets.has(`conversation.background.${index}`);
    });
  }
  async function create(state, assets) {
    if (!available(state, assets)) fail();
    const theme = clone(state.theme), items = [], refs = new Map();
    const editor = { backgrounds: {}, enabled: clone(state.backgroundEnabled), stages: clone(state.stageEnabled),
      colors: clone(state.backgroundColors), fills: clone(state.backgroundFill), placement: {} };
    const add = (key, image, background, assign) => {
      items.push({ key, image, width: image.width, height: image.height, background }); refs.set(key, assign);
    };
    // Preserve only the current output frames, not off-frame originals or editing history.
    for (const mode of modes) {
      const spec = theme[mode].background, count = spec ? Math.max(spec.sources.length, state.backgrounds[mode].length) : 0;
      editor.backgrounds[mode] = [];
      const activeCount = spec?.sources.length;
      if (spec) spec.sources = [];
      for (let i = 0; i < count; i++) {
        const original = state.backgrounds[mode][i], image = assets.get(`${mode}.background.${i}`), placement = state.placements[mode][i];
        editor.backgrounds[mode][i] = null;
        if (i > 0 && !original) { if (i < activeCount) spec.sources[i] = null; continue; }
        const frame = canvas(spec.width, spec.height);
        if (image && placement) ns.themeEditorImage.draw(frame.getContext("2d"), image, placement.x, placement.y, placement.width, placement.height);
        add(`${mode}.background.${i}`, frame, true, rect => {
          if (i < activeCount) spec.sources[i] = rect;
          if (original) editor.backgrounds[mode][i] = rect;
        });
      }
      for (const role of model.roles(mode)) theme[mode].components[role]?.paint?.forEach((layer, i) => {
        const image = assets.get(`${mode}.${role}.${i}`); if (!image) fail();
        const size = model.graphicSize(image.width, image.height), frame = canvas(size.width, size.height);
        ns.themeEditorImage.draw(frame.getContext("2d"), image, 0, 0, frame.width, frame.height);
        add(`${mode}.${role}.${i}`, frame, false, rect => { layer.source = rect; });
      });
    }
    const box = state.placementBackground, visible = visiblePlacement(box), layer = canvas(visible.width, visible.height);
    ns.themeEditorImage.draw(layer.getContext("2d"), assets.get("conversation.placementBackground"), box.x - visible.x, box.y - visible.y, box.width, box.height);
    add("placement", layer, true, rect => { editor.placement = { source: rect, ...visible, locked: box.locked, color: box.color, fill: box.fill }; });
    const plan = model.pack(items), image = canvas(plan.width, plan.height), ctx = image.getContext("2d");
    for (const item of plan.items) {
      ctx.drawImage(item.image, item.x, item.y);
      refs.get(item.key)({ x: item.x, y: item.y, width: item.width, height: item.height });
    }
    const blob = await pngBlob(image), bytes = new Uint8Array(await blob.arrayBuffer());
    contract.inspectPng(bytes);
    const digest = new Uint8Array(await global.crypto.subtle.digest("SHA-256", bytes));
    theme.atlas = { width: plan.width, height: plan.height, sha256: Array.from(digest, b => b.toString(16).padStart(2, "0")).join("") };
    contract.validateTheme(theme, plan);
    return new Blob([ns.themePackage.pack({ format, theme, editor }, bytes)], { type: "application/zip" });
  }
  function parse(jsonBytes) {
    if (jsonBytes.byteLength > contract.limits.jsonBytes) fail();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes));
  }
  async function read(data, pngBytes, defaults, decode) {
    keys(data, ["format", "theme", "editor"]); if (data.format !== format) fail();
    let image;
    const theme = await contract.validatePair({ jsonBytes: new TextEncoder().encode(JSON.stringify(data.theme)), pngBytes,
      decodePng: async bytes => { image = await decode(bytes); return { width: image.width, height: image.height }; } });
    const editor = data.editor;
    keys(editor, ["backgrounds", "enabled", "stages", "colors", "fills", "placement"]);
    for (const key of ["backgrounds", "enabled", "stages", "colors", "fills"]) keys(editor[key], modes);
    const next = model.create(theme, defaults);
    for (const mode of modes) {
      const sources = editor.backgrounds[mode], stages = editor.stages[mode], background = theme[mode].background;
      if (!Array.isArray(sources) || sources.length > 3 || (background ? sources.length < background.sources.length : sources.length !== 0)
        || !Array.isArray(stages) || stages.length !== sources.length || stages.some(flag => typeof flag !== "boolean")
        || typeof editor.enabled[mode] !== "boolean" || !color(editor.colors[mode]) || !fill(editor.fills[mode])) fail();
      for (const crop of sources) if (crop !== null) {
        source(crop, image);
        if (crop.width !== background.width || crop.height !== background.height) fail();
      }
      next.backgrounds[mode] = clone(sources);
      next.placements[mode] = sources.map(crop => crop ? { x: 0, y: 0, width: crop.width, height: crop.height, locked: true } : null);
      next.stageEnabled[mode] = clone(stages); next.backgroundEnabled[mode] = editor.enabled[mode];
      next.backgroundColors[mode] = editor.colors[mode]; next.backgroundFill[mode] = editor.fills[mode];
    }
    keys(editor.placement, ["source", "x", "y", "width", "height", "locked", "color", "fill"]); source(editor.placement.source, image);
    if (![editor.placement.x, editor.placement.y, editor.placement.width, editor.placement.height].every(Number.isInteger)
      || editor.placement.x < 0 || editor.placement.y < 0 || editor.placement.x + editor.placement.width > 256
      || editor.placement.y + editor.placement.height > 168 || typeof editor.placement.locked !== "boolean"
      || editor.placement.source.width !== editor.placement.width || editor.placement.source.height !== editor.placement.height
      || !color(editor.placement.color) || !fill(editor.placement.fill)) fail();
    next.placementBackground = { enabled: true, x: editor.placement.x, y: editor.placement.y,
      width: editor.placement.width, height: editor.placement.height, locked: editor.placement.locked,
      color: editor.placement.color, fill: editor.placement.fill };
    return { state: next, image, placementSource: editor.placement.source };
  }
  ns.themeEditorRecovery = Object.freeze({ format, available, create, parse, read });
})(globalThis);
