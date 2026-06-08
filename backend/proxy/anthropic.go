package proxy

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"sapi/utils"
)

func anthropicMessagesToOpenAI(messages []interface{}) []map[string]interface{} {
	result := make([]map[string]interface{}, 0)

	for _, msg := range messages {
		m, ok := msg.(map[string]interface{})
		if !ok {
			continue
		}
		role, _ := m["role"].(string)
		content := m["content"]

		if role == "tool" {
			toolContent := ""
			if s, ok := content.(string); ok {
				toolContent = s
			} else {
				toolContent = utils.ExtractTextFromContent(content)
			}
			result = append(result, map[string]interface{}{
				"role":         "tool",
				"tool_call_id": firstString(m, "tool_use_id", "tool_call_id"),
				"content":      toolContent,
			})
			continue
		}

		if contentArr, ok := content.([]interface{}); ok {
			var textParts []string
			var reasoningParts []string
			var toolUseBlocks []map[string]interface{}
			var toolResultItems []map[string]interface{}

			for _, block := range contentArr {
				b, ok := block.(map[string]interface{})
				if !ok {
					continue
				}
				blockType, _ := b["type"].(string)

				switch blockType {
				case "text", "input_text":
					if t, ok := b["text"].(string); ok {
						textParts = append(textParts, t)
					}
				case "tool_use":
					inputStr := ""
					if s, ok := b["input"].(string); ok {
						inputStr = s
					} else {
						inputBytes, _ := json.Marshal(b["input"])
						inputStr = string(inputBytes)
					}
					toolUseBlocks = append(toolUseBlocks, map[string]interface{}{
						"id":   b["id"],
						"type": "function",
						"function": map[string]interface{}{
							"name":      b["name"],
							"arguments": inputStr,
						},
					})
				case "tool_result":
					resultText := extractToolResultText(b)
					toolResultItems = append(toolResultItems, map[string]interface{}{
						"role":         "tool",
						"tool_call_id": fmt.Sprintf("%v", b["tool_use_id"]),
						"content":      resultText,
					})
				case "image":
					textParts = append(textParts, "[image]")
				case "thinking":
					if t, ok := b["thinking"].(string); ok {
						reasoningParts = append(reasoningParts, t)
					}
				}
			}

			if role == "assistant" {
				assistantMsg := map[string]interface{}{"role": "assistant"}
				joinedText := strings.Join(textParts, "\n")
				joinedReasoning := strings.Join(reasoningParts, "\n")
				if joinedReasoning != "" {
					assistantMsg["reasoning_content"] = joinedReasoning
				}
				if len(toolUseBlocks) > 0 {
					assistantMsg["tool_calls"] = toolUseBlocks
					if joinedText != "" {
						assistantMsg["content"] = joinedText
					} else {
						assistantMsg["content"] = nil
					}
				} else if joinedText != "" {
					assistantMsg["content"] = joinedText
				}
				if _, hasContent := assistantMsg["content"]; hasContent || len(assistantMsg) > 1 {
					result = append(result, assistantMsg)
				}
			} else {
				for _, tr := range toolResultItems {
					result = append(result, tr)
				}
				if len(textParts) > 0 {
					result = append(result, map[string]interface{}{
						"role":    "user",
						"content": strings.Join(textParts, "\n"),
					})
				}
			}
		} else if s, ok := content.(string); ok {
			result = append(result, map[string]interface{}{
				"role":    role,
				"content": s,
			})
		}
	}

	return result
}

func extractToolResultText(block map[string]interface{}) string {
	content := block["content"]
	switch v := content.(type) {
	case string:
		return v
	case []interface{}:
		var parts []string
		for _, b := range v {
			if m, ok := b.(map[string]interface{}); ok {
				bt, _ := m["type"].(string)
				if bt == "text" || bt == "input_text" {
					if t, ok := m["text"].(string); ok {
						parts = append(parts, t)
					}
				}
			}
		}
		return strings.Join(parts, "\n")
	case map[string]interface{}:
		return utils.ExtractTextFromContent(v)
	}
	return ""
}

func convertAnthropicToolsToOpenAI(tools []interface{}) []map[string]interface{} {
	result := make([]map[string]interface{}, 0)
	for _, tool := range tools {
		t, ok := tool.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := t["name"].(string)
		if name == "" {
			continue
		}
		inputSchema, _ := t["input_schema"].(map[string]interface{})
		result = append(result, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        name,
				"description": t["description"],
				"parameters":  inputSchema,
			},
		})
	}
	return result
}

