(function startChatcouter(global) {
  "use strict";

  if (global.__chatcouterLoaded) return;
  global.__chatcouterLoaded = true;

  const {
    chatGptApiAdapter: apiAdapter,
    chatGptDomAdapter: domAdapter,
    freshExporter,
    documentViewer,
    conversationSnapshot,
    meterUi,
    exportSettings,
    model,
    i18n,
    refreshPolicy,
  } = global.Chatcouter;
  const { t, number } = i18n;
  const HOST_ID = "chatcouter-root";
  const RESPONSE_SETTLE_MS = 4000;
  const RESPONSE_RETRY_MS = 1500;
  const RESPONSE_TRIGGER_FALLBACK_MS = 150;
  const ACTION_COMPLETION_FALLBACK_MS = 30000;
  const REGENERATION_INTENT_MS = 30000;
  const MAX_RESPONSE_VERIFICATION_RETRIES = 3;
  const MAX_RESPONSE_VERIFICATION_MS = 8000;
  const AUTOMATIC_RECOVERY_THRESHOLD = 1;
  const BASELINE_FAILURE_THRESHOLD = 3;
  const {
    composer: COMPOSER_SELECTOR,
    regenerationButton: REGENERATION_BUTTON_SELECTOR,
    stopControl: STOP_BUTTON_SELECTOR,
    responseAction: RESPONSE_ACTION_BUTTON_SELECTOR,
  } = domAdapter.selectors;

  let debounceTimer = null;
  let idleHandle = null;
  let lastRoute = `${location.pathname}${location.search}`;
  let measurementGeneration = 0;
  let activeRequest = null;
  let exportRequest = null;
  let exportError = "";
  let expandError = "";
  let startupRetries = 0;
  let awaitingResponse = false;
  let pendingConversationCreation = false;
  let responseSettleTimer = null;
  let responseTriggerFallbackTimer = null;
  let enterKeyTimer = null;
  let acceptedSubmitSequence = 0;
  let hasLatestSnapshot = false;
  let pendingResponseBaseline = null;
  let pendingResponseBaselineAssistantId = "";
  let pendingResponseMode = "";
  let trustedSummary = null;
  let trustedLastAssistantId = "";
  let turnsSinceTrusted = 0;
  let stoppedTurnsSinceTrusted = 0;
  let unverifiedResponseStreak = 0;
  let recoveryFailureStreak = 0;
  let baselineRequest = null;
  // Suppress response lifecycle tracking for a baseline refresh, including after
  // its request ends. Only the next submitted user turn resumes automatic work.
  let baselineTurnActive = false;
  let responseVerificationRetries = 0;
  let responseVerificationStartedAt = 0;
  let relevantMutationSequence = 0;
  let lastRelevantMutationAt = Date.now();
  let assistantActionKeys = [];
  let pendingActionBaselineKey = "";
  let pendingActionMarkerRemoved = false;
  let pendingActionCompletionSeen = false;
  let pendingActionHintSupported = false;
  let pendingActionWaitStartedAt = 0;
  let pendingResponseStopped = false;
  let regenerationIntent = null;
  const diagnostics = refreshPolicy.createDiagnostics();
  const refreshEpoch = refreshPolicy.createEpochGate();
  let measureState = "idle";
  let measureDisplay = { primary: "ChatGauge", secondary: "" };
  let measureTitle = t("automatic_measure_hint");
  let lastMeasuredDisplay = null;
  let updateOnUserInput = false;
  let desiredUpdateOnUserInput = false;
  let sendShortcut = null;
  let sendShortcutChanged = false;
  let settingsLoaded = false;
  let settingChangedDuringLoad = false;
  global.browser.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (Object.hasOwn(changes, exportSettings.UPDATE_ON_INPUT_KEY)) {
      desiredUpdateOnUserInput = exportSettings.normalizeUpdateOnUserInput(
        changes[exportSettings.UPDATE_ON_INPUT_KEY].newValue,
      );
      if (!settingsLoaded) settingChangedDuringLoad = true;
    }
    if (Object.hasOwn(changes, exportSettings.SEND_SHORTCUT_KEY)) {
      sendShortcut = exportSettings.normalizeSendShortcut(changes[exportSettings.SEND_SHORTCUT_KEY].newValue);
      sendShortcutChanged = true;
    }
  });
  exportSettings.getSendShortcut().then((value) => {
    if (!sendShortcutChanged) sendShortcut = value;
  }).catch(() => {
    diagnose("send-shortcut-settings-unavailable", { reason: "storage-read-failed" });
  });
  const settingsReady = exportSettings.getUpdateOnUserInput().then((value) => {
    if (!settingChangedDuringLoad) desiredUpdateOnUserInput = value;
  }).catch(() => {
    diagnose("refresh-settings-unavailable", { reason: "storage-read-failed" });
  }).then(() => {
    updateOnUserInput = desiredUpdateOnUserInput;
    settingsLoaded = true;
  });

  Object.defineProperty(global, "__chatcouterDiagnostics", {
    configurable: true,
    get: () => diagnostics.snapshot(),
  });

  function diagnose(event, details = {}) {
    const entry = diagnostics.record(event, details);
    global.console?.debug?.("[ChatGauge]", JSON.stringify(entry));
  }

  const ui = meterUi.create({
    document,
    window: global,
    getComposer: () => domAdapter.getComposerRegion(),
    onMeasure: handleMeasureClick,
    onExport: () => exportFresh(),
    onExpand: () => exportFresh({ view: true }),
    onOptions: openOptionsFromHome,
  });

  function currentRoute() {
    return `${location.pathname}${location.search}`;
  }

  function renderUi() {
    ui.render({
      pageKind: currentPageKind(),
      conversationId: apiAdapter.getConversationId(),
      state: measureState,
      display: measureDisplay,
      title: measureTitle,
      lastMeasuredDisplay,
      baselineBusy: Boolean(baselineRequest),
      exportBusy: Boolean(exportRequest && !exportRequest.view),
      exportError,
      expandBusy: Boolean(exportRequest?.view),
      expandError,
      recoveryFailureStreak,
      baselineFailureThreshold: BASELINE_FAILURE_THRESHOLD,
      unverifiedResponseStreak,
      automaticRecoveryThreshold: AUTOMATIC_RECOVERY_THRESHOLD,
      updateOnUserInput,
    });
  }

  function render(state, primary, secondary = "", title = "", charactersText) {
    measureState = state;
    measureDisplay = state === "error"
      ? lastMeasuredDisplay?.conversationId === apiAdapter.getConversationId()
        ? lastMeasuredDisplay : { primary: t("needs_verification"), secondary: "" }
      : { primary, secondary, charactersText };
    measureTitle = title || t("measure_again_hint");
    renderUi();
  }

  function renderUnverifiedResponseStreak() {
    renderUi();
  }

  function updateUnverifiedResponseStreak(outcome, { reason = "", responseMode = "" } = {}) {
    const previous = unverifiedResponseStreak;
    unverifiedResponseStreak = refreshPolicy.updateUnverifiedResponseStreak({
      current: previous,
      outcome,
      responseMode,
    });
    renderUnverifiedResponseStreak();
    diagnose("unverified-response-streak", {
      previous,
      current: unverifiedResponseStreak,
      outcome,
      reason,
      responseMode,
    });
  }

  function showPendingRefresh() {
    render("loading", t("measuring"), "", t("response_wait_hint"));
  }

  function currentPageKind() {
    return refreshPolicy.classifyPage({
      conversationId: apiAdapter.getConversationId() || "",
      hasComposer: Boolean(document.querySelector(COMPOSER_SELECTOR)),
    });
  }

  function showInactivePage(pageKind = currentPageKind()) {
    clearLatestSnapshot(`page:${pageKind}`);
    render(
      "idle",
      "ChatGauge",
      "",
      ["home", "new-chat"].includes(pageKind) ? t("options_open_hint") : t("automatic_measure_hint"),
    );
  }

  function restoreUiIfRemoved() {
    if (document.getElementById(HOST_ID)) return;

    const pageKind = currentPageKind();
    diagnose("ui-host-restored", { pageKind });
    renderUi();
  }

  async function openOptionsFromHome() {
    if (!["home", "new-chat"].includes(currentPageKind()) || measureState !== "idle"
      || pendingConversationCreation || awaitingResponse) return;
    const route = currentRoute(), generation = measurementGeneration;
    render("idle", "ChatGauge", "", t("options_open_hint"));
    try {
      const result = await global.browser.runtime.sendMessage({ type: "chatgauge-open-options" });
      if (!result?.ok) throw new Error("options-open-failed");
    } catch {
      diagnose("options-open-failed");
      if (route === currentRoute() && generation === measurementGeneration && measureState === "idle"
        && !pendingConversationCreation && !awaitingResponse
        && ["home", "new-chat"].includes(currentPageKind())) {
        render("idle", "ChatGauge", "", t("options_open_failed_hint"));
      }
    }
  }

  function handleMeasureClick() {
    if (exportRequest || baselineRequest) return;
    if (currentPageKind() !== "conversation") {
      showInactivePage();
      return;
    }
    refreshBaseline("manual");
  }

  function publishMeasurement(result, scope, fallbackReason = "") {
    const totals = model.measureConversation(result.messages);
    const isFull = scope === "full" || scope === "server-stored-unverified";
    const recovered = scope === "server-stored-unverified";

    hasLatestSnapshot = isFull;

    if (isFull) {
      recoveryFailureStreak = 0;
      updateUnverifiedResponseStreak(recovered ? "baseline-recovered" : "verified-full", { reason: "snapshot-published" });
      trustedSummary = refreshPolicy.summarizeMessages(result.messages);
      trustedLastAssistantId = refreshPolicy.getLastAssistantId(result.messages);
      turnsSinceTrusted = 0;
      stoppedTurnsSinceTrusted = 0;
    }

    lastMeasuredDisplay = {
      conversationId: apiAdapter.getConversationId(),
      charactersText: isFull ? number(totals.characters) : t("screen_number", number(totals.characters)),
      primary: t("character_count", isFull ? number(totals.characters) : t("screen_number", number(totals.characters))),
      secondary: model.formatBytes(totals.utf8Bytes),
    };
    render(
      isFull ? "ready" : "fallback",
      lastMeasuredDisplay.primary,
      lastMeasuredDisplay.secondary,
      [
        recovered
          ? t("baseline_success_hint")
          : isFull
          ? t("full_success_hint")
          : t("dom_success_hint", fallbackReason),
        t("message_count", number(totals.messages)),
        t("user_count", number(totals.userMessages)),
        t("assistant_count", number(totals.assistantMessages)),
        t("empty_count", number(totals.emptyMessages)),
        t("measure_again_hint"),
      ].join(" · "),
      lastMeasuredDisplay.charactersText,
    );

    renderUi();

    diagnose("snapshot-published", { scope, ...refreshPolicy.summarizeMessages(result.messages) });
  }

  function clearLatestSnapshot(reason = "unspecified") {
    const hadSnapshot = hasLatestSnapshot;
    hasLatestSnapshot = false;
    renderUi();
    diagnose("snapshot-invalidated", { reason, hadSnapshot });
  }

  async function refreshBaseline(trigger) {
    if (baselineRequest || exportRequest || !apiAdapter.getConversationId()) return;
    advanceRefreshEpoch("baseline-refresh");
    completePendingResponse("baseline-refresh");
    baselineTurnActive = true;
    regenerationIntent = null;
    const conversationId = apiAdapter.getConversationId();
    const token = refreshEpoch.capture({ conversationId, route: currentRoute() });
    const request = new AbortController();
    baselineRequest = request;
    const isCurrent = () => baselineRequest === request && refreshEpoch.accepts(token, {
      conversationId: apiAdapter.getConversationId() || "",
      route: currentRoute(),
    });
    render("loading", t("measuring"), "", t("baseline_loading_hint"));
    diagnose("baseline-refresh-started", { trigger, recoveryFailureStreak });
    try {
      const snapshot = await conversationSnapshot.readCheckpoint({
        signal: request.signal,
        isCurrent,
        domSnapshot: domAdapter.extract(),
      });
      if (request.signal.aborted || !isCurrent()) return;
      if (!snapshot.ok) {
        failBaselineRefresh(snapshot.reason, trigger);
        return;
      }
      publishMeasurement(snapshot.result, "server-stored-unverified");
      diagnose("baseline-refresh-succeeded", {
        trigger,
        unchecked: snapshot.unchecked,
        reason: snapshot.reason,
        ...refreshPolicy.summarizeMessages(snapshot.result.messages),
      });
    } catch (error) {
      if (request.signal.aborted || !isCurrent()) return;
      failBaselineRefresh("conversation-request-failed", trigger);
    } finally {
      if (baselineRequest === request) {
        baselineRequest = null;
        renderUi();
      }
    }
  }

  function failBaselineRefresh(reason, trigger) {
    if (trigger !== "manual" && trigger !== "admission") recoveryFailureStreak += 1;
    render("error", t("needs_verification"), "", t("baseline_failed_hint"));
    diagnose("baseline-refresh-failed", { trigger, reason, recoveryFailureStreak, unverifiedResponseStreak });
  }

  function downloadExport({ contents, filename, mimeType }) {
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.documentElement.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      global.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  async function exportFresh({ view = false } = {}) {
    const conversationId = apiAdapter.getConversationId();
    if (!conversationId || exportRequest || (view && baselineRequest)) return;
    const operation = view ? "fresh-view" : "fresh-export";
    if (baselineRequest) {
      baselineRequest.abort();
      baselineRequest = null;
      render("error", t("needs_verification"), "", t("baseline_export_cancelled_hint"));
      diagnose("baseline-refresh-cancelled", { reason: "fresh-export" });
    }
    cancelActiveMeasurement(operation);
    const request = new AbortController();
    request.view = view;
    exportRequest = request;
    if (view) expandError = "";
    else exportError = "";
    const token = refreshEpoch.capture({ conversationId, route: currentRoute() });
    const mutationSequence = relevantMutationSequence;
    const isCurrent = () => refreshEpoch.accepts(token, {
      conversationId: apiAdapter.getConversationId() || "",
      route: currentRoute(),
    }) && mutationSequence === relevantMutationSequence;
    const reject = reason => {
      if (view) expandError = reason;
      else exportError = reason;
      diagnose(`${operation}-rejected`, { reason });
    };
    renderUi();
    diagnose(`${operation}-started`);
    try {
      const options = () => ({
        signal: request.signal,
        isCurrent,
        conversationId,
        title: document.title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, ""),
      });
      let prepared;
      if (view) prepared = await freshExporter.prepareView(options());
      else {
        const { formats, filenameOptions } = await exportSettings.getExportPreferences();
        if (request.signal.aborted || exportRequest !== request) return;
        if (!isCurrent()) {
          reject("export-context-changed");
          return;
        }
        prepared = await freshExporter.prepare({ ...options(), formats, filenameOptions });
      }
      if (request.signal.aborted || exportRequest !== request) return;
      if (!prepared.ok) {
        reject(prepared.reason);
        return;
      }
      if (!isCurrent()) {
        reject("export-context-changed");
        return;
      }
      if (view) {
        // The prepared snapshot is committed to delivery here. New input/route
        // cancels the transfer; later assistant activity does not refresh it.
        const opened = await documentViewer.open({ html: prepared.contents, signal: request.signal });
        if (request.signal.aborted || exportRequest !== request) return;
        if (!opened.ok) { reject(opened.reason); return; }
      } else downloadExport(prepared);
      diagnose(view ? "fresh-view-opened" : "fresh-export-download-started", {
        ...refreshPolicy.summarizeMessages(prepared.result.messages),
        unchecked: prepared.unchecked,
        reason: prepared.reason,
      });
    } catch (error) {
      if (request.signal.aborted || exportRequest !== request) return;
      reject(view ? "view-failed" : "export-failed");
    } finally {
      if (exportRequest === request) {
        exportRequest = null;
        renderUi();
        if (awaitingResponse) armResponseSettleCheck();
        else if (!baselineTurnActive && measureState === "loading") {
          scheduleMeasurement(view ? "view-finished" : "export-finished");
        }
      }
    }
  }

  function cancelActiveMeasurement(reason) {
    global.clearTimeout(debounceTimer);
    debounceTimer = null;
    if (idleHandle !== null) {
      if ("cancelIdleCallback" in global) global.cancelIdleCallback(idleHandle);
      else global.clearTimeout(idleHandle);
      idleHandle = null;
    }
    measurementGeneration += 1;
    activeRequest?.abort();
    activeRequest = null;
    diagnose("measurement-cancelled", { reason });
  }

  function advanceRefreshEpoch(reason) {
    const epoch = refreshEpoch.advance();
    baselineRequest?.abort();
    baselineRequest = null;
    cancelExport();
    cancelActiveMeasurement(reason);
    clearLatestSnapshot(reason);
    diagnose("refresh-epoch-advanced", { epoch, reason });
    return epoch;
  }

  function cancelExport() {
    exportRequest?.abort();
    exportRequest = null;
    exportError = "";
    expandError = "";
  }

  function cancelResponseTriggerFallback() {
    global.clearTimeout(enterKeyTimer);
    enterKeyTimer = null;
    global.clearTimeout(responseTriggerFallbackTimer);
    responseTriggerFallbackTimer = null;
  }

  function completePendingResponse(reason, { uncertain = false } = {}) {
    const completedResponseMode = pendingResponseMode;
    if (uncertain) {
      updateUnverifiedResponseStreak("uncertain", {
        reason,
        responseMode: completedResponseMode,
      });
    }
    awaitingResponse = false;
    pendingConversationCreation = false;
    pendingResponseBaseline = null;
    pendingResponseBaselineAssistantId = "";
    pendingResponseMode = "";
    pendingActionBaselineKey = "";
    pendingActionMarkerRemoved = false;
    pendingActionCompletionSeen = false;
    pendingActionHintSupported = false;
    pendingActionWaitStartedAt = 0;
    pendingResponseStopped = false;
    responseVerificationRetries = 0;
    responseVerificationStartedAt = 0;
    global.clearTimeout(responseSettleTimer);
    responseSettleTimer = null;
    diagnose("response-complete", {
      operation: "response-observation",
      reason,
      uncertain,
      responseMode: completedResponseMode,
      unverifiedResponseStreak,
    });
    renderUi();
  }

  function retryPendingResponse(reason) {
    responseVerificationRetries += 1;
    const elapsedMs = Date.now() - responseVerificationStartedAt;
    const exhausted = responseVerificationRetries >= MAX_RESPONSE_VERIFICATION_RETRIES
      || elapsedMs >= MAX_RESPONSE_VERIFICATION_MS;
    diagnose("response-candidate-rejected", {
      reason,
      retry: responseVerificationRetries,
      elapsedMs,
      ...(exhausted ? { terminationReason: elapsedMs >= MAX_RESPONSE_VERIFICATION_MS
        ? "time-budget" : "retry-limit" } : {}),
    });
    if (exhausted) {
      completePendingResponse("verification-exhausted", { uncertain: true });
      render(
        "error",
        t("needs_verification"),
        "",
        t("verification_exhausted_hint"),
      );
      return;
    }

    render("loading", t("measuring"));
    global.clearTimeout(responseSettleTimer);
    responseSettleTimer = global.setTimeout(finishPendingResponse, RESPONSE_RETRY_MS);
  }

  async function measure(reason = "scheduled") {
    if (exportRequest || baselineRequest) return;
    if (updateOnUserInput) {
      if (!apiAdapter.getConversationId()) {
        if (!pendingConversationCreation) showInactivePage();
        return;
      }
      return refreshBaseline("admission");
    }
    if (baselineTurnActive) return;
    if (!awaitingResponse && unverifiedResponseStreak >= AUTOMATIC_RECOVERY_THRESHOLD) return;
    const conversationId = apiAdapter.getConversationId();
    const now = Date.now();

    if (!conversationId) {
      if (awaitingResponse) showPendingRefresh();
      else showInactivePage();
      return;
    }

    if (!awaitingResponse && responseIsStreaming()) {
      beginResponseCycle(`${reason}-streaming`, { newTurn: false });
      return;
    }

    clearLatestSnapshot(`measurement:${reason}`);
    if (awaitingResponse && !responseVerificationStartedAt) {
      responseVerificationStartedAt = now;
    }
    const generation = ++measurementGeneration;
    activeRequest?.abort();
    activeRequest = new AbortController();
    const mutationSequenceAtStart = relevantMutationSequence;
    const epochToken = refreshEpoch.capture({
      conversationId,
      route: currentRoute(),
    });
    diagnose("measurement-started", {
      reason,
      forceFullRefresh: true,
      conversationPresent: Boolean(conversationId),
      awaitingResponse,
      mutationSequence: mutationSequenceAtStart,
    });

    if (conversationId) {
      render("loading", t("measuring"));
      let apiResult;
      try {
        apiResult = await apiAdapter.extract({ signal: activeRequest.signal });
      } catch (error) {
        if (error?.name === "AbortError") return;
        apiResult = { ok: false, reason: "conversation-request-failed", messages: [] };
      }

      if (generation !== measurementGeneration) return;
      if (!refreshEpoch.accepts(epochToken, {
        conversationId: apiAdapter.getConversationId() || "",
        route: currentRoute(),
      })) {
        diagnose("measurement-discarded", { reason: "refresh-context-changed" });
        return;
      }
      if (apiResult.ok) {
        const apiSummary = refreshPolicy.summarizeMessages(apiResult.messages);
        const domResult = domAdapter.extract();
        const domSummary = domResult.ok
          ? refreshPolicy.summarizeMessages(domResult.messages)
          : null;
        const domUserCovered = domResult.ok
          ? refreshPolicy.coversLatestDomUser(apiResult.messages, domResult.messages)
          : null;
        diagnose("api-candidate-received", {
          ...apiSummary,
          ...apiResult.completion,
          domMessages: domSummary?.messages ?? null,
          domUserMessages: domSummary?.userMessages ?? null,
          domAssistantMessages: domSummary?.assistantMessages ?? null,
          domLastRole: domSummary?.lastRole || "",
          domUserCovered,
          domFailureReason: domResult.ok ? "" : domResult.reason,
          ...(!domResult.ok && domAdapter.diagnosticSummary ? {
            domStructure: domAdapter.diagnosticSummary(document),
          } : {}),
          mutationSequence: relevantMutationSequence,
        });

        if (awaitingResponse && relevantMutationSequence !== mutationSequenceAtStart) {
          retryPendingResponse("dom-changed-during-request");
          return;
        }

        if (awaitingResponse) {
          const assessment = refreshPolicy.assessResponseCandidate({
            baseline: pendingResponseBaseline,
            baselineAssistantId: pendingResponseBaselineAssistantId,
            candidate: apiSummary,
            candidateAssistantId: refreshPolicy.getLastAssistantId(apiResult.messages),
            completion: apiResult.completion,
            domCandidate: domSummary,
            domUserCovered,
            expectedTurns: turnsSinceTrusted,
            expectedAssistantTurns: refreshPolicy.expectedAssistantAdvance(
              turnsSinceTrusted,
              stoppedTurnsSinceTrusted,
            ),
            allowIncompleteTurn: pendingResponseStopped,
            requireAssistantIdentityChange:
              pendingResponseMode === "regeneration" && !pendingResponseStopped,
          });
          if (!assessment.publishable) {
            retryPendingResponse(assessment.reason);
            return;
          }
        } else if (domUserCovered === false) {
          startupRetries = 0;
          render("error", t("needs_verification"), "", t("admission_rejected_hint"));
          diagnose("admission-candidate-rejected", { reason: "api-user-tail-behind-dom" });
          return;
        }

        startupRetries = 0;
        publishMeasurement(apiResult, "full");
        if (awaitingResponse) completePendingResponse("verified-api-snapshot");
        return;
      }

      diagnose("api-candidate-failed", { reason: apiResult.reason });
      const domResult = domAdapter.extract();
      if (domResult.ok) {
        publishMeasurement(domResult, "dom", apiResult.reason);
        if (awaitingResponse) completePendingResponse("dom-fallback", { uncertain: true });
        return;
      }

      if (startupRetries < 2) {
        startupRetries += 1;
        render("loading", t("measuring"));
        scheduleMeasurement("lookup-retry", 1500);
        return;
      }

      render(
        "error",
        t("needs_verification"),
        "",
        t("measurement_failed_hint", apiResult.reason, domResult.reason),
      );
      if (awaitingResponse) completePendingResponse("measurement-failed", { uncertain: true });
      return;
    }

  }

  function scheduleIdleMeasurement(reason) {
    const generation = measurementGeneration;
    const run = async () => {
      idleHandle = null;
      if (!settingsLoaded) {
        if (currentPageKind() === "conversation" && !exportRequest && !baselineRequest) {
          render("loading", t("measuring"));
        }
        await settingsReady;
      }
      if (generation !== measurementGeneration) return;
      return measure(reason);
    };
    idleHandle = "requestIdleCallback" in global
      ? global.requestIdleCallback(run, { timeout: 800 })
      : global.setTimeout(run, 0);
  }

  function scheduleMeasurement(reason = "scheduled", delayMs = 0) {
    global.clearTimeout(debounceTimer);
    if (idleHandle !== null) {
      if ("cancelIdleCallback" in global) global.cancelIdleCallback(idleHandle);
      else global.clearTimeout(idleHandle);
      idleHandle = null;
    }
    debounceTimer = global.setTimeout(
      () => {
        debounceTimer = null;
        scheduleIdleMeasurement(reason);
      },
      delayMs,
    );
  }

  function responseIsStreaming() {
    return domAdapter.hasStreamingControl(document, {
      allowActiveComposerFallback: awaitingResponse
        && pendingActionHintSupported
        && !pendingActionCompletionSeen,
      allowEmptyComposerFallback: awaitingResponse,
    });
  }

  function finishPendingResponse() {
    if (!awaitingResponse) return;
    responseSettleTimer = null;
    if (pendingConversationCreation && !apiAdapter.getConversationId()) {
      diagnose("response-settle-deferred", { reason: "conversation-id-missing" });
      armResponseSettleCheck();
      return;
    }
    // Only explicit Stop can keep the action fallback clock from starting.
    // Enabled Send is a weak inference and may belong to an unsent draft.
    const explicitStreaming = domAdapter.hasStreamingControl(document);
    if (explicitStreaming) pendingActionWaitStartedAt = 0;
    else if (pendingActionHintSupported && !pendingActionCompletionSeen) {
      if (!pendingActionWaitStartedAt) pendingActionWaitStartedAt = Date.now();
      const waitElapsedMs = Date.now() - pendingActionWaitStartedAt;
      if (waitElapsedMs >= ACTION_COMPLETION_FALLBACK_MS) {
        pendingActionHintSupported = false;
        diagnose("assistant-actions-fallback", { waitElapsedMs });
      }
    }
    const streaming = explicitStreaming || responseIsStreaming();
    diagnose("response-settle-checked", {
      streaming,
      quietForMs: Date.now() - lastRelevantMutationAt,
      mutationSequence: relevantMutationSequence,
    });
    if (streaming) {
      armResponseSettleCheck();
      return;
    }

    if (pendingActionHintSupported && !pendingActionCompletionSeen) {
      const waitElapsedMs = Date.now() - pendingActionWaitStartedAt;
      diagnose("response-settle-deferred", {
        reason: "assistant-actions-pending",
        waitElapsedMs,
      });
      global.clearTimeout(responseSettleTimer);
      responseSettleTimer = global.setTimeout(finishPendingResponse, RESPONSE_RETRY_MS);
      return;
    }

    scheduleMeasurement("response-settled");
  }

  function armResponseSettleCheck() {
    global.clearTimeout(responseSettleTimer);
    responseSettleTimer = global.setTimeout(finishPendingResponse, RESPONSE_SETTLE_MS);
  }

  function latestAssistantActionKey(keys = assistantActionKeys) {
    return keys[keys.length - 1] || "";
  }

  function beginResponseCycle(
    trigger,
    {
      actionBaselineKey = "",
      actionMarkerRemoved = false,
      newTurn = false,
      mode = newTurn ? "new-turn" : "regeneration",
    } = {},
  ) {
    if (currentPageKind() === "inactive") {
      diagnose("response-trigger-ignored", { trigger, reason: "inactive-page" });
      showInactivePage("inactive");
      return;
    }

    // Input invalidates file preparation/view delivery while baseline work stays.
    // Never advance the epoch here: same-room input must preserve baseline work.
    if (newTurn) {
      cancelExport();
      renderUi();
    }
    if (baselineRequest) return;
    if (!settingsLoaded) {
      const route = currentRoute();
      const submitSequence = acceptedSubmitSequence;
      settingsReady.then(() => {
        if (route === currentRoute() && submitSequence === acceptedSubmitSequence) {
          beginResponseCycle(trigger, { actionBaselineKey, actionMarkerRemoved, newTurn, mode });
        }
      });
      return;
    }
    if (newTurn) {
      if (updateOnUserInput !== desiredUpdateOnUserInput) {
        diagnose("refresh-mode-changed", { updateOnUserInput: desiredUpdateOnUserInput });
      }
      updateOnUserInput = desiredUpdateOnUserInput;
    }
    if (updateOnUserInput) {
      if (!newTurn) return;
      if (apiAdapter.getConversationId()) {
        refreshBaseline("input-turn");
      } else {
        advanceRefreshEpoch("input-turn");
        completePendingResponse("input-turn");
        baselineTurnActive = true;
        pendingConversationCreation = true;
        render("loading", t("measuring"), "", t("conversation_loading_hint"));
        diagnose("input-checkpoint-deferred", { reason: "conversation-id-missing" });
      }
      return;
    }
    if (!newTurn && unverifiedResponseStreak >= AUTOMATIC_RECOVERY_THRESHOLD) return;
    if (newTurn && unverifiedResponseStreak >= AUTOMATIC_RECOVERY_THRESHOLD) {
      refreshBaseline(trigger);
      return;
    }
    if (baselineTurnActive) {
      if (!newTurn) return;
      baselineTurnActive = false;
    }

    if (awaitingResponse && !newTurn) {
      diagnose("response-pending-duplicate", { trigger });
      armResponseSettleCheck();
      return;
    }

    assistantActionKeys = domAdapter.getAssistantActionKeys();
    regenerationIntent = null;
    if (newTurn) turnsSinceTrusted += 1;
    pendingResponseBaseline = trustedSummary;
    pendingResponseBaselineAssistantId = trustedLastAssistantId;
    pendingResponseMode = mode;
    pendingActionBaselineKey = actionBaselineKey || latestAssistantActionKey();
    pendingActionMarkerRemoved = actionMarkerRemoved;
    pendingActionCompletionSeen = false;
    pendingActionHintSupported = Boolean(pendingActionBaselineKey);
    pendingActionWaitStartedAt = 0;
    pendingResponseStopped = false;
    advanceRefreshEpoch(newTurn ? "new-turn" : "response-start");
    pendingConversationCreation = !apiAdapter.getConversationId();
    awaitingResponse = true;
    startupRetries = 0;
    responseVerificationRetries = 0;
    responseVerificationStartedAt = 0;
    lastRelevantMutationAt = Date.now();
    diagnose("response-pending", {
      trigger,
      newTurn,
      conversationPresent: Boolean(apiAdapter.getConversationId()),
      expectedTurns: turnsSinceTrusted,
      expectedAssistantTurns: refreshPolicy.expectedAssistantAdvance(turnsSinceTrusted, stoppedTurnsSinceTrusted),
      responseMode: pendingResponseMode,
      actionHintSupported: pendingActionHintSupported,
      baselineMessages: pendingResponseBaseline?.messages ?? null,
      baselineUserMessages: pendingResponseBaseline?.userMessages ?? null,
      baselineAssistantMessages: pendingResponseBaseline?.assistantMessages ?? null,
    });
    showPendingRefresh();
    armResponseSettleCheck();
  }

  function handleAssistantActionMutations(mutations) {
    if (baselineTurnActive || updateOnUserInput) return;
    if (!domAdapter.mutationsTouchActionControls(mutations)) return;

    const previousKeys = assistantActionKeys;
    const currentKeys = domAdapter.getAssistantActionKeys();
    assistantActionKeys = currentKeys;
    if (!awaitingResponse && regenerationIntent) {
      const intent = regenerationIntent;
      if (Date.now() > intent.expiresAt) {
        regenerationIntent = null;
      } else if (
        intent.baselineKey
        && previousKeys.includes(intent.baselineKey)
        && !currentKeys.includes(intent.baselineKey)
      ) {
        beginResponseCycle("regeneration-action", {
          actionBaselineKey: intent.baselineKey,
          actionMarkerRemoved: true,
          mode: "regeneration",
          newTurn: false,
        });
        return;
      }
    }
    if (!awaitingResponse) return;

    const assessment = refreshPolicy.assessAssistantActionChange({
      baselineKey: pendingActionBaselineKey,
      mode: pendingResponseMode,
      markerRemoved: pendingActionMarkerRemoved,
      previousKeys,
      currentKeys,
    });
    pendingActionMarkerRemoved = assessment.markerRemoved;
    if (!assessment.completionSeen) return;

    pendingActionCompletionSeen = true;
    pendingActionWaitStartedAt = 0;
    responseVerificationRetries = 0;
    responseVerificationStartedAt = 0;
    cancelActiveMeasurement("assistant-actions-complete");
    diagnose("assistant-actions-complete", {
      responseMode: pendingResponseMode,
      markerRemoved: pendingActionMarkerRemoved,
    });
    armResponseSettleCheck();
  }

  function markPendingResponseStopped(trigger) {
    if (!awaitingResponse || pendingResponseStopped) return;
    pendingResponseStopped = true;
    if (pendingResponseMode === "new-turn") stoppedTurnsSinceTrusted += 1;
    pendingActionCompletionSeen = true;
    pendingActionWaitStartedAt = 0;
    responseVerificationRetries = 0;
    responseVerificationStartedAt = 0;
    cancelActiveMeasurement("manual-stop");
    diagnose("response-stopped", {
      trigger,
      expectedTurns: turnsSinceTrusted,
      expectedAssistantTurns: refreshPolicy.expectedAssistantAdvance(turnsSinceTrusted, stoppedTurnsSinceTrusted),
      responseMode: pendingResponseMode,
    });
    showPendingRefresh();
    armResponseSettleCheck();
  }

  function queueResponseTriggerFallback(trigger, { possibleStop = false } = {}) {
    const submitSequenceAtClick = acceptedSubmitSequence;
    const route = currentRoute();
    global.clearTimeout(responseTriggerFallbackTimer);
    responseTriggerFallbackTimer = global.setTimeout(() => {
      responseTriggerFallbackTimer = null;
      if (route !== currentRoute() || acceptedSubmitSequence !== submitSequenceAtClick) return;
      if (possibleStop && awaitingResponse) {
        markPendingResponseStopped(trigger);
        return;
      }
      beginResponseCycle(trigger, { newTurn: true });
    }, RESPONSE_TRIGGER_FALLBACK_MS);
  }

  function acceptSubmittedPrompt() {
    cancelResponseTriggerFallback();
    acceptedSubmitSequence += 1;
    beginResponseCycle("submit", { newTurn: true });
  }

  function noteRegenerationIntent() {
    assistantActionKeys = domAdapter.getAssistantActionKeys();
    regenerationIntent = {
      baselineKey: latestAssistantActionKey(),
      expiresAt: Date.now() + REGENERATION_INTENT_MS,
    };
    diagnose("regeneration-intent", {
      actionHintSupported: Boolean(regenerationIntent.baselineKey),
    });
  }

  function composerElement(target) {
    if (!(target instanceof Element)) return null;
    return target.closest(COMPOSER_SELECTOR);
  }

  function handleRouteChange() {
    lastRoute = currentRoute();
    regenerationIntent = null;
    assistantActionKeys = domAdapter.getAssistantActionKeys();
    const continuesNewConversation = awaitingResponse
      && pendingConversationCreation
      && Boolean(apiAdapter.getConversationId());
    const continuesInputConversation = updateOnUserInput
      && pendingConversationCreation
      && Boolean(apiAdapter.getConversationId());

    cancelResponseTriggerFallback();
    advanceRefreshEpoch("route-changed");
    if (continuesInputConversation) {
      pendingConversationCreation = false;
      refreshBaseline("input-turn");
      return;
    }
    if (continuesNewConversation) {
      pendingConversationCreation = false;
      showPendingRefresh();
      armResponseSettleCheck();
      return;
    }

    trustedSummary = null;
    trustedLastAssistantId = "";
    turnsSinceTrusted = 0;
    stoppedTurnsSinceTrusted = 0;
    baselineTurnActive = false;
    recoveryFailureStreak = 0;
    updateUnverifiedResponseStreak("route-reset", { reason: "route-changed" });
    completePendingResponse("route-changed");
    if (currentPageKind() !== "conversation") {
      showInactivePage();
      return;
    }
    render("loading", t("measuring"));
    scheduleMeasurement("route-changed");
  }

  function handlePageReturn(reason) {
    if (currentRoute() !== lastRoute) {
      handleRouteChange();
      return;
    }
    const cancelledBaseline = Boolean(baselineRequest);
    cancelResponseTriggerFallback();
    advanceRefreshEpoch(reason);
    if (cancelledBaseline) {
      render("error", t("needs_verification"), "", t("return_cancelled_hint"));
      diagnose("baseline-refresh-cancelled", { reason });
    }
    // Checkpoint suppression outlives its request. A return must not add queries
    // or strand a canceled request in loading, in either refresh mode.
    if (awaitingResponse) armResponseSettleCheck();
    else if (!baselineTurnActive) scheduleMeasurement(reason);
  }

  const observer = new MutationObserver((mutations) => {
    if (currentRoute() !== lastRoute) {
      handleRouteChange();
      return;
    }
    restoreUiIfRemoved();
    // Structural changes also cover composer replacement and sidebar layout changes.
    if (mutations.some((mutation) => mutation.type === "childList")) ui.schedule();

    const relevantMutation = domAdapter.mutationsNeedMeasurement(mutations, HOST_ID);
    if (relevantMutation) {
      relevantMutationSequence += 1;
      lastRelevantMutationAt = Date.now();
    }

    handleAssistantActionMutations(mutations);

    if (awaitingResponse && relevantMutation) {
      armResponseSettleCheck();
      return;
    }

    if (!updateOnUserInput && relevantMutation && apiAdapter.getConversationId() && responseIsStreaming()) {
      beginResponseCycle("streaming-detected", { newTurn: false });
      return;
    }

  });

  renderUi();
  assistantActionKeys = domAdapter.getAssistantActionKeys();
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  document.addEventListener("submit", (event) => {
    if (event.target instanceof Element && event.target.querySelector(COMPOSER_SELECTOR)) {
      acceptSubmittedPrompt();
    }
  }, true);
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(REGENERATION_BUTTON_SELECTOR)) {
      noteRegenerationIntent();
      return;
    }
    if (event.target.closest(RESPONSE_ACTION_BUTTON_SELECTOR)) {
      // A Stop click is response activity, not the next submitted user turn.
      if ((updateOnUserInput || baselineTurnActive || unverifiedResponseStreak >= AUTOMATIC_RECOVERY_THRESHOLD)
        && event.target.closest(STOP_BUTTON_SELECTOR)) return;
      queueResponseTriggerFallback("response-action", {
        possibleStop: awaitingResponse && responseIsStreaming(),
      });
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    const composer = composerElement(event.target);
    if (!composer || event.isComposing) return;
    const defaultEnter = event.key === "Enter" && !event.shiftKey;
    if (!defaultEnter && !exportSettings.matchesSendShortcut(event, sendShortcut)) return;
    const before = "value" in composer ? composer.value : composer.textContent;
    const submitSequenceBeforeKeydown = acceptedSubmitSequence;
    const route = currentRoute();
    global.clearTimeout(enterKeyTimer);
    enterKeyTimer = global.setTimeout(() => {
      enterKeyTimer = null;
      if (route !== currentRoute() || composer.isConnected === false) return;
      const after = "value" in composer ? composer.value : composer.textContent;
      if (
        before?.trim()
        && !after?.trim()
        && acceptedSubmitSequence === submitSequenceBeforeKeydown
      ) {
        queueResponseTriggerFallback(defaultEnter ? "enter-key" : "custom-send-key");
      }
    }, 100);
  }, true);
  global.addEventListener("popstate", () => handlePageReturn("popstate"));
  global.addEventListener("pageshow", () => handlePageReturn("pageshow"));
  scheduleMeasurement("startup");
})(globalThis);
