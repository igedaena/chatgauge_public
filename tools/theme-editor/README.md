# ChatGauge theme editor

The theme editor is a separate local tool. It is not included in the Firefox
extension package. Open the standalone HTML from the release downloads in a
browser; no extension installation or server is needed to edit a theme.

This source includes **Theme editor 0.1.0**, versioned independently of the
extension. Its version appears above the editor title and comes from
`tools/theme-editor/version.json`. See [CHANGELOG.md](CHANGELOG.md) for editor
changes. The theme file format has its own separate version.

To build the standalone HTML from this repository with Node.js 24 or later:

```sh
node scripts/build-theme-editor.mjs
```

The output is `dist/theme-editor/chatgauge-theme-editor.html` with a companion
SHA256 file. Open this generated HTML rather than the source `editor.html`.
The shared validator, renderer, default graphics and translations are bundled
at build time. No dependencies need to be installed for this build.

Save a theme ZIP in the editor, then import it through the extension's user-theme
options. The extension validates and stores the theme locally. Images, text
styles and up to three conversation background stages can be customized.

When both the large background and placement background are included, the
editor can also save an optional `_recovery.zip` for reopening those backgrounds
separately in the editor. This recovery file is not an extension theme. It
preserves the exported frame, not the full original image or editing history.

## 한국어

테마 에디터는 확장과 별도로 사용하는 로컬 도구입니다. 배포 파일의 독립 HTML을
브라우저에서 열고, 편집한 테마 ZIP을 확장 옵션에서 불러오면 됩니다.
에디터에서 저장해도 확장에 자동 적용되지는 않습니다.

이번 소스의 제작기 버전은 **0.1.0**입니다. 본체와 테마 파일 형식의 버전과
별개로 관리하며 제작기 제목 위에서 확인할 수 있습니다.

소스에서 만들 때는 위 빌드 명령을 실행하고 생성된 HTML을 여세요. 선택적인
`_recovery.zip`은 에디터에서 배경을 분리해 다시 열기 위한 파일이며 본체에
적용하는 테마가 아닙니다. 전체 원본 그림이나 편집 이력까지 복원하지는 않습니다.
