"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
globalThis.browser = { i18n: require("./helpers/i18n.cjs")("en") };
require("../src/i18n.js");
require("../src/model.js");
globalThis.marked = require("../src/vendor/marked.umd.js");
require("../src/exporters/html.js");
const { createHtmlExport } = globalThis.Chatcouter.htmlExporter;

test("Markdown character references render once while literal bodies and unsafe links remain inert", () => {
  const prose = 'AT&amp;T &#65; &#x1F600; &copy; &amp;amp; &unknown; &#xZZ; &lt;script&gt;';
  const messages = [{ role: "user", text: prose }, { role: "assistant", text:
    `${prose}\n\n\`${prose}\`\n\n\`\`\`text\n${prose}\n\`\`\`\n\n<div>&amp;</div>\n\n[bad](javascript&#58;alert(1)) [safe &amp; label](https://example.com/?a=1&b=2)` }];
  const before = JSON.stringify(messages);
  const html = createHtmlExport({ messages });
  assert.ok(html.includes('<p>AT&amp;T &#65; &#x1F600; &copy; &amp;amp; &unknown; &amp;#xZZ; &lt;script&gt;</p>'));
  assert.ok(html.includes('user-text">AT&amp;amp;T &amp;#65;'));
  assert.ok(html.includes('<code>AT&amp;amp;T &amp;#65;'));
  assert.ok(html.includes('<pre><code>AT&amp;amp;T &amp;#65;'));
  assert.ok(html.includes('&lt;div&gt;&amp;amp;&lt;/div&gt;'));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'));
  assert.ok(html.includes('safe &amp; label</a>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript'));
  assert.equal(JSON.stringify(messages), before);
});

test("HTML preserves Korean, whitespace, code, role order, empty messages and measured totals", () => {
  const messages = [
    { role: "user", text: "\n한글 질문 😀\n  들여쓰기\t끝", createdAt: "2026-10-01T04:00:00.000Z" },
    { role: "assistant", text: "```js\n  if (a < b) {}\n```" },
    { role: "assistant", text: "" },
  ];
  const html = createHtmlExport({ messages, title: "시험", exportedAt: "2026-10-01T05:00:00Z" });
  const totals = globalThis.Chatcouter.model.measureConversation(messages);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /user-text">\n한글 질문 😀\n  들여쓰기\t끝<\/div>/);
  assert.match(html, /<pre><code>  if \(a &lt; b\) {}<\/code><\/pre>/);
  assert.match(html, /<time>2026-10-01T04:00:00.000Z<\/time>/);
  assert.match(html, /Messages: 3 \(user 1, assistant 2\)/);
  assert.ok(html.includes(`Size: ${totals.characters} characters, ${totals.utf8Bytes} UTF-8 bytes`));
  assert.ok(html.indexOf("1. Prompt") < html.indexOf("2. Response"));
  assert.match(html, /3\. Response<\/span><\/div>\n<p class="empty">Empty message body/);
});