func AnthropicToOpenAI(body map[string]interface{}) map[string]interface{} {
	messages := make([]map[string]interface{}, 0)

	if system, ok := body["system"].(string); ok && system != "" {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": system,
		})
	} else if sysArr, ok := body["system"].([]interface{}); ok {
		var texts []string
		for _, b := range sysArr {
			if m, ok := b.(map[string]interface{}); ok {
				if bt, _ := m["type"].(string); bt == "text" {
					if t, ok := m["text"].(string); ok {
						texts = append(texts, t)
					}
				}
			}
		}
		if len(texts) > 0 {
			messages = append(messages, map[string]interface{}{
				"role":    "system",
				"content": strings.Join(texts, "\n"),
			})
		}
	}

	anthropicMsgs, _ := body["messages"].([]interface{})
	converted := anthropicMessagesToOpenAI(anthropicMsgs)
	messages = append(messages, converted...)

	payload := map[string]interface{}{
		"model":    body["model"],
		"messages": messages,
	}

	if stream, ok := body["stream"].(bool); ok && stream {
		payload["stream"] = true
		payload["stream_options"] = map[string]interface{}{"include_usage": true}
	}

	if mt, ok := body["max_tokens"].(float64); ok {
		payload["max_tokens"] = int(mt)
		payload["max_completion_tokens"] = int(mt)
	}
	if t, ok := body["temperature"].(float64); ok {
		payload["temperature"] = t
	}
	if tp, ok := body["top_p"].(float64); ok {
		payload["top_p"] = tp
	}
	if tk, ok := body["top_k"].(float64); ok {
		payload["top_k"] = tk
	}

	tools, _ := body["tools"].([]interface{})
	openaiTools := convertAnthropicToolsToOpenAI(tools)
	if len(openaiTools) > 0 {
		payload["tools"] = openaiTools
		if tc, ok := body["tool_choice"].(map[string]interface{}); ok {
			tcType, _ := tc["type"].(string)
			if tcType == "any" {
				payload["tool_choice"] = "required"
			} else if tcType == "tool" {
				if name, ok := tc["name"].(string); ok {
					payload["tool_choice"] = map[string]interface{}{
						"type":     "function",
						"function": map[string]interface{}{"name": name},
					}
				}
			} else {
				payload["tool_choice"] = "auto"
			}
		} else {
			payload["tool_choice"] = "auto"
		}
	}

	if stop, ok := body["stop_sequences"].([]interface{}); ok && len(stop) > 0 {
		payload["stop"] = stop
	}

	return payload
}

func OpenAIChatToAnthropic(body map[string]interface{}) map[string]interface{} {
	messages := make([]interface{}, 0)
	var systemParts []string

	if msgs, ok := body["messages"].([]interface{}); ok {
		for _, item := range msgs {
			msg, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			role, _ := msg["role"].(string)
			text := utils.ExtractTextFromContent(msg["content"])
			if role == "system" || role == "developer" {
				if text != "" {
					systemParts = append(systemParts, text)
				}
				continue
			}
			if role == "tool" {
				messages = append(messages, map[string]interface{}{
					"role": "user",
					"content": []interface{}{
						map[string]interface{}{
							"type":        "tool_result",
							"tool_use_id": firstString(msg, "tool_call_id"),
							"content":     text,
						},
					},
				})
				continue
			}
			if role != "assistant" {
				role = "user"
			}

			content := []interface{}{}
			if text != "" {
				content = append(content, map[string]interface{}{"type": "text", "text": text})
			}
			if role == "assistant" {
				if toolCalls, ok := msg["tool_calls"].([]interface{}); ok {
					for _, call := range toolCalls {
						if block := openAIToolCallToAnthropicBlock(call); block != nil {
							content = append(content, block)
						}
					}
				}
			}
			if len(content) > 0 {
				messages = append(messages, map[string]interface{}{"role": role, "content": content})
			}
		}
	}

	payload := map[string]interface{}{
		"model":      body["model"],
		"messages":   messages,
		"max_tokens": 1024,
	}
	if len(systemParts) > 0 {
		payload["system"] = strings.Join(systemParts, "\n")
	}
	if stream, ok := body["stream"].(bool); ok {
		payload["stream"] = stream
	}
	if mt, ok := body["max_tokens"]; ok {
		payload["max_tokens"] = mt
	} else if mt, ok := body["max_completion_tokens"]; ok {
		payload["max_tokens"] = mt
	} else if mt, ok := body["max_output_tokens"]; ok {
		payload["max_tokens"] = mt
	}
	for _, key := range []string{"temperature", "top_p", "top_k"} {
		if v, ok := body[key]; ok {
			payload[key] = v
		}
	}
	if stop, ok := body["stop"]; ok {
		payload["stop_sequences"] = stop
	}
	if tools, ok := body["tools"].([]interface{}); ok {
		if converted := convertOpenAIToolsToAnthropic(tools); len(converted) > 0 {
			payload["tools"] = converted
		}
	}
	return payload
}

