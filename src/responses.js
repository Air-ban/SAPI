const crypto = require("node:crypto");
const { extractTextFromContent, generateId, convertTools, normalizeResponseFormat, findUsagePayload, normalizeUsage, finiteTokenCount, generateTimestamp } = require("./utils");

function appendMessage(messages, role, content) {
  const text = extractTextFromContent(content).trim();
  if (!text) return;
  messages.push({
    role: role === "developer" ? "system" : String(role || "user").trim() || "user",
    content: text
  });
}

function convertInputToMessages(input, instructions) {
  const messages = [];

  if (String(instructions || "").trim()) {
    messages.push({ role: "system", content: String(instructions).trim() });
  }

  const visit = (item) => {
    if (item === null || item === undefined) return;
    if (typeof item === "string") {
      appendMessage(messages, "user", item);
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry);
      return;
    }
    if (typeof item !== "object") {
      appendMessage(messages, "user", String(item));
      return;
    }

    const role = item.role === "developer" ? "system" : item.role || "user";
    const content =
      item.content !== undefined
        ? item.content
        : item.text !== undefined
          ? item.text
          : item.value !== undefined
            ? item.value
            : item;
    appendMessage(messages, role, content);
  };

  visit(input);
  return messages;
}

function convertResponseInputItems(messages) {
  return messages
    .map((message) => {
      const text = extractTextFromContent(message.content).trim();
      if (!text) return null;
      return {
        id: generateId("msg"),
        type: "message",
        role: message.role === "developer" ? "system" : message.role || "user",
        content: [{ type: "input_text", text }]
      };
    })
    .filter(Boolean);
}

function buildResponseFormat(body = {}) {
  return normalizeResponseFormat(body.text?.format) || normalizeResponseFormat(body.response_format);
}

function convertToChatCompletionsPayload(body = {}) {
  const messages = convertInputToMessages(body.input ?? body.messages ?? "", body.instructions);
  const stream = body.stream !== false;
  const responseFormat = buildResponseFormat(body);
  const payload = {
    model: String(body.model || "gpt-4o").trim() || "gpt-4o",
    messages,
    stream,
    tool_choice: body.tool_choice ?? "auto"
  };

  if (stream) {
    payload.stream_options = { include_usage: true };
  }

  const tools = convertTools(body.tools);
  if (tools.length > 0) payload.tools = tools;

  const maxTokens = body.max_output_tokens ?? body.max_tokens;
  if (maxTokens !== undefined && maxTokens !== null && maxTokens !== "") {
    payload.max_tokens = maxTokens;
  }

  for (const key of [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty"
  ]) {
    if (body[key] !== undefined) {
      payload[key] = body[key];
    }
  }

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  return {
    payload,
    messages,
    input: convertResponseInputItems(messages),
    responseFormat,
    stream,
    reasoningEffort: String(body.reasoning?.effort || "").trim(),
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {}
  };
}

function extractChatCompletionText(payload) {
  if (!payload || typeof payload !== "object") {
    return { text: "", finishReason: "", usage: null };
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] || {};
  const messageContent = choice.message?.content;
  const messageReasoning = choice.message?.reasoning_content || choice.message?.reasoningContent;
  const deltaContent = choice.delta?.content;
  const deltaReasoning = choice.delta?.reasoning_content || choice.delta?.reasoningContent;
  const text = extractTextFromContent(messageContent || deltaContent || choice.text || "");
  const fallbackText = extractTextFromContent(messageReasoning || deltaReasoning || "");
  const finishReason = String(choice.finish_reason || choice.finishReason || "").trim();
  const usage = findUsagePayload(payload);
  return { text: text || fallbackText, finishReason, usage };
}

