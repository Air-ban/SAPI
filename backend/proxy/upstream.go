package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
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
	headers := baseUpstreamHeaders(provider)
	headers.Set("Content-Type", "application/json")

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

	headers := baseUpstreamHeaders(provider)
	headers.Set("Content-Type", "application/json")
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

func BuildAnthropicCountTokensUpstreamRequestDetailed(provider models.Provider, body map[string]interface{}, upstreamModel string) (ChatCompletionsUpstreamRequest, error) {
	payload := cloneMap(body)
	if upstreamModel != "" {
		payload["model"] = upstreamModel
	}
	reqBody, err := json.Marshal(payload)

	headers := baseUpstreamHeaders(provider)
	headers.Set("Content-Type", "application/json")
	headers.Set("x-api-key", provider.APIKey)
	headers.Set("anthropic-version", "2023-06-01")

	return ChatCompletionsUpstreamRequest{
		URL:                         utils.BuildUpstreamURL(provider.BaseURL, "/v1/messages/count_tokens"),
		Body:                        reqBody,
		Headers:                     headers,
		Kind:                        UpstreamAnthropic,
		NeedsChatResponseConversion: false,
	}, err
}

func BuildOpenAICompatibleUpstreamRequestDetailed(provider models.Provider, path, rawQuery string, body []byte, contentType, upstreamModel string) (ChatCompletionsUpstreamRequest, error) {
	headers := baseUpstreamHeaders(provider)
	headers.Set("Authorization", "Bearer "+provider.APIKey)

	var reqBody []byte
	if len(body) > 0 {
		reqBody = body
	}
	nextContentType := strings.TrimSpace(contentType)
	if upstreamModel != "" && len(body) > 0 {
		rewrittenBody, rewrittenContentType, ok, err := rewriteOpenAICompatibleModel(body, nextContentType, upstreamModel)
		if err != nil {
			return ChatCompletionsUpstreamRequest{}, err
		}
		if ok {
			reqBody = rewrittenBody
			nextContentType = rewrittenContentType
		}
	}

	if nextContentType != "" {
		headers.Set("Content-Type", nextContentType)
	}

	upstreamURL := utils.BuildUpstreamURL(provider.BaseURL, path)
	if rawQuery != "" {
		upstreamURL += "?" + rawQuery
	}

	return ChatCompletionsUpstreamRequest{
		URL:                         upstreamURL,
		Body:                        reqBody,
		Headers:                     headers,
		Kind:                        UpstreamOpenAI,
		NeedsChatResponseConversion: false,
	}, nil
}

func BuildOpenAIJSONUpstreamRequestDetailed(provider models.Provider, path, rawQuery string, body map[string]interface{}, upstreamModel string) (ChatCompletionsUpstreamRequest, error) {
	payload := cloneMap(body)
	if upstreamModel != "" {
		if _, ok := payload["model"]; ok {
			payload["model"] = upstreamModel
		}
	}
	reqBody, err := json.Marshal(payload)

	headers := baseUpstreamHeaders(provider)
	headers.Set("Content-Type", "application/json")
	headers.Set("Authorization", "Bearer "+provider.APIKey)
	if stream, _ := payload["stream"].(bool); stream {
		headers.Set("Accept", "text/event-stream")
	}

	upstreamURL := utils.BuildUpstreamURL(provider.BaseURL, path)
	if rawQuery != "" {
		upstreamURL += "?" + rawQuery
	}

	return ChatCompletionsUpstreamRequest{
		URL:                         upstreamURL,
		Body:                        reqBody,
		Headers:                     headers,
		Kind:                        UpstreamOpenAI,
		NeedsChatResponseConversion: false,
	}, err
}

func ShouldUseNativeResponses(provider models.Provider, body map[string]interface{}) bool {
	if ProviderUpstreamKind(provider) != UpstreamOpenAI || body == nil {
		return false
	}
	if hasNativeResponsesTools(body["tools"]) {
		return true
	}
	if hasNativeResponsesInput(body["input"]) {
		return true
	}
	for _, key := range []string{
		"previous_response_id",
		"conversation",
		"include",
		"metadata",
		"background",
		"prompt",
		"parallel_tool_calls",
		"tool_choice",
	} {
		if _, ok := body[key]; ok {
			return true
		}
	}
	return hasNativeResponsesTextFormat(body["text"])
}

