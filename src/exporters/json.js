(function registerJsonExporter(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { measureConversation } = namespace.model;

  function createJsonExport({
    messages,
    title = "",
    conversationId = "",
    source = "full",
    exportedAt = new Date(),
    preservation,
  }) {
    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");

    const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
    if (Number.isNaN(date.getTime())) throw new TypeError("Invalid export timestamp");

    const payload = {
      schemaVersion: 1,
      exportedAt: date.toISOString(),
      conversation: {
        id: String(conversationId || ""),
        title: String(title || ""),
        source,
        ...(preservation ? { preservation } : {}),
        totals: measureConversation(messages),
        messages: messages.map(({ id, role, text, ordinal, createdAt }) => ({
          id,
          role,
          text,
          ordinal,
          createdAt: createdAt || "",
        })),
      },
    };

    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  namespace.jsonExporter = Object.freeze({
    createJsonExport,
  });
})(globalThis);
