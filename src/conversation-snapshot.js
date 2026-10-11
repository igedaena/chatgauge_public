(function registerConversationSnapshot(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { chatGptApiAdapter, chatGptDomAdapter, refreshPolicy } = namespace;

  const preservationReasons = new Set([
    "assistant-in-progress", "current-node-in-progress", "assistant-end-turn-pending",
    "current-node-end-turn-pending", "current-node-not-assistant", "current-node-not-visible",
  ]);

  async function readSnapshot({ signal, isCurrent, domSnapshot }, baselineRefresh) {
    const result = await chatGptApiAdapter.extract({ signal });
    if (signal.aborted || !isCurrent()) return { ok: false, reason: "export-context-changed" };
    if (!result.ok) return { ok: false, reason: result.reason };

    // Baseline refresh captures the DOM once; later same-room input is
    // not grounds to restart or reject that server-stored checkpoint.
    const dom = baselineRefresh ? domSnapshot : chatGptDomAdapter.extract();
    const verdict = refreshPolicy.assessResponseCandidate({
      expectedTurns: 0,
      expectedAssistantTurns: 0,
      candidate: refreshPolicy.summarizeMessages(result.messages),
      completion: result.completion,
      domCandidate: !baselineRefresh && dom.ok ? refreshPolicy.summarizeMessages(dom.messages) : null,
      domUserCovered: dom.ok
        ? (baselineRefresh ? refreshPolicy.includesCapturedDomUser : refreshPolicy.coversLatestDomUser)(result.messages, dom.messages)
        : null,
    });
    if (verdict.reason === "api-user-tail-behind-dom"
      || (!baselineRefresh && !verdict.publishable && !preservationReasons.has(verdict.reason))) {
      return { ok: false, reason: verdict.reason };
    }
    const completed = result.completion?.currentNodeFinishType === "interrupted"
      || (result.completion?.currentNodeRole === "assistant"
        && result.completion?.currentNodeRecipient === "all"
        && result.completion?.currentNodeStatus === "finished_successfully"
        && result.completion?.currentNodeEndTurn === true
        && result.messages.at(-1)?.role === "assistant");
    const unchecked = !verdict.publishable || !completed;
    const reason = verdict.publishable ? "completion-unconfirmed" : verdict.reason;
    return { ok: true, result, unchecked, reason: unchecked ? reason : verdict.reason };
  }

  // Checkpoints use the user captured at request start; exports inspect current DOM.
  namespace.conversationSnapshot = Object.freeze({
    readCheckpoint: (options) => readSnapshot(options, true),
    readExport: (options) => readSnapshot(options, false),
  });
})(globalThis);