func openAIToolCallToAnthropicBlock(call interface{}) map[string]interface{} {
	tc, ok := call.(map[string]interface{})
	if !ok {
		return nil
	}
	fn, _ := tc["function"].(map[string]interface{})
	name := firstString(fn, "name")
	if name == "" {
		return nil
	}
	var input interface{} = map[string]interface{}{}
	if args, ok := fn["arguments"].(string); ok && strings.TrimSpace(args) != "" {
		if json.Unmarshal([]byte(args), &input) != nil {
			input = map[string]interface{}{}
		}
	}
	return map[string]interface{}{
		"type":  "tool_use",
		"id":    firstString(tc, "id"),
		"name":  name,
		"input": input,
	}
}

func convertOpenAIToolsToAnthropic(tools []interface{}) []map[string]interface{} {
	result := make([]map[string]interface{}, 0)
	for _, tool := range tools {
		t, ok := tool.(map[string]interface{})
		if !ok {
			continue
		}
		fn, _ := t["function"].(map[string]interface{})
		if fn == nil {
			continue
		}
		name := firstString(fn, "name")
		if name == "" {
			continue
		}
		result = append(result, map[string]interface{}{
			"name":         name,
			"description":  fn["description"],
			"input_schema": fn["parameters"],
		})
	}
	return result
}

func OpenAIToAnthropicNonStreaming(payload map[string]interface{}, model string) map[string]interface{} {
	choices, _ := payload["choices"].([]interface{})
	var choice map[string]interface{}
	if len(choices) > 0 {
		choice, _ = choices[0].(map[string]interface{})
	}
	if choice == nil {
		choice = map[string]interface{}{}
	}

	message, _ := choice["message"].(map[string]interface{})
	if message == nil {
		message = map[string]interface{}{}
	}

	messageContent, _ := message["content"].(string)
	text := utils.ExtractTextFromContent(messageContent)
	if text == "" && messageContent != "" {
		text = messageContent
	}

	reasoningContent := firstString(message, "reasoning_content", "reasoningContent")
	finishReason := firstString(choice, "finish_reason", "finishReason")
	if finishReason == "" {
		finishReason = "end_turn"
	}

	usage := utils.FindUsagePayload(payload)

	content := make([]interface{}, 0)
	if reasoningContent != "" {
		content = append(content, map[string]interface{}{
			"type":     "thinking",
			"thinking": reasoningContent,
		})
	}
	if text != "" {
		content = append(content, map[string]interface{}{
			"type": "text",
			"text": text,
		})
	}

	if toolCalls, ok := message["tool_calls"].([]interface{}); ok {
		for _, tc := range toolCalls {
			tcMap, ok := tc.(map[string]interface{})
			if !ok {
				continue
			}
			fn, ok := tcMap["function"].(map[string]interface{})
			if !ok || fn["name"] == nil {
				continue
			}
			name, _ := fn["name"].(string)
			if name == "" {
				continue
			}
			var inputObj interface{}
			if argStr, ok := fn["arguments"].(string); ok {
				json.Unmarshal([]byte(argStr), &inputObj)
			} else {
				inputObj = fn["arguments"]
			}
			if inputObj == nil {
				inputObj = map[string]interface{}{}
			}
			content = append(content, map[string]interface{}{
				"type":  "tool_use",
				"id":    firstString(tcMap, "id"),
				"name":  name,
				"input": inputObj,
			})
		}
	}

	stopReason := "end_turn"
	if finishReason == "tool_calls" {
		stopReason = "tool_use"
	} else if finishReason == "length" {
		stopReason = "max_tokens"
	} else if finishReason == "content_filter" {
		stopReason = "end_turn"
	}

	if len(content) == 0 {
		content = append(content, map[string]interface{}{"type": "text", "text": ""})
	}

	return map[string]interface{}{
		"id":            utils.GenerateID("msg"),
		"type":          "message",
		"role":          "assistant",
		"content":       content,
		"model":         model,
		"stop_reason":   stopReason,
		"stop_sequence": nil,
		"usage":         buildAnthropicUsage(usage),
	}
}

