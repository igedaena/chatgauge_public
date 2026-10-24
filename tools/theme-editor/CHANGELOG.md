# Theme editor changelog

The standalone editor has its own version, independent of the extension and
the theme file format. Increase this version when publishing an editor update.

## 0.1.0 — initial independently versioned release

- Show the editor version in the standalone HTML.
- Keep background transform handles on the actual image bounds, including
  outside-frame positions.
- Keep handles a consistent screen size and make small components easier to
  move and resize.
- Reduce broken fine lines when downscaling large images. Use the same
  processing for final previews, normal themes and editor recovery files.
- Preserve the existing local editor, theme import/export, layer editing,
  stage previews and optional recovery workflow.

### 한국어

- 본체 및 테마 파일 형식과 독립적인 제작기 버전을 표시합니다.
- 배경이 출력 영역 밖으로 나가도 실제 이미지 경계에서 조절합니다.
- 확대율에 따른 조절점 크기를 일정하게 유지하고 작은 요소 조작을 개선했습니다.
- 큰 그림을 축소할 때 가는 선의 깨짐을 완화했습니다.
- 기존 테마 편집·불러오기·저장·단계 미리보기·선택적 복원 기능을 유지합니다.
