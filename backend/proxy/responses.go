package proxy

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"sapi/utils"
)

func convertInputToMessages(input interface{}, instructions string) []map[string]interface{} {
	messages := make([]map[string]interface{}, 0)

	if strings.TrimSpace(instructions) != "" {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": strings.TrimSpace(instructions),
		})
	}

	var visit func(item interface{})
	visit = func(item interface{}) {
		if item == nil {
			return
		}
		switch v := item.(type) {
		case string:
			appendMessage(&messages, "user", v)
		case []interface{}:
			for _, entry := range v {
				visit(entry)
			}
		case map[string]interface{}:
			if appendResponsesToolMessage(&messages, v) {
				return
			}

			role, _ := v["role"].(string)
			if role == "developer" {
				role = "system"
			}
			if role == "" {
				role = "user"
			}
			content := v["content"]
			if content == nil {
				content = v["text"]
			}
			if content == nil {
				content = v["value"]
			}
			if content == nil {
				content = v
			}
			appendMessage(&messages, role, content)
		default:
			appendMessage(&messages, "user", fmt.Sprintf("%v", v))
		}
	}

	visit(input)
	return messages
}

func appendMessage(messages *[]map[string]interface{}, role string, content interface{}) {
	chatContent, ok := responsesContentToChatContent(content)
	if !ok {
		return
	}
	if role == "developer" {
		role = "system"
	}
	if role == "" {
		role = "user"
	}
	*messages = append(*messages, map[string]interface{}{
		"role":    role,
		"content": chatContent,
	})
}

func responsesContentToChatContent(content interface{}) (interface{}, bool) {
	switch v := content.(type) {
	case nil:
		return nil, false
	case string:
		text := strings.TrimSpace(v)
		if text == "" {
			return nil, false
		}
		return text, true
	case []interface{}:
		return responsesContentPartsToChatContent(v)
	case map[string]interface{}:
		if part, text, kind, ok := responsesContentPartToChatPart(v); ok {
			if kind == "image" || kind == "audio" {
				return []interface{}{part}, true
			}
			return text, true
		}
		text := strings.TrimSpace(utils.ExtractTextFromContent(v))
		if text == "" {
			return nil, false
		}
		return text, true
	default:
		text := strings.TrimSpace(utils.ExtractTextFromContent(v))
		if text == "" {
			return nil, false
		}
		return text, true
	}
}

func responsesContentPartsToChatContent(items []interface{}) (interface{}, bool) {
	parts := make([]interface{}, 0, len(items))
	textParts := make([]string, 0, len(items))
	hasMedia := false

	for _, item := range items {
		part, text, kind, ok := responsesContentPartToChatPart(item)
		if !ok {
			continue
		}
		switch kind {
		case "image", "audio":
			hasMedia = true
			parts = append(parts, part)
		case "text":
			textParts = append(textParts, text)
			parts = append(parts, map[string]interface{}{
				"type": "text",
				"text": text,
			})
		}
	}

	if len(parts) == 0 {
		return nil, false
	}
	if !hasMedia {
		text := strings.TrimSpace(strings.Join(textParts, "\n"))
		if text == "" {
			return nil, false
		}
		return text, true
	}
	return parts, true
}

