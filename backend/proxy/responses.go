package proxy

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
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
	text := strings.TrimSpace(utils.ExtractTextFromContent(content))
	if text == "" {
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
		"content": text,
	})
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
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
		if tc, ok := body["tool_choice"].(string); ok {
			payload["tool_choice"] = tc
		}
	}

	mt := body["max_output_tokens"]
	if mt == nil {
		mt = body["max_tokens"]
	}
	if mt != nil {
		payload["max_tokens"] = mt
	}

	for _, key := range []string{"temperature", "top_p", "frequency_penalty", "presence_penalty"} {
		if v, ok := body[key]; ok {
			payload[key] = v
		}
	}

	return payload
}

func ExtractChatCompletionText(payload map[string]interface{}) (text string, finishReason string, usage interface{}) {
	choices, _ := payload["choices"].([]interface{})
	var choice map[string]interface{}
	if len(choices) > 0 {
		choice, _ = choices[0].(map[string]interface{})
	}
	if choice == nil {
		return "", "", nil
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
	usage = utils.FindUsagePayload(payload)

	return
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
		"input_tokens":         inputTokens,
		"input_tokens_details": map[string]interface{}{"cached_tokens": cachedTokens},
		"output_tokens":        outputTokens,
		"output_tokens_details": map[string]interface{}{"reasoning_tokens": reasoningTokens},
		"total_tokens":         totalTokens,
	}
}

func BuildIncompleteDetails(finishReason string) interface{} {
	reason := strings.TrimSpace(finishReason)
	if reason == "" {
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
		"id":                 utils.GenerateID("resp"),
		"object":             "response",
		"created_at":         createdAt,
		"status":             params["status"],
		"background":         false,
		"error":              nil,
		"frequency_penalty":  0.0,
		"input":              params["input"],
		"instructions":       fmt.Sprintf("%v", params["instructions"]),
		"max_output_tokens":  params["maxOutputTokens"],
		"max_tool_calls":     nil,
		"model":              params["model"],
		"moderation":         nil,
		"output":             params["output"],
		"output_text":        outputText,
		"parallel_tool_calls": true,
		"presence_penalty":   0.0,
		"previous_response_id": nil,
		"prompt_cache_key":   nil,
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
			"image_gen":   nil,
			"web_search": map[string]interface{}{"num_requests": 0},
		},
		"tools":         []interface{}{},
		"top_logprobs":  0,
		"top_p":         0.98,
		"truncation":    "disabled",
		"usage":         params["usage"],
		"user":          nil,
		"metadata":      map[string]interface{}{},
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
