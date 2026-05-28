const { sendError, getUserApiKey, filterForwardHeaders, copyUpstreamHeaders, buildUpstreamUrl, buildUpstreamBody, shouldStreamResponse, writeUpstreamStreamToResponse, relayUpstreamResponse, extractUsageFromResponseText, isModelAllowed, appendDebugLog, appendDebugBodyLog, normalizeUsage, findUsagePayload, generateId } = require("../utils");
const { findUserByKey } = require("../middleware/auth");
const { recordRequestLog } = require("../logging");
const { isUpstreamProviderError, recordProviderFailure, recordProviderSuccess, chooseProviderCandidates, chooseAnthropicProviderCandidates } = require("../providers");
const { anthropicToOpenAI, openAIToAnthropicNonStreaming, openAIToAnthropicDeltaStreaming, estimateAnthropicInputTokens, sendAnthropicError } = require("../anthropic");
const { convertToChatCompletionsPayload, extractChatCompletionText, buildResponseObject, buildResponseUsage, buildIncompleteDetails, createReasoningItem, createAssistantMessageItem, createSseWriter } = require("../responses");
const { maskKey } = require("../user-utils");

const rpmWindows = new Map();

function getRpmLimit(apiKeyRecord, db) {
  if (typeof apiKeyRecord?.rpmLimit === "number" && apiKeyRecord.rpmLimit > 0) {
    return apiKeyRecord.rpmLimit;
  }
  return typeof db?.defaultRpmLimit === "number" && db.defaultRpmLimit > 0 ? db.defaultRpmLimit : 30;
}

function checkMaintenanceMode(db, res) {
  if (db.maintenanceMode) {
    const endTime = db.maintenanceEndTime || "";
    const msg = endTime
      ? `站点维护中，预计 ${new Date(endTime).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })} 恢复。`
      : "站点维护中，请稍后重试。";
    sendError(res, 503, msg, "maintenance_mode");
    return true;
  }
  return false;
}

function checkRpmLimit(apiKeyRecord, db) {
  const limit = getRpmLimit(apiKeyRecord, db);
  const key = apiKeyRecord?.key || "";
  if (!key || limit <= 0) return { allowed: true, limit, current: 0 };

  const now = Date.now();
  const windowStart = now - 60 * 1000;

  let timestamps = rpmWindows.get(key);
  if (!timestamps) {
    timestamps = [];
    rpmWindows.set(key, timestamps);
  }

  const cutoffIndex = timestamps.findIndex((t) => t >= windowStart);
  if (cutoffIndex > 0) {
    timestamps.splice(0, cutoffIndex);
  } else if (cutoffIndex === -1) {
    timestamps.length = 0;
  }

  if (timestamps.length >= limit) {
    return { allowed: false, limit, current: timestamps.length };
  }

  timestamps.push(now);
  return { allowed: true, limit, current: timestamps.length };
}

