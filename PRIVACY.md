# ChatGauge data handling

Last updated: 2026-10-11. This describes the source in version 0.3.3.

## Conversation access

ChatGauge reads user and assistant text from the ChatGPT conversation open in
the current tab to calculate text size, prepare a read-only view, and create
exports. Requests stay on that ChatGPT site's origin (`chatgpt.com` or
`chat.openai.com`) and use the user's existing session.

If a conversation request requires an access token, ChatGauge reads the site's
session endpoint and holds the token in memory only for that request. It does
not save the token in extension storage or send it to another service.

If the conversation endpoint is unavailable, ChatGauge can fall back to messages
loaded in the page. This fallback may cover only part of the conversation.

## Local processing and storage

- Measurements and export preparation take place in the browser.
- Export formats, filename options, refresh mode and the optional send shortcut
  are saved in `storage.local` in the Firefox profile. Browser sync is not used.
- Conversation text and authentication tokens are not written to extension
  preference storage.
- **View** transfers a generated HTML document to an extension tab for display.
  It does not keep a saved history for reopening the document after a reload.
- **Export** saves the selected files through the browser. These files contain
  conversation content and metadata; their storage and sharing are controlled
  by the user.

## Network and diagnostics

ChatGauge has no analytics, telemetry or external collection server. Generated
HTML does not load remote images, scripts or other assets. Opening a link in
the document is an ordinary browser navigation to that link's destination.

Diagnostic messages are written to the browser's local console. They include
operation status, timing, message counts, role/state information and structural
DOM counts, rather than conversation text or access tokens. A console export can
also contain logs from ChatGPT and other page scripts; review it before sharing.

## Permissions

- `storage`: save local extension preferences.
- Site access to `https://chatgpt.com/*` and `https://chat.openai.com/*`: display
  the meter and read the current conversation on those sites.

ChatGauge is an independent project and is not affiliated with or endorsed by
OpenAI or Mozilla.
