# Changelog

## 0.3.4 — Prepared for submission

- Refresh the extension icon across supported sizes.
- Build the meter with native DOM APIs instead of `innerHTML`, preserving its appearance and behavior.
- Improve Markdown exports by cleaning known ChatGPT display annotations and complete writing wrappers in assistant text. Preserve user text, code, escaped examples and unknown or incomplete markup.
- Align Markdown and HTML handling of display annotations while preserving JSON message content and measurement totals.

### 한국어

- 확장 아이콘을 새 디자인으로 변경했습니다.
- 계기판의 모양과 동작을 유지하면서 `innerHTML` 대신 기본 DOM API로 구성합니다.
- Markdown 내보내기에서 AI 본문의 알려진 표시 표지와 완전한 writing 감싸기를 정리합니다. 사용자 본문·코드·이스케이프 예시와 알 수 없거나 불완전한 표지는 보존합니다.
- Markdown과 HTML의 표시 표지 처리를 맞추며 JSON 메시지 본문과 측정 집계는 유지합니다.

## 0.3.3 — Published on Firefox Add-ons, 2026-10-14

- First Firefox Add-ons release of the conversation text-size meter, separate-tab View, and Markdown/JSON/HTML Export.
- Supports Firefox Desktop 140 or later with a signed-in ChatGPT account.
