(function registerZipExporter(global) {
  "use strict";
  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const encoder = new TextEncoder();
  const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Standard ZIP method 0 (stored): package files without runtime dependencies.
  function createZip(files, exportedAt = new Date()) {
    if (!Array.isArray(files) || !files.length || files.length > 65535) throw new TypeError("Invalid ZIP entries");
    const date = new Date(exportedAt);
    if (Number.isNaN(date.getTime())) throw new TypeError("Invalid ZIP timestamp");
    const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
    const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
    const names = new Set();
    let localSize = 0;
    let centralSize = 0;
    const entries = files.map(({ filename, contents }) => {
      if (typeof contents !== "string" && !(ArrayBuffer.isView(contents)
        && Object.prototype.toString.call(contents) === "[object Uint8Array]")) throw new TypeError("ZIP contents must be text or bytes");
      if (typeof filename !== "string" || !filename || /[\/\\\u0000]/.test(filename)
        || filename === "." || filename === ".." || names.has(filename)) throw new TypeError("Unsafe ZIP filename");
      names.add(filename);
      const name = encoder.encode(filename);
      const data = typeof contents === "string" ? encoder.encode(contents) : contents;
      if (name.length > 65535 || data.length >= 0xffffffff) throw new RangeError("ZIP64 required");
      const entry = { name, data, crc: crc32(data), offset: localSize };
      localSize += 30 + name.length + data.length;
      centralSize += 46 + name.length;
      return entry;
    });
    if (localSize + centralSize + 22 >= 0xffffffff) throw new RangeError("ZIP64 required");
    const output = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(output.buffer);
    const u16 = (offset, value) => view.setUint16(offset, value, true);
    const u32 = (offset, value) => view.setUint32(offset, value, true);
    for (const entry of entries) {
      const offset = entry.offset;
      u32(offset, 0x04034b50);
      u16(offset + 4, 20);
      u16(offset + 6, 0x0800); // UTF-8 filenames.
      u16(offset + 10, dosTime);
      u16(offset + 12, dosDate);
      u32(offset + 14, entry.crc);
      u32(offset + 18, entry.data.length);
      u32(offset + 22, entry.data.length);
      u16(offset + 26, entry.name.length);
      output.set(entry.name, offset + 30);
      output.set(entry.data, offset + 30 + entry.name.length);
    }
    let offset = localSize;
    for (const entry of entries) {
      u32(offset, 0x02014b50);
      u16(offset + 4, 20);
      u16(offset + 6, 20);
      u16(offset + 8, 0x0800);
      u16(offset + 12, dosTime);
      u16(offset + 14, dosDate);
      u32(offset + 16, entry.crc);
      u32(offset + 20, entry.data.length);
      u32(offset + 24, entry.data.length);
      u16(offset + 28, entry.name.length);
      u32(offset + 42, entry.offset);
      output.set(entry.name, offset + 46);
      offset += 46 + entry.name.length;
    }
    u32(offset, 0x06054b50);
    u16(offset + 8, entries.length);
    u16(offset + 10, entries.length);
    u32(offset + 12, centralSize);
    u32(offset + 16, localSize);
    return output;
  }
  namespace.zipExporter = Object.freeze({ createZip, crc32 });
})(globalThis);
