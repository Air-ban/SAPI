const { extractTextFromContent, generateId, sanitizeToolSchema, normalizeUsage, finiteTokenCount, findUsagePayload } = require("./utils");

function convertAnthropicMessagesToOpenAI(messages) {
  if (!Array.isArray(messages)) return [];
  const result = [];

  for (const msg of messages) {
    const role = msg.role || "user";
    const content = msg.content;

    if (role === "tool") {
      const toolContent = typeof content === "string" ? content : extractTextFromContent(content);
      result.push({
        role: "tool",
        tool_call_id: msg.tool_use_id || msg.tool_call_id || "",
        content: toolContent || ""
      });
      continue;
    }

    if (Array.isArray(content)) {
      const textParts = [];
      const reasoningParts = [];
      const toolUseBlocks = [];
      const toolResultItems = [];

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const blockType = block.type || "";

        if (blockType === "text" || blockType === "input_text") {
          if (block.text) textParts.push(block.text);
        } else if (blockType === "tool_use") {
          toolUseBlocks.push({
            id: block.id || "",
            type: "function",
            function: {
              name: block.name || "",
              arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {})
            }
          });
        } else if (blockType === "tool_result") {
          let resultText = "";
          if (typeof block.content === "string") {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter((b) => b && (b.type === "text" || b.type === "input_text"))
              .map((b) => b.text || "")
              .filter(Boolean)
              .join("\n");
          } else if (block.content && typeof block.content === "object") {
            resultText = extractTextFromContent(block.content);
          }
          toolResultItems.push({
            role: "tool",
            tool_call_id: block.tool_use_id || "",
            content: resultText || ""
          });
        } else if (blockType === "image") {
          textParts.push("[image]");
        } else if (blockType === "thinking") {
          if (block.thinking) reasoningParts.push(block.thinking);
        }
      }

      if (role === "assistant") {
        const assistantMsg = { role: "assistant" };
        const joinedText = textParts.join("\n");
        const joinedReasoning = reasoningParts.join("\n");
        if (joinedReasoning) assistantMsg.reasoning_content = joinedReasoning;
        if (toolUseBlocks.length > 0) {
          assistantMsg.tool_calls = toolUseBlocks;
          assistantMsg.content = joinedText || null;
        } else if (joinedText) {
          assistantMsg.content = joinedText;
        }
        if (assistantMsg.content !== undefined || assistantMsg.tool_calls || assistantMsg.reasoning_content) {
          result.push(assistantMsg);
        }
      } else {
        if (toolResultItems.length > 0) {
          for (const tr of toolResultItems) {
            result.push(tr);
          }
        }
        if (textParts.length > 0) {
          result.push({ role: "user", content: textParts.join("\n") });
        }
      }
    } else if (typeof content === "string") {
      result.push({ role, content });
    }
  }

  return result;
}

function convertAnthropicToolsToOpenAI(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      const name = tool.name || "";
      if (!name) return null;
      const parameters = sanitizeToolSchema(tool.input_schema);
      return {
        type: "function",
        function: {
          name,
          description: tool.description || "",
          parameters
        }
      };
    })
    .filter(Boolean);
}

function anthropicToOpenAI(body = {}) {
  const messages = [];
  if (body.system) {
    if (typeof body.system === "string") {
      messages.push({ role: "system", content: body.system });
    } else if (Array.isArray(body.system)) {
      const text = body.system
        .filter((b) => b && b.type === "text")
        .map((b) => b.text || "")
        .filter(Boolean)
        .join("\n");
      if (text) messages.push({ role: "system", content: text });
    }
  }

  const converted = convertAnthropicMessagesToOpenAI(body.messages || []);
  for (const msg of converted) {
    messages.push(msg);
  }

  const payload = {
    model: body.model || "",
    messages,
    stream: body.stream === true
  };

  if (payload.stream) {
    payload.stream_options = { include_usage: true };
  }
  if (body.max_tokens !== undefined && body.max_tokens !== null) {
    payload.max_tokens = body.max_tokens;
    payload.max_completion_tokens = body.max_tokens;
  }
  if (body.temperature !== undefined && body.temperature !== null) {
    payload.temperature = body.temperature;
  }
  if (body.top_p !== undefined && body.top_p !== null) {
    payload.top_p = body.top_p;
  }
  if (body.top_k !== undefined && body.top_k !== null) {
    payload.top_k = body.top_k;
  }

  const tools = convertAnthropicToolsToOpenAI(body.tools);
  if (tools.length > 0) {
    payload.tools = tools;
    if (body.tool_choice && typeof body.tool_choice === "object") {
      const tcType = body.tool_choice.type || "auto";
      if (tcType === "any") {
        payload.tool_choice = "required";
      } else if (tcType === "tool" && body.tool_choice.name) {
        payload.tool_choice = { type: "function", function: { name: body.tool_choice.name } };
      } else {
        payload.tool_choice = "auto";
      }
    } else {
      payload.tool_choice = "auto";
    }
  }

  if (body.stop_sequences && Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
    payload.stop = body.stop_sequences;
  }

  return payload;
}