func responsesContentPartToChatPart(item interface{}) (map[string]interface{}, string, string, bool) {
	switch v := item.(type) {
	case nil:
		return nil, "", "", false
	case string:
		text := strings.TrimSpace(v)
		if text == "" {
			return nil, "", "", false
		}
		return nil, text, "text", true
	case map[string]interface{}:
		itemType := strings.ToLower(firstStringFromBody(v, "type"))
		switch itemType {
		case "input_text", "output_text", "text":
			text := strings.TrimSpace(utils.ExtractTextFromContent(v["text"]))
			if text == "" {
				text = strings.TrimSpace(utils.ExtractTextFromContent(v["content"]))
			}
			if text == "" {
				return nil, "", "", false
			}
			return nil, text, "text", true
		case "input_image", "image", "image_url":
			imageURL := extractResponsesImageURL(v)
			if imageURL == "" {
				return nil, "", "", false
			}
			return map[string]interface{}{
				"type": "image_url",
				"image_url": map[string]interface{}{
					"url": imageURL,
				},
			}, "", "image", true
		case "input_audio", "audio":
			audio := extractResponsesAudio(v)
			if audio == nil {
				return nil, "", "", false
			}
			return map[string]interface{}{
				"type":        "input_audio",
				"input_audio": audio,
			}, "", "audio", true
		case "input_file", "file":
			text := responsesFileText(v)
			if text == "" {
				return nil, "", "", false
			}
			return nil, text, "text", true
		}

		if v["content"] != nil {
			if content, ok := responsesContentToChatContent(v["content"]); ok {
				if text, ok := content.(string); ok {
					return nil, text, "text", true
				}
			}
		}
		if v["text"] != nil || v["value"] != nil || v["parts"] != nil {
			text := strings.TrimSpace(utils.ExtractTextFromContent(v))
			if text != "" {
				return nil, text, "text", true
			}
		}
		return nil, "", "", false
	default:
		text := strings.TrimSpace(utils.ExtractTextFromContent(v))
		if text == "" {
			return nil, "", "", false
		}
		return nil, text, "text", true
	}
}

func extractResponsesImageURL(item map[string]interface{}) string {
	if url := firstStringFromBody(item, "url", "image", "file_url"); url != "" {
		return url
	}
	for _, key := range []string{"image_url", "file_url"} {
		switch v := item[key].(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		case map[string]interface{}:
			if url := firstStringFromBody(v, "url"); url != "" {
				return url
			}
		}
	}
	return ""
}

func extractResponsesAudio(item map[string]interface{}) map[string]interface{} {
	if audio, _ := item["input_audio"].(map[string]interface{}); audio != nil {
		data := firstStringFromBody(audio, "data")
		format := firstStringFromBody(audio, "format")
		if data == "" {
			data = firstStringFromBody(audio, "url")
		}
		if data == "" {
			return nil
		}
		result := map[string]interface{}{"data": data}
		if format != "" {
			result["format"] = format
		}
		return result
	}

	data := firstStringFromBody(item, "data", "audio", "url")
	if data == "" {
		return nil
	}
	result := map[string]interface{}{"data": data}
	if format := firstStringFromBody(item, "format"); format != "" {
		result["format"] = format
	}
	return result
}

func responsesFileText(item map[string]interface{}) string {
	filename := firstStringFromBody(item, "filename", "name")
	text := strings.TrimSpace(utils.ExtractTextFromContent(item["text"]))
	if text == "" {
		text = strings.TrimSpace(utils.ExtractTextFromContent(item["content"]))
	}
	if text == "" {
		text = strings.TrimSpace(utils.ExtractTextFromContent(item["value"]))
	}
	if text == "" {
		if filename == "" {
			return ""
		}
		return fmt.Sprintf("[Uploaded file: %s]", filename)
	}
	if filename == "" {
		return text
	}
	return fmt.Sprintf("[Uploaded file: %s]\n%s", filename, text)
}

func appendResponsesToolMessage(messages *[]map[string]interface{}, item map[string]interface{}) bool {
	itemType := firstStringFromBody(item, "type")
	switch itemType {
	case "function_call":
		name := firstStringFromBody(item, "name")
		callID := firstStringFromBody(item, "call_id", "id")
		if name == "" || callID == "" {
			return false
		}
		*messages = append(*messages, map[string]interface{}{
			"role":    "assistant",
			"content": nil,
			"tool_calls": []interface{}{
				map[string]interface{}{
					"id":   callID,
					"type": "function",
					"function": map[string]interface{}{
						"name":      name,
						"arguments": firstStringFromBody(item, "arguments"),
					},
				},
			},
		})
		return true
	case "function_call_output":
		callID := firstStringFromBody(item, "call_id", "id")
		if callID == "" {
			return false
		}
		*messages = append(*messages, map[string]interface{}{
			"role":         "tool",
			"tool_call_id": callID,
			"content":      utils.ExtractTextFromContent(item["output"]),
		})
		return true
	case "custom_tool_call":
		name := firstStringFromBody(item, "name")
		callID := firstStringFromBody(item, "call_id", "id")
		if name == "" || callID == "" {
			return false
		}
		input := utils.ExtractTextFromContent(item["input"])
		args, _ := json.Marshal(map[string]string{"input": input})
		*messages = append(*messages, map[string]interface{}{
			"role":    "assistant",
			"content": nil,
			"tool_calls": []interface{}{
				map[string]interface{}{
					"id":   callID,
					"type": "function",
					"function": map[string]interface{}{
						"name":      name,
						"arguments": string(args),
					},
				},
			},
		})
		return true
	case "custom_tool_call_output":
		callID := firstStringFromBody(item, "call_id", "id")
		if callID == "" {
			return false
		}
		*messages = append(*messages, map[string]interface{}{
			"role":         "tool",
			"tool_call_id": callID,
			"content":      utils.ExtractTextFromContent(item["output"]),
		})
		return true
	}
	return false
}

