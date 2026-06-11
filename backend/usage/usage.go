package usage

import (
	"sort"
	"time"

	"sapi/billing"
	"sapi/models"
	"sapi/store"
)

type UsageStats struct {
	TotalPromptTokens        int                 `json:"totalPromptTokens"`
	TotalCompletionTokens    int                 `json:"totalCompletionTokens"`
	TotalTokens              int                 `json:"totalTokens"`
	TotalCachedTokens        int                 `json:"totalCachedTokens"`
	TotalCacheCreationTokens int                 `json:"totalCacheCreationTokens"`
	TotalCacheMissTokens     int                 `json:"totalCacheMissTokens"`
	TotalReasoningTokens     int                 `json:"totalReasoningTokens"`
	TotalCostUSD             float64             `json:"totalCostUsd"`
	TotalCostCNY             float64             `json:"totalCostCny"`
	TotalBillableMicrounits  int64               `json:"totalBillableMicrounits"`
	Requests                 int                 `json:"requests"`
	FailedRequests           int                 `json:"failedRequests"`
	ByUser                   []UserUsageStats    `json:"byUser"`
	ByAPIKey                 []APIKeyUsageStats  `json:"byApiKey"`
	ByModel                  []ModelUsageStats   `json:"byModel"`
	ByDay                    []DayUsageStats     `json:"byDay"`
	ByHour                   []HourUsageStats    `json:"byHour"`
	Recent                   []models.RequestLog `json:"recent"`
	RecentRequests           []models.RequestLog `json:"recentRequests"`
}

type UserUsageStats struct {
	UserID              string  `json:"userId"`
	UserName            string  `json:"userName"`
	Username            string  `json:"username"`
	PromptTokens        int     `json:"promptTokens"`
	CompletionTokens    int     `json:"completionTokens"`
	TotalTokens         int     `json:"totalTokens"`
	CachedTokens        int     `json:"cachedTokens"`
	CacheCreationTokens int     `json:"cacheCreationTokens"`
	CacheMissTokens     int     `json:"cacheMissTokens"`
	ReasoningTokens     int     `json:"reasoningTokens"`
	CostUSD             float64 `json:"costUsd"`
	CostCNY             float64 `json:"costCny"`
	BillableMicrounits  int64   `json:"billableMicrounits"`
	Requests            int     `json:"requests"`
	FailedRequests      int     `json:"failedRequests"`
}

type APIKeyUsageStats struct {
	UserID              string  `json:"userId"`
	UserName            string  `json:"userName"`
	Username            string  `json:"username"`
	APIKeyID            string  `json:"apiKeyId"`
	APIKeyName          string  `json:"apiKeyName"`
	APIKeyPreview       string  `json:"apiKeyPreview"`
	PromptTokens        int     `json:"promptTokens"`
	CompletionTokens    int     `json:"completionTokens"`
	TotalTokens         int     `json:"totalTokens"`
	CachedTokens        int     `json:"cachedTokens"`
	CacheCreationTokens int     `json:"cacheCreationTokens"`
	CacheMissTokens     int     `json:"cacheMissTokens"`
	ReasoningTokens     int     `json:"reasoningTokens"`
	CostUSD             float64 `json:"costUsd"`
	CostCNY             float64 `json:"costCny"`
	BillableMicrounits  int64   `json:"billableMicrounits"`
	Requests            int     `json:"requests"`
	FailedRequests      int     `json:"failedRequests"`
}

type ModelUsageStats struct {
	Model               string  `json:"model"`
	PromptTokens        int     `json:"promptTokens"`
	CompletionTokens    int     `json:"completionTokens"`
	TotalTokens         int     `json:"totalTokens"`
	CachedTokens        int     `json:"cachedTokens"`
	CacheCreationTokens int     `json:"cacheCreationTokens"`
	CacheMissTokens     int     `json:"cacheMissTokens"`
	ReasoningTokens     int     `json:"reasoningTokens"`
	CostUSD             float64 `json:"costUsd"`
	CostCNY             float64 `json:"costCny"`
	BillableMicrounits  int64   `json:"billableMicrounits"`
	Requests            int     `json:"requests"`
	FailedRequests      int     `json:"failedRequests"`
}

type DayUsageStats struct {
	Day                 string  `json:"day"`
	PromptTokens        int     `json:"promptTokens"`
	CompletionTokens    int     `json:"completionTokens"`
	TotalTokens         int     `json:"totalTokens"`
	CachedTokens        int     `json:"cachedTokens"`
	CacheCreationTokens int     `json:"cacheCreationTokens"`
	CacheMissTokens     int     `json:"cacheMissTokens"`
	ReasoningTokens     int     `json:"reasoningTokens"`
	CostUSD             float64 `json:"costUsd"`
	CostCNY             float64 `json:"costCny"`
	BillableMicrounits  int64   `json:"billableMicrounits"`
	Requests            int     `json:"requests"`
	FailedRequests      int     `json:"failedRequests"`
}

