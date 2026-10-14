(function registerHtmlExporter(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { measureConversation } = namespace.model;

  const { t, locale, number } = namespace.i18n;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function escapeMarkdownText(value) {
    // Preserve character references in ordinary Markdown text. They are parsed
    // as text by HTML, so &lt; never becomes a tag. Code/raw HTML stay literal.
    return escapeHtml(value).replace(/&amp;((?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, "&$1");
  }

  const { lexer } = namespace.displayMarkup;

  // Render only known Markdown tokens. Never pass raw HTML through the parser.
  function renderTokens(tokens) {
    return tokens.map((token) => {
      const inline = () => renderTokens(token.tokens || []);
      switch (token.type) {
        case "space": return "";
        case "text": return token.tokens ? inline()
          : escapeMarkdownText(token.text).replace(/\n/g, "<br>\n");
        case "chatcouterAnnotation": return escapeHtml(token.text);
        case "chatcouterAnnotationLiteral": return escapeHtml(token.raw);
        case "chatcouterWriting": return `<section class="writing-card${token.variant === "chat_message" ? " message-card" : ""}"><div class="writing-title">${escapeHtml(token.title)}</div><div class="writing-body">${inline()}</div></section>\n`;
        case "chatcouterWritingLiteral": return `<p>${escapeHtml(token.raw).replace(/\n/g, "<br>\n")}</p>\n`;
        case "escape": return escapeHtml(token.text);
        case "html": return escapeHtml(token.raw);
        case "paragraph": return `<p>${inline()}</p>\n`;
        case "heading": return `<h${token.depth}>${inline()}</h${token.depth}>\n`;
        case "strong": return `<strong>${inline()}</strong>`;
        case "em": return `<em>${inline()}</em>`;
        case "del": return `<del>${inline()}</del>`;
        case "codespan": return `<code>${escapeHtml(token.text)}</code>`;
        case "br": return "<br>\n";
        case "hr": return "<hr>\n";
        case "blockquote": return `<blockquote>${inline()}</blockquote>\n`;
        case "code": {
          const language = escapeHtml((token.lang || "").split(/\s/)[0] || t("plain_text"));
          return `<div class="code-block"><div class="code-language">${language}</div><pre><code>${escapeHtml(token.text)}</code></pre></div>\n`;
        }
        case "link": {
          // Absolute web/mail links only; attribute escaping prevents entity tricks.
          const href = token.href || "";
          if (!/^(https?:\/\/|mailto:)/i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return inline();
          return `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${inline()}</a>`;
        }
        case "image": return `<span class="image-note">${escapeHtml(t("image_note", token.text || t("attached_image")))}</span>`;
        case "list": {
          const tag = token.ordered ? "ol" : "ul";
          const start = token.ordered && Number.isSafeInteger(token.start) ? ` start="${token.start}"` : "";
          const items = token.items.map((item) => {
            const check = item.task ? `<span class="task-marker">${item.checked ? "☑" : "☐"}</span> ` : "";
            return `<li>${check}${renderTokens(item.tokens)}</li>`;
          }).join("\n");
          return `<${tag}${start}>${items}</${tag}>\n`;
        }
        case "table": {
          const row = (cells, tag) => `<tr>${cells.map((cell, index) => {
            const align = ["left", "center", "right"].includes(token.align[index])
              ? ` class="align-${token.align[index]}"` : "";
            return `<${tag}${align}>${renderTokens(cell.tokens)}</${tag}>`;
          }).join("")}</tr>`;
          return `<div class="table-scroll"><table><thead>${row(token.header, "th")}</thead><tbody>${token.rows.map((cells) => row(cells, "td")).join("")}</tbody></table></div>\n`;
        }
        default: return escapeHtml(token.raw || token.text || "");
      }
    }).join("");
  }

  function renderMarkdown(text) {
    return renderTokens(lexer(text));
  }

  function createHtmlExport({
    messages, title = "", conversationId = "", source = "full", exportedAt = new Date(), preservation, view = false,
  }) {
    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
    const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
    if (Number.isNaN(date.getTime())) throw new TypeError("Invalid export timestamp");
    const heading = escapeHtml(String(title || "").trim() || "ChatGPT conversation");
    const totals = view ? null : measureConversation(messages);
    const sections = messages.map((message, index) => {
      const role = message.role === "user" ? "Prompt" : "Response";
      const timestamp = message.createdAt
        ? `<time>${escapeHtml(message.createdAt)}</time>` : "";
      const body = message.text
        ? message.role === "user"
          ? `<div class="body user-text">${escapeHtml(message.text)}</div>`
          : `<div class="body markdown">${renderMarkdown(message.text)}</div>`
        : `<p class="empty">${escapeHtml(t("empty_body"))}</p>`;
      return `<section class="message ${message.role === "user" ? "user" : "assistant"}" id="message-${index + 1}">
<div class="message-info"><span>${index + 1}. ${role}</span>${timestamp}</div>
${body}
</section>`;
    }).join("\n");
    return `<!doctype html>
<html lang="${locale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${heading}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #202123; font: 16px/1.8 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 840px; margin: auto; padding: 36px 24px 72px; }
.export-header { border-bottom: 1px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 36px; }
.export-header h1 { margin: 0 0 12px; font-size: 1.45rem; line-height: 1.4; overflow-wrap: anywhere; }
.summary { margin: 0; color: #6b7280; font-size: .8rem; }
.metadata { padding: 0; list-style: none; color: #6b7280; font-size: .8rem; overflow-wrap: anywhere; }
details { margin-top: 8px; } summary { cursor: pointer; color: #6b7280; font-size: .8rem; }
.message { margin: 32px 0 48px; min-width: 0; }
.user { margin-left: auto; width: fit-content; max-width: 78%; padding: 14px 20px; background: #eaf3ff; border-radius: 24px; }
.message-info { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 8px; color: #858585; font-size: .72rem; line-height: 1.5; }
.user .message-info { color: #657589; }
.body { overflow-wrap: anywhere; }
.user-text { white-space: pre-wrap; tab-size: 4; }
.markdown > :first-child { margin-top: 0; } .markdown > :last-child { margin-bottom: 0; }
.markdown p { margin: 0 0 16px; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 { line-height: 1.4; margin: 28px 0 14px; }
.markdown h1 { font-size: 1.65rem; } .markdown h2 { font-size: 1.4rem; } .markdown h3 { font-size: 1.18rem; }
.markdown ul, .markdown ol { padding-left: 26px; margin: 12px 0 20px; } .markdown li { margin: 5px 0; }
.markdown li p { margin: 0 0 8px; }
.markdown blockquote { margin: 16px 0; padding: 4px 18px; border-left: 3px solid #d1d5db; color: #59636e; }
.markdown blockquote > :last-child { margin-bottom: 0; }
.markdown a { color: #1769aa; text-underline-offset: 3px; }
.markdown code { font: .875em/1.6 ui-monospace, Consolas, monospace; background: #ececec; border-radius: 5px; padding: 2px 5px; }
.code-block { margin: 20px 0; background: #f0f0f0; border: 1px solid #e3e3e3; border-radius: 16px; overflow: hidden; }
.code-language { padding: 10px 16px; color: #62676e; font-size: .75rem; border-bottom: 1px solid #e3e3e3; }
.code-block pre { margin: 0; padding: 16px 20px; overflow-x: auto; white-space: pre; tab-size: 4; }
.code-block code { background: none; padding: 0; border-radius: 0; font-size: .85rem; overflow-wrap: normal; }
.table-scroll { overflow-x: auto; margin: 20px 0; }
table { border-collapse: collapse; width: 100%; font-size: .925rem; }
th, td { border-bottom: 1px solid #dedede; padding: 10px 14px; text-align: left; min-width: 100px; }
th { background: #f6f7f8; font-weight: 600; }
.align-center { text-align: center; } .align-right { text-align: right; }
hr { border: 0; border-top: 1px solid #e5e7eb; margin: 28px 0; }
.empty, .image-note { color: #6b7280; font-size: .875rem; }
.writing-card { margin: 20px 0; padding: 20px; border: 1px solid #e1e3e6; border-radius: 24px; background: #fff; }
.writing-title { margin-bottom: 18px; color: #858585; font-size: .875rem; }
.writing-body > :first-child { margin-top: 0; } .writing-body > :last-child { margin-bottom: 0; }
@media (max-width: 600px) { main { padding: 24px 16px; } .user { max-width: 90%; padding: 12px 16px; } .message { margin-bottom: 32px; } }
@media print { main { max-width: none; padding: 0; } .code-block pre { white-space: pre-wrap; overflow-wrap: anywhere; } .table-scroll { overflow: visible; } }
</style>
</head>
<body>
<main>
<header class="export-header">
<h1>${heading}</h1>
${view ? `<p class="summary">${escapeHtml(t("view_opened", new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "medium" }).format(date)))}</p>\n` : ""}${preservation ? `<p class="preservation-note">${escapeHtml(preservation.warning)} (${escapeHtml(preservation.reason)})</p>` : ""}
${view ? "" : `<p class="summary">${escapeHtml(t("summary_metadata", number(totals.messages), number(totals.characters), number(totals.utf8Bytes)))}</p>
<details><summary>${escapeHtml(t("export_information"))}</summary>
<ul class="metadata">
<li>${escapeHtml(t("exported_label"))}: ${date.toISOString()}</li>
<li>${escapeHtml(t("conversation_id_label"))}: ${escapeHtml(conversationId || "unknown")}</li>
<li>${escapeHtml(t("source_label"))}: ${escapeHtml(source)}</li>
<li>${escapeHtml(t("messages_metadata", totals.messages, totals.userMessages, totals.assistantMessages))}</li>
<li>${escapeHtml(t("size_metadata", totals.characters, totals.utf8Bytes))}</li>
</ul>
</details>`}
</header>
${sections}
</main>
</body>
</html>
`;
  }

  namespace.htmlExporter = Object.freeze({ createHtmlExport });
})(globalThis);
