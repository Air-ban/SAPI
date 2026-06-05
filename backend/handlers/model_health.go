package handlers

import (
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"time"

	"sapi/models"
	"sapi/proxy"
	"sapi/store"
)

const modelAvailabilityTTL = 5 * time.Minute

type modelAvailabilityCacheEntry struct {
	CreatedAt time.Time
	Payload   map[string]interface{}
}

var modelAvailabilityCache = struct {
	sync.RWMutex
	entry modelAvailabilityCacheEntry
}{}

type modelAvailabilityItem struct {
	ID                       string                      `json:"id"`
	Name                     string                      `json:"name"`
	Description              string                      `json:"description"`
	CliSupport               []string                    `json:"cliSupport"`
	HealthStatus             string                      `json:"healthStatus"`
	Availability7d           float64                     `json:"availability7d"`
	Latency                  int                         `json:"latency"`
	Ping                     int                         `json:"ping"`
	Providers                int                         `json:"providers"`
	HealthyProviders         int                         `json:"healthyProviders"`
	DegradedProviders        int                         `json:"degradedProviders"`
	AvailableProviders       int                         `json:"availableProviders"`
	FailoverReadyProviders   int                         `json:"failoverReadyProviders"`
	LastHealthCheck          string                      `json:"lastHealthCheck"`
	HealthHistory            []models.HealthHistoryEntry `json:"healthHistory"`
	ProviderNames            []string                    `json:"providerNames"`
	AvailableProviderNames   []string                    `json:"availableProviderNames"`
	DegradedProviderNames    []string                    `json:"degradedProviderNames"`
	UnavailableProviderNames []string                    `json:"unavailableProviderNames"`
}

func handleModelsHealth(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	payload := getModelAvailabilityPayload(now)
	w.Header().Set("Cache-Control", "public, max-age=300")
	json.NewEncoder(w).Encode(payload)
}

func getModelAvailabilityPayload(now time.Time) map[string]interface{} {
	modelAvailabilityCache.RLock()
	entry := modelAvailabilityCache.entry
	if entry.Payload != nil && now.Sub(entry.CreatedAt) < modelAvailabilityTTL {
		payload := entry.Payload
		modelAvailabilityCache.RUnlock()
		return payload
	}
	modelAvailabilityCache.RUnlock()

	modelAvailabilityCache.Lock()
	defer modelAvailabilityCache.Unlock()

	entry = modelAvailabilityCache.entry
	if entry.Payload != nil && now.Sub(entry.CreatedAt) < modelAvailabilityTTL {
		return entry.Payload
	}

	payload := buildModelAvailabilityPayload(store.ReadDB(), now)
	modelAvailabilityCache.entry = modelAvailabilityCacheEntry{
		CreatedAt: now,
		Payload:   payload,
	}
	return payload
}

func buildModelAvailabilityPayload(db *models.Database, now time.Time) map[string]interface{} {
	modelMap := map[string]*modelAvailabilityItem{}

	for _, provider := range db.Providers {
		if !provider.Enabled {
			continue
		}
		addProviderModelsToAvailability(modelMap, provider)
	}

	modelsList := make([]modelAvailabilityItem, 0, len(modelMap))
	for _, item := range modelMap {
		finalizeModelAvailability(item)
		modelsList = append(modelsList, *item)
	}
	sort.Slice(modelsList, func(i, j int) bool {
		return modelsList[i].ID < modelsList[j].ID
	})

	cachedAt := now.UTC()
	expiresAt := cachedAt.Add(modelAvailabilityTTL)
	return map[string]interface{}{
		"ttlSeconds": int(modelAvailabilityTTL.Seconds()),
		"cachedAt":   cachedAt.Format(time.RFC3339),
		"expiresAt":  expiresAt.Format(time.RFC3339),
		"models":     modelsList,
	}
}

func addProviderModelsToAvailability(modelMap map[string]*modelAvailabilityItem, provider models.Provider) {
	seen := map[string]bool{}
	for _, model := range provider.Models {
		if model.ID == "" {
			continue
		}
		item := ensureModelAvailabilityItem(modelMap, model.ID, model.Name, model.Description, model.CliSupport)
		addProviderAvailability(item, provider)
		seen[model.ID] = true
	}

	for customID, upstreamID := range provider.ModelMappings {
		if customID == "" || seen[customID] {
			continue
		}
		name := customID
		description := ""
		cliSupport := []string{}
		for _, model := range provider.Models {
			if model.ID == upstreamID {
				if model.Name != "" {
					name = model.Name
				}
				description = model.Description
				cliSupport = model.CliSupport
				break
			}
		}
		item := ensureModelAvailabilityItem(modelMap, customID, name, description, cliSupport)
		addProviderAvailability(item, provider)
	}
}