type HourUsageStats struct {
	Hour               string  `json:"hour"`
	PromptTokens       int     `json:"promptTokens"`
	CompletionTokens   int     `json:"completionTokens"`
	TotalTokens        int     `json:"totalTokens"`
	CostCNY            float64 `json:"costCny"`
	BillableMicrounits int64   `json:"billableMicrounits"`
	Requests           int     `json:"requests"`
}

func GetUsageStats(db *models.Database, userID string, days int) *UsageStats {
	since := time.Now().AddDate(0, 0, -days)

	usersByID := make(map[string]*models.User)
	for i := range db.Users {
		usersByID[db.Users[i].ID] = &db.Users[i]
	}
	usersByID[models.AdminVirtualUserID] = &models.User{
		ID: models.AdminVirtualUserID, Name: "Administrator", Username: "admin",
	}

	records := store.RequestLogsSince(db, since, userID, 50000)

	sort.Slice(records, func(i, j int) bool {
		return records[i].Timestamp < records[j].Timestamp
	})

	stats := &UsageStats{}
	byUser := make(map[string]*UserUsageStats)
	byAPIKey := make(map[string]*APIKeyUsageStats)
	byModel := make(map[string]*ModelUsageStats)
	byDay := make(map[string]*DayUsageStats)
	byHour := make(map[string]*HourUsageStats)

	for _, item := range records {
		cost := costForItem(db, item)
		stats.Requests++
		stats.TotalPromptTokens += item.PromptTokens
		stats.TotalCompletionTokens += item.CompletionTokens
		stats.TotalTokens += item.TotalTokens
		stats.TotalCachedTokens += item.CachedTokens
		stats.TotalCacheCreationTokens += item.CacheCreationTokens
		stats.TotalCacheMissTokens += item.CacheMissTokens
		stats.TotalReasoningTokens += item.ReasoningTokens
		stats.TotalCostUSD += cost.CostUSD
		stats.TotalCostCNY += cost.CostCNY
		stats.TotalBillableMicrounits += cost.BillableMicrounits
		if !item.OK {
			stats.FailedRequests++
		}

		if _, ok := byUser[item.UserID]; !ok {
			owner := usersByID[item.UserID]
			name := ""
			username := ""
			if owner != nil {
				name = owner.Name
				username = owner.Username
			}
			byUser[item.UserID] = &UserUsageStats{
				UserID: item.UserID, UserName: name, Username: username,
			}
		}
		uu := byUser[item.UserID]
		uu.PromptTokens += item.PromptTokens
		uu.CompletionTokens += item.CompletionTokens
		uu.TotalTokens += item.TotalTokens
		uu.CachedTokens += item.CachedTokens
		uu.CacheCreationTokens += item.CacheCreationTokens
		uu.CacheMissTokens += item.CacheMissTokens
		uu.ReasoningTokens += item.ReasoningTokens
		uu.CostUSD += cost.CostUSD
		uu.CostCNY += cost.CostCNY
		uu.BillableMicrounits += cost.BillableMicrounits
		uu.Requests++
		if !item.OK {
			uu.FailedRequests++
		}

		keyKey := item.UserID + ":" + item.APIKeyID
		if _, ok := byAPIKey[keyKey]; !ok {
			byAPIKey[keyKey] = &APIKeyUsageStats{
				UserID: item.UserID, UserName: item.UserName, Username: item.Username,
				APIKeyID: item.APIKeyID, APIKeyName: item.APIKeyName, APIKeyPreview: item.APIKeyPreview,
			}
		}
		ak := byAPIKey[keyKey]
		ak.PromptTokens += item.PromptTokens
		ak.CompletionTokens += item.CompletionTokens
		ak.TotalTokens += item.TotalTokens
		ak.CachedTokens += item.CachedTokens
		ak.CacheCreationTokens += item.CacheCreationTokens
		ak.CacheMissTokens += item.CacheMissTokens
		ak.ReasoningTokens += item.ReasoningTokens
		ak.CostUSD += cost.CostUSD
		ak.CostCNY += cost.CostCNY
		ak.BillableMicrounits += cost.BillableMicrounits
		ak.Requests++
		if !item.OK {
			ak.FailedRequests++
		}

		modelKey := item.Model
		if modelKey == "" {
			modelKey = "unknown"
		}
		if _, ok := byModel[modelKey]; !ok {
			byModel[modelKey] = &ModelUsageStats{Model: modelKey}
		}
		bm := byModel[modelKey]
		bm.PromptTokens += item.PromptTokens
		bm.CompletionTokens += item.CompletionTokens
		bm.TotalTokens += item.TotalTokens
		bm.CachedTokens += item.CachedTokens
		bm.CacheCreationTokens += item.CacheCreationTokens
		bm.CacheMissTokens += item.CacheMissTokens
		bm.ReasoningTokens += item.ReasoningTokens
		bm.CostUSD += cost.CostUSD
		bm.CostCNY += cost.CostCNY
		bm.BillableMicrounits += cost.BillableMicrounits
		bm.Requests++
		if !item.OK {
			bm.FailedRequests++
		}

		day := ""
		if len(item.Timestamp) >= 10 {
			day = item.Timestamp[:10]
		}
		if _, ok := byDay[day]; !ok {
			byDay[day] = &DayUsageStats{Day: day}
		}
		bd := byDay[day]
		bd.PromptTokens += item.PromptTokens
		bd.CompletionTokens += item.CompletionTokens
		bd.TotalTokens += item.TotalTokens
		bd.CachedTokens += item.CachedTokens
		bd.CacheCreationTokens += item.CacheCreationTokens
		bd.CacheMissTokens += item.CacheMissTokens
		bd.ReasoningTokens += item.ReasoningTokens
		bd.CostUSD += cost.CostUSD
		bd.CostCNY += cost.CostCNY
		bd.BillableMicrounits += cost.BillableMicrounits
		bd.Requests++
		if !item.OK {
			bd.FailedRequests++
		}

		hourSince := time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339)
		if item.Timestamp >= hourSince && len(item.Timestamp) >= 13 {
			hour := item.Timestamp[:13] + ":00"
			if _, ok := byHour[hour]; !ok {
				byHour[hour] = &HourUsageStats{Hour: hour}
			}
			bh := byHour[hour]
			bh.PromptTokens += item.PromptTokens
			bh.CompletionTokens += item.CompletionTokens
			bh.TotalTokens += item.TotalTokens
			bh.CostCNY += cost.CostCNY
			bh.BillableMicrounits += cost.BillableMicrounits
			bh.Requests++
		}
	}

	for _, v := range byUser {
		stats.ByUser = append(stats.ByUser, *v)
	}
	sort.Slice(stats.ByUser, func(i, j int) bool {
		return stats.ByUser[i].TotalTokens > stats.ByUser[j].TotalTokens
	})

	for _, v := range byAPIKey {
		stats.ByAPIKey = append(stats.ByAPIKey, *v)
	}
	sort.Slice(stats.ByAPIKey, func(i, j int) bool {
		return stats.ByAPIKey[i].TotalTokens > stats.ByAPIKey[j].TotalTokens
	})

	for _, v := range byModel {
		stats.ByModel = append(stats.ByModel, *v)
	}
	sort.Slice(stats.ByModel, func(i, j int) bool {
		return stats.ByModel[i].TotalTokens > stats.ByModel[j].TotalTokens
	})

	for _, v := range byDay {
		stats.ByDay = append(stats.ByDay, *v)
	}
	sort.Slice(stats.ByDay, func(i, j int) bool {
		return stats.ByDay[i].Day < stats.ByDay[j].Day
	})

	for _, v := range byHour {
		stats.ByHour = append(stats.ByHour, *v)
	}
	sort.Slice(stats.ByHour, func(i, j int) bool {
		return stats.ByHour[i].Hour < stats.ByHour[j].Hour
	})

	recentStart := max(0, len(records)-100)
	recent := records[recentStart:]
	for i := len(recent)/2 - 1; i >= 0; i-- {
		opp := len(recent) - 1 - i
		recent[i], recent[opp] = recent[opp], recent[i]
	}
	stats.Recent = recent
	stats.RecentRequests = recent

	return stats
}

func costForItem(db *models.Database, item models.RequestLog) billing.CostBreakdown {
	if item.BillableMicrounits > 0 || item.CostUSD > 0 || item.CostCNY > 0 {
		return billing.CostBreakdown{
			CostUSD:            item.CostUSD,
			CostCNY:            item.CostCNY,
			BillableMicrounits: item.BillableMicrounits,
		}
	}
	return billing.CalculateRequestCost(db, item)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

type numeric interface{ int | float64 }

func maxOf[T numeric](a, b T) T {
	if a > b {
		return a
	}
	return b
}
