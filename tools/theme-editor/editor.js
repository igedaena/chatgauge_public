(async function startEditor(global) {
  "use strict";
  const ns = global.Chatcouter, { t, localizeDocument } = ns.i18n;
  const contract = ns.themeContract, model = ns.themeEditorModel, images = ns.themeEditorImage;
  const controls = new Map();
  const $ = id => controls.get(id) || document.getElementById(id);
  for (const id of ["stage", "stage-control"]) controls.set(id, $(id));
  const clone = value => structuredClone(value);
  const modes = ["conversation", "idle"];
  let state, assets, defaults, defaultImage, atlasUrl, selected = null, busy = false, dirty = false, gesture, spaceDown = false;
  let messagePreview = false, presenting = false;
  let pendingExport = null;
  let savedViewport, viewportSize = "";
  const colorModes = new Map();
  const zoomSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  let scene, workspace;
  let workspaceInsets = { left: 0, top: 0 };
  let backgroundFrame = 0, backgroundPointer;
  localizeDocument(document);
  // Preview owns its position; all component painting/text/state still uses the real meter renderer.
  ns.uiPosition = { create: () => ({ schedule() {}, destroy() {} }) };
  const meter = ns.meterUi.create({ document, window: global, getComposer: () => null,
    onMeasure() {}, onExport() {}, onExpand() {}, onOptions() {}, editing: true });
  function canvas(width, height) {
    const node = document.createElement("canvas"); node.width = width; node.height = height; return node;
  }
  function crop(image, source) {
    const node = canvas(source.width, source.height);
    node.getContext("2d").drawImage(image, source.x, source.y, source.width, source.height, 0, 0, source.width, source.height);
    return node;
  }
  async function decode(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try { const image = new Image(); image.src = url; await image.decode(); return image; }
    finally { URL.revokeObjectURL(url); }
  }
  const toBlob = node => new Promise((resolve, reject) => node.toBlob(blob => blob ? resolve(blob) : reject(new Error("theme-image-decode")), "image/png"));
  function clearOutput() {
    for (const link of $("output-files").querySelectorAll("a")) URL.revokeObjectURL(link.href);
    $("output-files").replaceChildren(); $("output-files").hidden = true;
  }
  function message(key, error = false) {
    if (["editor_changed", "editor_reset_done", "editor_open_done"].includes(key)) clearOutput();
    $("status").textContent = t(key); $("status").dataset.error = String(error);
  }
  function updateOverlapWarning() {
    let overlap = false;
    try { contract.validateTheme(state.theme); }
    catch (error) { overlap = error?.code === "theme-layout"; }
    $("overlap-warning").hidden = !overlap;
  }
  function errorMessage(error) {
    const code = error?.code || error?.message;
    const key = ({ "theme-layout": "editor_layout_error", "theme-font": "editor_font_error",
      "theme-usage-required": "editor_required", "editor-component-off": "editor_off_hint",
      "editor-atlas-full": "editor_atlas_error", "theme-image-pair": "editor_pair_error",
      "editor-file-pair": "editor_pair_hint", "theme-png-size": "editor_png_hint",
      "theme-image-size": "editor_png_hint", "theme-png": "editor_png_hint", "theme-png-static": "editor_png_hint",
      "theme-zip": "editor_zip_error", "editor-integer": "editor_integer", "editor-image-bounds": "editor_image_bounds", "theme-json-size": "editor_json_hint",
      "editor-source-size": "editor_source_size", "editor-recovery-file": "editor_recovery_file_error" })[code] || "editor_file_error";
    message(key, true);
  }
  function setBusy(value) {
    busy = value;
    for (const node of document.querySelectorAll("button, input, select")) node.disabled = value;
    if (!value && state) {
      const required = document.querySelector('[data-toggle="measure"]');
      if (required && $("mode").value === "conversation") required.disabled = true;
      $("indicator").disabled = $("mode").value === "idle";
    }
    document.querySelector("aside").inert = value || presenting;
    for (const id of ["reset", "open", "mode", "zoom", "stage", "composer-preview", "area-enabled", "grid-enabled", "grid-gap", "reset-view"]) $(id).disabled = value || presenting;
    $("actual-preview-toggle").disabled = value;
  }
  async function task(work) {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch (error) { errorMessage(error); }
    finally { render(); setBusy(false); }
  }
  function assetMap(theme, image) {
    const map = new Map();
    for (const mode of modes) {
      theme[mode].background?.sources.forEach((source, i) => { if (source) map.set(`${mode}.background.${i}`, crop(image, source)); });
      for (const role of model.roles(mode)) {
        const original = theme[mode].components[role], box = original || defaults[mode].components[role];
        box?.paint?.forEach((layer, i) => map.set(`${mode}.${role}.${i}`, crop(original ? image : defaultImage, layer.source)));
      }
    }
    return map;
  }
  async function prepareDefault() {
    const next = model.expandBackground(model.create(model.normalize(defaults))), map = assetMap(defaults, defaultImage);
    for (const mode of modes) {
      const spec = next.theme[mode], box = spec.components.symbol;
      if (mode === "idle" || box?.paint?.length !== 2) continue;
      const body = map.get(`${mode}.symbol.0`), status = map.get(`${mode}.symbol.1`);
      const pixels = status.getContext("2d").getImageData(0, 0, status.width, status.height).data;
      let left = status.width, top = status.height, right = 0, bottom = 0;
      for (let y = 0; y < status.height; y++) for (let x = 0; x < status.width; x++) if (pixels[(y * status.width + x) * 4 + 3]) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
      // The old fixed outline is decoration: merge it into every default background.
      for (let i = 0; i < spec.background.sources.length; i++) {
        const background = canvas(spec.background.width, spec.background.height), ctx = background.getContext("2d");
        ctx.drawImage(backgroundImage(next, map, mode, i, true), 0, 0);
        ctx.drawImage(body, box.x + 2, spec.background.height - box.y - box.height + 2);
        map.set(`${mode}.background.${i}`, background);
        next.placements[mode][i] = { x: 0, y: 0, width: background.width, height: background.height, locked: true };
      }
      spec.background.color = "line";
      next.backgroundColors[mode] = "line";
      const triangle = crop(status, { x: left, y: top, width: right - left, height: bottom - top });
      map.set(`${mode}.symbol.0`, triangle); map.delete(`${mode}.symbol.1`);
      spec.components.symbol = { x: box.x + left, y: box.y + status.height - bottom,
        width: triangle.width + 4, height: triangle.height + 4,
        paint: [{ source: { x: 0, y: 0, width: triangle.width, height: triangle.height }, color: "status" }] };
    }
    const result = await packed(next, map, true);
    defaults = result.state.theme; defaultImage = await decode(result.bytes);
  }
  // Only bundled startup/reset split the decoration. Imported finished themes stay merged.
  function createDefault() {
    const next = model.create(defaults), map = assetMap(defaults, defaultImage);
    const background = next.theme.conversation.background;
    const image = map.get("conversation.background.0");
    map.set("conversation.placementBackground", crop(image, { x: 0, y: image.height - 168, width: 256, height: 168 }));
    next.placementBackground.enabled = true;
    next.placementBackground.color = next.backgroundColors.conversation;
    next.backgroundEnabled.conversation = false;
    next.backgroundColors.conversation = undefined;
    delete background.color;
    for (let i = 0; i < next.backgrounds.conversation.length; i++) {
      map.delete(`conversation.background.${i}`);
      next.backgrounds.conversation[i] = null; next.placements.conversation[i] = null;
    }
    return { next, map };
  }
  // Repack on image changes/output only. Integer layout edits reuse the same atlas.
  async function packed(input, inputAssets, includeHidden) {
    const next = clone(input), items = [], refs = new Map();
    // Keep paint layers intact: the shared renderer applies each layer's color and fit.
    for (const mode of modes) {
      const background = next.theme[mode].background;
      const count = background ? (includeHidden ? Math.max(next.backgrounds[mode].length, background.sources.length) : background.sources.length) : 0;
      const sources = [];
      for (let i = 0; i < count; i++) {
        const key = `${mode}.background.${i}`;
        items.push({ key, width: background.width, height: background.height, background: true });
        refs.set(key, rect => { sources[i] = rect; });
      }
      if (background) {
        const activeCount = background.sources.length;
        refs.set(`${mode}.finish`, () => { background.sources = sources.slice(0, activeCount); });
        const color = backgroundColor(input, inputAssets, mode);
        if (color !== undefined) background.color = color;
        else delete background.color;
      }
      for (const role of model.roles(mode)) {
        const box = next.theme[mode].components[role] || (includeHidden && next.hidden[mode][role]);
        box?.paint?.forEach((layer, i) => {
          const key = `${mode}.${role}.${i}`, image = inputAssets.get(key);
          if (!image) throw new Error("editor-component-missing");
          items.push({ key, ...model.graphicSize(image.width, image.height) });
          refs.set(key, rect => { layer.source = rect; });
        });
      }
    }
    const plan = model.pack(items), image = canvas(plan.width, plan.height), ctx = image.getContext("2d");
    for (const item of plan.items) {
      const match = item.key.match(/^(conversation|idle)\.background\.(\d+)$/);
      const asset = match ? backgroundImage(input, inputAssets, match[1], Number(match[2]), true) : inputAssets.get(item.key);
      if (!asset) throw new Error("editor-component-missing");
      images.draw(ctx, asset, item.x, item.y, item.width, item.height);
      refs.get(item.key)({ x: item.x, y: item.y, width: item.width, height: item.height });
    }
    for (const mode of modes) refs.get(`${mode}.finish`)?.();
    const blob = await toBlob(image), bytes = new Uint8Array(await blob.arrayBuffer());
    contract.inspectPng(bytes);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    next.theme.atlas = { width: plan.width, height: plan.height, sha256: Array.from(hash, b => b.toString(16).padStart(2, "0")).join("") };
    contract.validateTheme(next.theme, undefined, { allowOverlap: includeHidden });
    return { state: next, blob, bytes, assets: inputAssets };
  }
  function install(next, map, blob, changed = true) {
    const url = URL.createObjectURL(blob), previous = atlasUrl;
    state = next; assets = map; atlasUrl = url; dirty = changed;
    if (previous) URL.revokeObjectURL(previous);
    render();
  }
  function view(stage = Number($("stage").value), mode = $("mode").value) {
    const indicator = $("indicator").value, idle = mode === "idle";
    const bytes = Math.round(2.69 * 1024 * 1024);
    return { pageKind: idle ? "home" : "conversation", conversationId: "theme-preview", state: "ready",
      display: { primary: idle ? "ChatGauge" : `1,283,633 ${t("character_unit")}`, secondary: idle ? "" : "2.69 MiB",
        ...(idle ? {} : { charactersText: "1,283,633" }) }, title: "", enteredAt: new Date(2026, 0, 1, 21, 0, 55).getTime(),
      lastMeasuredDisplay: { conversationId: "theme-preview", primary: `1,283,633 ${t("character_unit")}`, secondary: "2.69 MiB", charactersText: "1,283,633", utf8Bytes: bytes },
      showEntryTime: true, exportBusy: false, expandBusy: !idle && indicator === "busy", baselineBusy: false,
      recoveryFailureStreak: !idle && indicator === "unavailable" ? 3 : 0, baselineFailureThreshold: 3,
      unverifiedResponseStreak: !idle && indicator === "attention" ? 1 : 0, automaticRecoveryThreshold: 1,
      capacityBackground: { enabled: true, ...[{ secondKB: 4000, thirdKB: 8000 }, { secondKB: 2000, thirdKB: 4000 }, { secondKB: 400, thirdKB: 800 }][stage] } };
  }
  function baseBackgroundImage(input, inputAssets, mode, stage, includeHidden = false) {
    const background = input.theme[mode].background;
    if (!includeHidden && stage >= background.sources.length) stage = 0;
    const node = canvas(background.width, background.height), ctx = node.getContext("2d");
    if (!input.backgroundEnabled[mode] || input.stageEnabled[mode][stage] === false) return node;
    if (input.backgroundFill[mode] !== null) {
      ctx.fillStyle = input.backgroundFill[mode]; ctx.fillRect(0, 0, node.width, node.height); return node;
    }
    const index = input.backgrounds[mode][stage] ? stage : 0;
    if (index !== stage && input.stageEnabled[mode][index] === false) return node;
    const image = inputAssets.get(`${mode}.background.${index}`);
    const placement = input.placements[mode][index];
    if (image && placement) images.draw(ctx, image, placement.x, placement.y, placement.width, placement.height);
    return node;
  }
  function hasPlacementBackground(input, inputAssets) {
    return input.placementBackground.enabled && inputAssets.has("conversation.placementBackground");
  }
  function backgroundColor(input, inputAssets, mode) {
    if (mode === "conversation" && hasPlacementBackground(input, inputAssets)) {
      // A shared semantic mask is safe only when no main picture/fill contributes to any stage.
      const hasMain = input.backgroundEnabled[mode] && input.theme[mode].background.sources.some((_, stage) => {
        if (input.stageEnabled[mode][stage] === false) return false;
        const index = input.backgrounds[mode][stage] ? stage : 0;
        return input.backgroundFill[mode] !== null || (input.stageEnabled[mode][index] !== false
          && inputAssets.has(`${mode}.background.${index}`) && input.placements[mode][index]);
      });
      return !hasMain && input.placementBackground.fill === null ? input.placementBackground.color : undefined;
    }
    return input.backgroundFill[mode] === null ? input.backgroundColors[mode] : undefined;
  }
  function placementBackgroundImage(input, inputAssets, preserveSemantic = false) {
    const source = inputAssets.get("conversation.placementBackground"), box = input.placementBackground;
    const color = box.fill ?? (preserveSemantic ? undefined : box.color);
    if (!color) return source;
    const image = canvas(source.width, source.height), ctx = image.getContext("2d");
    ctx.drawImage(source, 0, 0); ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = resolvedColor(color); ctx.fillRect(0, 0, image.width, image.height);
    return image;
  }
  function backgroundImage(input, inputAssets, mode, stage, includeHidden = false) {
    const node = baseBackgroundImage(input, inputAssets, mode, stage, includeHidden);
    if (mode !== "conversation" || !hasPlacementBackground(input, inputAssets)) return node;
    const ctx = node.getContext("2d"), color = input.backgroundColors[mode];
    if (color && input.backgroundFill[mode] === null) {
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = color.startsWith("#") ? color : resolvedColor(color);
      ctx.fillRect(0, 0, node.width, node.height); ctx.globalCompositeOperation = "source-over";
    }
    const box = input.placementBackground;
    ctx.save(); ctx.beginPath(); ctx.rect(0, node.height - 168, 256, 168); ctx.clip();
    images.draw(ctx, placementBackgroundImage(input, inputAssets, Boolean(backgroundColor(input, inputAssets, mode))),
      box.x, node.height - 168 + box.y, box.width, box.height);
    ctx.restore(); return node;
  }
  function backgroundEditTarget() {
    const mode = $("mode").value, stage = Number($("stage").value);
    if (mode !== "conversation") return null;
    const layer = selected === "placementBackground";
    if (layer ? !hasPlacementBackground(state, assets) : selected !== "background" || !state.backgroundEnabled[mode]
      || state.stageEnabled[mode][stage] === false || state.backgroundFill[mode] !== null || !state.placements[mode][stage]) return null;
    return { mode, stage, layer, frame: layer ? state.theme[mode] : state.theme[mode].background,
      placement: layer ? state.placementBackground : state.placements[mode][stage],
      image: assets.get(layer ? "conversation.placementBackground" : `${mode}.background.${stage}`) };
  }
  function updateBackgroundEditor() {
    const frame = $("preview").querySelector(".background-edit"), target = backgroundEditTarget();
    const image = document.getElementById("chatcouter-root").shadowRoot.querySelector(".image-edit-preview canvas");
    if (!frame || !target || !image) return;
    const { placement, frame: background } = target;
    const dragging = gesture?.kind === "background";
    image.style.visibility = dragging ? "visible" : "hidden";
    image.parentElement.querySelector(".image-edit-final").style.visibility = dragging ? "hidden" : "visible";
    image.style.transform = `translate(${placement.x}px,${placement.y}px) scale(${placement.width / image.width},${placement.height / image.height})`;
    frame.querySelector(".background-outline").style.cssText = `left:${placement.x}px;top:${placement.y}px;width:${placement.width}px;height:${placement.height}px`;
    updateHandles(frame, placement);
    updateWorkspaceSpace();
    frame.dataset.snapped = String(Boolean(gesture) && (placement.x === 0 || placement.y === 0
      || placement.x + placement.width === background.width || placement.y + placement.height === background.height));
  }
  function backgroundEditor(frame) {
    const target = backgroundEditTarget();
    if (!target) return;
    const { mode, layer: editingLayer } = target;
    const source = editingLayer ? placementBackgroundImage(state, assets) : target.image;
    const shadow = document.getElementById("chatcouter-root").shadowRoot;
    shadow.querySelector(".image-edit-preview")?.remove();
    const clip = document.createElement("div"); clip.className = "image-edit-preview";
    clip.style.cssText = `position:absolute;left:0;bottom:0;width:${target.frame.width}px;height:${target.frame.height}px;overflow:hidden;pointer-events:none`;
    const image = canvas(source.naturalWidth || source.width, source.naturalHeight || source.height), ctx = image.getContext("2d");
    image.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none";
    ctx.drawImage(source, 0, 0);
    const color = editingLayer ? undefined : state.backgroundColors[mode];
    if (color) { ctx.globalCompositeOperation = "source-in"; ctx.fillStyle = color.startsWith("#") ? color : resolvedColor(color); ctx.fillRect(0, 0, image.width, image.height); }
    clip.append(image);
    // Final editing appearance uses exactly the same bounded resampling as export.
    // During a gesture only the reusable original's CSS transform changes.
    const finalImage = canvas(target.frame.width, target.frame.height), finalContext = finalImage.getContext("2d");
    finalImage.className = "image-edit-final";
    finalImage.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
    images.draw(finalContext, image, target.placement.x, target.placement.y, target.placement.width, target.placement.height);
    clip.append(finalImage);
    if (!editingLayer && hasPlacementBackground(state, assets)) {
      const layer = canvas(256, 168), box = state.placementBackground;
      images.draw(layer.getContext("2d"), placementBackgroundImage(state, assets), box.x, box.y, box.width, box.height);
      layer.style.cssText = "position:absolute;left:0;bottom:0;pointer-events:none"; clip.append(layer);
    }
    // Keep the editable image below the real components; the outer editor owns only handles/outline.
    shadow.querySelector(".theme-background").after(clip);
    const outline = document.createElement("div"); outline.className = "background-outline"; frame.append(outline);
    for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      const handle = document.createElement("span"); handle.className = "handle"; handle.dataset.edge = edge;
      handle.title = t("editor_background_handles"); frame.append(handle);
    }
    if (!editingLayer) document.getElementById("chatcouter-root").shadowRoot.querySelector(".theme-background").style.visibility = "hidden";
    updateBackgroundEditor();
  }
  function paintPreview(shadow, stage, mode = $("mode").value, final = false) {
    const background = state.theme[mode].background;
    if (background && !final) {
      // The selected layer is drawn once by the reusable image editor, so drags only update its transform.
      const input = selected === "placementBackground" && !presenting
        ? { ...state, placementBackground: { ...state.placementBackground, enabled: false } } : state;
      const node = shadow.querySelector(".theme-background"), image = backgroundImage(input, assets, mode, stage);
      const url = image.toDataURL(), color = backgroundColor(input, assets, mode);
      node.style.cssText = `width:${background.width}px;height:${background.height}px;${color
        ? `background:${color.startsWith("#") ? color : `var(--${color})`};mask:url("${url}") 0 0 / 100% 100% no-repeat;mask-mode:alpha`
        : `background:url("${url}") 0 0 / 100% 100% no-repeat`}`;
    }
    if (mode === "conversation") {
      const primary = shadow.querySelector(".primary"), measure = shadow.querySelector(".measure");
      measure.dataset.numeric = String(!messagePreview);
      if (messagePreview) {
        const keys = ["measuring", "usage_unverified", "export_preparing", "expand_preparing", "export_failed_status", "expand_failed_status"];
        primary.textContent = keys.map(key => t(key)).reduce((a, b) => Array.from(a).length >= Array.from(b).length ? a : b);
      } else {
        primary.textContent = "1,283,633";
        const unit = document.createElement("span"); unit.className = "unit"; unit.textContent = t("character_unit"); primary.append(unit);
      }
    }
  }
  function updateHandles(node, box) {
    const layout = model.controlLayout(box, Number($("zoom").value));
    for (const handle of node.querySelectorAll(".handle")) {
      const point = layout.handles.find(point => point.edge === handle.dataset.edge);
      handle.hidden = !point;
      if (point) handle.style.cssText = `left:${point.x}px;top:${point.y}px`;
    }
  }
  function updateWorkspaceSpace() {
    if (!workspace) return;
    const target = backgroundEditTarget(), { zoom, left, top, width, height } = workspace;
    const box = target?.placement, y = target ? scene.height - target.frame.height : 0;
    const extra = box ? {
      left: Math.max(0, -(528 + box.x) * zoom + 12),
      top: Math.max(0, -(y + box.y) * zoom + 12),
      right: Math.max(0, (528 + box.x + box.width - scene.width) * zoom + 12),
      bottom: Math.max(0, (y + box.y + box.height - scene.height) * zoom + 12),
    } : { left: 0, top: 0, right: 0, bottom: 0 };
    $("preview-frame").style.cssText = `width:${width + extra.left + extra.right}px;height:${height + extra.top + extra.bottom}px`;
    $("preview").style.left = `${left + extra.left}px`; $("preview").style.top = `${top + extra.top}px`;
    // Growing space on the negative side must not move the image under the pointer.
    $("viewport").scrollLeft += extra.left - workspaceInsets.left;
    $("viewport").scrollTop += extra.top - workspaceInsets.top;
    workspaceInsets = extra;
  }
  function renderPreview() {
    if (!state || presenting) return;
    const mode = $("mode").value, spec = state.theme[mode], zoom = Number($("zoom").value);
    const home = mode === "idle", height = Math.max(spec.height, spec.background?.height || 0);
    $("viewport").dataset.scheme = $("scheme").value;
    const themeX = 528;
    scene = { width: themeX + spec.width, height: home ? 64 : 664 };
    const viewport = $("viewport"), marginX = viewport.clientWidth, marginY = viewport.clientHeight;
    const areaWidth = Math.max(viewport.clientWidth, scene.width * zoom + 40);
    const areaHeight = Math.max(viewport.clientHeight, scene.height * zoom + 40);
    const focusX = home || !$("composer-preview").checked ? themeX + spec.width / 2 : scene.width / 2;
    const top = home ? (areaHeight - scene.height * zoom) / 2 : areaHeight - scene.height * zoom - 20;
    workspace = { zoom, left: marginX + areaWidth / 2 - focusX * zoom, top: marginY + top,
      width: areaWidth + 2 * marginX, height: areaHeight + 2 * marginY };
    $("preview").style.cssText = `left:${workspace.left}px;top:${workspace.top}px;width:${scene.width}px;height:${scene.height}px;transform:scale(${zoom});--editor-zoom:${zoom}`;
    updateWorkspaceSpace();
    $("render-mount").style.cssText = `left:${themeX}px;top:${scene.height - height}px;width:${spec.width}px;height:${height}px`;
    $("overlay").style.cssText = `left:${themeX}px;bottom:0;width:${spec.width}px;height:${spec.height}px`;
    $("grid").hidden = !$("grid-enabled").checked;
    $("grid").style.cssText = `left:${themeX}px;bottom:0;width:${spec.width}px;height:${spec.height}px;background-size:${$("grid-gap").value}px ${$("grid-gap").value}px`;
    const guides = $("area-enabled").checked;
    $("component-guide").hidden = !guides;
    $("component-guide").style.cssText = `left:${themeX}px;bottom:0;width:${spec.width}px;height:${spec.height}px`;
    $("background-guide").hidden = !guides || home;
    $("background-guide").style.cssText = `left:${themeX}px;bottom:0;width:${spec.width}px;height:640px`;
    $("guide-legend").hidden = !guides;
    $("component-legend").textContent = `${t("editor_component_area")} ${spec.width} × ${spec.height} px`;
    $("background-legend").hidden = home;
    $("composer").hidden = !$("composer-preview").checked;
    $("composer-help").hidden = home || !$("composer-preview").checked;
    $("composer").style.bottom = home ? "4px" : "24px";
    meter.setLayout({ ...state.theme, atlasUrl }); meter.render(view());
    paintPreview(document.getElementById("chatcouter-root").shadowRoot, Number($("stage").value));
    $("render-mount").append(document.getElementById("chatcouter-root"));
    $("dimensions").textContent = `${t("editor_component_area")} ${spec.width} × ${spec.height} px${spec.background ? ` · ${t("editor_background")} ${spec.background.width} × ${spec.background.height} px · ${t("editor_maximum")} ${spec.width} × 640 px` : ""}`;
    $("overlay").replaceChildren();
    $("overlay").style.pointerEvents = ["background", "placementBackground"].includes(selected) ? "none" : "auto";
    $("preview").querySelector(".background-edit")?.remove();
    if (["background", "placementBackground"].includes(selected) && !home) {
      const frame = selected === "placementBackground" ? spec : spec.background;
      const node = document.createElement("div"); node.className = "background-edit";
      node.dataset.layer = selected;
      node.style.cssText = `left:${themeX}px;bottom:0;width:${frame.width}px;height:${frame.height}px`;
      $("preview").append(node);
      backgroundEditor(node);
    }
    for (const [role, box] of Object.entries(spec.components)) if (contract.active(box)) {
      const node = document.createElement("div"); node.className = "edit-box";
      node.dataset.role = role; node.tabIndex = 0; node.setAttribute("role", "button");
      node.setAttribute("aria-label", label(role)); node.setAttribute("aria-pressed", String(selected === role));
      node.style.cssText = `left:${box.x}px;bottom:${box.y}px;width:${box.width}px;height:${box.height}px`;
      for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
        const handle = document.createElement("span"); handle.className = "handle"; handle.dataset.edge = edge; node.append(handle);
      }
      updateHandles(node, { x: 0, y: 0, width: box.width, height: box.height });
      $("overlay").append(node);
    }
    updateOverlapWarning();
  }
  function resetView() {
    if (!state || !scene) return;
    const viewport = $("viewport"), zoom = Number($("zoom").value);
    viewport.scrollLeft = workspaceInsets.left + viewport.clientWidth + Math.max(0, (scene.width * zoom + 40 - viewport.clientWidth) / 2);
    viewport.scrollTop = workspaceInsets.top + viewport.clientHeight + Math.max(0, $("mode").value === "idle" ? (scene.height * zoom + 40 - viewport.clientHeight) / 2 : scene.height * zoom + 40 - viewport.clientHeight);
  }
  function zoomTo(value, clientX, clientY) {
    if (!state || busy) return;
    const before = $("preview").getBoundingClientRect(), oldZoom = Number($("zoom").value);
    const viewport = $("viewport"), rect = viewport.getBoundingClientRect();
    clientX ??= rect.left + viewport.clientWidth / 2; clientY ??= rect.top + viewport.clientHeight / 2;
    const x = (clientX - before.left) / oldZoom, y = (clientY - before.top) / oldZoom;
    $("zoom").value = String(value); renderPreview();
    const after = $("preview").getBoundingClientRect();
    viewport.scrollLeft += after.left + x * value - clientX;
    viewport.scrollTop += after.top + y * value - clientY;
  }
  const label = role => t(role === "symbol" && $("mode").value === "idle" ? "editor_icon" : role === "measure" && $("mode").value === "idle" ? "editor_name" : role === "export" ? "editor_export_label" : `editor_${role}`);
  function renderList() {
    $("components").replaceChildren();
    const home = $("mode").value === "idle";
    const groups = home ? [["symbol"], ["measure"]] : [["background"], ["placementBackground"], ["secondary"], ["symbol"], ["expand", "expandIcon"], ["export", "exportIcon"], ["entryTime"]];
    for (const group of groups) {
      const row = document.createElement("div"); row.className = "component-row";
      if (group.length > 1) { const name = document.createElement("span"); name.className = "group-name"; name.textContent = t(group[0] === "expand" ? "expand_button" : "export_button"); row.append(name); }
      for (const role of group) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = group.length > 1 ? t(role.endsWith("Icon") ? "editor_icon" : "editor_text") : label(role);
      button.dataset.select = role; button.setAttribute("aria-label", label(role));
      button.setAttribute("aria-pressed", String(selected === role));
      button.addEventListener("click", () => { if (!busy) { selected = role; render(); } }); row.append(button);
      if (role === "placementBackground") {
        const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.dataset.toggle = role;
        toggle.checked = state.placementBackground.enabled; toggle.setAttribute("aria-label", label(role));
        toggle.addEventListener("change", () => backgroundChange(() => { state.placementBackground.enabled = toggle.checked; }));
        row.append(toggle);
      } else if (role === "background") {
        const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.dataset.toggle = role;
        toggle.checked = state.backgroundEnabled.conversation; toggle.setAttribute("aria-label", label(role));
        toggle.addEventListener("change", () => { state.backgroundEnabled.conversation = toggle.checked; dirty = true; render(); message("editor_changed"); });
        row.append(toggle);
      } else {
        const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.dataset.toggle = role;
        toggle.checked = contract.active(state.theme[$("mode").value].components[role]); toggle.setAttribute("aria-label", label(role));
        toggle.addEventListener("change", () => {
          try { state = model.toggle(state, $("mode").value, role, toggle.checked); dirty = true; message("editor_changed"); }
          catch (error) { errorMessage(error); }
          render();
        }); row.append(toggle);
      }
      }
      $("components").append(row);
    }
  }
  function field(parent, key, value, change, { number = false, options, wide = false, min, max } = {}) {
    const wrapper = document.createElement("label"); wrapper.className = `field${wide ? " wide" : ""}`;
    const caption = document.createElement("span"); caption.textContent = t(`editor_${key}`);
    const input = document.createElement(options ? "select" : "input"); input.dataset.field = key;
    if (options) for (const [optionValue, text] of options) {
      const option = document.createElement("option"); option.value = optionValue; option.textContent = text; input.append(option);
    }
    else if (number) { input.type = "number"; input.step = "1"; if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; }
    else input.type = "text";
    input.value = value;
    input.addEventListener("change", () => {
      if (busy) return;
      try {
        const next = number ? Number(input.value) : input.value;
        if (number && (!input.value.trim() || !Number.isInteger(next))) throw new Error("editor-integer");
        change(next);
      } catch (error) { errorMessage(error); renderDetails(); }
    });
    wrapper.append(caption, input); parent.append(wrapper); return input;
  }
  function hint(parent, key) { const p = document.createElement("p"); p.className = "hint"; p.textContent = t(key); parent.append(p); }
  function upload(parent, key, handle) {
    const wrapper = document.createElement("label"); wrapper.className = "upload"; wrapper.textContent = t(key);
    const input = document.createElement("input"); input.type = "file"; input.accept = ".png,image/png";
    input.dataset.upload = key;
    input.addEventListener("change", () => {
      const file = input.files[0]; input.value = "";
      if (file) task(async () => {
        if (file.size > model.limits.sourceBytes) throw new Error("editor-source-size");
        const bytes = new Uint8Array(await file.arrayBuffer());
        try { contract.inspectPng(bytes, { maxBytes: model.limits.sourceBytes }); }
        catch { throw new Error("editor-source-size"); }
        const image = await decode(bytes);
        await handle(image); message("editor_changed");
      });
    }); wrapper.append(input); parent.append(wrapper);
  }
  function modify(changes) {
    state = model.edit(state, $("mode").value, selected, changes); dirty = true;
    renderPreview(); message("editor_changed");
  }
  function resolvedColor(value) {
    if (value?.startsWith("#")) return value;
    const shadow = document.getElementById("chatcouter-root").shadowRoot;
    const node = document.createElement("span"); node.style.color = `var(--${value || "ink"})`;
    shadow.querySelector(".controls").append(node);
    const channels = global.getComputedStyle(node).color.match(/[\d.]+/g)?.map(Number) || [77, 115, 165]; node.remove();
    return "#" + channels.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
  }
  function checkField(parent, key, checked, change) {
    const wrapper = document.createElement("label"); wrapper.className = "check wide";
    const node = document.createElement("input"); node.type = "checkbox"; node.checked = checked; node.dataset.field = key;
    node.addEventListener("change", () => { if (!busy && !presenting) change(node.checked); });
    wrapper.append(node, document.createTextNode(t(`editor_${key}`))); parent.append(wrapper); return node;
  }
  function button(parent, key, click) {
    const node = document.createElement("button"); node.type = "button"; node.textContent = t(key); node.dataset.action = key;
    node.addEventListener("click", click); parent.append(node); return node;
  }
  function colorField(parent, value, apply, key = "color", allowOriginal = false, customOnly = false) {
    const current = value ?? "original", id = `${$("mode").value}.${selected}.${key}`;
    const choice = customOnly ? "custom" : colorModes.get(id) ?? (allowOriginal ? (current.startsWith("#") ? "custom" : current) : "custom");
    const custom = choice === "custom", code = current.startsWith("#") ? current : resolvedColor(current === "original" ? "ink" : current);
    const options = [...(allowOriginal ? [["original", t("editor_original_color")]] : []),
      ["ink", t("editor_ink_color")], ["muted", t("editor_muted_color")], ["line", t("editor_line_color")], ["custom", t("editor_custom_color")]];
    if (!customOnly) field(parent, key, choice, next => {
      colorModes.set(id, next);
      apply(next === "original" ? undefined : next === "custom" ? code : next); renderDetails();
    }, { options, wide: true });
    if (custom) {
      const input = field(parent, "color_code", code, next => {
        if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(next)) throw new Error("theme-font");
        apply(next); renderDetails();
      }, { wide: true });
      const picker = document.createElement("input"); picker.type = "color";
      picker.setAttribute("aria-label", t("editor_pick_color")); picker.value = code.slice(0, 7);
      picker.addEventListener("change", () => { if (!busy) { apply(picker.value); renderDetails(); } });
      input.parentElement.append(picker);
    }
    if (!customOnly) hint(parent, "editor_adaptive_color_hint");
    if (!customOnly && !allowOriginal && custom && !current.startsWith("#")) hint(parent, "editor_semantic_color_hint");
  }
  function backgroundChange(change) {
    change(); dirty = true; render(); message("editor_changed");
  }
  function renderDetails() {
    const root = $("details"); root.replaceChildren();
    if (!selected) { hint(root, "editor_select_hint"); return; }
    const title = document.createElement("h2"); title.textContent = label(selected); root.append(title);
    const mode = $("mode").value, spec = state.theme[mode];
    const fields = document.createElement("div"); fields.className = "fields"; root.append(fields);
    if (selected === "background") {
      fields.classList.add("background-settings");
      checkField(fields, "stages", spec.background.sources.length > 1, checked => task(async () => {
        const next = clone(state);
        while (next.backgrounds[mode].length < 3) { next.backgrounds[mode].push(null); next.placements[mode].push(null); next.stageEnabled[mode].push(true); }
        const first = clone(next.theme[mode].background.sources[0]);
        next.theme[mode].background.sources = checked ? [first, first, first] : [first];
        const result = await packed(next, assets, true); install(result.state, result.assets, result.blob); message("editor_changed");
      }));
      fields.append($("stage-control"));
      checkField(fields, "stage_visible", state.stageEnabled[mode][Number($("stage").value)] !== false,
        checked => backgroundChange(() => { state.stageEnabled[mode][Number($("stage").value)] = checked; }));
      field(fields, "image_mode", state.backgroundFill[mode] === null ? "original" : "fill", value => backgroundChange(() => {
        state.backgroundFill[mode] = value === "fill" ? "#4d73a5" : null;
        delete spec.background.color;
        state.backgroundColors[mode] = undefined;
      }), { options: [["original", t("editor_source_image")], ["fill", t("editor_solid_fill")]], wide: true });
      if (state.backgroundFill[mode] !== null) colorField(fields, state.backgroundFill[mode], value => backgroundChange(() => {
        state.backgroundFill[mode] = value;
      }), "color", false, true);
      const stage = Number($("stage").value), placement = state.placements[mode][stage];
      upload(root, `editor_load_stage${stage + 1}`, async image => {
        const map = new Map(assets); map.set(`${mode}.background.${stage}`, image);
        const next = clone(state); delete next.theme[mode].background.color;
        next.backgroundColors[mode] = undefined;
        next.backgroundFill[mode] = null; next.stageEnabled[mode][stage] = true;
        next.backgrounds[mode][stage] ||= { x: 0, y: 0, width: spec.background.width, height: spec.background.height };
        next.placements[mode][stage] = { x: 0, y: 0, ...model.backgroundSize(image.width, image.height, mode), locked: true };
        const result = await packed(next, map, true); install(result.state, result.assets, result.blob);
      });
      if (placement && state.backgroundFill[mode] === null) {
        const actions = document.createElement("div"); actions.className = "placement-actions"; root.append(actions);
        for (const action of ["contain", "cover", "bottom"]) button(actions, `editor_align_${action}`, () => backgroundChange(() => {
          state.placements[mode][stage] = model.alignImage(state.placements[mode][stage], spec.background, action);
        }));
        const imageFields = document.createElement("div"); imageFields.className = "fields"; root.append(imageFields);
        const image = assets.get(`${mode}.background.${stage}`);
        const original = document.createElement("p"); original.className = "hint";
        original.textContent = `${t("editor_source_image")} ${image.width} × ${image.height} px`; root.append(original);
        for (const key of ["x", "y", "width", "height"]) field(imageFields, `image_${key}`, placement[key], value => {
          state.placements[mode][stage] = model.placement(state.placements[mode][stage], { [key]: value });
          dirty = true; renderPreview(); renderDetails(); message("editor_changed");
        }, { number: true, min: ["x", "y"].includes(key) ? -16384 : 1, max: 16384 });
        checkField(imageFields, "keep_ratio", placement.locked, checked => { state.placements[mode][stage].locked = checked; });
      } else if (!placement && state.backgrounds[mode][0]) hint(root, "editor_stage_fallback");
      if (stage > 0 && placement) {
      const remove = button(root, "editor_remove_stage", () => task(async () => {
        const next = clone(state), map = new Map(assets);
        next.backgrounds[mode][stage] = null; next.placements[mode][stage] = null; next.theme[mode].background.sources[stage] = null;
        map.delete(`${mode}.background.${stage}`);
        const result = await packed(next, map, true); install(result.state, result.assets, result.blob); message("editor_changed");
      }));
      remove.title = t("editor_remove_stage"); remove.setAttribute("aria-label", remove.title); remove.textContent = t("editor_remove_short"); remove.className = "small-button";
      }
      const help = document.createElement("details"); help.className = "editor-help";
      const summary = document.createElement("summary"); summary.textContent = t("editor_background_help"); help.append(summary);
      hint(help, "editor_frame_hint"); hint(help, "editor_background_hint"); hint(help, "editor_background_handles"); root.append(help); return;
    }
    if (selected === "placementBackground") {
      const placement = state.placementBackground;
      upload(root, "editor_load_image", async image => {
        const next = clone(state), map = new Map(assets);
        map.set("conversation.placementBackground", image);
        next.placementBackground = { enabled: true, x: 0, y: 0, ...model.graphicSize(image.width, image.height), locked: true, fill: null };
        const result = await packed(next, map, true); install(result.state, result.assets, result.blob);
      });
      if (assets.has("conversation.placementBackground")) {
        field(fields, "image_mode", placement.fill === null ? "original" : "fill", value => backgroundChange(() => {
          state.placementBackground.fill = value === "fill" ? "#4d73a5" : null;
        }), { options: [["original", t("editor_source_image")], ["fill", t("editor_solid_fill")]], wide: true });
        if (placement.fill !== null) colorField(fields, placement.fill, value => backgroundChange(() => {
          state.placementBackground.fill = value;
        }), "color", false, true);
        const actions = document.createElement("div"); actions.className = "placement-actions"; root.append(actions);
        for (const action of ["contain", "cover", "bottom"]) button(actions, `editor_align_${action}`, () => backgroundChange(() => {
          state.placementBackground = model.alignImage(state.placementBackground, spec, action);
        }));
        for (const key of ["x", "y", "width", "height"]) field(fields, `image_${key}`, placement[key], value => backgroundChange(() => {
          state.placementBackground = model.placement(state.placementBackground, { [key]: value });
        }), { number: true, min: ["x", "y"].includes(key) ? -16384 : 1, max: 16384 });
        checkField(fields, "keep_ratio", placement.locked, checked => { state.placementBackground.locked = checked; });
        button(root, "editor_remove_short", () => backgroundChange(() => {
          state.placementBackground.enabled = false; assets.delete("conversation.placementBackground");
        })).className = "small-button";
      }
      const help = document.createElement("details"); help.className = "editor-help";
      const summary = document.createElement("summary"); summary.textContent = t("editor_placement_background_help"); help.append(summary);
      hint(help, "editor_placement_background_hint"); hint(help, "editor_background_handles"); root.append(help); return;
    }
    const box = spec.components[selected];
    if (!contract.active(box)) { hint(root, "editor_off_hint"); return; }
    for (const key of ["x", "y", "width", "height"]) field(fields, key, box[key], value => {
      if (box.paint && state.theme[mode].components[selected].fit !== "stretch" && ["width", "height"].includes(key)) {
        const current = state.theme[mode].components[selected], ratio = current.width / current.height;
        const changes = key === "width" ? { width: value, height: Math.round(value / ratio) } : { height: value, width: Math.round(value * ratio) };
        modify(changes); renderDetails();
      } else modify({ [key]: value });
    },
      { number: true, min: ["x", "y"].includes(key) ? 0 : contract.limits.componentMin, max: ["x", "width"].includes(key) ? spec.width : spec.height });
    if (box.text) {
      const style = box.text;
      const update = (key, value) => modify({ text: { ...state.theme[mode].components[selected].text, [key]: value } });
      const family = field(fields, "family", style.family, value => update("family", value), { wide: true });
      family.parentElement.classList.add("family-field");
      const restore = button(family.parentElement, "editor_restore_family", () => { update("family", defaults[mode].components[selected]?.text?.family || "system-ui"); renderDetails(); });
      restore.title = t("editor_restore_family"); restore.setAttribute("aria-label", restore.title); restore.textContent = "↺";
      const shortcut = document.createElement("a"); shortcut.className = "font-shortcut wide";
      shortcut.href = "ms-settings:fonts"; shortcut.textContent = t("editor_windows_fonts");
      shortcut.title = t("editor_windows_fonts_hint"); fields.append(shortcut);
      field(fields, "size", style.size, value => update("size", value), { number: true, min: contract.limits.fontMin, max: contract.limits.fontMax });
      field(fields, "weight", style.weight, value => update("weight", Number(value)), { options: [400, 500, 600, 700].map(n => [String(n), String(n)]) });
      field(fields, "align", style.align || "left", value => update("align", value), { options: ["left", "center", "right"].map(v => [v, t(`editor_${v}`)]), wide: true });
      colorField(fields, style.color, value => update("color", value));
      if (mode === "conversation" && selected === "measure") {
        const checkbox = checkField(fields, "message_preview", messagePreview, checked => { messagePreview = checked; renderPreview(); });
        checkbox.id = "message-preview";
      }
      const help = document.createElement("details"); help.className = "editor-help";
      const summary = document.createElement("summary"); summary.textContent = t("editor_text_help"); help.append(summary);
      for (const note of fields.querySelectorAll(":scope > .hint")) help.append(note);
      hint(help, "editor_font_hint"); root.append(help);
    } else {
      checkField(fields, "keep_ratio", box.fit !== "stretch", checked => { modify({ fit: checked ? "contain" : "stretch" }); });
      const isStatus = selected === "symbol" && mode === "conversation";
      if (isStatus) {
        field(fields, "shape", state.shapes[`${mode}.${selected}`] || "custom", shape => task(async () => {
          if (shape === "custom") { state.shapes[`${mode}.${selected}`] = "custom"; return; }
          const image = canvas(64, 64), ctx = image.getContext("2d"); ctx.fillStyle = "#ffffff";
          if (shape === "circle") { ctx.beginPath(); ctx.arc(32, 32, 32, 0, 2 * Math.PI); ctx.fill(); }
          else if (shape === "square") ctx.fillRect(0, 0, 64, 64);
          else { ctx.beginPath(); ctx.moveTo(32, 0); ctx.lineTo(64, 64); ctx.lineTo(0, 64); ctx.closePath(); ctx.fill(); }
          await replaceGraphic(image, true, shape); message("editor_changed");
        }), { options: ["custom", "circle", "square", "triangle"].map(value => [value, t(`editor_${value}`)]), wide: true });
      } else {
        field(fields, "image_mode", box.fill === undefined ? "original" : "fill", value => {
          const changes = { fill: value === "fill" ? "#4d73a5" : undefined };
          if (value === "original") changes.paint = state.theme[mode].components[selected].paint.map(layer => ({ source: clone(layer.source) }));
          modify(changes); renderDetails();
        }, { options: [["original", t("editor_source_image")], ["fill", t("editor_solid_fill")]], wide: true });
        if (box.fill !== undefined) colorField(fields, box.fill, value => modify({ fill: value }), "color", false, true);
      }
      upload(root, isStatus ? "editor_load_status" : "editor_load_image", image => replaceGraphic(image, isStatus));
      if (["expandIcon", "exportIcon"].includes(selected)) {
        button(root, "editor_remove_short", () => task(async () => {
          await replaceGraphic(canvas(1, 1), false); message("editor_changed");
        })).className = "small-button";
        hint(root, "editor_transparent_icon_hint");
      }
      hint(root, selected === "symbol" && mode !== "idle" ? "editor_indicator_hint" : "editor_image_hint");
    }
  }
  async function replaceGraphic(image, isStatus, shape = "custom") {
    const mode = $("mode").value, role = selected, next = clone(state), map = new Map(assets);
    map.set(`${mode}.${role}.0`, image);
    const box = next.theme[mode].components[role];
    box.paint = [{ source: { x: 0, y: 0, width: image.width, height: image.height }, ...(isStatus ? { color: "status" } : {}) }];
    delete box.fill;
    if (isStatus) next.shapes[`${mode}.${role}`] = shape;
    const result = await packed(next, map, true); install(result.state, result.assets, result.blob);
  }
  const previewCards = [];
  function renderActualPreview() {
    const all = Boolean(pendingExport), count = all ? 4 : $("mode").value === "idle" ? 1 : 3;
    $("actual-preview").dataset.scheme = $("scheme").value;
    for (let i = 0; i < 4; i++) {
      if (!previewCards[i]) {
        const card = document.createElement("section"); card.className = "appearance-card"; card.dataset.stage = i;
        const title = document.createElement("h2"), note = document.createElement("p"), mount = document.createElement("div");
        mount.inert = true;
        note.className = "hint"; card.append(title, note, mount); $("actual-preview").append(card);
        const scope = mount.attachShadow({ mode: "open" });
        const doc = { createElement: document.createElement.bind(document), createElementNS: document.createElementNS.bind(document),
          getElementById: id => scope.getElementById(id), documentElement: scope, fonts: document.fonts };
        const ui = ns.meterUi.create({ document: doc, window: global, getComposer: () => null,
          onMeasure() {}, onExport() {}, onExpand() {}, onOptions() {}, editing: true });
        previewCards[i] = { card, title, note, scope, ui };
      }
      const item = previewCards[i]; item.card.hidden = i >= count;
      if (i >= count) continue;
      const mode = all ? i === 3 ? "idle" : "conversation" : $("mode").value;
      const stage = mode === "idle" ? 0 : i;
      const theme = pendingExport?.theme || state.theme, url = pendingExport?.url || atlasUrl;
      item.card.dataset.mode = mode;
      item.title.textContent = mode === "idle" ? t("editor_home") : `${t("editor_stage")} ${stage + 1}`;
      item.note.textContent = mode === "conversation" && !theme.conversation.background.sources[stage] ? t("editor_stage_fallback") : "";
      item.ui.setLayout({ ...theme, atlasUrl: url }); item.ui.render(view(stage, mode));
      paintPreview(item.scope.getElementById("chatcouter-root").shadowRoot, stage, mode, all);
      item.scope.getElementById("chatcouter-root").style.cssText = "display:block;position:relative;pointer-events:none";
    }
  }
  function render() {
    if (!state) return;
    const sources = state.theme[$("mode").value].background?.sources || [null];
    const stage = Math.min(Number($("stage").value) || 0, sources.length - 1);
    $("stage").replaceChildren(...sources.map((_, i) => { const node = document.createElement("option"); node.value = i; node.textContent = i + 1; return node; }));
    $("stage").value = stage;
    $("stage-control").hidden = $("mode").value === "idle" || selected !== "background";
    $("indicator").parentElement.hidden = $("mode").value === "idle";
    $("indicator").disabled = busy || $("mode").value === "idle";
    renderPreview(); renderList(); renderDetails();
    if (presenting) renderActualPreview();
  }
  function edgeAt(event, node) {
    if (event.target.dataset.edge) return event.target.dataset.edge;
    return model.resizeEdge(node.getBoundingClientRect(), event.clientX, event.clientY);
  }
  $("viewport").addEventListener("pointerdown", event => {
    const node = event.target.closest(".edit-box"); if (busy || presenting || event.button !== 0) return;
    event.preventDefault();
    const viewport = $("viewport");
    viewport.focus({ preventScroll: true });
    if (!spaceDown && event.target.closest(".background-edit")) {
      const target = backgroundEditTarget();
      if (!target) return;
      const { mode, stage, layer, frame, placement } = target;
      gesture = { kind: "background", pointer: event.pointerId, mode, stage, layer, frame, placement: clone(placement),
        edge: event.target.dataset.edge || "", x: event.clientX, y: event.clientY, before: state, dirty };
      updateBackgroundEditor();
      viewport.setPointerCapture(event.pointerId); return;
    }
    if (spaceDown || !node) {
      gesture = { kind: "pan", pointer: event.pointerId, x: event.clientX, y: event.clientY,
        left: viewport.scrollLeft, top: viewport.scrollTop, blank: !spaceDown && !node, moved: false };
      viewport.dataset.panning = "true"; viewport.setPointerCapture(event.pointerId); return;
    }
    selected = node.dataset.role;
    const mode = $("mode").value;
    gesture = { pointer: event.pointerId, mode, role: selected, box: clone(state.theme[mode].components[selected]),
      x: event.clientX, y: event.clientY, edge: edgeAt(event, node), before: state, dirty };
    viewport.setPointerCapture(event.pointerId); render();
  });
  $("viewport").addEventListener("pointermove", event => {
    if (!gesture) {
      const node = event.target.closest(".edit-box"); if (!node) return;
      const edge = edgeAt(event, node);
      node.style.cursor = !edge ? "move" : ["n", "s"].includes(edge) ? "ns-resize" : ["e", "w"].includes(edge) ? "ew-resize" : ["ne", "sw"].includes(edge) ? "nesw-resize" : "nwse-resize";
      return;
    }
    if (event.pointerId !== gesture.pointer) return;
    if (gesture.kind === "pan") {
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.hypot(dx, dy) > 3) gesture.moved = true;
      $("viewport").scrollLeft = gesture.left - dx; $("viewport").scrollTop = gesture.top - dy; return;
    }
    const zoom = Number($("zoom").value), g = gesture;
    if (g.kind === "background") {
      backgroundPointer = { x: event.clientX, y: event.clientY };
      if (!backgroundFrame) backgroundFrame = global.requestAnimationFrame(applyBackgroundPointer);
      return;
    }
    const changes = model.drag(g.box, g.edge, (event.clientX - g.x) / zoom, (g.y - event.clientY) / zoom, state.theme[g.mode], Boolean(g.box.paint && g.box.fit !== "stretch"));
    try {
      state = model.edit(state, g.mode, g.role, changes); dirty = true;
      renderPreview();
      for (const [key, value] of Object.entries(changes)) { const input = document.querySelector(`[data-field="${key}"]`); if (input) input.value = value; }
      message("editor_changed");
    } catch (error) { errorMessage(error); }
  });
  function applyBackgroundPointer() {
    backgroundFrame = 0;
    const g = gesture, point = backgroundPointer; backgroundPointer = null;
    if (g?.kind !== "background" || !point) return;
    try {
      const zoom = Number($("zoom").value), next = clone(state);
      const placement = model.backgroundDrag(g.placement, g.edge, (point.x - g.x) / zoom, (point.y - g.y) / zoom,
        g.frame, 6 / zoom);
      if (g.layer) next.placementBackground = placement;
      else next.placements[g.mode][g.stage] = placement;
      state = next; dirty = true; updateBackgroundEditor();
      for (const key of ["x", "y", "width", "height"]) {
        const input = document.querySelector(`[data-field="image_${key}"]`); if (input) input.value = placement[key];
      }
      message("editor_changed");
    } catch (error) { errorMessage(error); }
  }
  function finishGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (backgroundFrame) global.cancelAnimationFrame(backgroundFrame);
    backgroundFrame = 0;
    if (gesture.kind === "background" && event.type === "pointerup") applyBackgroundPointer();
    backgroundPointer = null;
    if (gesture.kind === "pan") {
      if (gesture.blank && !gesture.moved && event.type === "pointerup") selected = null;
      $("viewport").dataset.panning = "false";
    } else if (event.type === "pointercancel") { state = gesture.before; dirty = gesture.dirty; }
    gesture = null; render();
  }
  $("viewport").addEventListener("pointerup", finishGesture);
  $("viewport").addEventListener("pointercancel", finishGesture);
  $("viewport").addEventListener("keydown", event => {
    const role = event.target.closest(".edit-box")?.dataset.role || selected;
    if (!role || role === "background" || busy || presenting || spaceDown || !state.theme[$("mode").value].components[role]) return;
    if (event.key === "Enter") { event.preventDefault(); selected = role; render(); return; }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (!delta) return;
    event.preventDefault(); selected = role;
    try {
      const mode = $("mode").value, spec = state.theme[mode];
      state = model.edit(state, mode, role, model.drag(spec.components[role], "", ...delta, spec)); dirty = true;
      render(); $("overlay").querySelector(`[data-role="${role}"]`)?.focus(); message("editor_changed");
    } catch (error) { errorMessage(error); }
  });
  $("mode").addEventListener("change", () => { selected = null; render(); resetView(); });
  let previousZoom = Number($("zoom").value);
  $("zoom").addEventListener("change", () => { const value = Number($("zoom").value); $("zoom").value = String(previousZoom); zoomTo(value); previousZoom = value; });
  $("viewport").addEventListener("wheel", event => {
    if (!event.ctrlKey || busy) return;
    event.preventDefault();
    const index = zoomSteps.indexOf(Number($("zoom").value));
    const value = zoomSteps[Math.max(0, Math.min(zoomSteps.length - 1, index + (event.deltaY < 0 ? 1 : -1)))];
    zoomTo(value, event.clientX, event.clientY); previousZoom = value;
  }, { passive: false });
  const typingTarget = target => Boolean(target.closest("input,textarea,select,button,a,[contenteditable=true]"));
  document.addEventListener("keydown", event => {
    if (event.code === "Space" && !typingTarget(event.target)) { event.preventDefault(); spaceDown = true; $("viewport").dataset.hand = "true"; }
    if (event.key === "Escape" && !presenting && !typingTarget(event.target)) {
      if (gesture) finishGesture({ pointerId: gesture.pointer, type: "pointercancel" });
      else { selected = null; render(); }
    }
  });
  document.addEventListener("keyup", event => { if (event.code === "Space") { spaceDown = false; $("viewport").dataset.hand = "false"; } });
  global.addEventListener("blur", () => { spaceDown = false; $("viewport").dataset.hand = "false"; });
  for (const id of ["scheme", "indicator", "grid-enabled", "area-enabled"]) $(id).addEventListener("change", () => { renderPreview(); if (presenting) renderActualPreview(); });
  $("stage").addEventListener("change", () => { renderPreview(); renderDetails(); });
  function present(value) {
    if (value && !presenting) {
      savedViewport = { left: $("viewport").scrollLeft, top: $("viewport").scrollTop };
      viewportSize = `${$("viewport").clientWidth}:${$("viewport").clientHeight}`;
    }
    presenting = value;
    $("actual-preview-toggle").textContent = t(presenting ? "editor_return_edit" : "editor_actual_preview");
    $("actual-preview-toggle").setAttribute("aria-pressed", String(presenting));
    $("preview-shell").hidden = presenting; $("actual-preview").hidden = !presenting;
    document.querySelector(".preview-footer").hidden = presenting;
    $("edit-file-actions").hidden = Boolean(pendingExport);
    $("export-file-actions").hidden = !pendingExport;
    $("export-preview-note").hidden = !pendingExport;
    document.querySelector("main").classList.toggle("export-preview", Boolean(pendingExport));
    $("reset").hidden = Boolean(pendingExport);
    render(); setBusy(false);
    if (!presenting && savedViewport) { $("viewport").scrollLeft = savedViewport.left; $("viewport").scrollTop = savedViewport.top; }
  }
  function returnToEditing() {
    if (busy) return;
    if (pendingExport) URL.revokeObjectURL(pendingExport.url);
    pendingExport = null; present(false); message("editor_initial_hint");
  }
  $("actual-preview-toggle").addEventListener("click", () => {
    if (busy) return;
    if (pendingExport) returnToEditing(); else present(!presenting);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && pendingExport && !busy) { event.preventDefault(); returnToEditing(); }
  });
  $("composer-preview").addEventListener("change", renderPreview);
  let gridGap = 8;
  $("grid-gap").addEventListener("change", () => {
    const value = Number($("grid-gap").value);
    if (!Number.isInteger(value) || value < 1 || value > 128) { $("grid-gap").value = gridGap; message("editor_grid_error", true); return; }
    gridGap = value; renderPreview();
  });
  $("reset-view").addEventListener("click", resetView);
  new ResizeObserver(() => {
    const size = `${$("viewport").clientWidth}:${$("viewport").clientHeight}`;
    if (state && !gesture && !presenting && size !== viewportSize) { viewportSize = size; renderPreview(); resetView(); }
  }).observe($("viewport"));
  const canDiscard = () => !dirty || global.confirm(t("editor_discard"));
  $("reset").addEventListener("click", () => { if (!canDiscard()) return; task(async () => {
    colorModes.clear();
    const { next, map } = createDefault();
    const result = await packed(next, map, true); install(result.state, result.assets, result.blob); message("editor_reset_done");
  }); });
  $("open").addEventListener("click", () => { if (canDiscard()) $("pair-files").click(); });
  $("pair-files").addEventListener("change", () => {
    const files = Array.from($("pair-files").files); $("pair-files").value = "";
    if (!files.length) return;
    task(async () => {
      let jsonBytes, pngBytes;
      if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
        if (files[0].size > ns.themePackage.maxBytes) throw new Error("theme-zip");
        ({ jsonBytes, pngBytes } = ns.themePackage.unpack(new Uint8Array(await files[0].arrayBuffer())));
      } else {
        if (files.length !== 2) throw new Error("editor-file-pair");
        const json = files.find(file => /\.json$/i.test(file.name)), png = files.find(file => /\.png$/i.test(file.name));
        if (!json || !png) throw new Error("editor-file-pair");
        if (json.size > contract.limits.jsonBytes || png.size > contract.limits.pngBytes) throw new Error("theme-zip");
        jsonBytes = new Uint8Array(await json.arrayBuffer()); pngBytes = new Uint8Array(await png.arrayBuffer());
      }
      let image;
      const recoveryData = ns.themeEditorRecovery.parse(jsonBytes);
      if (recoveryData?.format === ns.themeEditorRecovery.format) {
        const restored = await ns.themeEditorRecovery.read(recoveryData, pngBytes, defaults, decode);
        const next = restored.state, map = assetMap(next.theme, restored.image);
        for (const mode of modes) for (let i = 0; i < 3; i++) {
          const key = `${mode}.background.${i}`, source = next.backgrounds[mode][i];
          map.delete(key); if (source) map.set(key, crop(restored.image, source));
        }
        map.set("conversation.placementBackground", crop(restored.image, restored.placementSource));
        const result = await packed(next, map, true);
        colorModes.clear(); install(result.state, result.assets, result.blob, false); message("editor_recovery_open_done"); return;
      }
      const theme = await contract.validatePair({ jsonBytes: new Uint8Array(jsonBytes), pngBytes: new Uint8Array(pngBytes),
        decodePng: async bytes => { image = await decode(bytes); return { width: image.width, height: image.height }; } });
      const normalized = model.normalize(theme); colorModes.clear();
      const next = model.expandBackground(model.create(normalized, defaults)), map = assetMap(normalized, image);
      const result = await packed(next, map, true); install(result.state, result.assets, result.blob, false); message("editor_open_done");
    });
  });
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = name;
    link.hidden = true; document.body.append(link); link.click(); link.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("save").addEventListener("click", () => task(async () => {
    const result = await packed(state, assets, false);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(result.state.theme, null, 2) + "\n");
    await contract.validatePair({ jsonBytes, pngBytes: result.bytes, decodePng: async bytes => {
      const image = await decode(bytes); return { width: image.width, height: image.height };
    } });
    clearOutput();
    if (pendingExport) URL.revokeObjectURL(pendingExport.url);
    pendingExport = { theme: result.state.theme, url: URL.createObjectURL(result.blob),
      blob: new Blob([ns.themePackage.pack(result.state.theme, result.bytes)], { type: "application/zip" }) };
    present(true); $("status").textContent = ""; $("status").dataset.error = "false";
  }));
  $("save-file").addEventListener("click", () => {
    if (busy || !pendingExport) return;
    const filename = model.filename();
    download(pendingExport.blob, filename); dirty = false; message("editor_export_done");
    if (ns.themeEditorRecovery.available(state, assets) && global.confirm(t("editor_recovery_confirm"))) task(async () => {
      try {
        const blob = await ns.themeEditorRecovery.create(state, assets);
        download(blob, filename.replace(/\.zip$/i, "_recovery.zip")); message("editor_recovery_saved");
      } catch { message("editor_recovery_failed", true); }
    });
  });
  global.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  setBusy(true);
  try {
    const bundle = ns.themeEditorBundle;
    const pngBytes = Uint8Array.from(atob(bundle.png), character => character.charCodeAt(0));
    defaults = await contract.validatePair({
      jsonBytes: new TextEncoder().encode(JSON.stringify(bundle.theme)), pngBytes,
      decodePng: async bytes => {
        defaultImage = await decode(bytes);
        return { width: defaultImage.naturalWidth, height: defaultImage.naturalHeight };
      },
    });
    await prepareDefault();
    const { next, map } = createDefault();
    const result = await packed(next, map, true); install(result.state, result.assets, result.blob, false);
    resetView();
    message("editor_initial_hint"); setBusy(false);
  } catch (error) { errorMessage(error); /* Keep editing disabled when no validated initial theme is available. */ }
})(globalThis);
