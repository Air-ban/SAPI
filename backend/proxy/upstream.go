package proxy

import (
	"encoding/json"
	"net/http"
	"strings"

	"sapi/models"
	"sapi/utils"
)

type UpstreamKind string

const (
	UpstreamOpenAI    UpstreamKind = "openai"
	UpstreamAnthropic UpstreamKind = "anthropic"
	UpstreamGemini    UpstreamKind = "gemini"
)

func DetectUpstreamKind(provider models.Provider) UpstreamKind {
	baseURL := strings.ToLower(provider.BaseURL)
	name := strings.ToLower(provider.Name)
	switch {
	case strings.Contains(baseURL, "anthropic.com") || strings.Contains(baseURL, "claude") || strings.Contains(name, "anthropic") || strings.Contains(name, "claude"):
		return UpstreamAnthropic
	case strings.Contains(baseURL, "generativelanguage.googleapis.com") || strings.Contains(baseURL, "googleapis.com") || strings.Contains(name, "gemini") || strings.Contains(name, "google"):
		return UpstreamGemini
	default:
		return UpstreamOpenAI
	}
}

func BuildChatCompletionsUpstreamRequest(provider models.Provider, path, rawQuery string, body map[string]interface{}, upstreamModel string) (string, []byte, http.Header, bool, error) {
	kind := DetectUpstreamKind(provider)
	headers := make(http.Header)
	headers.Set("Content-Type", "application/json")
	headers.Set("Accept-Encoding", "identity")

	if !isChatCompletionsPath(path) {
		kind = UpstreamOpenAI
	}

	switch kind {
	case UpstreamAnthropic:
		payload := OpenAIChatToAnthropic(body)
		if upstreamModel != "" {
			payload["model"] = upstreamModel
		}
		reqBody, err := json.Marshal(payload)
		headers.Set("x-api-key", provider.APIKey)
		headers.Set("anthropic-version", "2023-06-01")
		if stream, _ := payload["stream"].(bool); stream {
			headers.Set("Accept", "text/event-stream")
		}
		return utils.BuildUpstreamURL(provider.BaseURL, "/v1/messages"), reqBody, headers, true, err
	case UpstreamGemini:
		model := upstreamModel
		if model == "" {
			model, _ = body["model"].(string)
		}
		stream, _ := body["stream"].(bool)
		payload := OpenAIChatToGemini(body)
		reqBody, err := json.Marshal(payload)
		action := "generateContent"
		if stream {
			action = "streamGenerateContent"
			headers.Set("Accept", "text/event-stream")
		}
		url := utils.BuildGeminiGenerateContentURL(provider.BaseURL, model, action, provider.APIKey)
		return url, reqBody, headers, true, err
	default:
		payload := cloneMap(body)
		if upstreamModel != "" {
			if _, ok := payload["model"]; ok {
				payload["model"] = upstreamModel
			}
		}
		if stream, ok := payload["stream"].(bool); ok && stream {
			streamOptions, _ := payload["stream_options"].(map[string]interface{})
			if streamOptions == nil {
				streamOptions = map[string]interface{}{}
			}
			streamOptions["include_usage"] = true
			payload["stream_options"] = streamOptions
		}
		reqBody, err := json.Marshal(payload)
		headers.Set("Authorization", "Bearer "+provider.APIKey)
		url := utils.BuildUpstreamURL(provider.BaseURL, path)
		if rawQuery != "" {
			url += "?" + rawQuery
		}
		return url, reqBody, headers, false, err
	}
}

func isChatCompletionsPath(path string) bool {
	cleaned := strings.Trim(path, "/")
	return cleaned == "chat/completions" || cleaned == "v1/chat/completions"
}

func cloneMap(input map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{}, len(input))
	for k, v := range input {
		result[k] = v
	}
	return result
}