func AnthropicToOpenAIChat(payload map[string]interface{}, model string) map[string]interface{} {
	text := ""
	if content, ok := payload["content"].([]interface{}); ok {
		var parts []string
		for _, item := range content {
			block, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if blockType, _ := block["type"].(string); blockType == "text" {
				if t, ok := block["text"].(string); ok {
					parts = append(parts, t)
				}
			}
		}
		text = strings.Join(parts, "")
	}
	stopReason := firstString(payload, "stop_reason")
	return map[string]interface{}{
		"id":      firstString(payload, "id"),
		"object":  "chat.completion",
		"created": utils.GenerateTimestamp(),
		"model":   model,
		"choices": []interface{}{
			map[string]interface{}{
				"index": 0,
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": text,
				},
				"finish_reason": anthropicStopReasonToOpenAI(stopReason),
			},
		},
		"usage": anthropicUsageToOpenAI(payload["usage"]),
	}
}

func anthropicUsageToOpenAI(usage interface{}) interface{} {
	normalized := utils.NormalizeUsage(usage)
	if normalized == nil {
		return nil
	}
	result := map[string]interface{}{
		"prompt_tokens":     normalized.PromptTokens,
		"completion_tokens": normalized.CompletionTokens,
		"total_tokens":      normalized.TotalTokens,
	}
	if normalized.CachedTokens > 0 || normalized.CacheCreationTokens > 0 {
		result["prompt_tokens_details"] = map[string]interface{}{
			"cached_tokens": normalized.CachedTokens,
		}
		result["cache_read_input_tokens"] = normalized.CachedTokens
		result["cache_creation_input_tokens"] = normalized.CacheCreationTokens
	}
	if normalized.ReasoningTokens > 0 {
		result["completion_tokens_details"] = map[string]interface{}{
			"reasoning_tokens": normalized.ReasoningTokens,
		}
	}
	return result
}

func anthropicStopReasonToOpenAI(reason string) string {
	switch reason {
	case "", "end_turn", "stop_sequence":
		return "stop"
	case "max_tokens":
		return "length"
	case "tool_use":
		return "tool_calls"
	default:
		return reason
	}
}

func AnthropicStreamLineToOpenAI(line string, model string) string {
	item := strings.TrimSpace(line)
	if strings.HasPrefix(item, "data:") {
		item = strings.TrimSpace(item[5:])
	}
	if item == "" || item == "[DONE]" || !strings.HasPrefix(item, "{") {
		return ""
	}

	var payload map[string]interface{}
	if json.Unmarshal([]byte(item), &payload) != nil {
		return ""
	}

	eventType, _ := payload["type"].(string)
	deltaText := ""
	finishReason := ""
	switch eventType {
	case "content_block_delta":
		if delta, ok := payload["delta"].(map[string]interface{}); ok {
			if t, ok := delta["text"].(string); ok {
				deltaText = t
			} else if t, ok := delta["thinking"].(string); ok {
				deltaText = t
			}
		}
	case "message_delta":
		if delta, ok := payload["delta"].(map[string]interface{}); ok {
			finishReason = anthropicStopReasonToOpenAI(firstString(delta, "stop_reason"))
		}
	default:
		return ""
	}

	chunk := map[string]interface{}{
		"id":      utils.GenerateID("chatcmpl"),
		"object":  "chat.completion.chunk",
		"created": utils.GenerateTimestamp(),
		"model":   model,
		"choices": []interface{}{
			map[string]interface{}{
				"index": 0,
				"delta": map[string]interface{}{
					"content": deltaText,
				},
				"finish_reason": nullableString(finishReason),
			},
		},
	}
	if usage := anthropicUsageToOpenAI(payload["usage"]); usage != nil {
		chunk["usage"] = usage
	}
	out, _ := json.Marshal(chunk)
	return fmt.Sprintf("data: %s\n\n", string(out))
}

func buildAnthropicUsage(usage interface{}) map[string]interface{} {
	normalized := utils.NormalizeUsage(usage)
	result := map[string]interface{}{
		"input_tokens":                0,
		"output_tokens":               0,
		"cache_creation_input_tokens": 0,
		"cache_read_input_tokens":     0,
	}
	if normalized != nil {
		result["input_tokens"] = normalized.PromptTokens
		result["output_tokens"] = normalized.CompletionTokens
		result["cache_creation_input_tokens"] = normalized.CacheCreationTokens
		result["cache_read_input_tokens"] = normalized.CachedTokens
	}
	if u, ok := usage.(map[string]interface{}); ok {
		if v := utils.FiniteTokenCount(u["input_tokens"], u["prompt_tokens"]); v > 0 {
			result["input_tokens"] = v
		}
		if v := utils.FiniteTokenCount(u["output_tokens"], u["completion_tokens"]); v > 0 {
			result["output_tokens"] = v
		}
	}
	return result
}

