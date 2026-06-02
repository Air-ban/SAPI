package logging

import (
	"fmt"
	"time"

	"sapi/auth"
	"sapi/models"
	"sapi/store"
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

	store.MutateDB(func(db *models.Database) interface{} {
		if db.RequestLogs == nil {
			db.RequestLogs = []models.RequestLog{}
		}

		timestamp := store.Now()

		if params.APIKeyID != "" {
			for i := range db.Users {
				if db.Users[i].ID == params.UserID {
					for j := range db.Users[i].APIKeys {
						if db.Users[i].APIKeys[j].ID == params.APIKeyID {
							db.Users[i].APIKeys[j].LastUsedAt = timestamp
							db.Users[i].APIKeys[j].UpdatedAt = timestamp
						}
					}
				}
			}
		}

		db.RequestLogs = append(db.RequestLogs, models.RequestLog{
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
			Timestamp:           timestamp,
		})

		if len(db.RequestLogs) > 50000 {
			db.RequestLogs = db.RequestLogs[len(db.RequestLogs)-50000:]
		}
		return nil
	})
}

type RequestLogParams struct {
	UserID              string
	UserName            string
	Username            string
	APIKeyID            string
	APIKeyName          string
	APIKeyPreview       string
	ProviderID          string
	ProviderName        string
	Model               string
	UpstreamModel       string
	Endpoint            string
	Method              string
	Status              int
	OK                  bool
	Stream              bool
	DurationMs          int
	Usage               interface{}
	ErrorCode           string
	ErrorMessage        string
	FinishReason        string
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
	if usage == nil {
		return simpleUsage{}
	}
	u, ok := usage.(map[string]interface{})
	if !ok {
		return simpleUsage{}
	}

	promptTokens := intVal(u, "prompt_tokens", "promptTokens", "input_tokens", "inputTokens")
	completionTokens := intVal(u, "completion_tokens", "completionTokens", "output_tokens", "outputTokens")
	totalTokens := intVal(u, "total_tokens", "totalTokens")
	if totalTokens == 0 {
		totalTokens = promptTokens + completionTokens
	}

	return simpleUsage{
		PromptTokens:        promptTokens,
		CompletionTokens:    completionTokens,
		TotalTokens:         totalTokens,
		CachedTokens:        intVal(u, "cached_tokens", "cachedTokens"),
		CacheCreationTokens: intVal(u, "cache_creation_input_tokens", "cacheCreationInputTokens"),
		CacheMissTokens:     intVal(u, "prompt_cache_miss_tokens", "promptCacheMissTokens"),
		ReasoningTokens:     intVal(u, "reasoning_tokens", "reasoningTokens"),
	}
}

func intVal(m map[string]interface{}, keys ...string) int {
	for _, key := range keys {
		if v, ok := m[key].(float64); ok {
			return int(v)
		}
	}
	return 0
}
