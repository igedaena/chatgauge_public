"use strict";

// Synthetic nodes exercise the production extractor without copying its ID logic.
module.exports = function domTurns(messages) {
  const turns = messages.map(({ id, wrapperId, testId, role, text }, ordinal) => {
    const roleElement = {
      getAttribute: name => ({ "data-message-author-role": role, "data-message-id": id })[name] || null,
      querySelector: () => null,
      cloneNode: () => ({ textContent: text, querySelectorAll: () => [] }),
    };
    return {
      matches: () => false,
      contains: node => node === roleElement,
      getAttribute: name => ({ "data-testid": testId ?? `conversation-turn-${ordinal}`, "data-message-id": wrapperId })[name] || null,
      querySelector: selector => selector.includes("data-message-author-role") ? roleElement : null,
    };
  });
  return { querySelectorAll: () => turns, querySelector: () => null };
};
