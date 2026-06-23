package proxy

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"sapi/models"
	"sapi/store"
	"sapi/utils"
)

var providerFailureCounters sync.Map

type failureCounter struct {
	ConsecutiveFailures int
	LastFailureAt       string
}

func GetProviderFailureCounter(providerID string) *failureCounter {
	c, ok := providerFailureCounters.Load(providerID)
	if !ok {
		return &failureCounter{}
	}
	return c.(*failureCounter)
}

func RecordProviderSuccess(providerID string) {
	c, ok := providerFailureCounters.Load(providerID)
	if ok && c.(*failureCounter).ConsecutiveFailures > 0 {
		c.(*failureCounter).ConsecutiveFailures = 0
		c.(*failureCounter).LastFailureAt = ""
	}
}

func RecordProviderFailure(providerID string) {
	c, loaded := providerFailureCounters.Load(providerID)
	if loaded {
		fc := c.(*failureCounter)
		fc.ConsecutiveFailures++
		fc.LastFailureAt = time.Now().UTC().Format(time.RFC3339)
	} else {
		providerFailureCounters.Store(providerID, &failureCounter{
			ConsecutiveFailures: 1,
			LastFailureAt:       time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func IsUpstreamProviderError(status int) bool {
	return status >= 500 || status == 429
}

func IsProviderAvailableForFailover(provider models.Provider) bool {
	threshold := provider.FailoverThreshold
	if threshold <= 0 {
		return true
	}
	counter := GetProviderFailureCounter(provider.ID)
	return counter.ConsecutiveFailures < threshold
}

type ProviderCandidate struct {
	Provider      models.Provider
	UpstreamModel string
}

func GetModelProviderMapping(provider models.Provider, modelID string) *ProviderCandidate {
	if modelID == "" {
		return nil
	}
	modelID = strings.TrimSpace(modelID)
	for _, m := range provider.Models {
		if m.ID == modelID {
			return &ProviderCandidate{provider, modelID}
		}
	}
	if upstreamID, ok := provider.ModelMappings[modelID]; ok {
		return &ProviderCandidate{provider, upstreamID}
	}
	return nil
}

func SortProvidersByPriority(providers []models.Provider) []models.Provider {
	sorted := make([]models.Provider, len(providers))
	copy(sorted, providers)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Priority > sorted[i].Priority ||
				(sorted[j].Priority == sorted[i].Priority && sorted[j].CreatedAt > sorted[i].CreatedAt) {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	return sorted
}

func ChooseProviderCandidates(db *models.Database, body map[string]interface{}) []ProviderCandidate {
	model := ""
	if body != nil {
		if m, ok := body["model"].(string); ok {
			model = strings.TrimSpace(m)
		}
	}

	var enabled []models.Provider
	for _, p := range db.Providers {
		if p.Enabled && IsProviderAvailableForFailover(p) {
			enabled = append(enabled, p)
		}
	}
	enabled = SortProvidersByPriority(enabled)

	if len(enabled) == 0 {
		return nil
	}

	if model != "" {
		if matched := exactProviderModelMappings(enabled, model); len(matched) > 0 {
			return matched
		}
		var channelMatched bool
		enabled, model, channelMatched = selectRequestedModelChannel(db, enabled, model)
		if channelMatched && len(enabled) == 0 {
			return nil
		}
		var matched []ProviderCandidate
		for _, p := range enabled {
			mapping := GetModelProviderMapping(p, model)
			if mapping != nil {
				matched = append(matched, *mapping)
			}
		}
		return matched
	}

	return []ProviderCandidate{{Provider: enabled[0], UpstreamModel: ""}}
}

func ChooseProviderCandidatesForTier(db *models.Database, body map[string]interface{}, tier string) []ProviderCandidate {
	candidates := ChooseProviderCandidates(db, body)
	model := ""
	if body != nil {
		if m, ok := body["model"].(string); ok {
			model = strings.TrimSpace(m)
		}
	}
	return filterCandidatesBySubscriptionRoute(db, candidates, model, tier)
}

func ChooseAnthropicProviderCandidates(db *models.Database, model string) []ProviderCandidate {
	model = strings.TrimSpace(model)
	var enabled []models.Provider
	for _, p := range db.Providers {
		if p.Enabled && IsProviderAvailableForFailover(p) {
			enabled = append(enabled, p)
		}
	}
	enabled = SortProvidersByPriority(enabled)

	if len(enabled) == 0 {
		return nil
	}

	if model != "" {
		if matched := exactProviderModelMappings(enabled, model); len(matched) > 0 {
			return matched
		}
		var channelMatched bool
		enabled, model, channelMatched = selectRequestedModelChannel(db, enabled, model)
		if channelMatched && len(enabled) == 0 {
			return nil
		}
		var matched []ProviderCandidate
		for _, p := range enabled {
			mapping := GetModelProviderMapping(p, model)
			if mapping != nil {
				matched = append(matched, *mapping)
			}
		}
		if len(matched) > 0 {
			return matched
		}
		if channelMatched {
			return nil
		}
	}

	first := enabled[0]
	firstModel := ""
	if len(first.Models) > 0 {
		firstModel = first.Models[0].ID
	}
	mappedFirst := ""
	for _, v := range first.ModelMappings {
		mappedFirst = v
		break
	}
	if mappedFirst != "" {
		return []ProviderCandidate{{Provider: first, UpstreamModel: mappedFirst}}
	}
	if firstModel != "" {
		return []ProviderCandidate{{Provider: first, UpstreamModel: firstModel}}
	}
	return []ProviderCandidate{{Provider: first, UpstreamModel: model}}
}

func ChooseAnthropicProviderCandidatesForTier(db *models.Database, model string, tier string) []ProviderCandidate {
	return filterCandidatesBySubscriptionRoute(db, ChooseAnthropicProviderCandidates(db, model), model, tier)
}

func filterCandidatesBySubscriptionRoute(db *models.Database, candidates []ProviderCandidate, model string, tier string) []ProviderCandidate {
	model = strings.TrimSpace(model)
	if db == nil || model == "" || len(candidates) == 0 {
		return candidates
	}
	plan, ok := subscriptionPlanByID(db, tier)
	if !ok || len(plan.ModelProviderRoutes) == 0 {
		return candidates
	}
	providerID := routedProviderForModel(plan, model, candidates)
	if providerID == "" {
		return candidates
	}
	filtered := make([]ProviderCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if providerMatchesRoute(candidate.Provider, providerID) {
			filtered = append(filtered, candidate)
		}
	}
	return filtered
}

func subscriptionPlanByID(db *models.Database, tier string) (models.SubscriptionPlan, bool) {
	tier = strings.TrimSpace(tier)
	if tier == "" {
		return models.SubscriptionPlan{}, false
	}
	for _, plan := range db.SubscriptionPlans {
		if strings.EqualFold(strings.TrimSpace(plan.ID), tier) {
			return plan, true
		}
	}
	return models.SubscriptionPlan{}, false
}

func routedProviderForModel(plan models.SubscriptionPlan, model string, candidates []ProviderCandidate) string {
	for routeModel, providerID := range plan.ModelProviderRoutes {
		routeModel = strings.TrimSpace(routeModel)
		providerID = strings.TrimSpace(providerID)
		if routeModel == "" || providerID == "" {
			continue
		}
		if modelRouteMatches(routeModel, model) {
			return providerID
		}
		for _, candidate := range candidates {
			if modelRouteMatches(routeModel, candidate.UpstreamModel) {
				return providerID
			}
		}
	}
	return ""
}

func modelRouteMatches(routeModel, requestedModel string) bool {
	routeModel = strings.TrimSpace(routeModel)
	requestedModel = strings.TrimSpace(requestedModel)
	if routeModel == "" || requestedModel == "" {
		return false
	}
	return strings.EqualFold(routeModel, requestedModel) || IsModelAllowedByRule(routeModel, requestedModel)
}

func providerMatchesRoute(provider models.Provider, providerID string) bool {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(provider.ID), providerID) ||
		strings.EqualFold(strings.TrimSpace(provider.Name), providerID) ||
		ModelChannelMatchesProvider(provider, providerID)
}

func exactProviderModelMappings(providers []models.Provider, model string) []ProviderCandidate {
	model = strings.TrimSpace(model)
	if model == "" {
		return nil
	}
	matched := make([]ProviderCandidate, 0)
	for _, p := range providers {
		if mapping := GetModelProviderMapping(p, model); mapping != nil {
			matched = append(matched, *mapping)
		}
	}
	return matched
}

func selectRequestedModelChannel(db *models.Database, enabled []models.Provider, model string) ([]models.Provider, string, bool) {
	channelID, innerID, ok := SplitPrefixedModelID(model)
	if !ok {
		return enabled, model, false
	}

	matchesKnownProvider := false
	for _, p := range db.Providers {
		if ModelChannelMatchesProvider(p, channelID) {
			matchesKnownProvider = true
			break
		}
	}
	if !matchesKnownProvider {
		return enabled, model, false
	}

	filtered := make([]models.Provider, 0, 1)
	for _, p := range enabled {
		if ModelChannelMatchesProvider(p, channelID) {
			filtered = append(filtered, p)
			break
		}
	}
	return filtered, innerID, true
}

func ComputeAvailability(history []models.HealthHistoryEntry) float64 {
	since := time.Now().Add(-7 * 24 * time.Hour).UTC().Format(time.RFC3339)
	var recent []models.HealthHistoryEntry
	for _, h := range history {
		if h.Timestamp >= since {
			recent = append(recent, h)
		}
	}
	if len(recent) == 0 {
		return 100
	}
	okCount := 0
	for _, h := range recent {
		if h.Status == "ok" {
			okCount++
		}
	}
	return float64(okCount*10000/len(recent)) / 100
}

func RunHealthChecks() {
	db := store.ReadDB()
	for _, p := range db.Providers {
		if p.Enabled {
			go checkProviderHealth(p)
		}
	}
}

func checkProviderHealth(provider models.Provider) {
	url := utils.BuildUpstreamURL(provider.BaseURL, "/v1/models")
	startedAt := time.Now()
	status := "fail"
	var latency int

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		latency = int(time.Since(startedAt).Milliseconds())
	} else {
		req.Header.Set("Authorization", "Bearer "+provider.APIKey)
		req.Header.Set("Accept", "application/json")
		if userAgent := models.NormalizeProviderUserAgent(provider.UserAgent); userAgent != "" {
			req.Header.Set("User-Agent", userAgent)
		}
		resp, err := DoUpstream(req)
		if err != nil {
			latency = int(time.Since(startedAt).Milliseconds())
		} else {
			latency = int(time.Since(startedAt).Milliseconds())
			if resp.StatusCode < 400 {
				if latency > 5000 {
					status = "slow"
				} else {
					status = "ok"
				}
				RecordProviderSuccess(provider.ID)
			}
			resp.Body.Close()
		}
	}

	healthStatus := "down"
	if status == "ok" {
		healthStatus = "healthy"
	} else if status == "slow" {
		healthStatus = "degraded"
	}

	entry := models.HealthHistoryEntry{
		Timestamp: store.Now(),
		Status:    status,
		Latency:   latency,
	}

	store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Providers {
			if db.Providers[i].ID == provider.ID {
				p := &db.Providers[i]
				p.HealthStatus = healthStatus
				p.Latency = latency
				p.Ping = latency
				p.LastHealthCheck = entry.Timestamp
				p.HealthHistory = append(p.HealthHistory, entry)
				if len(p.HealthHistory) > 120 {
					p.HealthHistory = p.HealthHistory[len(p.HealthHistory)-120:]
				}
				p.Availability7d = ComputeAvailability(p.HealthHistory)
				p.UpdatedAt = store.Now()
				break
			}
		}
		return nil
	})
}
