# Changelog

## 0.3.6 — Published on Firefox Add-ons, 2026-10-24

- Keep the meter aligned when ChatGPT's summary panel opens or closes.
- Prevent tall theme decorations from covering the visible summary panel.
- Refresh the store screenshots to match the current options interface.
- Include the separately versioned theme editor 0.1.0 in the source release;
  its improved transform controls and image downscaling are editor-only changes.

### 한국어

- ChatGPT 요약 패널을 열거나 닫을 때 계기판 위치가 따라오도록 수정했습니다.
- 높은 테마 장식이 표시 중인 요약 패널을 가리지 않도록 수정했습니다.
- 현재 옵션 화면에 맞춘 스토어 스크린샷을 준비했습니다.
- 별도 버전으로 관리하는 테마 에디터0.1.0을 소스 배포에 포함합니다.
  조절점과 축소 품질 개선은 독립 제작기에 적용됩니다.

## 0.3.5 — 2026-10-21

- Add locally stored user themes with validated ZIP import, built-in fallback,
  optional entry-time display and conversation-size background stages.
- Add an optional 1.5-second stage-2 transition on entry before displaying stage 3;
  usage measurement and exports do not wait for the visual transition.
- Add reset-to-defaults for extension preferences and the locally stored user theme.
- Provide a separate theme editor with image/text editing, stage previews, theme
  ZIP output and optional editor-only background recovery ZIPs. Preserve home-icon
  layer colors and sizing during export and reopening.
- Keep theme decorations behind the host page's menus.

### 한국어

- 테마 ZIP 검증·불러오기와 브라우저 내부 저장, 내장 기본 테마 복귀,
  입장 시각 표시 및 대화 용량별 배경 전환을 추가했습니다.
- 입장 후 첫 측정이3단계일 때2단계를1.5초 보여주는 선택적 연출을 추가했습니다.
  사용량 표시·측정·내보내기는 연출을 기다리지 않습니다.
- 확장 설정과 저장된 사용자 테마를 기본값으로 초기화하는 기능을 추가했습니다.
- 별도 테마 에디터에서 그림·글자 편집, 단계 미리보기, 테마 ZIP 저장과 선택적
  배경 복원 ZIP을 제공합니다. 홈 아이콘의 층별 색상과 크기 맞춤을 보존합니다.
- 테마 장식이 ChatGPT 메뉴를 가리지 않도록 표시 순서를 조정했습니다.

## 0.3.4 — Published on Firefox Add-ons, 2026-10-14

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
