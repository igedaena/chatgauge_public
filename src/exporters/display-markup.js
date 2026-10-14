(function registerDisplayMarkup(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { t } = namespace.i18n;

  const ANNOTATION_PATTERN = /\uE200(memcite|cite|url|genui|filecite|entity|image_group)(?:\uE202([^\uE200\uE201]*))?\uE201/;
  const ANNOTATION_MASK_PATTERN = new RegExp(ANNOTATION_PATTERN.source, "g");

  function annotationText(kind, payload) {
    if (kind === "url") return payload.split("\uE202")[0];
    if (kind === "genui") return t("annotation_ui");
    if (kind === "filecite") return t("annotation_file");
    if (kind === "entity" || kind === "image_group") {
      let value;
      try { value = JSON.parse(payload); }
      catch { return undefined; } // Malformed widgets retain their literal source.
      if (kind === "entity") {
        return Array.isArray(value) && typeof value[1] === "string" && value[1].trim()
          ? value[1] : undefined;
      }
      return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "query")
        ? t("annotation_images") : undefined;
    }
    return "";
  }

  // Read a complete annotation before Markdown can split its label into tokens.
  // Code spans/blocks remain literal because their own tokenizers consume them.
  const markdown = new global.marked.Marked({
    gfm: true,
    breaks: true,
    hooks: {
      emStrongMask(masked) {
        // Change only the parser's shadow text, retaining every UTF-16 offset.
        // Marked has already masked code/escapes/links. Mask annotation payloads
        // as well so their literal labels cannot terminate surrounding emphasis.
        return masked.replace(ANNOTATION_MASK_PATTERN, raw => "a".repeat(raw.length))
          .replace(/([\p{P}\p{S}])(\*{1,2})(?=[가-힣])/gu,
            (raw, punctuation, marks) => punctuation === "*" ? raw
              : "a".repeat(punctuation.length) + marks);
      },
    },
    extensions: [{
      name: "chatcouterWriting",
      level: "block",
      start: (text) => text.match(/^ {0,3}:::writing\{/m)?.index,
      tokenizer(text) {
        const opening = /^ {0,3}:::writing\{([^\n]*)\}[ \t]*\n/.exec(text);
        const variant = /(?:^|\s)variant="(document|chat_message)"(?:\s|$)/.exec(opening?.[1] || "")?.[1];
        if (!opening) return /^ {0,3}:::writing\{/.test(text)
          ? { type: "chatcouterWritingLiteral", raw: text } : undefined;
        let valid = Boolean(variant);
        const titleMatch = /(?:^|\s)title="((?:\\.|[^"\\])*)"/.exec(opening[1]);
        let title = variant === "chat_message" ? t("writing_message") : t("writing_document");
        if (titleMatch) {
          try { title = JSON.parse(`"${titleMatch[1]}"`) || title; }
          catch { valid = false; }
        } else if (/(?:^|\s)title=/.test(opening[1])) valid = false;
        const rest = text.slice(opening[0].length);
        let offset = 0;
        let fence = null;
        let depth = 1;
        let nested = false;
        for (const line of rest.split("\n")) {
          const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
          if (fence) {
            if (fenceMatch && fenceMatch[1][0] === fence.character
              && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
          } else if (fenceMatch) {
            fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
          } else if (/^ {0,3}:::[ \t]*$/.test(line)) {
            depth -= 1;
            if (depth > 0) {
              offset += line.length + 1;
              continue;
            }
            const length = opening[0].length + offset + line.length
              + (offset + line.length < rest.length ? 1 : 0);
            if (nested || !valid) return { type: "chatcouterWritingLiteral", raw: text.slice(0, length) };
            return {
              type: "chatcouterWriting",
              raw: text.slice(0, length),
              title,
              variant,
              body: rest.slice(0, offset),
              bodyStart: opening[0].length,
              wrapperEnd: length,
              tokens: this.lexer.blockTokens(rest.slice(0, offset)),
            };
          } else if (/^ {0,3}:::writing\{/.test(line)) {
            nested = true;
            depth += 1;
          }
          offset += line.length + 1;
        }
        // Keep ambiguous nested blocks wholly literal, including their inner
        // wrappers; otherwise the lexer could render an inner card on its own.
        return { type: "chatcouterWritingLiteral", raw: text };
      },
    }, {
      name: "chatcouterAnnotation",
      level: "inline",
      start: (text) => text.match(/\\?\uE200/)?.index,
      tokenizer(text) {
        const envelope = /^\\?\uE200[^\uE201]*(?:\uE201|$)/.exec(text);
        if (!envelope) return undefined;
        const raw = envelope[0];
        const match = ANNOTATION_PATTERN.exec(raw);
        const label = match && match[0] === raw ? annotationText(match[1], match[2] || "") : undefined;
        // Consume escaped, unknown, incomplete and malformed envelopes whole:
        // Markdown syntax or a nested known marker inside is a literal example.
        if (label === undefined) return { type: "chatcouterAnnotationLiteral", raw };
        return {
          type: "chatcouterAnnotation",
          raw,
          text: label,
        };
      },
    }],
  });

  function literalMarkdown(text) {
    return text.replace(/([\\`*_{}\[\]<>#!|+.=~\-])/g, "\\$1").replace(/\r?\n/g, " ");
  }

  // Locate changes in raw Markdown instead of reserializing its token tree.
  // An unalignable subtree is kept verbatim, rather than guessing its offsets.
  function tokenEdits(source, tokens, unwrapWriting = true) {
    let cursor = 0;
    const edits = [];
    for (const token of tokens) {
      if (!token.raw) continue;
      const start = source.indexOf(token.raw, cursor);
      if (start < 0) return [];
      edits.push(...editsForToken(token, unwrapWriting).map(edit => ({ ...edit, start: edit.start + start, end: edit.end + start })));
      cursor = start + token.raw.length;
    }
    return edits;
  }

  function containerEdits(token) {
    // Marked removes quote/list prefixes before parsing children. Map each
    // unchanged content line back to its original line, keeping those prefixes.
    const rawLines = token.raw.split("\n"), textLines = token.text.split("\n");
    const positions = [];
    let rawOffset = 0;
    for (let index = 0; index < textLines.length; index++) {
      const raw = rawLines[index], text = textLines[index];
      if (raw === undefined || !raw.endsWith(text)) return [];
      const prefix = raw.slice(0, raw.length - text.length);
      if (!/^[ \t>]*(?:[-+*]|\d+[.)])?[ \t]*(?:\[[ xX]\][ \t]+)?$/.test(prefix)) return [];
      for (let i = 0; i < text.length; i++) positions.push(rawOffset + prefix.length + i);
      if (index < textLines.length - 1) positions.push(rawOffset + raw.length);
      rawOffset += raw.length + 1;
    }
    return tokenEdits(token.text, token.tokens.filter(child => child.type !== "checkbox"), false).filter(edit =>
      // A multiline replacement could remove structural prefixes. Keep such
      // wrappers literal; ordinary inline annotations map without that risk.
      !token.text.slice(edit.start, edit.end).includes("\n") && edit.end > edit.start
    ).map(edit => ({ ...edit, start: positions[edit.start], end: positions[edit.end - 1] + 1 }));
  }

  function editsForToken(token, unwrapWriting) {
    if (token.type === "chatcouterAnnotation") return [{ start: 0, end: token.raw.length, text: literalMarkdown(token.text) }];
    if (token.type === "chatcouterWriting") return unwrapWriting ? [
      { start: 0, end: token.bodyStart, text: "" },
      ...tokenEdits(token.body, token.tokens).map(edit => ({ ...edit, start: edit.start + token.bodyStart, end: edit.end + token.bodyStart })),
      { start: token.bodyStart + token.body.length, end: token.wrapperEnd, text: "" },
    ] : [];
    if (["code", "codespan", "escape", "html", "image", "chatcouterWritingLiteral", "chatcouterAnnotationLiteral"].includes(token.type)) return [];
    if (token.type === "blockquote" || token.type === "list_item") return containerEdits(token);
    if (token.type === "list") return tokenEdits(token.raw, token.items, unwrapWriting);
    if (token.type === "table") return tokenEdits(token.raw,
      [...token.header, ...token.rows.flat()].map(cell => ({ raw: cell.text, tokens: cell.tokens })), unwrapWriting);
    return token.tokens ? tokenEdits(token.raw, token.tokens, unwrapWriting) : [];
  }

  function cleanMarkdown(text) {
    const edits = tokenEdits(text, markdown.lexer(text));
    let cursor = 0;
    const pieces = [];
    for (const edit of edits) {
      pieces.push(text.slice(cursor, edit.start), edit.text);
      cursor = edit.end;
    }
    pieces.push(text.slice(cursor));
    return pieces.join("");
  }

  namespace.displayMarkup = Object.freeze({ lexer: text => markdown.lexer(text), cleanMarkdown });
})(globalThis);
