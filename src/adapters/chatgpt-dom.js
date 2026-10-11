(function registerChatGptAdapter(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { createMessage } = namespace.model;

  const TURN_SELECTOR = [
    'main article[data-testid^="conversation-turn-"]',
    'main [data-testid^="conversation-turn-"]',
    'main [data-message-author-role="user"]',
    'main [data-message-author-role="assistant"]',
    "main article",
  ].join(",");

  const ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const ACTION_CONTROL_SELECTOR = ".turn-action-controls";
  const ACTION_TURN_SELECTOR = "[data-turn-key]";
  const FALLBACK_ACTION_TURN_SELECTOR = "[data-content-search-turn-key]";
  const COPY_ACTION_SELECTOR = [
    'button[aria-label="Copy"]',
    'button[aria-label="복사"]',
  ].join(",");
  const COMPOSER_SELECTOR = [
    "#prompt-textarea",
    'textarea[data-id="root"]',
    'form [contenteditable="true"]',
  ].join(",");
  const STOP_CONTROL_SELECTOR = [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop generating"]',
    'button[aria-label*="응답 중지"]',
  ].join(",");
  const SEND_CONTROL_SELECTOR = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send"]',
    'button[aria-label="Send message"]',
    'button[aria-label="보내기"]',
  ].join(",");
  const REGENERATION_BUTTON_SELECTOR = [
    'button[data-testid*="regenerate"]',
    'button[data-testid*="retry"]',
    'button[aria-label*="Regenerate"]',
    'button[aria-label*="Retry"]',
    'button[aria-label*="다시 생성"]',
    'button[aria-label*="다시 시도"]',
  ].join(",");
  const selectors = Object.freeze({
    composer: COMPOSER_SELECTOR,
    stopControl: STOP_CONTROL_SELECTOR,
    responseAction: `${SEND_CONTROL_SELECTOR},${STOP_CONTROL_SELECTOR}`,
    regenerationButton: REGENERATION_BUTTON_SELECTOR,
  });
  const REMOVE_SELECTOR = [
    "button",
    "form",
    "script",
    "style",
    "svg",
    "textarea",
    '[aria-hidden="true"]',
    '[data-testid*="copy"]',
  ].join(",");

  function findTurns(root) {
    const candidates = Array.from(root.querySelectorAll(TURN_SELECTOR));
    const seenRoles = new Set();

    return candidates.filter((candidate) => {
      const roleElement = candidate.matches(ROLE_SELECTOR)
        ? candidate
        : candidate.querySelector(ROLE_SELECTOR);

      if (!roleElement || seenRoles.has(roleElement)) return false;
      seenRoles.add(roleElement);
      return true;
    });
  }

  function preferredContentRoot(roleElement, role) {
    const selectors =
      role === "assistant"
        ? [".markdown", '[class*="markdown"]']
        : ['[data-testid="user-message"]', ".whitespace-pre-wrap"];

    for (const selector of selectors) {
      const match = roleElement.querySelector(selector);
      if (match) return match;
    }

    return roleElement;
  }

  function textWithoutControls(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(REMOVE_SELECTOR).forEach((node) => node.remove());
    return clone.textContent || "";
  }

  function getAssistantActionKeys(root = document) {
    const keys = [];
    const seen = new Set();

    for (const control of root.querySelectorAll(ACTION_CONTROL_SELECTOR)) {
      if (!control.querySelector(COPY_ACTION_SELECTOR)) continue;
      const turn = control.closest(ACTION_TURN_SELECTOR)
        || control.closest(FALLBACK_ACTION_TURN_SELECTOR);
      const key = turn?.getAttribute("data-turn-key")
        || turn?.getAttribute("data-content-search-turn-key")
        || "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }

    return keys;
  }

  function mutationsTouchActionControls(mutations = []) {
    function isElement(node) {
      return Boolean(node && node.nodeType === 1);
    }

    function containsActionControl(node) {
      return Boolean(
        isElement(node)
        && (
          node.matches?.(ACTION_CONTROL_SELECTOR)
          || node.querySelector?.(ACTION_CONTROL_SELECTOR)
        )
      );
    }

    return mutations.some((mutation) => {
      const target = mutation.target?.nodeType === 1
        ? mutation.target
        : mutation.target?.parentElement;
      if (target?.closest?.(ACTION_CONTROL_SELECTOR)) return true;
      return [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]
        .some(containsActionControl);
    });
  }

  function mutationsNeedMeasurement(mutations = [], ownedHostId = "chatcouter-root") {
    function isElement(node) {
      return Boolean(node && node.nodeType === 1);
    }

    function containsConversationTurn(node) {
      return Boolean(
        isElement(node)
        && (
          node.matches?.(TURN_SELECTOR)
          || node.querySelector?.(TURN_SELECTOR)
        )
      );
    }

    return mutations.some((mutation) => {
      const target = mutation.target?.nodeType === 1
        ? mutation.target
        : mutation.target?.parentElement;
      if (!target) return false;
      if (target.closest?.(`#${ownedHostId}`)) return false;
      if (target.closest?.(COMPOSER_SELECTOR)) return false;
      const composerForm = target.closest?.("form");
      if (composerForm?.querySelector?.(COMPOSER_SELECTOR)) return false;
      if (target.closest?.(TURN_SELECTOR)) return true;
      return [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]
        .some(containsConversationTurn);
    });
  }

  function hasStreamingControl(
    root = document,
    {
      allowActiveComposerFallback = false,
      allowEmptyComposerFallback = false,
    } = {},
  ) {
    if (root.querySelector(STOP_CONTROL_SELECTOR)) return true;
    if (!allowActiveComposerFallback && !allowEmptyComposerFallback) return false;

    const composer = root.querySelector(COMPOSER_SELECTOR);
    if (!composer) return false;
    const value = "value" in composer ? composer.value : composer.textContent;
    const composerForm = composer.closest?.("form");
    const action = composerForm?.querySelector?.(SEND_CONTROL_SELECTOR);
    if (!action) return false;
    const actionEnabled = !action.disabled
      && action.getAttribute?.("aria-disabled") !== "true";
    if (!actionEnabled) return false;
    if (allowActiveComposerFallback) return true;
    return allowEmptyComposerFallback && !value?.trim();
  }

  function extractMessage(turn, ordinal) {
    const roleElement = turn.matches(ROLE_SELECTOR)
      ? turn
      : turn.querySelector(ROLE_SELECTOR);
    const role = roleElement?.getAttribute("data-message-author-role");

    if (role !== "user" && role !== "assistant") return null;

    const contentRoot = preferredContentRoot(roleElement, role);
    // UI conversation-turn testids identify rendered containers, not API messages.
    const id =
      roleElement.getAttribute("data-message-id") ||
      turn.getAttribute("data-message-id") ||
      `${role}-${ordinal}`;
    const createdAt = turn.querySelector("time[datetime]")?.getAttribute("datetime") || "";

    return createMessage({
      id,
      role,
      text: textWithoutControls(contentRoot),
      ordinal,
      createdAt,
    });
  }

  function looksLikeConversationRoute(locationLike) {
    return /(?:^|\/)c\/[a-z0-9-]+(?:\/|$)/i.test(locationLike.pathname);
  }

  function extract(root = document, locationLike = location) {
    const turns = findTurns(root);
    const messages = turns
      .map((turn, ordinal) => extractMessage(turn, ordinal))
      .filter(Boolean);
    const hasComposer = Boolean(
      root.querySelector('#prompt-textarea, textarea[data-id="root"], [contenteditable="true"]'),
    );

    if (messages.length === 0 && looksLikeConversationRoute(locationLike)) {
      return {
        ok: false,
        reason: "conversation-messages-not-found",
        messages,
      };
    }

    if (messages.length === 0 && !hasComposer) {
      return {
        ok: false,
        reason: "chatgpt-page-not-ready",
        messages,
      };
    }

    return { ok: true, reason: null, messages };
  }

  function diagnosticSummary(root = document) {
    const composer = root.querySelector(COMPOSER_SELECTOR);
    const form = composer?.closest?.("form");
    return {
      mainCount: root.querySelectorAll("main").length,
      roleElements: root.querySelectorAll(ROLE_SELECTOR).length,
      roleElementsInMain: root.querySelectorAll(`main ${ROLE_SELECTOR.split(",").join(", main ")}`).length,
      matchedTurns: findTurns(root).length,
      composerPresent: Boolean(composer),
      composerFormPresent: Boolean(form),
      stopControlPresent: Boolean(root.querySelector(STOP_CONTROL_SELECTOR)),
      sendControlPresent: Boolean(form?.querySelector?.(SEND_CONTROL_SELECTOR)),
      actionControls: root.querySelectorAll(ACTION_CONTROL_SELECTOR).length,
      assistantActionKeys: getAssistantActionKeys(root).length,
    };
  }

  function getComposerRegion(root = document) {
    // The editable text alone excludes the send/attachment controls.
    // SPA navigation may retain an earlier conversation's hidden composer.
    // Never let the first selector match pin the badge to that hidden form.
    for (const input of root.querySelectorAll(COMPOSER_SELECTOR)) {
      const form = input.closest("form");
      if (!form || input.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
      if (typeof input.checkVisibility === "function"
        && !input.checkVisibility({ checkVisibilityCSS: true })) continue;
      const rect = form.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return form;
    }
    return null;
  }

  namespace.chatGptDomAdapter = Object.freeze({
    selectors,
    diagnosticSummary,
    getComposerRegion,
    extract,
    getAssistantActionKeys,
    hasStreamingControl,
    looksLikeConversationRoute,
    mutationsNeedMeasurement,
    mutationsTouchActionControls,
  });
})(globalThis);
