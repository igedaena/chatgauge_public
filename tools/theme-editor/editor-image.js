(function registerEditorImage(global) {
  "use strict";
  const ns = global.Chatcouter = global.Chatcouter || {};
  // One bounded prefilter per immutable source. Never allocate the virtual placement size.
  const cache = new WeakMap();
  function draw(ctx, source, x, y, width, height) {
    if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error("editor-image-bounds");
    let w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    let image = source;
    const steps = [];
    while (w > width * 2 || h > height * 2) {
      w = w > width * 2 ? Math.ceil(w / 2) : w;
      h = h > height * 2 ? Math.ceil(h / 2) : h;
      steps.push([w, h]);
    }
    if (steps.length) {
      const previous = cache.get(source);
      if (previous?.width === w && previous?.height === h) image = previous;
      else {
        for (const [width, height] of steps) {
          const node = global.document.createElement("canvas"); node.width = width; node.height = height;
          const context = node.getContext("2d");
          context.imageSmoothingEnabled = true;
          context.drawImage(image, 0, 0, width, height); image = node;
        }
        cache.set(source, image);
      }
    }
    ctx.drawImage(image, x, y, width, height);
  }
  ns.themeEditorImage = Object.freeze({ draw });
})(globalThis);
