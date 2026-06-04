package proxy

import (
	"encoding/json"
	"fmt"
	"strings"

	"sapi/utils"
)

func OpenAIChatToGemini(body map[string]interface{}) map[string]interface{} {
	contents := make([]interface{}, 0)
	var systemParts []interface{}

	if messages, ok := body["messages"].([]interface{}); ok {
		for _, item := range messages {
			msg, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			role, _ := msg["role"].(string)
			text := utils.ExtractTextFromContent(msg["content"])
			if text == "" {
				continue
			}
			if role == "system" || role == "developer" {
				systemParts = append(systemParts, map[string]interface{}{"text": text})
				continue
			}
			geminiRole := "user"
			if role == "assistant" {
				geminiRole = "model"
			}
			contents = append(contents, map[string]interface{}{
				"role":  geminiRole,
				"parts": []interface{}{map[string]interface{}{"text": text}},
			})
		}
	}

	payload := map[string]interface{}{"contents": contents}
	if len(systemParts) > 0 {
		payload["systemInstruction"] = map[string]interface{}{"parts": systemParts}
	}

	generationConfig := map[string]interface{}{}
	copyGeminiConfig(body, generationConfig, "temperature", "temperature")
	copyGeminiConfig(body, generationConfig, "top_p", "topP")
	copyGeminiConfig(body, generationConfig, "top_k", "topK")
	copyGeminiConfig(body, generationConfig, "max_tokens", "maxOutputTokens")
	copyGeminiConfig(body, generationConfig, "max_completion_tokens", "maxOutputTokens")
	copyGeminiConfig(body, generationConfig, "max_output_tokens", "maxOutputTokens")
	if stop, ok := body["stop"].([]interface{}); ok && len(stop) > 0 {
		generationConfig["stopSequences"] = stop
	}
	if len(generationConfig) > 0 {
		payload["generationConfig"] = generationConfig
	}

	return payload
}

func copyGeminiConfig(source, target map[string]interface{}, from, to string) {
	if v, ok := source[from]; ok {
		target[to] = v
	}
}

func GeminiToOpenAIChat(payload map[string]interface{}, model string) map[string]interface{} {
	text := ""
	finishReason := "stop"
	if candidates, ok := payload["candidates"].([]interface{}); ok && len(candidates) > 0 {
		if candidate, ok := candidates[0].(map[string]interface{}); ok {
			text = utils.ExtractTextFromContent(candidate["content"])
			if reason, ok := candidate["finishReason"].(string); ok {
				finishReason = geminiFinishReasonToOpenAI(reason)
			}
		}
	}

	return map[string]interface{}{
		"id":      utils.GenerateID("chatcmpl"),
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
				"finish_reason": finishReason,
			},
		},
		"usage": geminiUsageToOpenAI(payload["usageMetadata"]),
	}
}

func GeminiStreamChunkToOpenAI(line string, model string) string {
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
	text := ""
	finishReason := ""
	if candidates, ok := payload["candidates"].([]interface{}); ok && len(candidates) > 0 {
		if candidate, ok := candidates[0].(map[string]interface{}); ok {
			text = utils.ExtractTextFromContent(candidate["content"])
			if reason, ok := candidate["finishReason"].(string); ok {
				finishReason = geminiFinishReasonToOpenAI(reason)
			}
		}
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
					"content": text,
				},
				"finish_reason": nullableString(finishReason),
			},
		},
	}
	if usage := geminiUsageToOpenAI(payload["usageMetadata"]); usage != nil {
		chunk["usage"] = usage
	}
	out, _ := json.Marshal(chunk)
	return fmt.Sprintf("data: %s\n\n", string(out))
}

func geminiUsageToOpenAI(usage interface{}) interface{} {
	u, ok := usage.(map[string]interface{})
	if !ok || u == nil {
		return nil
	}
	prompt := utils.FiniteTokenCount(u["promptTokenCount"])
	completion := utils.FiniteTokenCount(u["candidatesTokenCount"])
	total := utils.FiniteTokenCount(u["totalTokenCount"])
	if total == 0 {
		total = prompt + completion
	}
	return map[string]interface{}{
		"prompt_tokens":     prompt,
		"completion_tokens": completion,
		"total_tokens":      total,
	}
}

func geminiFinishReasonToOpenAI(reason string) string {
	switch strings.ToUpper(reason) {
	case "", "STOP":
		return "stop"
	case "MAX_TOKENS":
		return "length"
	case "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII":
		return "content_filter"
	default:
		return strings.ToLower(reason)
	}
}

func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