func OpenAIToAnthropicDeltaStreaming(payload map[string]interface{}) []map[string]interface{} {
	choices, _ := payload["choices"].([]interface{})
	var choice map[string]interface{}
	if len(choices) > 0 {
		choice, _ = choices[0].(map[string]interface{})
	}
	if choice == nil {
		return nil
	}

	delta, _ := choice["delta"].(map[string]interface{})
	if delta == nil {
		return nil
	}

	var events []map[string]interface{}

	reasoningText := firstString(delta, "reasoning_content", "reasoningContent")
	if reasoningText != "" {
		events = append(events, map[string]interface{}{
			"type":  "content_block_delta",
			"index": 0,
			"delta": map[string]interface{}{
				"type":     "thinking_delta",
				"thinking": reasoningText,
			},
		})
	}

	if content, ok := delta["content"].(string); ok && content != "" {
		events = append(events, map[string]interface{}{
			"type":  "content_block_delta",
			"index": 0,
			"delta": map[string]interface{}{
				"type": "text_delta",
				"text": content,
			},
		})
	}

	if toolCalls, ok := delta["tool_calls"].([]interface{}); ok {
		for _, tc := range toolCalls {
			tcMap, ok := tc.(map[string]interface{})
			if !ok {
				continue
			}
			upstreamIndex := 0
			if idx, ok := tcMap["index"].(float64); ok {
				upstreamIndex = int(idx)
			}

			if fn, ok := tcMap["function"].(map[string]interface{}); ok {
				if name, ok := fn["name"].(string); ok && name != "" {
					events = append(events, map[string]interface{}{
						"_toolStart":     true,
						"_upstreamIndex": upstreamIndex,
						"type":           "content_block_start",
						"index":          0,
						"content_block": map[string]interface{}{
							"type":  "tool_use",
							"id":    firstString(tcMap, "id"),
							"name":  name,
							"input": map[string]interface{}{},
						},
					})
				}
				if args, ok := fn["arguments"].(string); ok && args != "" {
					events = append(events, map[string]interface{}{
						"_upstreamIndex": upstreamIndex,
						"type":           "content_block_delta",
						"index":          0,
						"delta": map[string]interface{}{
							"type":         "input_json_delta",
							"partial_json": args,
						},
					})
				}
			}
		}
	}

	return events
}

func EstimateAnthropicInputTokens(body map[string]interface{}) int {
	var textParts []string

	if system, ok := body["system"].(string); ok {
		textParts = append(textParts, system)
	} else if sysArr, ok := body["system"].([]interface{}); ok {
		for _, b := range sysArr {
			if m, ok := b.(map[string]interface{}); ok {
				if bt, _ := m["type"].(string); bt == "text" {
					if t, ok := m["text"].(string); ok {
						textParts = append(textParts, t)
					}
				}
			}
		}
	}

	if msgs, ok := body["messages"].([]interface{}); ok {
		for _, msg := range msgs {
			if m, ok := msg.(map[string]interface{}); ok {
				if role, ok := m["role"].(string); ok {
					textParts = append(textParts, role)
				}
				switch c := m["content"].(type) {
				case string:
					textParts = append(textParts, c)
				case []interface{}:
					for _, block := range c {
						if b, ok := block.(map[string]interface{}); ok {
							bt, _ := b["type"].(string)
							if bt == "text" || bt == "input_text" {
								if t, ok := b["text"].(string); ok {
									textParts = append(textParts, t)
								}
							}
						}
					}
				}
			}
		}
	}

	fullText := strings.Join(textParts, "")
	tokens := 0.0
	for _, ch := range fullText {
		if ch < 128 {
			tokens += 0.25
		} else {
			tokens += 0.6
		}
	}

	msgCount := 0
	if msgs, ok := body["messages"].([]interface{}); ok {
		msgCount = len(msgs)
	}
	tokens += float64(msgCount) * 3
	if _, ok := body["system"]; ok {
		tokens += 3
	}
	if tokens < 1 {
		return 1
	}
	return int(tokens + 0.99)
}

func SendAnthropicError(w http.ResponseWriter, status int, errorType, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"type": "error",
		"error": map[string]interface{}{
			"type":    errorType,
			"message": message,
		},
	})
}

func firstString(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if s, ok := m[key].(string); ok && s != "" {
			return s
		}
	}
	return ""
}
