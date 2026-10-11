(function registerChatGptApiAdapter(global) {
  "use strict";

  const namespace = (global.Chatcouter = global.Chatcouter || {});
  const { createMessage } = namespace.model;
  const CONVERSATION_ID_PATTERN = /^[a-z0-9-]+$/i;
  const VISIBLE_CONTENT_TYPES = new Set(["text", "multimodal_text", "code"]);
  const REQUEST_TIMEOUT_MS = 30000;

  function getConversationId(locationLike = location) {
    const match = locationLike.pathname.match(/(?:^|\/)c\/([a-z0-9-]+)(?:\/|$)/i);
    return match?.[1] || null;
  }

  function partText(part) {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    return "";
  }

  function messageText(message) {
    const content = message?.content;
    if (!content) return "";
    if (Array.isArray(content.parts)) {
      return content.parts.map(partText).filter(Boolean).join("\n");
    }
    if (typeof content.text === "string") return content.text;
    return "";
  }

  function completionDetails(message) {
    const metadata = message?.metadata || {};
    return Object.freeze({
      currentNodeRole: message?.author?.role || "",
      currentNodeStatus: typeof message?.status === "string" ? message.status : "",
      currentNodeEndTurn: typeof message?.end_turn === "boolean" ? message.end_turn : null,
      currentNodeRecipient: typeof message?.recipient === "string" ? message.recipient : "",
      currentNodeContentType:
        typeof message?.content?.content_type === "string" ? message.content.content_type : "",
      currentNodeFinishType:
        typeof metadata?.finish_details?.type === "string" ? metadata.finish_details.type : "",
    });
  }

  function activePath(payload) {
    const mapping = payload?.mapping;
    const currentNode = payload?.current_node;
    if (!mapping || typeof mapping !== "object" || !currentNode) return null;

    const path = [];
    const visited = new Set();
    let nodeId = currentNode;

    while (nodeId && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = mapping[nodeId];
      if (!node) return null;
      path.push(node);
      nodeId = node.parent;
    }

    if (nodeId) return null;
    return path.reverse();
  }

  function extractActiveBranch(payload) {
    const path = activePath(payload);
    if (!path) {
      return { ok: false, reason: "invalid-conversation-graph", messages: [] };
    }

    const messages = [];
    let lastVisibleAssistant = null;
    for (const node of path) {
      const message = node.message;
      const role = message?.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      const metadata = message?.metadata || {};
      const contentType = message?.content?.content_type;
      if (contentType && !VISIBLE_CONTENT_TYPES.has(contentType)) continue;
      if (message?.recipient && message.recipient !== "all") continue;
      if (
        metadata.is_visually_hidden_from_conversation ||
        metadata.is_hidden ||
        metadata.hidden ||
        metadata.is_redacted
      ) {
        continue;
      }

      messages.push(
        createMessage({
          id: message.id || node.id,
          role,
          text: messageText(message),
          ordinal: messages.length,
          createdAt: message.create_time,
        }),
      );
      if (role === "assistant") lastVisibleAssistant = message;
    }

    const currentNodeMessage = path[path.length - 1]?.message;
    const assistantDetails = completionDetails(lastVisibleAssistant);
    const currentDetails = completionDetails(currentNodeMessage);

    return {
      ok: true,
      reason: null,
      messages,
      title: typeof payload.title === "string" ? payload.title : "",
      currentNode: payload.current_node,
      completion: Object.freeze({
        lastAssistantStatus: assistantDetails.currentNodeStatus,
        lastAssistantEndTurn: assistantDetails.currentNodeEndTurn,
        lastAssistantFinishType: assistantDetails.currentNodeFinishType,
        ...currentDetails,
      }),
    };
  }

  async function extract({ locationLike = location, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const conversationId = getConversationId(locationLike);
    if (!conversationId || !CONVERSATION_ID_PATTERN.test(conversationId)) {
      return { ok: false, reason: "conversation-id-not-found", messages: [] };
    }

    const endpointPaths = [
      `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      `/backend-api/conversations/${encodeURIComponent(conversationId)}`,
    ];
    const requestController = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => requestController.abort();
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeoutId = global.setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, timeoutMs);

    async function request(path, accessToken = "") {
      const headers = { Accept: "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      return fetch(new URL(path, locationLike.origin), {
        credentials: "include",
        headers,
        signal: requestController.signal,
      });
    }

    try {
      let response = await request(endpointPaths[0]);

      if (response.ok) return extractActiveBranch(await response.json());

      if (![401, 403, 404].includes(response.status)) {
        return {
          ok: false,
          reason: `conversation-request-${response.status}`,
          messages: [],
        };
      }

      const sessionResponse = await fetch(new URL("/api/auth/session", locationLike.origin), {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: requestController.signal,
      });
      if (!sessionResponse.ok) {
        return {
          ok: false,
          reason: `session-request-${sessionResponse.status}`,
          messages: [],
        };
      }

      const session = await sessionResponse.json();
      const accessToken = session?.accessToken;
      if (typeof accessToken !== "string" || !accessToken) {
        return { ok: false, reason: "session-token-not-found", messages: [] };
      }

      for (const path of endpointPaths) {
        response = await request(path, accessToken);
        if (response.ok) return extractActiveBranch(await response.json());
        if (![401, 403, 404].includes(response.status)) break;
      }

      return {
        ok: false,
        reason: `authorized-conversation-request-${response.status}`,
        messages: [],
      };
    } catch (error) {
      if (error?.name === "AbortError" && timedOut) {
        return { ok: false, reason: "conversation-request-timeout", messages: [] };
      }
      if (error?.name === "AbortError") throw error;
      return { ok: false, reason: "conversation-request-failed", messages: [] };
    } finally {
      global.clearTimeout(timeoutId);
      signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }

  namespace.chatGptApiAdapter = Object.freeze({
    extract,
    extractActiveBranch,
    getConversationId,
    messageText,
  });
})(globalThis);