async function handleResponsesProxy(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendError(res, 401, "SAPI API key is required.", "missing_api_key");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const responseRequest = convertToChatCompletionsPayload(req.body || {});
  const model = responseRequest.payload.model;

  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendError(res, 403, `Model "${model}" is not allowed for this API key.`, "model_not_allowed");
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendError(res, 429, `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`, "rate_limit_exceeded");
    return;
  }

  const candidates = chooseProviderCandidates(db, responseRequest.payload);
  if (candidates.length === 0) {
    sendError(res, 503, "No enabled upstream provider is configured.", "no_provider");
    return;
  }

  let selectedProvider = null;
  let selectedUpstreamModel = null;
  let upstreamResponse = null;
  let startedAt = null;
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const { provider, upstreamModel } = candidates[i];
    startedAt = Date.now();

    try {
      const upstreamUrl = buildUpstreamUrl(provider.baseUrl, "/v1/chat/completions");
      const headers = filterForwardHeaders(req.headers);
      headers.authorization = `Bearer ${provider.apiKey}`;
      headers["content-type"] = "application/json";
      headers["accept-encoding"] = "identity";
      if (req.headers.accept) headers.accept = req.headers.accept;

      appendDebugLog("responses.request", {
        url: upstreamUrl,
        method: "POST",
        bodyLength: Buffer.byteLength(JSON.stringify(responseRequest.payload), "utf8")
      });
      appendDebugBodyLog("responses", responseRequest.payload);
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(responseRequest.payload)
      });

      if (!upstreamResponse.ok) {
        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: model || "",
          upstreamModel: upstreamModel || "",
          endpoint: "/responses",
          method: "POST",
          status: upstreamResponse.status,
          ok: false,
          stream: responseRequest.stream === true,
          durationMs: Date.now() - startedAt,
          usage: null
        });
        if (isUpstreamProviderError(upstreamResponse.status)) {
          recordProviderFailure(provider.id);
          lastError = new Error(`Upstream provider responded with HTTP ${upstreamResponse.status}`);
          continue;
        } else {
          await relayUpstreamResponse(upstreamResponse, res);
          return;
        }
      }

      selectedProvider = provider;
      selectedUpstreamModel = upstreamModel;
      break;

    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }
      recordProviderFailure(provider.id);
      lastError = error;
    }
  }

  if (!selectedProvider) {
    if (lastError) {
      sendError(res, 502, `All upstream providers failed. Last error: ${lastError.message}`, "upstream_request_failed");
    } else {
      sendError(res, 502, "All upstream providers failed.", "all_providers_failed");
    }
    return;
  }

  const provider = selectedProvider;

  try {
    if (!responseRequest.stream) {
      const text = await upstreamResponse.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        sendError(res, 502, "Upstream chat completion response was not valid JSON.", "upstream_response_invalid");
        return;
      }

      const { text: outputText, finishReason, usage } = extractChatCompletionText(payload);
      const reasoningItem = responseRequest.reasoningEffort
        ? createReasoningItem(responseRequest.reasoningEffort)
        : null;
      const outputItems = reasoningItem ? [reasoningItem] : [];
      const assistantItem = createAssistantMessageItem(outputText);
      outputItems.push(assistantItem);

      res.status(200);
      res.json(
        buildResponseObject({
          status: "completed",
          model,
          input: responseRequest.input,
          instructions: String(req.body?.instructions || ""),
          output: outputItems,
          outputText,
          usage,
          reasoningEffort: responseRequest.reasoningEffort,
          toolChoice: responseRequest.payload.tool_choice,
          tools: responseRequest.payload.tools || [],
          temperature: responseRequest.payload.temperature,
          topP: responseRequest.payload.top_p,
          frequencyPenalty: responseRequest.payload.frequency_penalty,
          presencePenalty: responseRequest.payload.presence_penalty,
          maxOutputTokens: responseRequest.payload.max_tokens ?? null,
          responseFormat: responseRequest.responseFormat,
          finishReason,
          metadata: responseRequest.metadata
        })
      );
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: model || "",
        upstreamModel: selectedUpstreamModel || "",
        endpoint: "/responses",
        method: "POST",
        status: 200,
        ok: true,
        stream: false,
        durationMs: Date.now() - startedAt,
        usage
      });
      recordProviderSuccess(provider.id);
      return;
    }

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    const writer = createSseWriter(res);
    const responseId = generateId("resp");
    const messageId = generateId("msg");
    const reasoningItem = responseRequest.reasoningEffort
      ? createReasoningItem(responseRequest.reasoningEffort)
      : null;
    const outputItems = [];
    if (reasoningItem) outputItems.push(reasoningItem);
    const assistantItem = {
      id: messageId,
      type: "message",
      status: "in_progress",
      content: [],
      phase: "final_answer",
      role: "assistant"
    };
    outputItems.push(assistantItem);
    const baseResponse = buildResponseObject({
      status: "in_progress",
      model,
      input: responseRequest.input,
      instructions: String(req.body?.instructions || ""),
      output: outputItems,
      outputText: "",
      usage: null,
      reasoningEffort: responseRequest.reasoningEffort,
      toolChoice: responseRequest.payload.tool_choice,
      tools: responseRequest.payload.tools || [],
      temperature: responseRequest.payload.temperature,
      topP: responseRequest.payload.top_p,
      frequencyPenalty: responseRequest.payload.frequency_penalty,
      presencePenalty: responseRequest.payload.presence_penalty,
      maxOutputTokens: responseRequest.payload.max_tokens ?? null,
      responseFormat: responseRequest.responseFormat,
      metadata: responseRequest.metadata
    });
    baseResponse.id = responseId;
    baseResponse.status = "in_progress";
    baseResponse.completed_at = null;
    baseResponse.output = outputItems;

    writer.write("response.created", { response: baseResponse });
    writer.write("response.in_progress", { response: baseResponse });

    if (reasoningItem) {
      writer.write("response.output_item.added", {
        item: reasoningItem,
        output_index: 0
      });
      writer.write("response.output_item.done", {
        item: reasoningItem,
        output_index: 0
      });
    }

    writer.write("response.output_item.added", {
      item: assistantItem,
      output_index: reasoningItem ? 1 : 0
    });

    const contentPart = {
      type: "output_text",
      annotations: [],
      logprobs: [],
      text: ""
    };
    writer.write("response.content_part.added", {
      content_index: 0,
      item_id: messageId,
      output_index: reasoningItem ? 1 : 0,
      part: contentPart
    });

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      const finalResponse = {
        ...baseResponse,
        status: "completed",
        completed_at: Math.floor(Date.now() / 1000),
        output: [
          ...(reasoningItem ? [reasoningItem] : []),
          {
            ...assistantItem,
            status: "completed",
            content: [
              {
                type: "output_text",
                annotations: [],
                logprobs: [],
                text: ""
              }
            ]
          }
        ],
        output_text: "",
        usage: buildResponseUsage(null, "")
      };
      writer.write("response.output_text.done", {
        content_index: 0,
        item_id: messageId,
        output_index: reasoningItem ? 1 : 0,
        logprobs: [],
        text: ""
      });
      writer.write("response.content_part.done", {
        content_index: 0,
        item_id: messageId,
        output_index: reasoningItem ? 1 : 0,
        part: { ...contentPart, text: "" }
      });
      writer.write("response.output_item.done", {
        item: finalResponse.output[finalResponse.output.length - 1],
        output_index: reasoningItem ? 1 : 0
      });
      writer.write("response.completed", { response: finalResponse });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let outputText = "";
    let finishReason = "";
    let usagePayload = null;

    const processData = (data) => {
      const trimmed = String(data || "").trim();
      if (!trimmed || trimmed === "[DONE]") return;

      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        return;
      }

      const extracted = extractChatCompletionText(payload);
      if (extracted.finishReason) finishReason = extracted.finishReason;
      if (extracted.usage) usagePayload = extracted.usage;

      const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
      const delta =
        choice?.delta?.content ||
        choice?.delta?.reasoning_content ||
        choice?.delta?.reasoningContent;
      const deltaText = extractChatCompletionText({ choices: [{ delta }] }).text;
      if (!deltaText) return;

      outputText += deltaText;
      writer.write("response.output_text.delta", {
        content_index: 0,
        delta: deltaText,
        item_id: messageId,
        output_index: reasoningItem ? 1 : 0
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        let current = [];

        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };

        for (const line of lines) {
          if (line === "") {
            flush();
            continue;
          }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) {
            current.push(line.slice(5).replace(/^ /, ""));
          }
        }
        flush();
      }

      buffer += decoder.decode();
      if (buffer) {
        const lines = buffer.split(/\r?\n/);
        let current = [];
        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };
        for (const line of lines) {
          if (line === "") {
            flush();
            continue;
          }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) {
            current.push(line.slice(5).replace(/^ /, ""));
          }
        }
        flush();
      }
    } finally {
      reader.releaseLock();
    }

    const assistantDoneItem = {
      ...assistantItem,
      status: "completed",
      content: [
        {
          type: "output_text",
          annotations: [],
          logprobs: [],
          text: outputText
        }
      ]
    };

    writer.write("response.output_text.done", {
      content_index: 0,
      item_id: messageId,
      output_index: reasoningItem ? 1 : 0,
      logprobs: [],
      text: outputText
    });
    writer.write("response.content_part.done", {
      content_index: 0,
      item_id: messageId,
      output_index: reasoningItem ? 1 : 0,
      part: {
        type: "output_text",
        annotations: [],
        logprobs: [],
        text: outputText
      }
    });
    writer.write("response.output_item.done", {
      item: assistantDoneItem,
      output_index: reasoningItem ? 1 : 0
    });

    const finalResponse = {
      ...baseResponse,
      id: responseId,
      status: "completed",
      completed_at: Math.floor(Date.now() / 1000),
      output: [...(reasoningItem ? [reasoningItem] : []), assistantDoneItem],
      output_text: outputText,
      incomplete_details: buildIncompleteDetails(finishReason),
      usage: buildResponseUsage(usagePayload, outputText)
    };

    writer.write("response.completed", { response: finalResponse });
    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: selectedUpstreamModel || "",
      endpoint: "/responses",
      method: "POST",
      status: 200,
      ok: true,
      stream: true,
      durationMs: Date.now() - startedAt,
      usage: buildResponseUsage(usagePayload, outputText)
    });
    recordProviderSuccess(provider.id);
    res.end();
  } catch (error) {
    appendDebugLog("responses.error", {
      message: error.message,
      name: error.name,
      code: error.code,
      causeCode: error.cause?.code,
      causeMessage: error.cause?.message
    });
    console.error("[responses] upstream fetch failed", {
      message: error.message,
      name: error.name,
      code: error.code,
      causeCode: error.cause?.code,
      causeMessage: error.cause?.message
    });
    if (res.headersSent) {
      if (!res.destroyed) res.destroy(error);
      return;
    }
    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: selectedUpstreamModel || "",
      endpoint: "/responses",
      method: "POST",
      status: 502,
      ok: false,
      stream: responseRequest.stream === true,
      durationMs: Date.now() - startedAt,
      usage: null,
      errorCode: "upstream_request_failed",
      errorMessage: error.message
    });
    recordProviderFailure(provider.id);
    sendError(res, 502, `Upstream provider request failed: ${error.message}`, "upstream_request_failed");
  }
}