func ConvertToChatCompletionsPayload(body map[string]interface{}) map[string]interface{} {
	input := body["input"]
	if input == nil {
		input = body["messages"]
	}
	instructions, _ := body["instructions"].(string)

	messages := convertInputToMessages(input, instructions)

	stream := true
	if s, ok := body["stream"].(bool); ok {
		stream = s
	}

	payload := map[string]interface{}{
		"model":    firstStringFromBody(body, "model"),
		"messages": messages,
		"stream":   stream,
	}
	if stream {
		payload["stream_options"] = map[string]interface{}{"include_usage": true}
	}

	if tools, ok := body["tools"].([]interface{}); ok && len(tools) > 0 {
		chatTools := ConvertResponsesToolsToChatTools(tools)
		if len(chatTools) > 0 {
			payload["tools"] = chatTools
			payload["tool_choice"] = "auto"
			if tc, ok := body["tool_choice"].(string); ok {
				payload["tool_choice"] = tc
			} else if tc, ok := body["tool_choice"].(map[string]interface{}); ok {
				if choice, ok := ConvertResponsesToolChoiceToChat(tc, chatTools); ok {
					payload["tool_choice"] = choice
				}
			}
		}
	}

	mt := body["max_output_tokens"]
	if mt == nil {
		mt = body["max_tokens"]
	}
	if mt != nil {
		payload["max_tokens"] = mt
	}

	if responseFormat, ok := ConvertResponsesTextFormatToChatResponseFormat(body["text"]); ok {
		payload["response_format"] = responseFormat
	} else if responseFormat, ok := body["response_format"].(map[string]interface{}); ok {
		payload["response_format"] = responseFormat
	}

	for _, key := range []string{"temperature", "top_p", "frequency_penalty", "presence_penalty"} {
		if v, ok := body[key]; ok {
			payload[key] = v
		}
	}

	return payload
}

func ConvertResponsesTextFormatToChatResponseFormat(textConfig interface{}) (map[string]interface{}, bool) {
	cfg, ok := textConfig.(map[string]interface{})
	if !ok || cfg == nil {
		return nil, false
	}
	format, _ := cfg["format"].(map[string]interface{})
	if format == nil {
		return nil, false
	}

	formatType := firstStringFromBody(format, "type")
	switch formatType {
	case "json_object":
		return map[string]interface{}{"type": "json_object"}, true
	case "json_schema":
		name := firstStringFromBody(format, "name")
		if name == "" {
			name = "response"
		}
		jsonSchema := map[string]interface{}{
			"name":   name,
			"schema": format["schema"],
		}
		if description := firstStringFromBody(format, "description"); description != "" {
			jsonSchema["description"] = description
		}
		if strict, ok := format["strict"].(bool); ok {
			jsonSchema["strict"] = strict
		}
		return map[string]interface{}{
			"type":        "json_schema",
			"json_schema": jsonSchema,
		}, true
	default:
		return nil, false
	}
}

