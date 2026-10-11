(function registerFreshExporter(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { conversationSnapshot, markdownExporter, jsonExporter, htmlExporter, zipExporter, exportUtils } = namespace;

  const { t } = namespace.i18n;

  async function prepareView({ signal, isCurrent, conversationId, title = "" }) {
    const snapshotResult = await conversationSnapshot.readExport({ signal, isCurrent });
    if (!snapshotResult.ok) return snapshotResult;
    if (signal.aborted || !isCurrent()) return { ok: false, reason: "export-context-changed" };
    const { result, unchecked, reason } = snapshotResult;
    const contents = htmlExporter.createHtmlExport({
      messages: result.messages, conversationId, title: result.title || title,
      source: unchecked ? "server-stored-unverified" : "full", exportedAt: new Date(), view: true,
      ...(unchecked ? { preservation: { mode: "server-stored-unverified", reason, warning: t("preservation_warning") } } : {}),
    });
    return { ...snapshotResult, contents };
  }

  async function prepare({ signal, isCurrent, conversationId, title = "", formats = ["md"], filenameOptions = {} }) {
    if (!Array.isArray(formats) || !formats.length || new Set(formats).size !== formats.length
      || formats.some((format) => !["md", "json", "html"].includes(format))) throw new TypeError("Unsupported export formats");
    const snapshotResult = await conversationSnapshot.readExport({ signal, isCurrent });
    if (!snapshotResult.ok) return snapshotResult;
    const { result, unchecked, reason } = snapshotResult;

    const snapshot = {
      conversationId,
      title: result.title || title,
      messages: result.messages,
      source: unchecked ? "server-stored-unverified" : "full",
      ...(unchecked ? { preservation: {
        mode: "server-stored-unverified",
        reason,
        warning: t("preservation_warning"),
      } } : {}),
      exportedAt: new Date(),
    };
    const serializers = {
      md: [markdownExporter.createMarkdownExport, "text/markdown;charset=utf-8"],
      json: [jsonExporter.createJsonExport, "application/json;charset=utf-8"],
      html: [htmlExporter.createHtmlExport, "text/html;charset=utf-8"],
    };
    const filename = (extension) => exportUtils.createFilename({ ...snapshot, extension,
      includeDate: filenameOptions?.includeDate, includeTime: filenameOptions?.includeTime })
      .replace(new RegExp(`\\.${extension}$`), `${unchecked && filenameOptions?.includeUnchecked !== false ? "_unchecked" : ""}.${extension}`);
    const files = formats.map((format) => ({
      contents: serializers[format][0](snapshot),
      filename: filename(format),
      mimeType: serializers[format][1],
    }));
    const download = files.length === 1 ? files[0] : {
      contents: zipExporter.createZip(files, snapshot.exportedAt),
      filename: filename("zip"),
      mimeType: "application/zip",
    };
    return { ...snapshotResult, ...download };
  }

  namespace.freshExporter = Object.freeze({
    prepare,
    prepareView,
    prepareMarkdown: (options) => prepare({ ...options, formats: ["md"] }),
  });
})(globalThis);
