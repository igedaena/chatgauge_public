# ChatGauge

ChatGauge is a Firefox extension that shows the text size of the current ChatGPT
conversation and lets you view or export its stored messages.

현재 ChatGPT 대화의 글자 수와 UTF-8 용량을 표시하고, 서버에 저장된 대화를
펼쳐보거나 파일로 내보내는 Firefox 확장입니다.

**Status: release preparation.** This repository contains the source for version
0.3.3. A signed release and an installation link are not available here yet.

## Features

- Character count and UTF-8 byte size for user and assistant text.
- Automatic updates, a manual refresh, and an optional update-on-input mode.
- A read-only HTML view in a new tab; use the browser's Ctrl+F to search it.
- Markdown, JSON and HTML export. Selecting multiple formats downloads a ZIP.
- Local preferences for export formats, filenames and a custom send shortcut.
- English and Korean UI, selected from the browser language.

## Try the source in Firefox

The manifest requires Firefox 140 or later. No build or dependency installation
is needed to load the extension source.

1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on** and choose `manifest.json`.
4. Open or reload a conversation on `https://chatgpt.com/`.

The meter appears next to the message composer. Click its count to refresh,
**View / 펼쳐보기** to open the stored conversation, or **Export / 내보내기** to
download it. Open the extension's toolbar icon to change preferences.

This is a temporary development installation. Distribution and signing are
separate release steps.

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

Use Node.js 24 or later for the checks below. Tests use synthetic fixtures; no
ChatGPT account or private conversation files are needed.

```sh
node --test --test-isolation=none tests/*.test.cjs
node scripts/validate-manifest.mjs
```

The extension uses plain JavaScript, CSS and HTML. Marked 18.0.7 is bundled for
Markdown tokenization; no runtime download is needed.

```text
manifest.json               Extension configuration
src/                        Runtime, options, viewer and exporters
_locales/                   English and Korean translations
icons/                      Runtime icons
tests/                      Synthetic regression tests
scripts/validate-manifest.mjs
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