func ExtractChatCompletionText(payload map[string]interface{}) (text string, finishReason string, usage interface{}) {
	usage = utils.FindUsagePayload(payload)
	choices, _ := payload["choices"].([]interface{})
	var choice map[string]interface{}
	if len(choices) > 0 {
		choice, _ = choices[0].(map[string]interface{})
	}
	if choice == nil {
		return "", "", usage
	}

	message, _ := choice["message"].(map[string]interface{})
	delta, _ := choice["delta"].(map[string]interface{})

	var rawText interface{}
	if message != nil {
		rawText = message["content"]
		if rawText == nil {
			rawText = message["reasoning_content"]
		}
		if rawText == nil {
			rawText = message["reasoningContent"]
		}
	}
	if rawText == nil && delta != nil {
		rawText = delta["content"]
		if rawText == nil {
			rawText = delta["reasoning_content"]
		}
		if rawText == nil {
			rawText = delta["reasoningContent"]
		}
	}

	text = utils.ExtractTextFromContent(rawText)
	if text == "" {
		if s, ok := rawText.(string); ok {
			text = s
		}
	}

	finishReason = firstStringFromBody(choice, "finish_reason", "finishReason")

	return
}

func ConvertResponsesToolsToChatTools(tools []interface{}) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(tools))
	for _, tool := range tools {
		t, ok := tool.(map[string]interface{})
		if !ok {
			continue
		}

		toolType, _ := t["type"].(string)
		switch toolType {
		case "function":
			if converted, ok := convertResponsesFunctionTool(t); ok {
				result = append(result, converted)
			}
		case "custom":
			if converted, ok := convertResponsesCustomTool(t); ok {
				result = append(result, converted)
			}
		}
	}
	return result
}

func convertResponsesFunctionTool(tool map[string]interface{}) (map[string]interface{}, bool) {
	if fn, ok := tool["function"].(map[string]interface{}); ok {
		name := firstStringFromBody(fn, "name")
		if name == "" {
			return nil, false
		}
		return map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        name,
				"description": fn["description"],
				"parameters":  fn["parameters"],
			},
		}, true
	}

	name := firstStringFromBody(tool, "name")
	if name == "" {
		return nil, false
	}
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        name,
			"description": tool["description"],
			"parameters":  tool["parameters"],
		},
	}, true
}

func convertResponsesCustomTool(tool map[string]interface{}) (map[string]interface{}, bool) {
	name := firstStringFromBody(tool, "name")
	if name == "" {
		return nil, false
	}
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        name,
			"description": tool["description"],
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"input": map[string]interface{}{
						"type":        "string",
						"description": "Raw input for the custom tool.",
					},
				},
				"required":             []string{"input"},
				"additionalProperties": false,
			},
		},
	}, true
}

func ConvertResponsesToolChoiceToChat(choice map[string]interface{}, tools []map[string]interface{}) (interface{}, bool) {
	choiceType := firstStringFromBody(choice, "type")
	name := firstStringFromBody(choice, "name")

	if choiceType == "auto" || choiceType == "required" || choiceType == "none" {
		return choiceType, true
	}
	if name == "" {
		return nil, false
	}

	for _, tool := range tools {
		switch choiceType {
		case "function":
			if fn, ok := tool["function"].(map[string]interface{}); ok && fn["name"] == name {
				return map[string]interface{}{
					"type":     "function",
					"function": map[string]interface{}{"name": name},
				}, true
			}
		case "custom":
			if fn, ok := tool["function"].(map[string]interface{}); ok && fn["name"] == name {
				return map[string]interface{}{
					"type":     "function",
					"function": map[string]interface{}{"name": name},
				}, true
			}
		}
	}
	return nil, false
}

func ExtractChatCompletionFunctionCallItems(payload map[string]interface{}) []interface{} {
	return ExtractChatCompletionToolCallItems(payload, nil)
}

