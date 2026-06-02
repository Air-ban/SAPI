package utils

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"sapi/config"
)

func SHA256(message string) string {
	h := sha256.Sum256([]byte(message))
	return hex.EncodeToString(h[:])
}

func GenerateTimestamp() int64 {
	return time.Now().Unix()
}

func GenerateID(prefix string) string {
	b := make([]byte, 16)
	rand.Read(b)
	return prefix + "_" + fmt.Sprintf("%x", b)
}

func SendError(w http.ResponseWriter, status int, message, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{
			"message": message,
			"type":    code,
			"code":    code,
		},
	})
}

func GetBearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if header == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return strings.TrimSpace(header[7:])
	}
	return ""
}

func GetUserAPIKey(r *http.Request) string {
	token := GetBearerToken(r)
	if token != "" {
		return token
	}
	return r.Header.Get("X-API-Key")
}

func IsHopByHopHeader(name string) bool {
	return config.HopByHopHeaders[strings.ToLower(name)]
}

func FilterForwardHeaders(headers http.Header) http.Header {
	result := make(http.Header)
	allowed := map[string]bool{"accept": true, "content-type": true}

	for key, values := range headers {
		lower := strings.ToLower(key)
		if !allowed[lower] || lower == "host" || lower == "authorization" ||
			lower == "x-api-key" || lower == "content-length" || IsHopByHopHeader(lower) {
			continue
		}
		for _, v := range values {
			result.Add(key, v)
		}
	}
	return result
}

func CopyUpstreamHeaders(source http.Header, w http.ResponseWriter, overrides map[string]string) {
	for key, values := range source {
		lower := strings.ToLower(key)
		if IsHopByHopHeader(lower) {
			continue
		}
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}
	for key, value := range overrides {
		if value != "" {
			w.Header().Set(key, value)
		}
	}
}

func BuildUpstreamURL(baseURL, originalURL string) string {
	baseURL = strings.TrimRight(baseURL, "/")

	incomingPath := originalURL
	if idx := strings.Index(originalURL, "?"); idx >= 0 {
		incomingPath = originalURL[:idx]
	}
	incomingPath = strings.TrimLeft(incomingPath, "/")
	incomingWithoutVersion := strings.TrimPrefix(incomingPath, "v1/")

	if strings.HasSuffix(baseURL, "/v1") {
		return baseURL + "/" + incomingWithoutVersion
	}
	return baseURL + "/" + incomingPath
}

func ExtractTextFromContent(content interface{}) string {
	switch v := content.(type) {
	case nil:
		return ""
	case string:
		return v
	case float64:
		return fmt.Sprintf("%v", v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case []interface{}:
		var parts []string
		for _, item := range v {
			parts = append(parts, ExtractTextFromContent(item))
		}
		return strings.Join(parts, "")
	case map[string]interface{}:
		typeVal, _ := v["type"].(string)
		typeVal = strings.ToLower(typeVal)
		if (typeVal == "input_text" || typeVal == "output_text") && v["text"] != nil {
			return ExtractTextFromContent(v["text"])
		}
		if v["text"] != nil {
			if text, ok := v["text"].(string); ok {
				return text
			}
		}
		if v["content"] != nil {
			return ExtractTextFromContent(v["content"])
		}
		if v["parts"] != nil {
			return ExtractTextFromContent(v["parts"])
		}
		if v["value"] != nil {
			return ExtractTextFromContent(v["value"])
		}
		return ""
	default:
		return fmt.Sprintf("%v", v)
	}
}

func IsModelAllowed(apiKeyRecord *APIKeyRecordInfo, model string) bool {
	if apiKeyRecord == nil || len(apiKeyRecord.AllowedModels) == 0 {
		return true
	}
	modelID := strings.TrimSpace(model)
	if modelID == "" {
		return true
	}
	for _, allowed := range apiKeyRecord.AllowedModels {
		if strings.TrimSpace(allowed) == modelID {
			return true
		}
	}
	return false
}

type APIKeyRecordInfo struct {
	AllowedModels []string
	RPMLimit      int
	Key           string
}

func BuildUpstreamBody(r *http.Request, upstreamModel string) ([]byte, error) {
	if r.Method == "GET" || r.Method == "HEAD" || r.Body == nil {
		return nil, nil
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("[V1CHAT] BUILD_BODY_READ_ERR err=%v", err)
		return nil, err
	}

	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		log.Printf("[V1CHAT] BUILD_BODY_PARSE_ERR err=%v | passing raw bytes len=%d", err, len(bodyBytes))
		return bodyBytes, nil
	}

	hasStream := false
	if stream, ok := body["stream"].(bool); ok && stream {
		hasStream = true
		streamOptions := make(map[string]interface{})
		if so, ok := body["stream_options"].(map[string]interface{}); ok {
			streamOptions = so
		}
		streamOptions["include_usage"] = true
		body["stream_options"] = streamOptions
	}

	originalModel, _ := body["model"].(string)
	if upstreamModel != "" {
		if _, ok := body["model"]; ok {
			body["model"] = upstreamModel
		}
	}

	result, marshalErr := json.Marshal(body)
	log.Printf("[V1CHAT] BUILD_BODY_OK original_model=%s upstream_model=%s stream=%v include_usage=%v result_len=%d marshal_err=%v",
		originalModel, upstreamModel, hasStream, hasStream, len(result), marshalErr)
	return result, marshalErr
}

