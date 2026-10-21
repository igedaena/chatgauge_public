(function registerThemeLayout(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const roles = ["measure", "secondary", "symbol", "expand", "expandIcon", "export", "exportIcon", "entryTime"];
  const rect = (x, y, width, height) => Object.freeze({ x, y, width, height });

  // Temporary measurement guide for this development branch, not a file schema
  // or final size limits. Disable here to compare the original appearance.
  const guideEnabled = true;
  const guide = Object.freeze({
    conversation: Object.freeze({ width: 256, height: 168, bottomOffset: 24,
      background: Object.freeze({ width: 256, height: 640 }), components: Object.freeze({
      symbol: rect(0, 70, 40, 62), measure: rect(40, 92, 110, 40),
      secondary: rect(40, 70, 110, 22), expand: rect(150, 110, 52, 22),
      expandIcon: rect(202, 110, 20, 22), export: rect(150, 92, 52, 18),
      exportIcon: rect(202, 92, 20, 18), entryTime: rect(0, 0, 256, 24),
    }) }),
    idle: Object.freeze({ width: 168, height: 64, verticalAlign: "center", components: Object.freeze({
      symbol: rect(0, 0, 40, 64), measure: rect(40, 0, 128, 64),
    }) }),
  });

  const { validateLayout: validate } = namespace.themeContract;
  validate(guide.conversation);
  validate(guide.idle);
  const samplePath = "src/themes/default-sample.json";
  const atlasPath = "src/themes/default-sample.png";
  async function loadSample({ runtime, fetch, Image }) {
    const atlasUrl = runtime.getURL(atlasPath);
    const [jsonResponse, pngResponse] = await Promise.all([fetch(runtime.getURL(samplePath)), fetch(atlasUrl)]);
    if (!jsonResponse.ok || !pngResponse.ok) throw new Error("Theme files unavailable");
    const [json, png] = await Promise.all([jsonResponse.arrayBuffer(), pngResponse.arrayBuffer()]);
    const theme = await namespace.themeContract.validatePair({ jsonBytes: new Uint8Array(json), pngBytes: new Uint8Array(png),
      decodePng: async () => {
        const image = new Image();
        image.src = atlasUrl;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      } });
    return { ...namespace.themeContract.upgrade(theme), atlasUrl };
  }
  namespace.themeLayout = Object.freeze({ guide, preview: guideEnabled ? guide : null, validate, loadSample });
})(globalThis);