test("HTML treats hostile bodies and metadata as text and contains no external assets", () => {
  const payload = '</span></pre><script>alert("x")</script><img src="https://example.com" onerror=alert(1)>&';
  const html = createHtmlExport({
    messages: [{ role: "user", text: payload, createdAt: payload }],
    title: payload, conversationId: payload, source: payload,
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img "));
  assert.ok(!html.includes('src="https://'));
  assert.ok(!html.includes("</pre><script>"));
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /default-src 'none'/);
});

test("HTML hides memory citation markers in prose while preserving original measurements and code", () => {
  const marker = "\uE200memcite\uE202turn1memory0\uE201";
  const messages = [
    { role: "user", text: `사용자 원문 ${marker}` },
    { role: "assistant", text: `본문${marker}\n\n다음\uE200memcite\uE201\n\n\`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`` },
  ];
  const before = JSON.stringify(messages);
  const html = createHtmlExport({ messages });
  assert.match(html, /<p>본문<\/p>/);
  assert.ok(!html.includes(`다음\uE200memcite`));
  assert.ok(html.includes(`<code>${marker}</code>`));
  assert.ok(html.includes(`사용자 원문 ${marker}`));
  const totals = globalThis.Chatcouter.model.measureConversation(messages);
  assert.ok(html.includes(`Size: ${totals.characters} characters, ${totals.utf8Bytes} UTF-8 bytes`));
  assert.equal(JSON.stringify(messages), before);
});

test("HTML validates its input and supplies a fallback title", () => {
  assert.throws(() => createHtmlExport({ messages: null }), /messages must be an array/);
  assert.throws(() => createHtmlExport({ messages: [], exportedAt: "invalid" }), /Invalid export timestamp/);
  assert.match(createHtmlExport({ messages: [], title: "  " }), /<title>ChatGPT conversation<\/title>/);
});

test("HTML cleans search citations and preserves URL labels without exposing source IDs", () => {
  const text = '문장\uE200cite\uE202turn0search4\uE202turn0search8\uE201\n\n공식 문서 \uE200url\uE202문서 안내\uE202turn0search6\uE201와 \uE200url\uE202다른 문서\uE202turn0search5\uE201. 😀\n\n\uE200genui\uE202synthetic-widget-id\uE201';
  const messages = [{ role: "assistant", text }];
  const html = createHtmlExport({ messages });
  assert.match(html, /<p>문장<\/p>/);
  assert.match(html, /공식 문서 문서 안내와 다른 문서\. 😀/);
  assert.match(html, /\[Additional UI element\]/);
  assert.ok(!html.includes("turn0search"));
  assert.ok(!html.includes("synthetic-widget-id"));
  assert.ok(!html.includes("\uE200"));
  assert.equal(messages[0].text, text);
  const totals = globalThis.Chatcouter.model.measureConversation(messages);
  assert.ok(html.includes(`Size: ${totals.characters} characters, ${totals.utf8Bytes} UTF-8 bytes`));
});

test("citation cleanup preserves literal code, prompts, unknown private characters and ordinary Unicode", () => {
  const marker = "\uE200cite\uE202turn0search4\uE201";
  const text = `\`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`\n\n원문 \uE200unknown\uE202value\uE201 😀 ♥`;
  const html = createHtmlExport({ messages: [
    { role: "user", text: marker },
    { role: "assistant", text },
  ] });
  assert.ok(html.includes(`user-text">${marker}</div>`));
  assert.ok(html.includes(`<code>${marker}</code>`));
  assert.ok(html.includes("\uE200unknown\uE202value\uE201 😀 ♥"));
});

test("annotation labels containing Markdown or HTML do not split or execute", () => {
  const text = '정상 \uE200url\uE202문서 `API` 안내\uE202turn0search1\uE201와 \uE200url\uE202<img src=x onerror=alert(1)>\uE202turn0search2\uE201';
  const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
  assert.match(html, /문서 `API` 안내/);
  assert.ok(!html.includes("\uE200"));
  assert.ok(!html.includes("turn0search"));
  assert.ok(!html.includes("<img "));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("complete writing documents render a titled card and keep surrounding Markdown", () => {
  const text = '앞 문단\n\n:::writing{variant="document" id="synthetic" title="문서 제목"}\n첫 문단\n\n**강조**와 목록\n\n- 첫 항목\n- 다음 항목\n:::\n\n뒷 문단';
  const messages = [{ role: "assistant", text }];
  const html = createHtmlExport({ messages });
  assert.match(html, /<p>앞 문단<\/p>/);
  assert.match(html, /<section class="writing-card"><div class="writing-title">문서 제목<\/div>/);
  assert.match(html, /<strong>강조<\/strong>/);
  assert.match(html, /<p>뒷 문단<\/p>/);
  assert.ok(!html.includes(":::writing"));
  assert.ok(!html.includes('id="synthetic"'));
  assert.equal(messages[0].text, text);
});

test("document delimiters inside code do not close a writing card and titles are escaped", () => {
  const text = ':::writing{variant="document" title="<img src=x>"}\n```text\n:::\n```\n\n마지막 문단\n:::';
  const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
  assert.match(html, /writing-title">&lt;img src=x&gt;<\/div>/);
  assert.match(html, /<pre><code>:::<\/code><\/pre>/);
  assert.match(html, /<p>마지막 문단<\/p>/);
  assert.ok(!html.includes("<img "));
});

test("incomplete or unsupported writing blocks and code examples stay literal", () => {
  for (const text of [
    ':::writing{variant="document" title="제목"}\n본문만 있고 끝 없음',
    ':::writing{variant="email" title="제목"}\n본문\n:::',
    ':::writing{variant="document" title="닫히지 않은 제목}\n본문\n:::',
    '```text\n:::writing{variant="document" title="예시"}\n본문\n:::\n```',
  ]) {
    const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
    assert.ok(!html.includes('<section class="writing-card">'));
    assert.ok(html.includes(":::writing"));
    assert.match(html, /본문/);
  }
});

test("assistant Markdown renders headings, nested lists, quotes, tables and code while prompts stay literal", () => {
  const text = "## 제목\n\n**굵게**와 *강조*, ~~취소~~, `a < b`\n\n- 첫 항목\n  - 하위 항목\n\n3. 세 번째\n4. 네 번째\n\n> 인용문\n\n| 항목 | 값 |\n| :--- | ---: |\n| 한글 | 42 |\n\n- [x] 완료\n- [ ] 대기\n\n---\n\n첫 줄\n다음 줄";
  const html = createHtmlExport({ messages: [
    { role: "user", text: "**원문 그대로**\n  들여쓰기" },
    { role: "assistant", text },
  ] });
  assert.match(html, /class="message user"/);
  assert.match(html, /class="message assistant"/);
  assert.match(html, /user-text">\*\*원문 그대로\*\*\n  들여쓰기/);
  assert.match(html, /<h2>제목<\/h2>/);
  assert.match(html, /<strong>굵게<\/strong>/);
  assert.match(html, /<em>강조<\/em>/);
  assert.match(html, /<del>취소<\/del>/);
  assert.match(html, /<code>a &lt; b<\/code>/);
  assert.match(html, /<ul><li>첫 항목<ul><li>하위 항목/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<blockquote><p>인용문/);
  assert.match(html, /<th class="align-right">값<\/th>/);
  assert.match(html, /<td class="align-right">42<\/td>/);
  assert.match(html, /☑/);
  assert.match(html, /☐/);
  assert.match(html, /첫 줄<br>\n다음 줄/);
});

test("Markdown links cannot execute scripts or load images and raw HTML remains literal", () => {
  const text = '[안전](https://example.com/?q=1&v=2)\n\n[위험](javascript:alert%281%29) [데이터](data:text/html,test) [파일](file:///C:/secret) [엔티티](javascript&#58;alert%281%29)\n\n![그림](https://example.com/pixel.png)\n\n<img src=x onerror=alert(1)>\n\n```html\n<script>alert(1)</script>\n```';
  const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
  assert.match(html, /href="https:\/\/example.com\/\?q=1&amp;v=2" rel="noreferrer noopener"/);
  assert.ok(!/href="(?:javascript|data|file):/i.test(html));
  assert.ok(!/<(?:script|img|iframe|object|input)\b/i.test(html));
  assert.match(html, /\[Image: 그림\]/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("Hangul-adjacent punctuation and inline code emphasis renders without changing source or measured totals", () => {
  const text = '**「제목」**가 **“문장”**를 **기준선(term)**이야 **`code`**가 **😀**도 *「이탤릭」*은';
  const messages = [{ role: "assistant", text }];
  const before = JSON.stringify(messages);
  const html = createHtmlExport({ messages });
  for (const inner of ["「제목」", "“문장”", "기준선(term)", "<code>code</code>", "😀"]) {
    assert.ok(html.includes(`<strong>${inner}</strong>`));
  }
  assert.match(html, /<em>「이탤릭」<\/em>은/);
  assert.equal(JSON.stringify(messages), before);
  const totals = globalThis.Chatcouter.model.measureConversation(messages);
  assert.ok(html.includes(`Size: ${totals.characters} characters, ${totals.utf8Bytes} UTF-8 bytes`));
});

test("Hangul emphasis compatibility keeps standard word boundaries, escaped literals, code and other suffixes", () => {
  for (const text of ['앞**「제목」**가', '***「제목」***가', '**(term)**suffix', '**(term)**2', '**내용**가', '**(term)** 가', '**(term)**.', '_name_field_']) {
    const expected = globalThis.marked.lexer(text)[0].tokens;
    const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
    assert.equal(html.includes("<strong>"), expected.some(token => token.type === "strong"), text);
  }
  const literal = '**「제목」**가';
  const escaped = '\\*\\*「제목」\\*\\*가';
  const html = createHtmlExport({ messages: [
    { role: "user", text: literal },
    { role: "assistant", text: `${escaped}\n\n\`${literal}\`\n\n\`\`\`md\n${literal}\n\`\`\`` },
  ] });
  assert.ok(html.includes(`user-text">${literal}</div>`));
  assert.ok(html.includes(`<p>${literal}</p>`));
  assert.ok(html.includes(`<code>${literal}</code>`));
  assert.ok(!html.includes("<strong>"));
});

test("Hangul emphasis supports nesting, links and table cells while keeping raw HTML inert", () => {
  const text = '**「*내용*」**가\n\n**[「링크」](https://example.com)**가\n\n| 항목 | 값 |\n| --- | --- |\n| **「제목」**가 | **`code`**가 |\n\n**「<img src=x onerror=alert(1)>」**가';
  const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
  assert.match(html, /<strong>「<em>내용<\/em>」<\/strong>가/);
  assert.match(html, /<strong><a href="https:\/\/example.com" rel="noreferrer noopener">「링크」<\/a><\/strong>가/);
  assert.match(html, /<td><strong>「제목」<\/strong>가<\/td>/);
  assert.match(html, /<strong><code>code<\/code><\/strong>가/);
  assert.ok(!html.includes("<img "));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("known file and widget annotations preserve escaped labels as static text without remote assets", () => {
  const entity = '\uE200entity\uE202["company","예시 **회사** <img src=x>","설명"]\uE201';
  const images = '\uE200image_group\uE202{"query":["synthetic query"],"layout":"carousel"}\uE201';
  const file = '\uE200filecite\uE202turn0file0\uE201';
  const text = `본문 ${file} ${entity} ${images}`;
  const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
  assert.ok(html.includes("[File citation]"));
  assert.ok(html.includes("예시 **회사** &lt;img src=x&gt;"));
  assert.ok(html.includes("[Image group]"));
  assert.ok(!html.includes("\uE200"));
  assert.ok(!html.includes("turn0file0"));
  assert.ok(!html.includes("synthetic query"));
  assert.ok(!/<(?:img|script|iframe)\b/i.test(html));
  const wrapped = createHtmlExport({ messages: [{ role: "assistant", text: `**「${entity}」**가` }] });
  assert.ok(wrapped.includes('<strong>「예시 **회사** &lt;img src=x&gt;」</strong>가'));
});

test("widget cleanup leaves code, prompts, malformed or unknown payloads and ordinary private Unicode literal", () => {
  const marker = '\uE200filecite\uE202turn0file0\uE201';
  const invalid = '\uE200entity\uE202not-json\uE201';
  const invalidGroup = '\uE200image_group\uE202{"other":true}\uE201';
  const unknown = '\uE200unknown\uE202value\uE201';
  const html = createHtmlExport({ messages: [
    { role: "user", text: marker },
    { role: "assistant", text: `\`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`\n\n${invalid} ${invalidGroup} ${unknown} \uE234` },
  ] });
  assert.ok(html.includes(`user-text">${marker}</div>`));
  assert.ok(html.includes(`<code>${marker}</code>`));
  for (const literal of [invalid, unknown, "\uE234"]) assert.ok(html.includes(literal));
  assert.ok(html.includes("\uE200image_group"));
  assert.ok(!html.includes("[File citation]"));
});

test("complete chat_message cards reuse safe writing rendering and incomplete variants remain literal", () => {
  const text = '앞 문단\n\n:::writing{variant="chat_message" id="synthetic" title="<img src=x>"}\n**「메시지」**가\n\n```md\n:::\n```\n\n마지막 문단\n:::\n\n뒷 문단';
  const html = createHtmlExport({ messages: [{ role: "assistant", text }] });
  assert.match(html, /class="writing-card message-card"/);
  assert.match(html, /writing-title">&lt;img src=x&gt;<\/div>/);
  assert.match(html, /<strong>「메시지」<\/strong>가/);
  assert.match(html, /<pre><code>:::<\/code><\/pre>/);
  assert.match(html, /<p>뒷 문단<\/p>/);
  assert.ok(!html.includes('id="synthetic"'));
  for (const literal of [
    ':::writing{variant="chat_message"}\n닫는 줄 없음',
    ':::writing{variant="chat_message" title="닫히지 않음}\n본문\n:::',
    ':::writing{variant="chat_message"}\n:::writing{variant="document"}\n본문\n:::\n:::',
    '```text\n:::writing{variant="chat_message"}\n본문\n:::\n```',
  ]) {
    const result = createHtmlExport({ messages: [{ role: "assistant", text: literal }] });
    assert.ok(!result.includes('class="writing-card'));
    assert.ok(result.includes(":::writing"));
  }
  assert.match(createHtmlExport({ messages: [{ role: "assistant", text: ':::writing{variant="chat_message"}\n본문\n:::' }] }), /writing-title">Message<\/div>/);
});
