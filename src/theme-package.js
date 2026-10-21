(function registerThemePackage(global) {
  "use strict";
  const ns = global.Chatcouter, contract = ns.themeContract;
  const names = ["chatgauge-theme.json", "chatgauge-theme.png"];
  const maxBytes = contract.limits.jsonBytes + contract.limits.pngBytes + 1024;
  function fail() { throw new Error("theme-zip"); }
  // Read the bounded, stored ZIPs emitted by this editor. No filesystem extraction.
  function unpack(bytes) {
    if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== "[object Uint8Array]"
      || bytes.byteLength < 22 || bytes.byteLength > maxBytes) fail();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = n => { if (n < 0 || n + 2 > bytes.length) fail(); return view.getUint16(n, true); };
    const u32 = n => { if (n < 0 || n + 4 > bytes.length) fail(); return view.getUint32(n, true); };
    const end = bytes.length - 22;
    if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== 2
      || u16(end + 10) !== 2 || u16(end + 20)) fail();
    let cursor = u32(end + 16), local = 0;
    if (cursor + u32(end + 12) !== end) fail();
    const files = {};
    for (let i = 0; i < 2; i++) {
      if (u32(cursor) !== 0x02014b50) fail();
      const flags = u16(cursor + 8), size = u32(cursor + 24), length = u16(cursor + 28);
      if ((flags & ~0x0800) || u16(cursor + 10) || u32(cursor + 20) !== size
        || u16(cursor + 30) || u16(cursor + 32) || u16(cursor + 34) || u32(cursor + 42) !== local) fail();
      const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + length));
      if (!names.includes(name) || files[name] || size > (name.endsWith("json") ? contract.limits.jsonBytes : contract.limits.pngBytes)) fail();
      if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8)
        || u32(local + 14) !== u32(cursor + 16) || u32(local + 18) !== size || u32(local + 22) !== size
        || u16(local + 26) !== length || u16(local + 28)) fail();
      const localName = new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + length));
      const start = local + 30 + length;
      if (localName !== name || start + size > u32(end + 16)) fail();
      const data = bytes.slice(start, start + size);
      if (ns.zipExporter.crc32(data) !== u32(cursor + 16)) fail();
      files[name] = data;
      local = start + size; cursor += 46 + length;
    }
    if (local !== u32(end + 16) || cursor !== end) fail();
    return { jsonBytes: files[names[0]], pngBytes: files[names[1]] };
  }
  function pack(theme, pngBytes) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(theme, null, 2) + "\n");
    if (jsonBytes.byteLength > contract.limits.jsonBytes || pngBytes.byteLength > contract.limits.pngBytes) fail();
    return ns.zipExporter.createZip([{ filename: names[0], contents: jsonBytes }, { filename: names[1], contents: pngBytes }]);
  }
  async function decodePng(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try { const image = new Image(); image.src = url; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; }
    finally { URL.revokeObjectURL(url); }
  }
  async function read(bytes, decoder = decodePng) {
    const pair = unpack(bytes);
    const theme = await contract.validatePair({ ...pair, decodePng: decoder });
    return { theme: contract.upgrade(theme), pngBytes: pair.pngBytes };
  }
  ns.themePackage = Object.freeze({ maxBytes, pack, unpack, read, decodePng });
})(globalThis);
