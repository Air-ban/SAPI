package handlers

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sapi/models"
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
	for _, want := range []string{`"ttlSeconds":300`, `"id":"chat-fast"`, `"healthStatus":"healthy"`, `"cachedAt"`, `"expiresAt"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %s: %s", want, body)
		}
	}
}

func TestBuildModelAvailabilityAggregatesProviders(t *testing.T) {
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
	if !ok || len(items) != 1 {
		t.Fatalf("models payload = %#v", payload["models"])
	}

	item := items[0]
	if item.HealthStatus != "degraded" {
		t.Fatalf("healthStatus = %q, want degraded", item.HealthStatus)
	}
	if item.Providers != 2 || item.AvailableProviders != 1 || item.HealthyProviders != 1 {
		t.Fatalf("provider counts = providers:%d available:%d healthy:%d", item.Providers, item.AvailableProviders, item.HealthyProviders)
	}
	if item.Latency != 100 || item.Ping != 80 || item.Availability7d != 99 {
		t.Fatalf("metrics = latency:%d ping:%d availability:%f", item.Latency, item.Ping, item.Availability7d)
	}
	if payload["ttlSeconds"] != 300 {
		t.Fatalf("ttlSeconds = %#v, want 300", payload["ttlSeconds"])
	}
}

func resetModelAvailabilityCacheForTest() {
	modelAvailabilityCache.Lock()
	defer modelAvailabilityCache.Unlock()
	modelAvailabilityCache.entry = modelAvailabilityCacheEntry{}
}