func ExtractChatCompletionToolCallItems(payload map[string]interface{}, customToolNames map[string]bool) []interface{} {
	choices, _ := payload["choices"].([]interface{})
	if len(choices) == 0 {
		return nil
	}

	choice, _ := choices[0].(map[string]interface{})
	if choice == nil {
		return nil
	}

	message, _ := choice["message"].(map[string]interface{})
	if message == nil {
		message, _ = choice["delta"].(map[string]interface{})
	}
	if message == nil {
		return nil
	}

	toolCalls, _ := message["tool_calls"].([]interface{})
	if len(toolCalls) == 0 {
		return nil
	}

	items := make([]interface{}, 0, len(toolCalls))
	for _, toolCall := range toolCalls {
		tc, ok := toolCall.(map[string]interface{})
		if !ok {
			continue
		}

		switch firstStringFromBody(tc, "type") {
		case "function":
			fn, _ := tc["function"].(map[string]interface{})
			name := firstStringFromBody(fn, "name")
			if name == "" {
				continue
			}
			callID := firstStringFromBody(tc, "id")
			if customToolNames[name] {
				items = append(items, buildResponsesCustomToolCall(callID, name, firstStringFromBody(fn, "arguments")))
				continue
			}
			items = append(items, map[string]interface{}{
				"type":      "function_call",
				"id":        callID,
				"call_id":   callID,
				"name":      name,
				"arguments": firstStringFromBody(fn, "arguments"),
				"status":    "completed",
			})
		case "custom":
			custom, _ := tc["custom"].(map[string]interface{})
			name := firstStringFromBody(custom, "name")
			if name == "" {
				continue
			}
			items = append(items, buildResponsesCustomToolCall(firstStringFromBody(tc, "id"), name, firstStringFromBody(custom, "input")))
		}
	}
	return items
}

type ChatToolCallAccumulator struct {
	calls map[int]*chatToolCallState
}

type chatToolCallState struct {
	id          string
	toolType    string
	name        string
	arguments   strings.Builder
	customInput strings.Builder
}

func NewChatToolCallAccumulator() *ChatToolCallAccumulator {
	return &ChatToolCallAccumulator{calls: map[int]*chatToolCallState{}}
}

func (a *ChatToolCallAccumulator) AddChunk(payload map[string]interface{}) {
	if a == nil || payload == nil {
		return
	}
	choices, _ := payload["choices"].([]interface{})
	if len(choices) == 0 {
		return
	}
	choice, _ := choices[0].(map[string]interface{})
	if choice == nil {
		return
	}
	message, _ := choice["message"].(map[string]interface{})
	if message == nil {
		message, _ = choice["delta"].(map[string]interface{})
	}
	if message == nil {
		return
	}
	toolCalls, _ := message["tool_calls"].([]interface{})
	for i, toolCall := range toolCalls {
		tc, ok := toolCall.(map[string]interface{})
		if !ok {
			continue
		}
		index := i
		if idx, ok := tc["index"].(float64); ok {
			index = int(idx)
		}
		state := a.calls[index]
		if state == nil {
			state = &chatToolCallState{}
			a.calls[index] = state
		}
		if id := firstStringFromBody(tc, "id"); id != "" {
			state.id = id
		}
		if toolType := firstStringFromBody(tc, "type"); toolType != "" {
			state.toolType = toolType
		}
		if fn, _ := tc["function"].(map[string]interface{}); fn != nil {
			if name := firstStringFromBody(fn, "name"); name != "" {
				state.name = name
			}
			if args, ok := fn["arguments"].(string); ok {
				state.arguments.WriteString(args)
			}
		}
		if custom, _ := tc["custom"].(map[string]interface{}); custom != nil {
			state.toolType = "custom"
			if name := firstStringFromBody(custom, "name"); name != "" {
				state.name = name
			}
			if input, ok := custom["input"].(string); ok {
				state.customInput.WriteString(input)
			}
		}
	}
}

func (a *ChatToolCallAccumulator) Items(customToolNames map[string]bool) []interface{} {
	if a == nil || len(a.calls) == 0 {
		return nil
	}
	indexes := make([]int, 0, len(a.calls))
	for index := range a.calls {
		indexes = append(indexes, index)
	}
	sort.Ints(indexes)

	items := make([]interface{}, 0, len(indexes))
	for _, index := range indexes {
		state := a.calls[index]
		if state == nil || state.name == "" {
			continue
		}
		callID := state.id
		if callID == "" {
			callID = utils.GenerateID("call")
		}
		arguments := state.arguments.String()
		if state.toolType == "custom" || customToolNames[state.name] {
			input := state.customInput.String()
			if input == "" {
				input = customToolInputFromArguments(arguments)
			}
			items = append(items, buildResponsesCustomToolCall(callID, state.name, input))
			continue
		}
		items = append(items, map[string]interface{}{
			"type":      "function_call",
			"id":        callID,
			"call_id":   callID,
			"name":      state.name,
			"arguments": arguments,
			"status":    "completed",
		})
	}
	return items
}

