# Bundled third-party code

`marked.umd.js` is the unmodified browser distribution of Marked **18.0.7**.

- Project: https://github.com/markedjs/marked/tree/v18.0.7
- Download: https://cdn.jsdelivr.net/npm/marked@18.0.7/lib/marked.umd.js
- License: MIT; full distribution license in `marked.LICENSE.md`
- SHA-256: `7a1f8c5e7226b75ff16644bdb2c0130d2ae7371e7ea3106c2d6dac77ab0ff7b6`

The extension uses only the Markdown lexer. `src/exporters/html.js` renders an
allowlist of token types and escapes text, code and raw HTML. It never inserts
Marked's default HTML output. Links permit only absolute HTTP(S) and mailto
destinations; images become text placeholders. The exported file contains no
JavaScript, remote assets or runtime dependency on Marked.

The HTML integration uses Marked's `emStrongMask` hook for Hangul-adjacent
asterisk emphasis. It changes only the same-length delimiter shadow mask,
including annotation masking, while keeping source tokens, code and escapes.
The vendored distribution itself remains unmodified.

Updates must retain the license and pass the HTML rendering/security tests.