func ensureModelAvailabilityItem(modelMap map[string]*modelAvailabilityItem, id, name, description string, cliSupport []string) *modelAvailabilityItem {
	item, ok := modelMap[id]
	if !ok {
		if name == "" {
			name = id
		}
		item = &modelAvailabilityItem{
			ID:             id,
			Name:           name,
			Description:    description,
			CliSupport:     normalizedStringSet(cliSupport),
			HealthStatus:   "down",
			Availability7d: 100,
		}
		modelMap[id] = item
		return item
	}
	if item.Name == "" && name != "" {
		item.Name = name
	}
	if item.Description == "" && description != "" {
		item.Description = description
	}
	item.CliSupport = mergeStringSet(item.CliSupport, cliSupport)
	return item
}

func addProviderAvailability(item *modelAvailabilityItem, provider models.Provider) {
	item.Providers++
	item.ProviderNames = appendUniqueString(item.ProviderNames, provider.Name)

	status := provider.HealthStatus
	if status == "" || status == "unknown" {
		status = "down"
	}
	failoverReady := proxy.IsProviderAvailableForFailover(provider)
	if failoverReady {
		item.FailoverReadyProviders++
	}

	if status == "healthy" && failoverReady {
		item.HealthyProviders++
		item.AvailableProviders++
		item.AvailableProviderNames = appendUniqueString(item.AvailableProviderNames, provider.Name)
	} else if status == "degraded" && failoverReady {
		item.DegradedProviders++
		item.AvailableProviders++
		item.DegradedProviderNames = appendUniqueString(item.DegradedProviderNames, provider.Name)
	} else {
		item.UnavailableProviderNames = appendUniqueString(item.UnavailableProviderNames, provider.Name)
	}

	if provider.LastHealthCheck > item.LastHealthCheck {
		item.LastHealthCheck = provider.LastHealthCheck
	}
	if provider.Latency > 0 && (item.Latency == 0 || provider.Latency < item.Latency) {
		item.Latency = provider.Latency
	}
	if provider.Ping > 0 && (item.Ping == 0 || provider.Ping < item.Ping) {
		item.Ping = provider.Ping
	}
	if provider.Availability7d > item.Availability7d || item.Providers == 1 {
		item.Availability7d = provider.Availability7d
	}

	history := provider.HealthHistory
	if len(history) > 30 {
		history = history[len(history)-30:]
	}
	item.HealthHistory = mergeHealthHistory(item.HealthHistory, history)
}

func finalizeModelAvailability(item *modelAvailabilityItem) {
	sort.Strings(item.CliSupport)
	sort.Strings(item.ProviderNames)
	sort.Strings(item.AvailableProviderNames)
	sort.Strings(item.DegradedProviderNames)
	sort.Strings(item.UnavailableProviderNames)

	if len(item.HealthHistory) > 30 {
		item.HealthHistory = item.HealthHistory[len(item.HealthHistory)-30:]
	}

	if item.FailoverReadyProviders == 0 || item.AvailableProviders == 0 {
		item.HealthStatus = "down"
		return
	}
	if item.HealthyProviders > 0 && item.AvailableProviders == item.Providers && item.FailoverReadyProviders == item.Providers {
		item.HealthStatus = "healthy"
		return
	}
	item.HealthStatus = "degraded"
}

func mergeHealthHistory(existing, next []models.HealthHistoryEntry) []models.HealthHistoryEntry {
	merged := append(existing, next...)
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].Timestamp < merged[j].Timestamp
	})
	if len(merged) > 30 {
		merged = merged[len(merged)-30:]
	}
	return merged
}

func normalizedStringSet(values []string) []string {
	result := []string{}
	for _, value := range values {
		result = appendUniqueString(result, value)
	}
	return result
}

func mergeStringSet(left, right []string) []string {
	result := normalizedStringSet(left)
	for _, value := range right {
		result = appendUniqueString(result, value)
	}
	return result
}

func appendUniqueString(values []string, value string) []string {
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
