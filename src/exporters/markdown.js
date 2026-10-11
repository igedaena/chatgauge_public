(function registerMarkdownExporter(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { measureConversation } = namespace.model;

  const { t } = namespace.i18n;

  function headingText(value) {
    return String(value || "ChatGPT conversation")
      .replace(/[\r\n]+/g, " ")
      .trim() || "ChatGPT conversation";
  }

  function createMarkdownExport({
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

    const totals = measureConversation(messages);
    const lines = [
      `# ${headingText(title)}`,
      "",
      `- Exported: ${date.toISOString()}`,
      `- Conversation ID: ${conversationId || "unknown"}`,
      `- Source: ${source}`,
      `- Messages: ${totals.messages} (user ${totals.userMessages}, assistant ${totals.assistantMessages})`,
      `- Size: ${totals.characters} characters, ${totals.utf8Bytes} UTF-8 bytes`,
      "",
    ];

    if (preservation) lines.push(`> ${preservation.warning}`, `> ${t("verification_status")}: ${preservation.reason}`, "");

    for (const message of messages) {
      lines.push(`## ${message.role === "user" ? "Prompt" : "Response"}:`);
      lines.push("");
      if (message.createdAt) {
        lines.push(message.createdAt);
        lines.push("");
      }
      lines.push(message.text || "<!-- Empty message body -->");
      lines.push("");
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }

  namespace.markdownExporter = Object.freeze({
    createMarkdownExport,
  });
})(globalThis);
