# ChatGauge

**ChatGPT sign-in required. Signed-out chats are not supported. No paid plan is required.**

**ChatGPT 로그인 필요 · 비로그인 대화 미지원 · 유료 플랜 불필요**

ChatGauge is a Firefox extension that estimates the size of your signed-in
ChatGPT conversation from its message text.

로그인한 ChatGPT 채팅방의 대화 텍스트를 기준으로 사용량과 용량을 추정해
보여주는 Firefox 확장입니다.

- **Usage and size / 사용량·용량 표시** — See the size of the current conversation.
  현재 채팅방의 사용량과 용량을 표시합니다.
- **View / 펼쳐보기** — Open the current conversation in a separate tab.
  현재 채팅방을 별도 탭에 펼쳐봅니다.
- **Export / 내보내기** — Save the conversation as files.
  대화를 파일로 내보냅니다.

## Install

Install ChatGauge from [Firefox Add-ons](https://addons.mozilla.org/addon/chatgauge/).
Requires Firefox 140 or later and a signed-in ChatGPT account.

[Firefox 부가 기능 스토어](https://addons.mozilla.org/addon/chatgauge/)에서 설치할 수 있습니다.
Firefox 140 이상과 ChatGPT 로그인이 필요합니다.

This source corresponds to version 0.3.5, approved on Firefox Add-ons. For published downloads,
see [GitHub Releases](https://github.com/igedaena/chatgauge_public/releases).
See [CHANGELOG.md](CHANGELOG.md) for changes between versions.

## Feature details

- Character count and UTF-8 byte size for user and assistant text.
- Automatic updates, a manual refresh, and an optional update-on-input mode.
- A read-only HTML view in a new tab; use the browser's Ctrl+F to search it.
- Markdown, JSON and HTML export. Selecting multiple formats downloads a ZIP.
- Local preferences for export formats, filenames and a custom send shortcut.
- User themes imported from a theme ZIP, stored only in the local browser profile.
- Optional conversation-size background stages and a brief stage-2 transition
  when entering a conversation whose first measurement reaches stage 3.
- A reset action that restores extension defaults and removes the stored user theme.
- English and Korean UI, selected from the browser language.

The meter appears next to the message composer. Click its count to refresh,
**View / 펼쳐보기** to open the stored conversation, or **Export / 내보내기** to
download it. Open the extension's toolbar icon to change preferences.

## Themes / 테마

Enable **User theme** in the extension options to import a theme ZIP. Switching
it off shows the built-in theme and preserves the imported theme. Background
stages and their size limits are separate options. Resetting all settings removes
the theme stored in this extension; theme files saved on disk remain untouched.

Create themes with the separate `chatgauge-theme-editor.html` from the release
downloads. Open it locally in a browser, edit and save a theme ZIP, then import
that ZIP in the extension. The editor is not bundled in the extension.
See [the editor guide](tools/theme-editor/README.md) for building from source and
the optional editor-only recovery ZIP.

확장 옵션에서 사용자 테마를 켜고 에디터로 저장한 테마 ZIP을 불러오세요.
사용자 테마를 끄면 불러온 테마는 보존하고 내장 기본 테마를 표시합니다.
전체 기본값 초기화는 확장 안에 저장한 사용자 테마도 삭제하며, 디스크에 저장한
테마 파일은 삭제하지 않습니다. 독립 에디터 HTML은 확장과 별도로 사용합니다.

## What the numbers mean

The count measures normalized user and assistant text. It is not a token count,
the model's context limit, or the size of attached files and images.

ChatGauge reads the active conversation branch stored by ChatGPT. The latest
response may still be incomplete or absent from that stored snapshot. A yellow
indicator means the current measurement could not be confirmed; a blue stored
baseline does not by itself prove that the latest response is complete.

If the conversation endpoint is unavailable, a screen-based fallback may count
only the messages currently loaded in the page. ChatGPT interface or endpoint
changes can affect compatibility.

View and Export perform their own reads. They do not reset the meter. Exports
whose completion could not be confirmed include a warning and, by default, an
`_unchecked` filename suffix. Exported HTML works offline without scripts or
remote assets. Images and unsupported interactive content use text placeholders.

## Data handling

ChatGauge processes conversation text locally and reads the current conversation
from ChatGPT's own site. It has no telemetry or external collection server.
Preferences are saved in the local Firefox profile. See [PRIVACY.md](PRIVACY.md)
for the request, storage and permission details.

## Development

### Try the source in Firefox

The manifest requires Firefox 140 or later. No build or dependency installation
is needed to load the extension source.

1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on** and choose `manifest.json`.
4. Sign in to ChatGPT and open or reload a conversation on `https://chatgpt.com/`.

This is a temporary development installation. Distribution and signing are
separate release steps.

### Checks and packaging

Use Node.js 24 or later for the checks below. Tests use synthetic fixtures; no
ChatGPT account or private conversation files are needed.

```sh
node --test --test-isolation=none tests/*.test.cjs
node scripts/validate-manifest.mjs
node scripts/build-theme-editor.mjs
```

The extension uses plain JavaScript, CSS and HTML. Marked 18.0.7 is bundled for
Markdown tokenization; no runtime download is needed.

To prepare an AMO upload, install Mozilla's `web-ext` tool, then run:

```sh
node scripts/prepare-amo-package.mjs
web-ext lint --source-dir dist/amo/runtime
web-ext build --source-dir dist/amo/runtime --artifacts-dir dist/amo --filename ChatGauge-0.3.5-amo.zip
```

The staging script copies an explicit runtime allowlist without transforming
source files. It refuses to overwrite a previous staging directory.

```text
manifest.json               Extension configuration
src/                        Runtime, options, viewer and exporters
_locales/                   English and Korean translations
icons/                      Runtime icons
tests/                      Synthetic regression tests
tools/theme-editor/         Standalone editor source and guide (not in extension ZIP)
scripts/validate-manifest.mjs
scripts/build-theme-editor.mjs
PRIVACY.md                  Data handling and permissions
LICENSE                     GNU GPL version 3
```

## Feedback

Use this repository's Issues for bugs or suggestions. Include the Firefox and
extension versions and the steps needed to reproduce the problem. Use synthetic
examples where possible; remove conversation text, account details and credentials
before attaching screenshots, exports or console logs.

## License

Copyright (C) 2026 igedaena.

ChatGauge's own source code is licensed under the
[GNU General Public License version 3](LICENSE) (`GPL-3.0-only`). You may use,
modify and redistribute it under those terms, including commercially. When
distributing the program or a modified version, provide its corresponding source
under the GPL as required by the license. The program is provided without warranty.

Marked retains its MIT license; its
[license](src/vendor/marked.LICENSE.md) and
[provenance](src/vendor/README.md) are included with the bundled source.