function openAIToAnthropicNonStreaming(payload, model) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] || {};
  const messageContent = choice.message?.content || "";
  const text = extractTextFromContent(messageContent);
  const reasoningContent = choice.message?.reasoning_content || choice.message?.reasoningContent || "";
  const finishReason = String(choice.finish_reason || choice.finishReason || "end_turn").trim();
  const usage = findUsagePayload(payload);

  const content = [];
  if (reasoningContent) {
    content.push({
      type: "thinking",
      thinking: typeof reasoningContent === "string" ? reasoningContent : extractTextFromContent(reasoningContent)
    });
  }
  if (text) {
    content.push({ type: "text", text });
  }

  const toolCalls = choice.message?.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const func = tc?.function;
      if (!func?.name) continue;
      let inputObj = {};
      try {
        inputObj = typeof func.arguments === "string" ? JSON.parse(func.arguments) : (func.arguments || {});
      } catch { inputObj = {}; }
      content.push({
        type: "tool_use",
        id: tc.id || generateId("toolu"),
        name: func.name,
        input: inputObj
      });
    }
  }

  const stopReason = finishReason === "tool_calls" ? "tool_use"
    : finishReason === "length" ? "max_tokens"
    : finishReason === "content_filter" ? "end_turn"
    : "end_turn";

  return {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    model: String(model || payload.model || ""),
    stop_reason: stopReason,
    stop_sequence: null,
    usage: buildAnthropicUsage(usage)
  };
}

function buildAnthropicUsage(usage) {
  const normalized = normalizeUsage(usage);
  const source = usage && typeof usage === "object" ? usage : {};
  return {
    input_tokens: normalized?.promptTokens || finiteTokenCount(source.input_tokens, source.prompt_tokens) || 0,
    output_tokens: normalized?.completionTokens || finiteTokenCount(source.output_tokens, source.completion_tokens) || 0,
    cache_creation_input_tokens: normalized?.cacheCreationTokens || finiteTokenCount(source.cache_creation_input_tokens) || 0,
    cache_read_input_tokens: normalized?.cachedTokens || finiteTokenCount(source.cache_read_input_tokens, source.cached_tokens) || 0
  };
}

function openAIToAnthropicDeltaStreaming(payload) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] || {};
  const delta = choice.delta || {};
  const events = [];

  if (delta.reasoning_content || delta.reasoningContent) {
    const reasoningText = typeof (delta.reasoning_content || delta.reasoningContent) === "string"
      ? (delta.reasoning_content || delta.reasoningContent)
      : extractTextFromContent(delta.reasoning_content || delta.reasoningContent);
    if (reasoningText) {
      events.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: reasoningText }
      });
    }
  }

  if (delta.content) {
    const text = typeof delta.content === "string" ? delta.content : extractTextFromContent(delta.content);
    if (text) {
      events.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text }
      });
    }
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const upstreamIndex = tc.index || 0;
      if (tc.function?.name) {
        events.push({
          _toolStart: true,
          _upstreamIndex: upstreamIndex,
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: tc.id || generateId("toolu"),
            name: tc.function.name,
            input: {}
          }
        });
      }
      if (tc.function?.arguments) {
        events.push({
          _upstreamIndex: upstreamIndex,
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: tc.function.arguments
          }
        });
      }
    }
  }

  return events;
}

function estimateAnthropicInputTokens(body) {
  let text = "";

  const append = (value) => {
    if (value === null || value === undefined) return;
    text += String(value);
  };

  if (body.system) {
    if (typeof body.system === "string") {
      append(body.system);
    } else if (Array.isArray(body.system)) {
      for (const item of body.system) {
        if (item?.type === "text") append(item.text);
      }
    }
  }

  for (const msg of body.messages || []) {
    append(msg.role);
    if (typeof msg.content === "string") {
      append(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "text" || block?.type === "input_text") {
          append(block.text);
        }
      }
    }
  }

  let tokens = 0;
  for (const char of text) {
    tokens += char.charCodeAt(0) < 128 ? 0.25 : 0.6;
  }

  tokens += (body.messages?.length || 0) * 3;
  if (body.system) tokens += 3;

  return Math.max(1, Math.ceil(tokens));
}

function sendAnthropicError(res, status, errorType, message) {
  res.status(status).json({
    type: "error",
    error: {
      type: errorType,
      message
    }
  });
}

module.exports = {
  convertAnthropicMessagesToOpenAI,
  convertAnthropicToolsToOpenAI,
  anthropicToOpenAI,
  openAIToAnthropicNonStreaming,
  buildAnthropicUsage,
  openAIToAnthropicDeltaStreaming,
  estimateAnthropicInputTokens,
  sendAnthropicError
};