function buildResponseUsage(usage, outputText = "") {
  const normalized = normalizeUsage(usage);
  const source = usage && typeof usage === "object" ? usage : {};
  const promptDetails =
    source.prompt_tokens_details ||
    source.promptTokensDetails ||
    source.input_tokens_details ||
    source.inputTokensDetails ||
    {};
  const completionDetails =
    source.completion_tokens_details ||
    source.completionTokensDetails ||
    source.output_tokens_details ||
    source.outputTokensDetails ||
    {};
  const inputTokens = finiteTokenCount(
    source.prompt_tokens,
    source.promptTokens,
    source.input_tokens,
    source.inputTokens,
    normalized?.promptTokens,
    normalized?.inputTokens
  );
  let outputTokens = finiteTokenCount(
    source.completion_tokens,
    source.completionTokens,
    source.output_tokens,
    source.outputTokens,
    normalized?.completionTokens,
    normalized?.outputTokens
  );
  if (!outputTokens && String(outputText || "").trim()) {
    outputTokens = String(outputText)
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }
  let totalTokens = finiteTokenCount(
    source.total_tokens,
    source.totalTokens,
    normalized?.totalTokens
  );
  if (!totalTokens && (inputTokens + outputTokens > 0)) {
    totalTokens = inputTokens + outputTokens;
  }

  const cachedTokens = finiteTokenCount(
    source.cached_tokens,
    source.cachedTokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens,
    normalized?.cachedTokens
  );
  const reasoningTokens = finiteTokenCount(
    source.reasoning_tokens,
    source.reasoningTokens,
    completionDetails.reasoning_tokens,
    completionDetails.reasoningTokens,
    normalized?.reasoningTokens
  );

  return {
    input_tokens: inputTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens
    },
    output_tokens: outputTokens,
    output_tokens_details: {
      reasoning_tokens: reasoningTokens
    },
    total_tokens: totalTokens
  };
}

function buildIncompleteDetails(finishReason) {
  const reason = String(finishReason || "").trim();
  if (!reason) return null;
  if (reason === "length") return { reason: "max_output_tokens" };
  if (reason === "content_filter") return { reason: "content_filter" };
  return { reason };
}

function createReasoningItem(effort) {
  return {
    id: generateId("rs"),
    type: "reasoning",
    encrypted_content: `gAAAAAB${crypto.randomBytes(100).toString("hex")}`,
    summary: [],
    effort: String(effort || "").trim() || "low"
  };
}

function createAssistantMessageItem(text) {
  return {
    id: generateId("msg"),
    type: "message",
    status: "completed",
    content: [
      {
        type: "output_text",
        annotations: [],
        logprobs: [],
        text: String(text || "")
      }
    ],
    phase: "final_answer",
    role: "assistant"
  };
}

function buildResponseObject({
  status = "completed",
  model = "gpt-4o",
  input = [],
  instructions = "",
  output = [],
  outputText = "",
  usage = null,
  reasoningEffort = "",
  toolChoice = "auto",
  tools = [],
  temperature = 1,
  topP = 0.98,
  frequencyPenalty = 0,
  presencePenalty = 0,
  maxOutputTokens = null,
  responseFormat = null,
  finishReason = "",
  metadata = {},
  previousResponseId = null,
  store = false
} = {}) {
  const createdAt = generateTimestamp();
  const responseUsage = buildResponseUsage(usage, outputText);

  return {
    id: generateId("resp"),
    object: "response",
    created_at: createdAt,
    status,
    background: false,
    completed_at: status === "completed" ? createdAt : null,
    error: null,
    frequency_penalty: Number(frequencyPenalty || 0),
    incomplete_details: buildIncompleteDetails(finishReason),
    input,
    instructions: String(instructions || ""),
    max_output_tokens: maxOutputTokens === undefined ? null : maxOutputTokens,
    max_tool_calls: null,
    model: String(model || "gpt-4o"),
    moderation: null,
    output,
    output_text: String(outputText || ""),
    parallel_tool_calls: true,
    presence_penalty: Number(presencePenalty || 0),
    previous_response_id: previousResponseId,
    prompt_cache_key: null,
    prompt_cache_retention: "24h",
    reasoning: {
      context: "current_turn",
      effort: reasoningEffort || null,
      summary: null
    },
    safety_identifier: `user-${crypto.randomBytes(8).toString("hex")}`,
    service_tier: "auto",
    store: Boolean(store),
    temperature: Number(temperature ?? 1),
    text: responseFormat ? { format: responseFormat } : {},
    tool_choice: toolChoice || "auto",
    tool_usage: {
      image_gen: null,
      web_search: { num_requests: 0 }
    },
    tools,
    top_logprobs: 0,
    top_p: Number(topP ?? 0.98),
    truncation: "disabled",
    usage: responseUsage,
    user: null,
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };
}

function createSseWriter(res) {
  let sequence = 0;
  return {
    write(type, payload) {
      sequence += 1;
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify({ type, ...payload, sequence_number: sequence })}\n\n`);
      return sequence;
    },
    nextSequence() {
      sequence += 1;
      return sequence;
    },
    current() {
      return sequence;
    }
  };
}

module.exports = {
  convertInputToMessages,
  convertResponseInputItems,
  buildResponseFormat,
  convertToChatCompletionsPayload,
  extractChatCompletionText,
  buildResponseUsage,
  buildIncompleteDetails,
  createReasoningItem,
  createAssistantMessageItem,
  buildResponseObject,
  createSseWriter
};