func ResponsesCustomToolNames(tools interface{}) map[string]bool {
	result := map[string]bool{}
	toolList, ok := tools.([]interface{})
	if !ok {
		return result
	}
	for _, tool := range toolList {
		t, ok := tool.(map[string]interface{})
		if !ok || firstStringFromBody(t, "type") != "custom" {
			continue
		}
		if name := firstStringFromBody(t, "name"); name != "" {
			result[name] = true
		}
	}
	return result
}

func buildResponsesCustomToolCall(callID, name, input string) map[string]interface{} {
	if callID == "" {
		callID = utils.GenerateID("call")
	}
	return map[string]interface{}{
		"type":    "custom_tool_call",
		"id":      callID,
		"call_id": callID,
		"name":    name,
		"input":   customToolInputFromArguments(input),
		"status":  "completed",
	}
}

func customToolInputFromArguments(arguments string) string {
	trimmed := strings.TrimSpace(arguments)
	if trimmed == "" {
		return ""
	}
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		if input, ok := payload["input"].(string); ok {
			return input
		}
	}
	return arguments
}

func BuildResponseUsage(usage interface{}, outputText string) map[string]interface{} {
	normalized := utils.NormalizeUsage(usage)
	source, _ := usage.(map[string]interface{})
	if source == nil {
		source = map[string]interface{}{}
	}

	inputTokens := utils.FiniteTokenCount(
		source["prompt_tokens"], source["promptTokens"],
		source["input_tokens"], source["inputTokens"],
	)
	if normalized != nil && inputTokens == 0 {
		inputTokens = normalized.PromptTokens
	}

	outputTokens := utils.FiniteTokenCount(
		source["completion_tokens"], source["completionTokens"],
		source["output_tokens"], source["outputTokens"],
	)
	if normalized != nil && outputTokens == 0 {
		outputTokens = normalized.CompletionTokens
	}
	if outputTokens == 0 && strings.TrimSpace(outputText) != "" {
		outputTokens = len(strings.Fields(outputText))
	}

	totalTokens := utils.FiniteTokenCount(
		source["total_tokens"], source["totalTokens"],
	)
	if normalized != nil && totalTokens == 0 {
		totalTokens = normalized.TotalTokens
	}
	if totalTokens == 0 {
		totalTokens = inputTokens + outputTokens
	}

	cachedTokens := utils.FiniteTokenCount(
		source["cached_tokens"], source["cachedTokens"],
	)
	if normalized != nil && cachedTokens == 0 {
		cachedTokens = normalized.CachedTokens
	}

	reasoningTokens := utils.FiniteTokenCount(
		source["reasoning_tokens"], source["reasoningTokens"],
	)
	if normalized != nil && reasoningTokens == 0 {
		reasoningTokens = normalized.ReasoningTokens
	}

	return map[string]interface{}{
		"input_tokens":          inputTokens,
		"input_tokens_details":  map[string]interface{}{"cached_tokens": cachedTokens},
		"output_tokens":         outputTokens,
		"output_tokens_details": map[string]interface{}{"reasoning_tokens": reasoningTokens},
		"total_tokens":          totalTokens,
	}
}

func BuildIncompleteDetails(finishReason string) interface{} {
	reason := strings.TrimSpace(finishReason)
	if reason == "" || reason == "tool_calls" {
		return nil
	}
	if reason == "length" {
		return map[string]interface{}{"reason": "max_output_tokens"}
	}
	if reason == "content_filter" {
		return map[string]interface{}{"reason": "content_filter"}
	}
	return map[string]interface{}{"reason": reason}
}

