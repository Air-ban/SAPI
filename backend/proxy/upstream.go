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

type ChatCompletionsUpstreamRequest struct {
	URL                         string
	Body                        []byte
	Headers                     http.Header
	Kind                        UpstreamKind
	NeedsChatResponseConversion bool
}

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

func ProviderUpstreamKind(provider models.Provider) UpstreamKind {
	switch models.NormalizeUpstreamFormat(provider.UpstreamFormat) {
	case models.UpstreamFormatAnthropic:
		return UpstreamAnthropic
	case models.UpstreamFormatGemini:
		return UpstreamGemini
	case models.UpstreamFormatOpenAI:
		return UpstreamOpenAI
	default:
		return DetectUpstreamKind(provider)
	}
}

func BuildChatCompletionsUpstreamRequest(provider models.Provider, path, rawQuery string, body map[string]interface{}, upstreamModel string) (string, []byte, http.Header, bool, error) {
	req, err := BuildChatCompletionsUpstreamRequestDetailed(provider, path, rawQuery, body, upstreamModel)
	return req.URL, req.Body, req.Headers, req.NeedsChatResponseConversion, err
}

func BuildChatCompletionsUpstreamRequestDetailed(provider models.Provider, path, rawQuery string, body map[string]interface{}, upstreamModel string) (ChatCompletionsUpstreamRequest, error) {
	kind := ProviderUpstreamKind(provider)
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
		return ChatCompletionsUpstreamRequest{
			URL:                         utils.BuildUpstreamURL(provider.BaseURL, "/v1/messages"),
			Body:                        reqBody,
			Headers:                     headers,
			Kind:                        UpstreamAnthropic,
			NeedsChatResponseConversion: true,
		}, err
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
		return ChatCompletionsUpstreamRequest{
			URL:                         url,
			Body:                        reqBody,
			Headers:                     headers,
			Kind:                        UpstreamGemini,
			NeedsChatResponseConversion: true,
		}, err
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
		return ChatCompletionsUpstreamRequest{
			URL:                         url,
			Body:                        reqBody,
			Headers:                     headers,
			Kind:                        UpstreamOpenAI,
			NeedsChatResponseConversion: false,
		}, err
	}
}

func BuildAnthropicMessagesUpstreamRequestDetailed(provider models.Provider, body map[string]interface{}, upstreamModel string) (ChatCompletionsUpstreamRequest, error) {
	payload := cloneMap(body)
	if upstreamModel != "" {
		payload["model"] = upstreamModel
	}
	reqBody, err := json.Marshal(payload)

	headers := make(http.Header)
	headers.Set("Content-Type", "application/json")
	headers.Set("Accept-Encoding", "identity")
	headers.Set("x-api-key", provider.APIKey)
	headers.Set("anthropic-version", "2023-06-01")
	if stream, _ := payload["stream"].(bool); stream {
		headers.Set("Accept", "text/event-stream")
	}

	return ChatCompletionsUpstreamRequest{
		URL:                         utils.BuildUpstreamURL(provider.BaseURL, "/v1/messages"),
		Body:                        reqBody,
		Headers:                     headers,
		Kind:                        UpstreamAnthropic,
		NeedsChatResponseConversion: false,
	}, err
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