async function handleAnthropicCountTokens(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendAnthropicError(res, 401, "authentication_error", "SAPI API key is required.");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendAnthropicError(res, 401, "authentication_error", "Invalid or disabled SAPI API key.");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const model = req.body?.model || "";
  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendAnthropicError(res, 403, "permission_error", `Model "${model}" is not allowed for this API key.`);
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendAnthropicError(res, 429, "rate_limit_error", `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`);
    return;
  }

  const inputTokens = estimateAnthropicInputTokens(req.body || {});
  res.json({ input_tokens: inputTokens });
}

async function handleAnthropicMessagesProxy(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendAnthropicError(res, 401, "invalid_request_error", "SAPI API key is required.");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendAnthropicError(res, 401, "authentication_error", "Invalid or disabled SAPI API key.");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const model = req.body?.model || "";
  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendAnthropicError(res, 403, "permission_error", `Model "${model}" is not allowed for this API key.`);
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendAnthropicError(res, 429, "rate_limit_error", `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`);
    return;
  }

  const openAIBody = anthropicToOpenAI(req.body || {});
  openAIBody.model = model || openAIBody.model;
  const wantStream = openAIBody.stream === true;

  const candidates = chooseAnthropicProviderCandidates(db, model);
  if (candidates.length === 0) {
    sendAnthropicError(res, 503, "api_error", "No enabled upstream provider is configured.");
    return;
  }

  let selectedProvider = null;
  let upstreamResponse = null;
  let startedAt = null;
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const { provider, upstreamModel } = candidates[i];
    startedAt = Date.now();

    try {
      if (upstreamModel && openAIBody.model) openAIBody.model = upstreamModel;
      const upstreamUrl = buildUpstreamUrl(provider.baseUrl, "/v1/chat/completions");
      const headers = filterForwardHeaders(req.headers);
      headers.authorization = `Bearer ${provider.apiKey}`;
      headers["content-type"] = "application/json";
      headers["accept-encoding"] = "identity";

      appendDebugLog("anthropic.request", {
        url: upstreamUrl,
        method: "POST",
        bodyLength: Buffer.byteLength(JSON.stringify(openAIBody), "utf8"),
        tools: openAIBody.tools?.length || 0,
        toolChoice: openAIBody.tool_choice,
        hasThinking: openAIBody.messages?.some((m) => m.reasoning_content) || false
      });
      appendDebugBodyLog("anthropic", openAIBody);
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(openAIBody)
      });

      if (!upstreamResponse.ok) {
        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: model || "",
          upstreamModel: openAIBody.model || "",
          endpoint: "/v1/messages",
          method: "POST",
          status: upstreamResponse.status,
          ok: false,
          stream: wantStream,
          durationMs: Date.now() - startedAt,
          usage: null
        });
        if (isUpstreamProviderError(upstreamResponse.status)) {
          recordProviderFailure(provider.id);
          lastError = new Error(`Upstream provider responded with HTTP ${upstreamResponse.status}`);
          continue;
        } else {
          const text = await upstreamResponse.text();
          let errMessage = "Upstream provider error.";
          try {
            const parsed = JSON.parse(text);
            errMessage = parsed.error?.message || errMessage;
          } catch {}
          sendAnthropicError(res, upstreamResponse.status, "api_error", errMessage);
          return;
        }
      }

      selectedProvider = provider;
      break;
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }
      recordProviderFailure(provider.id);
      lastError = error;
    }
  }

  if (!selectedProvider) {
    const msg = lastError
      ? `All upstream providers failed. Last error: ${lastError.message}`
      : "All upstream providers failed.";
    sendAnthropicError(res, 502, "api_error", msg);
    return;
  }

  const provider = selectedProvider;

  try {
    if (!wantStream) {
      const text = await upstreamResponse.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {
        sendAnthropicError(res, 502, "api_error", "Upstream response was not valid JSON.");
        return;
      }

      const anthropicResp = openAIToAnthropicNonStreaming(payload, model);
      const usage = findUsagePayload(payload);
      res.status(200);
      res.setHeader("anthropic-version", "2023-06-01");
      res.json(anthropicResp);
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: model || "",
        upstreamModel: openAIBody.model || "",
        endpoint: "/v1/messages",
        method: "POST",
        status: 200,
        ok: true,
        stream: false,
        durationMs: Date.now() - startedAt,
        usage
      });
      recordProviderSuccess(provider.id);
      return;
    }

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.setHeader("anthropic-version", "2023-06-01");
    res.flushHeaders?.();

    const writeEvent = (eventType, data) => {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const responseId = generateId("msg");
    writeEvent("message_start", {
      type: "message_start",
      message: {
        id: responseId,
        type: "message",
        role: "assistant",
        content: [],
        model: model || openAIBody.model || "",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    });

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      writeEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" }
      });
      writeEvent("content_block_stop", { type: "content_block_stop", index: 0 });
      writeEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 }
      });
      writeEvent("message_stop", { type: "message_stop" });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let outputText = "";
    let finishReason = "";
    let usagePayload = null;
    let nextContentIndex = 0;
    let thinkingBlockIndex = -1;
    let textBlockIndex = -1;
    const toolIndexMap = {};
    const toolArgBuffers = {};

    const processData = (data) => {
      const trimmed = String(data || "").trim();
      if (!trimmed || trimmed === "[DONE]") return;

      let payload;
      try { payload = JSON.parse(trimmed); } catch { return; }

      const extracted = extractChatCompletionText(payload);
      if (extracted.finishReason) {
        const choice = (Array.isArray(payload.choices) ? payload.choices : [])[0] || {};
        const delta = choice.delta || {};
        const hasContentDelta =
          (delta.content !== undefined && delta.content !== null && delta.content !== "") ||
          (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) ||
          (delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== "");
        if (!hasContentDelta) {
          finishReason = extracted.finishReason;
        }
      }
      if (extracted.usage) usagePayload = extracted.usage;

      const events = openAIToAnthropicDeltaStreaming(payload);
      if (events.length > 0) {
        appendDebugLog("anthropic.stream.events", { count: events.length, types: events.map((e) => e._toolStart ? "toolStart" : e.delta?.type || "unknown") });
      }
      for (const ev of events) {
        if (ev._toolStart) {
          const upIdx = ev._upstreamIndex;
          if (toolIndexMap[upIdx] === undefined) {
            const outIdx = nextContentIndex++;
            toolIndexMap[upIdx] = outIdx;
            toolArgBuffers[upIdx] = "";
            writeEvent("content_block_start", {
              type: "content_block_start",
              index: outIdx,
              content_block: ev.content_block
            });
          }
        } else if (ev.delta?.type === "input_json_delta") {
          const upIdx = ev._upstreamIndex ?? 0;
          if (toolIndexMap[upIdx] !== undefined) {
            if (!toolArgBuffers[upIdx]) toolArgBuffers[upIdx] = "";
            toolArgBuffers[upIdx] += ev.delta.partial_json || "";
            writeEvent("content_block_delta", {
              type: "content_block_delta",
              index: toolIndexMap[upIdx],
              delta: { type: "input_json_delta", partial_json: ev.delta.partial_json }
            });
          }
        } else if (ev.delta?.type === "thinking_delta") {
          if (thinkingBlockIndex < 0) {
            thinkingBlockIndex = nextContentIndex++;
            writeEvent("content_block_start", {
              type: "content_block_start",
              index: thinkingBlockIndex,
              content_block: { type: "thinking", thinking: "" }
            });
          }
          writeEvent("content_block_delta", {
            type: "content_block_delta",
            index: thinkingBlockIndex,
            delta: { type: "thinking_delta", thinking: ev.delta.thinking }
          });
        } else if (ev.delta?.type === "text_delta") {
          if (thinkingBlockIndex >= 0) {
            writeEvent("content_block_stop", { type: "content_block_stop", index: thinkingBlockIndex });
            thinkingBlockIndex = -1;
          }
          if (textBlockIndex < 0) {
            textBlockIndex = nextContentIndex++;
            writeEvent("content_block_start", {
              type: "content_block_start",
              index: textBlockIndex,
              content_block: { type: "text", text: "" }
            });
          }
          outputText += ev.delta.text;
          writeEvent("content_block_delta", {
            type: "content_block_delta",
            index: textBlockIndex,
            delta: { type: "text_delta", text: ev.delta.text }
          });
        }
      }
    };

    let chunkCount = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          appendDebugLog("anthropic.stream.done", { chunks: chunkCount, finishReason, outputTextLength: outputText.length });
          break;
        }
        if (!value || value.length === 0) continue;
        chunkCount += 1;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        let current = [];
        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };
        for (const line of lines) {
          if (line === "") { flush(); continue; }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) current.push(line.slice(5).replace(/^ /, ""));
        }
        flush();
      }

      buffer += decoder.decode();
      if (buffer) {
        const lines = buffer.split(/\r?\n/);
        let current = [];
        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };
        for (const line of lines) {
          if (line === "") { flush(); continue; }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) current.push(line.slice(5).replace(/^ /, ""));
        }
        flush();
      }
    } finally {
      reader.releaseLock();
    }

    appendDebugLog("anthropic.stream.cleanup", {
      toolBlocks: Object.keys(toolIndexMap).length,
      textBlockOpen: textBlockIndex >= 0,
      thinkingBlockOpen: thinkingBlockIndex >= 0,
      finishReason,
      outputTextLength: outputText.length
    });

    for (const [upIdx, outIdx] of Object.entries(toolIndexMap)) {
      writeEvent("content_block_stop", { type: "content_block_stop", index: outIdx });
    }

    if (textBlockIndex >= 0) {
      writeEvent("content_block_stop", { type: "content_block_stop", index: textBlockIndex });
    } else {
      if (thinkingBlockIndex >= 0) {
        writeEvent("content_block_stop", { type: "content_block_stop", index: thinkingBlockIndex });
        thinkingBlockIndex = -1;
      }
      const textIdx = nextContentIndex++;
      writeEvent("content_block_start", {
        type: "content_block_start",
        index: textIdx,
        content_block: { type: "text", text: "" }
      });
      writeEvent("content_block_stop", { type: "content_block_stop", index: textIdx });
    }

    const stopReason = finishReason === "tool_calls" ? "tool_use"
      : finishReason === "length" ? "max_tokens"
      : "end_turn";

    if (outputText.length < 100 && stopReason === "end_turn" && !finishReason) {
      appendDebugLog("anthropic.stream.short", {
        outputTextLength: outputText.length,
        outputText: outputText.slice(0, 200),
        chunks: chunkCount,
        finishReason,
        stopReason
      });
    }

    const normalized = normalizeUsage(usagePayload);
    writeEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: normalized?.completionTokens || 0 }
    });
    writeEvent("message_stop", { type: "message_stop" });

    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: openAIBody.model || "",
      endpoint: "/v1/messages",
      method: "POST",
      status: 200,
      ok: true,
      stream: true,
      durationMs: Date.now() - startedAt,
      usage: usagePayload,
      finishReason
    });
    recordProviderSuccess(provider.id);
    res.end();
  } catch (error) {
    appendDebugLog("anthropic.error", {
      message: error.message,
      name: error.name,
      code: error.code,
      causeCode: error.cause?.code,
      causeMessage: error.cause?.message
    });
    console.error("[anthropic] upstream fetch failed", {
      message: error.message,
      name: error.name,
      code: error.code
    });
    if (res.headersSent) {
      if (!res.destroyed) res.destroy(error);
      return;
    }
    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: openAIBody.model || "",
      endpoint: "/v1/messages",
      method: "POST",
      status: 502,
      ok: false,
      stream: true,
      durationMs: Date.now() - startedAt,
      usage: null,
      errorCode: "upstream_request_failed",
      errorMessage: error.message,
      finishReason
    });
    recordProviderFailure(provider.id);
    sendAnthropicError(res, 502, "api_error", `Upstream provider request failed: ${error.message}`);
  }
}