func hasNativeResponsesInput(input interface{}) bool {
	switch v := input.(type) {
	case []interface{}:
		for _, item := range v {
			if hasNativeResponsesInput(item) {
				return true
			}
		}
	case map[string]interface{}:
		switch strings.ToLower(firstUpstreamString(v, "type")) {
		case "input_file", "file", "input_audio", "audio":
			return true
		}
		if hasNativeResponsesInput(v["content"]) {
			return true
		}
	case string, nil:
		return false
	}
	return false
}

func hasNativeResponsesTools(tools interface{}) bool {
	toolList, ok := tools.([]interface{})
	if !ok {
		return false
	}
	for _, tool := range toolList {
		t, ok := tool.(map[string]interface{})
		if !ok {
			continue
		}
		switch strings.ToLower(firstUpstreamString(t, "type")) {
		case "web_search_preview", "web_search", "file_search", "code_interpreter", "computer_use_preview", "image_generation", "mcp":
			return true
		}
	}
	return false
}

func hasNativeResponsesTextFormat(textConfig interface{}) bool {
	cfg, ok := textConfig.(map[string]interface{})
	if !ok || cfg == nil {
		return false
	}
	format, _ := cfg["format"].(map[string]interface{})
	if format == nil {
		return false
	}
	return firstUpstreamString(format, "type") != ""
}

func firstUpstreamString(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if s, ok := m[key].(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func rewriteOpenAICompatibleModel(body []byte, contentType, upstreamModel string) ([]byte, string, bool, error) {
	upstreamModel = strings.TrimSpace(upstreamModel)
	if upstreamModel == "" {
		return body, contentType, false, nil
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
		params = map[string]string{}
	}
	mediaType = strings.ToLower(mediaType)

	switch mediaType {
	case "application/json", "":
		var payload map[string]interface{}
		if err := json.Unmarshal(body, &payload); err != nil {
			return body, contentType, false, nil
		}
		if _, ok := payload["model"]; !ok {
			return body, contentType, false, nil
		}
		payload["model"] = upstreamModel
		rewritten, err := json.Marshal(payload)
		return rewritten, contentType, true, err
	case "application/x-www-form-urlencoded":
		values, err := url.ParseQuery(string(body))
		if err != nil {
			return body, contentType, false, nil
		}
		if _, ok := values["model"]; !ok {
			return body, contentType, false, nil
		}
		values.Set("model", upstreamModel)
		return []byte(values.Encode()), contentType, true, nil
	case "multipart/form-data":
		boundary := params["boundary"]
		if boundary == "" {
			return body, contentType, false, nil
		}
		rewritten, rewrittenContentType, ok, err := rewriteMultipartModel(body, boundary, upstreamModel)
		return rewritten, rewrittenContentType, ok, err
	default:
		return body, contentType, false, nil
	}
}

func rewriteMultipartModel(body []byte, boundary, upstreamModel string) ([]byte, string, bool, error) {
	reader := multipart.NewReader(bytes.NewReader(body), boundary)
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	replaced := false

	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return body, "", false, err
		}

		headers := copyMIMEHeader(part.Header)
		dst, err := writer.CreatePart(headers)
		if err != nil {
			return body, "", false, err
		}
		if part.FormName() == "model" {
			if _, err := dst.Write([]byte(upstreamModel)); err != nil {
				return body, "", false, err
			}
			replaced = true
			continue
		}
		if _, err := io.Copy(dst, part); err != nil {
			return body, "", false, err
		}
	}
	if err := writer.Close(); err != nil {
		return body, "", false, err
	}
	if !replaced {
		return body, "", false, nil
	}
	return buf.Bytes(), writer.FormDataContentType(), true, nil
}

func copyMIMEHeader(source textproto.MIMEHeader) textproto.MIMEHeader {
	result := make(textproto.MIMEHeader, len(source))
	for key, values := range source {
		result[key] = append([]string{}, values...)
	}
	return result
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

func baseUpstreamHeaders(provider models.Provider) http.Header {
	headers := make(http.Header)
	headers.Set("Accept-Encoding", "identity")
	if userAgent := models.NormalizeProviderUserAgent(provider.UserAgent); userAgent != "" {
		headers.Set("User-Agent", userAgent)
	}
	return headers
}