func ShouldStreamResponse(_ *http.Request, upstreamResp *http.Response) bool {
	contentType := upstreamResp.Header.Get("Content-Type")
	isStream := strings.Contains(contentType, "text/event-stream") ||
		strings.Contains(contentType, "application/x-ndjson")
	log.Printf("[V1CHAT] SHOULD_STREAM content-type=%q => %v", contentType, isStream)
	return isStream
}

func FiniteTokenCount(values ...interface{}) int {
	for _, value := range values {
		switch v := value.(type) {
		case float64:
			if v >= 0 {
				return int(v)
			}
		case int:
			if v >= 0 {
				return v
			}
		case int64:
			if v >= 0 {
				return int(v)
			}
		}
	}
	return 0
}

type NormalizedUsage struct {
	PromptTokens        int
	CompletionTokens    int
	TotalTokens         int
	CachedTokens        int
	CacheCreationTokens int
	CacheMissTokens     int
	ReasoningTokens     int
}

func NormalizeUsage(usage interface{}) *NormalizedUsage {
	u, ok := usage.(map[string]interface{})
	if !ok || u == nil {
		return nil
	}

	promptDetails := getMap(u, "prompt_tokens_details", "promptTokensDetails", "input_tokens_details", "inputTokensDetails")
	completionDetails := getMap(u, "completion_tokens_details", "completionTokensDetails", "output_tokens_details", "outputTokensDetails")

	promptTokens := FiniteTokenCount(
		getValue(u, "prompt_tokens", "promptTokens", "input_tokens", "inputTokens"),
	)
	completionTokens := FiniteTokenCount(
		getValue(u, "completion_tokens", "completionTokens", "output_tokens", "outputTokens"),
	)
	totalTokens := FiniteTokenCount(
		getValue(u, "total_tokens", "totalTokens"),
	)
	if totalTokens == 0 && promptTokens+completionTokens > 0 {
		totalTokens = promptTokens + completionTokens
	}

	cachedTokens := FiniteTokenCount(
		getValue(u, "cached_tokens", "cachedTokens", "prompt_cache_hit_tokens", "promptCacheHitTokens", "cache_read_input_tokens", "cacheReadInputTokens"),
		getValue(promptDetails, "cached_tokens", "cachedTokens"),
	)
	cacheCreationTokens := FiniteTokenCount(
		getValue(u, "cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens", "cacheWriteInputTokens"),
		getValue(promptDetails, "cache_creation_tokens", "cacheCreationTokens"),
	)
	cacheMissTokens := FiniteTokenCount(
		getValue(u, "prompt_cache_miss_tokens", "promptCacheMissTokens", "cache_miss_input_tokens", "cacheMissInputTokens"),
	)
	reasoningTokens := FiniteTokenCount(
		getValue(u, "reasoning_tokens", "reasoningTokens"),
		getValue(completionDetails, "reasoning_tokens", "reasoningTokens"),
	)

	if totalTokens == 0 && promptTokens == 0 && completionTokens == 0 &&
		cachedTokens == 0 && cacheCreationTokens == 0 && cacheMissTokens == 0 && reasoningTokens == 0 {
		return nil
	}

	return &NormalizedUsage{
		PromptTokens:        promptTokens,
		CompletionTokens:    completionTokens,
		TotalTokens:         totalTokens,
		CachedTokens:        cachedTokens,
		CacheCreationTokens: cacheCreationTokens,
		CacheMissTokens:     cacheMissTokens,
		ReasoningTokens:     reasoningTokens,
	}
}

func FindUsagePayload(payload interface{}) interface{} {
	p, ok := payload.(map[string]interface{})
	if !ok || p == nil {
		return nil
	}

	candidates := []interface{}{
		p["usage"],
		p["token_usage"],
		p["tokenUsage"],
	}
	if resp, ok := p["response"].(map[string]interface{}); ok {
		candidates = append(candidates, resp["usage"])
	}

	for _, candidate := range candidates {
		if NormalizeUsage(candidate) != nil {
			return candidate
		}
	}

	if arr, ok := payload.([]interface{}); ok {
		for i := len(arr) - 1; i >= 0; i-- {
			if result := FindUsagePayload(arr[i]); result != nil {
				return result
			}
		}
	}

	return nil
}

func ExtractUsageFromResponseText(text string) interface{} {
	if text == "" {
		return nil
	}

	var payload interface{}
	if err := json.Unmarshal([]byte(text), &payload); err == nil {
		if usage := FindUsagePayload(payload); usage != nil {
			return usage
		}
	}

	scanner := bufio.NewScanner(strings.NewReader(text))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}

		item := line
		if strings.HasPrefix(line, "data:") {
			item = strings.TrimSpace(line[5:])
		}
		if item == "" || item == "[DONE]" || (!strings.HasPrefix(item, "{") && !strings.HasPrefix(item, "[")) {
			continue
		}

		var parsed interface{}
		if err := json.Unmarshal([]byte(item), &parsed); err == nil {
			if usage := FindUsagePayload(parsed); usage != nil {
				return usage
			}
		}
	}

	return nil
}

func getMap(m map[string]interface{}, keys ...string) map[string]interface{} {
	for _, key := range keys {
		if val, ok := m[key].(map[string]interface{}); ok {
			return val
		}
	}
	return map[string]interface{}{}
}

func getValue(m map[string]interface{}, keys ...string) interface{} {
	for _, key := range keys {
		if val, ok := m[key]; ok && val != nil {
			return val
		}
	}
	return nil
}

func GenerateIDSimple(prefix string) string {
	b := make([]byte, 12)
	rand.Read(b)
	return prefix + "_" + fmt.Sprintf("%x", b)
}