async function proxyToProvider(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendError(res, 401, "SAPI API key is required.", "missing_api_key");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const model = req.body?.model || "";
  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendError(res, 403, `Model "${model}" is not allowed for this API key.`, "model_not_allowed");
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendError(res, 429, `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`, "rate_limit_exceeded");
    return;
  }

  const candidates = chooseProviderCandidates(db, req.body);
  if (candidates.length === 0) {
    sendError(res, 503, "No enabled upstream provider is configured.", "no_provider");
    return;
  }

  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const { provider, upstreamModel } = candidates[i];
    const startedAt = Date.now();

    try {
      const upstreamUrl = buildUpstreamUrl(provider.baseUrl, req.originalUrl);
      const headers = filterForwardHeaders(req.headers);
      headers.authorization = `Bearer ${provider.apiKey}`;
      if (req.body !== undefined && !headers["content-type"]) {
        headers["content-type"] = "application/json";
      }
      headers["accept-encoding"] = "identity";

      appendDebugLog("proxy.request", {
        url: upstreamUrl,
        method: req.method,
        bodyLength: Buffer.byteLength(buildUpstreamBody(req, upstreamModel) || "", "utf8")
      });
      const upstreamBody = buildUpstreamBody(req, upstreamModel);
      if (upstreamBody) appendDebugBodyLog("proxy", JSON.parse(upstreamBody));
      const upstreamResponse = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: upstreamBody
      });

      if (!upstreamResponse.ok) {
        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: req.body?.model || "",
          upstreamModel: upstreamModel || "",
          endpoint: req.originalUrl || "",
          method: req.method,
          status: upstreamResponse.status,
          ok: false,
          stream: req.body?.stream === true,
          durationMs: Date.now() - startedAt,
          usage: null
        });

        if (isUpstreamProviderError(upstreamResponse.status)) {
          recordProviderFailure(provider.id);
          lastError = new Error(`Upstream provider responded with HTTP ${upstreamResponse.status}`);
          continue;
        } else {
          const text = await upstreamResponse.text();
          res.status(upstreamResponse.status);
          copyUpstreamHeaders(upstreamResponse.headers, res);
          res.send(text);
          return;
        }
      }

      if (shouldStreamResponse(req, upstreamResponse)) {
        res.status(upstreamResponse.status);
        copyUpstreamHeaders(upstreamResponse.headers, res, {
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no"
        });
        res.flushHeaders?.();

        let usage = null;
        try {
          usage = await writeUpstreamStreamToResponse(upstreamResponse, res);
          res.end();
        } catch (streamError) {
          if (!res.headersSent) {
            throw streamError;
          }
          res.destroy(streamError);
          throw streamError;
        }

        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: req.body?.model || "",
          upstreamModel: upstreamModel || "",
          endpoint: req.originalUrl || "",
          method: req.method,
          status: upstreamResponse.status,
          ok: upstreamResponse.ok,
          stream: true,
          durationMs: Date.now() - startedAt,
          usage
        });
        recordProviderSuccess(provider.id);

        return;
      }

      const text = await upstreamResponse.text();
      const usage = extractUsageFromResponseText(text);

      res.status(upstreamResponse.status);
      copyUpstreamHeaders(upstreamResponse.headers, res);
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: req.body?.model || "",
        upstreamModel: upstreamModel || "",
        endpoint: req.originalUrl || "",
        method: req.method,
        status: upstreamResponse.status,
        ok: upstreamResponse.ok,
        stream: req.body?.stream === true,
        durationMs: Date.now() - startedAt,
        usage
      });
      recordProviderSuccess(provider.id);

      res.send(text);
      return;
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }

      appendDebugLog("proxy.error", {
        message: error.message,
        name: error.name,
        code: error.code,
        causeCode: error.cause?.code,
        causeMessage: error.cause?.message
      });
      console.error("[proxy] upstream fetch failed", {
        message: error.message,
        name: error.name,
        code: error.code,
        causeCode: error.cause?.code,
        causeMessage: error.cause?.message
      });
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: req.body?.model || "",
        upstreamModel: upstreamModel || "",
        endpoint: req.originalUrl || "",
        method: req.method,
        status: 502,
        ok: false,
        stream: req.body?.stream === true,
        durationMs: Date.now() - startedAt,
        usage: null,
        errorCode: "upstream_request_failed",
        errorMessage: error.message
      });
      recordProviderFailure(provider.id);
      lastError = error;
    }
  }

  if (lastError) {
    sendError(
      res,
      502,
      `All upstream providers failed. Last error: ${lastError.message}`,
      "upstream_request_failed"
    );
  } else {
    sendError(res, 502, "All upstream providers failed.", "all_providers_failed");
  }
}

function mountProxyRoutes(app) {
  app.post("/responses", handleResponsesProxy);
  app.post("/v1/messages/count_tokens", handleAnthropicCountTokens);
  app.post("/v1/messages", handleAnthropicMessagesProxy);
  app.all("/v1/*", proxyToProvider);
}

module.exports = { mountProxyRoutes };
