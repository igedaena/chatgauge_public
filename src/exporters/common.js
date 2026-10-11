(function registerExportUtils(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});

  function safeFilePart(value, fallback = "conversation") {
    const cleaned = String(value || "")
      .normalize("NFKC")
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, part => part.length === 2 ? part : "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 80)
      .replace(/[\uD800-\uDBFF]$/u, "")
      .replace(/[. ]+$/g, "");

    return cleaned || fallback;
  }

  function timestampForFile(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError("Invalid export timestamp");
    return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  }

  function createFilename({
    title,
    conversationId,
    exportedAt = new Date(),
    extension,
    includeDate = true,
    includeTime = true,
  } = {}) {
    const label = safeFilePart(title || conversationId);
    const safeExtension = String(extension || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!safeExtension) throw new TypeError("A valid file extension is required");
    const [date, time] = timestampForFile(exportedAt).split("-");
    const parts = [];
    if (includeDate !== false) parts.push(date);
    if (includeTime !== false) parts.push(time);
    return `${label}${parts.length ? `_${parts.join("-")}` : ""}.${safeExtension}`;
  }

  namespace.exportUtils = Object.freeze({
    createFilename,
    safeFilePart,
  });
})(globalThis);
