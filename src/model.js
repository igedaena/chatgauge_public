(function registerModel(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeCreatedAt(value) {
    if (value === undefined || value === null || value === "") return "";
    const numericValue = typeof value === "number" && value < 1e12 ? value * 1000 : value;
    const date = new Date(numericValue);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function createMessage({ id, role, text, ordinal, createdAt = "" }) {
    if (role !== "user" && role !== "assistant") {
      throw new TypeError(`Unsupported message role: ${role}`);
    }

    return Object.freeze({
      id: String(id || `${role}-${ordinal}`),
      role,
      text: normalizeText(text),
      ordinal,
      createdAt: normalizeCreatedAt(createdAt),
    });
  }

  function measureConversation(messages) {
    const totals = {
      characters: 0,
      utf8Bytes: 0,
      messages: messages.length,
      userMessages: 0,
      assistantMessages: 0,
      emptyMessages: 0,
    };

    const encoder = new TextEncoder();

    for (const message of messages) {
      totals.characters += Array.from(message.text).length;
      totals.utf8Bytes += encoder.encode(message.text).byteLength;
      totals[`${message.role}Messages`] += 1;
      if (message.text.length === 0) {
        totals.emptyMessages += 1;
      }
    }

    return Object.freeze(totals);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  namespace.model = Object.freeze({
    createMessage,
    formatBytes,
    measureConversation,
    normalizeCreatedAt,
    normalizeText,
  });
})(globalThis);

