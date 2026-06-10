package logging

import (
	"fmt"
	"net/http"
	"time"

	"sapi/auth"
	"sapi/device"
	"sapi/ippure"
	"sapi/models"
	"sapi/store"
	"sapi/utils"
)

var (
	Reset  = "\033[0m"
	Green  = "\033[32m"
	Red    = "\033[31m"
	Yellow = "\033[33m"
	Cyan   = "\033[36m"
	Dim    = "\033[2m"
	Bold   = "\033[1m"
)

func logRequestToTerminal(method, endpoint string, status int, ok, stream bool, durationMs int, userName, model, providerName, errorCode, errorMessage string, promptTokens, completionTokens int, finishReason string) {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	ts := time.Now().In(loc).Format("2006-01-02 15:04:05")

	statusColor := Green
	statusLabel := "OK"
	if !ok {
		statusColor = Red
		statusLabel = "FAIL"
	}

	parts := []string{
		Dim + "[" + ts + "]" + Reset,
		Cyan + method + Reset,
		Bold + endpoint + Reset,
		fmt.Sprintf("%s%s%d %s%s", statusColor, Bold, status, statusLabel, Reset),
		fmt.Sprintf("%s%dms%s", Dim, durationMs, Reset),
	}
	if userName != "" {
		parts = append(parts, Dim+userName+Reset)
	}
	if model != "" {
		parts = append(parts, Yellow+model+Reset)
	}
	if providerName != "" {
		parts = append(parts, Dim+"via "+providerName+Reset)
	}
	if stream {
		parts = append(parts, Dim+"[stream]"+Reset)
	}
	if promptTokens > 0 || completionTokens > 0 {
		parts = append(parts, fmt.Sprintf("%stokens=%d+%d%s", Dim, promptTokens, completionTokens, Reset))
	}
	if finishReason != "" {
		parts = append(parts, Yellow+"finish="+finishReason+Reset)
	}
	if !ok {
		reason := errorMessage
		if reason == "" {
			reason = errorCode
		}
		if reason == "" {
			reason = fmt.Sprintf("HTTP %d", status)
		}
		parts = append(parts, Red+"reason=\""+reason+"\""+Reset)
	}

	out := parts[0]
	for _, p := range parts[1:] {
		out += " " + p
	}
	fmt.Println(out)
}

func RecordRequestLog(params RequestLogParams) {
	normalized := normalizeUsageSimple(params.Usage)

	logRequestToTerminal(
		params.Method, params.Endpoint, params.Status, params.OK, params.Stream, params.DurationMs,
		params.UserName, params.Model, params.ProviderName, params.ErrorCode, params.ErrorMessage,
		normalized.PromptTokens, normalized.CompletionTokens, params.FinishReason,
	)

	store.AppendRequestLog(models.RequestLog{
		ID:                  auth.RandomID("req"),
		UserID:              params.UserID,
		UserName:            params.UserName,
		Username:            params.Username,
		APIKeyID:            params.APIKeyID,
		APIKeyName:          params.APIKeyName,
		APIKeyPreview:       params.APIKeyPreview,
		ProviderID:          params.ProviderID,
		ProviderName:        params.ProviderName,
		Model:               params.Model,
		UpstreamModel:       params.UpstreamModel,
		Endpoint:            params.Endpoint,
		Method:              params.Method,
		Status:              params.Status,
		OK:                  params.OK,
		Stream:              params.Stream,
		DurationMs:          params.DurationMs,
		PromptTokens:        normalized.PromptTokens,
		CompletionTokens:    normalized.CompletionTokens,
		TotalTokens:         normalized.TotalTokens,
		CachedTokens:        normalized.CachedTokens,
		CacheCreationTokens: normalized.CacheCreationTokens,
		CacheMissTokens:     normalized.CacheMissTokens,
		ReasoningTokens:     normalized.ReasoningTokens,
		ErrorCode:           params.ErrorCode,
		ErrorMessage:        params.ErrorMessage,
		ClientIPInfo:        ippure.LookupRequest(params.Request),
		ClientDevice:        device.FromRequest(params.Request),
		RequestContent:      params.RequestContent,
		Timestamp:           store.Now(),
	})
}

type RequestLogParams struct {
	UserID         string
	UserName       string
	Username       string
	APIKeyID       string
	APIKeyName     string
	APIKeyPreview  string
	ProviderID     string
	ProviderName   string
	Model          string
	UpstreamModel  string
	Endpoint       string
	Method         string
	Status         int
	OK             bool
	Stream         bool
	DurationMs     int
	Usage          interface{}
	ErrorCode      string
	ErrorMessage   string
	FinishReason   string
	RequestContent map[string]interface{}
	Request        *http.Request
}

type simpleUsage struct {
	PromptTokens        int
	CompletionTokens    int
	TotalTokens         int
	CachedTokens        int
	CacheCreationTokens int
	CacheMissTokens     int
	ReasoningTokens     int
}

func normalizeUsageSimple(usage interface{}) simpleUsage {
	normalized := utils.NormalizeUsage(usage)
	if normalized == nil {
		return simpleUsage{}
	}
	return simpleUsage{
		PromptTokens:        normalized.PromptTokens,
		CompletionTokens:    normalized.CompletionTokens,
		TotalTokens:         normalized.TotalTokens,
		CachedTokens:        normalized.CachedTokens,
		CacheCreationTokens: normalized.CacheCreationTokens,
		CacheMissTokens:     normalized.CacheMissTokens,
		ReasoningTokens:     normalized.ReasoningTokens,
	}
}
