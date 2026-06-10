package handlers

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sapi/models"
	"sapi/proxy"
	"sapi/store"
)

func TestModelsHealthRouteReturnsTTLMetadata(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	resetModelAvailabilityCacheForTest()
	store.MutateDB(func(db *models.Database) interface{} {
		db.Providers = []models.Provider{{
			ID:             "prv_fast",
			Name:           "Fast Upstream",
			Models:         []models.Model{{ID: "chat-fast", Name: "Chat Fast", CliSupport: []string{"codex"}}},
			ModelMappings:  map[string]string{},
			Enabled:        true,
			HealthStatus:   "healthy",
			Latency:        120,
			Ping:           90,
			Availability7d: 99.9,
			HealthHistory: []models.HealthHistoryEntry{{
				Timestamp: "2026-06-05T00:00:00.000Z",
				Status:    "ok",
				Latency:   120,
			}},
			LastHealthCheck: "2026-06-05T00:00:00.000Z",
		}}
		return nil
	})

	mux := http.NewServeMux()
	MountPublicRoutes(mux)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health/models", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("models health returned %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=300" {
		t.Fatalf("Cache-Control = %q, want public max-age", got)
	}
	body := rec.Body.String()
	for _, want := range []string{`"ttlSeconds":300`, `"id":"fast-upstream/chat-fast"`, `"healthStatus":"healthy"`, `"cachedAt"`, `"expiresAt"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %s: %s", want, body)
		}
	}
}

func TestBuildModelAvailabilityPrefixesProviders(t *testing.T) {
	now := time.Date(2026, 6, 5, 1, 2, 3, 0, time.UTC)
	db := &models.Database{
		Providers: []models.Provider{
			{
				ID:              "prv_ok",
				Name:            "Healthy",
				Models:          []models.Model{{ID: "chat-main", Name: "Chat Main", CliSupport: []string{"codex"}}},
				Enabled:         true,
				HealthStatus:    "healthy",
				Latency:         100,
				Ping:            80,
				Availability7d:  99,
				LastHealthCheck: "2026-06-05T00:00:00.000Z",
			},
			{
				ID:                "prv_down",
				Name:              "Down",
				Models:            []models.Model{{ID: "chat-main", Name: "Chat Main", CliSupport: []string{"cursor"}}},
				Enabled:           true,
				HealthStatus:      "down",
				Latency:           900,
				Ping:              900,
				Availability7d:    70,
				LastHealthCheck:   "2026-06-05T00:01:00.000Z",
				FailoverThreshold: 1,
			},
		},
	}

	payload := buildModelAvailabilityPayload(db, now)
	items, ok := payload["models"].([]modelAvailabilityItem)
	if !ok || len(items) != 2 {
		t.Fatalf("models payload = %#v", payload["models"])
	}

	byID := map[string]modelAvailabilityItem{}
	for _, item := range items {
		byID[item.ID] = item
	}
	healthy := byID["healthy/chat-main"]
	if healthy.HealthStatus != "healthy" || healthy.Providers != 1 || healthy.AvailableProviders != 1 || healthy.HealthyProviders != 1 {
		t.Fatalf("healthy item = %#v", healthy)
	}
	if healthy.Latency != 100 || healthy.Ping != 80 || healthy.Availability7d != 99 {
		t.Fatalf("healthy metrics = latency:%d ping:%d availability:%f", healthy.Latency, healthy.Ping, healthy.Availability7d)
	}
	degraded := byID["down/chat-main"]
	if degraded.HealthStatus != "degraded" || degraded.Providers != 1 || degraded.AvailableProviders != 1 {
		t.Fatalf("degraded item = %#v", degraded)
	}
	if payload["ttlSeconds"] != 300 {
		t.Fatalf("ttlSeconds = %#v, want 300", payload["ttlSeconds"])
	}
}

func TestAvailableModelsKeepsRoutableProviderWhenHealthProbeIsDown(t *testing.T) {
	db := &models.Database{
		ShowOnlyAvailableModels: true,
		Providers: []models.Provider{{
			ID:                "prv_probe_down_visible",
			Name:              "Probe Down Visible",
			Models:            []models.Model{{ID: "chat-live", Name: "Chat Live"}},
			ModelMappings:     map[string]string{"public-live": "chat-live"},
			Enabled:           true,
			HealthStatus:      "down",
			FailoverThreshold: 3,
		}},
	}

	modelsList := availableModelsForKey(db, nil, nil)
	ids := map[string]bool{}
	for _, model := range modelsList {
		ids[model.ID] = true
	}

	for _, want := range []string{"probe-down-visible/chat-live", "probe-down-visible/public-live"} {
		if !ids[want] {
			t.Fatalf("models = %#v, missing %q", modelsList, want)
		}
	}
}

func TestAvailableModelsHidesProviderAfterFailoverExcludesIt(t *testing.T) {
	providerID := "prv_failover_excluded_models_test"
	proxy.RecordProviderFailure(providerID)

	db := &models.Database{
		ShowOnlyAvailableModels: true,
		Providers: []models.Provider{{
			ID:                providerID,
			Name:              "Failover Excluded",
			Models:            []models.Model{{ID: "chat-hidden", Name: "Chat Hidden"}},
			ModelMappings:     map[string]string{},
			Enabled:           true,
			HealthStatus:      "healthy",
			FailoverThreshold: 1,
		}},
	}

	if modelsList := availableModelsForKey(db, nil, nil); len(modelsList) != 0 {
		t.Fatalf("models = %#v, want hidden after failover exclusion", modelsList)
	}
}

func resetModelAvailabilityCacheForTest() {
	modelAvailabilityCache.Lock()
	defer modelAvailabilityCache.Unlock()
	modelAvailabilityCache.entry = modelAvailabilityCacheEntry{}
}