func CreateReasoningItem(effort string) map[string]interface{} {
	b := make([]byte, 100)
	rand.Read(b)
	return map[string]interface{}{
		"id":                utils.GenerateID("rs"),
		"type":              "reasoning",
		"encrypted_content": fmt.Sprintf("gAAAAAB%x", b),
		"summary":           []interface{}{},
		"effort":            effort,
	}
}

func CreateAssistantMessageItem(text string) map[string]interface{} {
	return map[string]interface{}{
		"id":     utils.GenerateID("msg"),
		"type":   "message",
		"status": "completed",
		"content": []map[string]interface{}{
			{
				"type":        "output_text",
				"annotations": []interface{}{},
				"logprobs":    []interface{}{},
				"text":        text,
			},
		},
		"phase": "final_answer",
		"role":  "assistant",
	}
}

func BuildResponseObject(params map[string]interface{}) map[string]interface{} {
	createdAt := utils.GenerateTimestamp()
	outputText, _ := params["outputText"].(string)

	response := map[string]interface{}{
		"id":                     utils.GenerateID("resp"),
		"object":                 "response",
		"created_at":             createdAt,
		"status":                 params["status"],
		"background":             false,
		"error":                  nil,
		"frequency_penalty":      0.0,
		"input":                  params["input"],
		"instructions":           fmt.Sprintf("%v", params["instructions"]),
		"max_output_tokens":      params["maxOutputTokens"],
		"max_tool_calls":         nil,
		"model":                  params["model"],
		"moderation":             nil,
		"output":                 params["output"],
		"output_text":            outputText,
		"parallel_tool_calls":    true,
		"presence_penalty":       0.0,
		"previous_response_id":   nil,
		"prompt_cache_key":       nil,
		"prompt_cache_retention": "24h",
		"reasoning": map[string]interface{}{
			"context": "current_turn",
			"effort":  nil,
			"summary": nil,
		},
		"safety_identifier": fmt.Sprintf("user-%x", make([]byte, 8)),
		"service_tier":      "auto",
		"store":             false,
		"temperature":       1.0,
		"text":              map[string]interface{}{},
		"tool_choice":       "auto",
		"tool_usage": map[string]interface{}{
			"image_gen":  nil,
			"web_search": map[string]interface{}{"num_requests": 0},
		},
		"tools":        []interface{}{},
		"top_logprobs": 0,
		"top_p":        0.98,
		"truncation":   "disabled",
		"usage":        params["usage"],
		"user":         nil,
		"metadata":     map[string]interface{}{},
	}

	if status, ok := params["status"].(string); ok && status == "completed" {
		response["completed_at"] = createdAt
	} else {
		response["completed_at"] = nil
	}

	finishReason, _ := params["finishReason"].(string)
	response["incomplete_details"] = BuildIncompleteDetails(finishReason)

	if v, ok := params["frequencyPenalty"].(float64); ok {
		response["frequency_penalty"] = v
	}
	if v, ok := params["presencePenalty"].(float64); ok {
		response["presence_penalty"] = v
	}
	if v, ok := params["temperature"].(float64); ok {
		response["temperature"] = v
	}
	if v, ok := params["topP"].(float64); ok {
		response["top_p"] = v
	}

	reasoningEffort, _ := params["reasoningEffort"].(string)
	if reasoningEffort != "" {
		response["reasoning"].(map[string]interface{})["effort"] = reasoningEffort
	}

	return response
}

type SseWriter struct {
	w        http.ResponseWriter
	sequence int
}

func CreateSseWriter(w http.ResponseWriter) *SseWriter {
	return &SseWriter{w: w}
}

func (s *SseWriter) Write(eventType string, data interface{}) {
	s.sequence++
	payload := map[string]interface{}{
		"type":            eventType,
		"sequence_number": s.sequence,
	}

	dataMap, _ := data.(map[string]interface{})
	for k, v := range dataMap {
		payload[k] = v
	}

	jsonData, _ := json.Marshal(payload)
	fmt.Fprintf(s.w, "event: %s\n", eventType)
	fmt.Fprintf(s.w, "data: %s\n\n", string(jsonData))
	if flusher, ok := s.w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func firstStringFromBody(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if s, ok := m[key].(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}
