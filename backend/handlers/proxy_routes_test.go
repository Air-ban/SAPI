package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
)

func TestProxyRoutesMatchSupportedEndpointVariants(t *testing.T) {
	mux := http.NewServeMux()
	MountProxyRoutes(mux)

	tests := []struct {
		name   string
		method string
		path   string
		status int
	}{
		{name: "root chat completions", method: http.MethodPost, path: "/chat/completions", status: http.StatusUnauthorized},
		{name: "v1 chat completions", method: http.MethodPost, path: "/v1/chat/completions", status: http.StatusUnauthorized},
		{name: "root responses", method: http.MethodPost, path: "/responses", status: http.StatusUnauthorized},
		{name: "v1 responses", method: http.MethodPost, path: "/v1/responses", status: http.StatusUnauthorized},
		{name: "root messages", method: http.MethodPost, path: "/messages", status: http.StatusUnauthorized},
		{name: "v1 messages", method: http.MethodPost, path: "/v1/messages", status: http.StatusUnauthorized},
		{name: "root count tokens", method: http.MethodPost, path: "/messages/count_tokens", status: http.StatusUnauthorized},
		{name: "v1 count tokens", method: http.MethodPost, path: "/v1/messages/count_tokens", status: http.StatusUnauthorized},
		{name: "generic v1 post", method: http.MethodPost, path: "/v1/embeddings", status: http.StatusUnauthorized},
		{name: "unsupported v1 get", method: http.MethodGet, path: "/v1/embeddings", status: http.StatusMethodNotAllowed},
		{name: "unsupported responses get", method: http.MethodGet, path: "/responses", status: http.StatusMethodNotAllowed},
		{name: "unsupported messages get", method: http.MethodGet, path: "/v1/messages", status: http.StatusMethodNotAllowed},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(`{"model":"test"}`))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()

			mux.ServeHTTP(rec, req)

			if rec.Code != tt.status {
				t.Fatalf("%s %s returned %d, want %d", tt.method, tt.path, rec.Code, tt.status)
			}
		})
	}
}

func TestResponsesProxyUsesForcedGeminiFormat(t *testing.T) {
	var mu sync.Mutex
	var gotPath string
	var gotBody map[string]interface{}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		mu.Unlock()

		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"candidates": []map[string]interface{}{{
				"content": map[string]interface{}{
					"parts": []map[string]interface{}{{"text": "gemini ok"}},
				},
				"finishReason": "STOP",
			}},
			"usageMetadata": map[string]interface{}{
				"promptTokenCount":     1,
				"candidatesTokenCount": 1,
				"totalTokenCount":      2,
			},
		})
	}))
	defer upstream.Close()

	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_gemini",
		Name:           "Generic Gemini Gateway",
		BaseURL:        upstream.URL,
		APIKey:         "google-key",
		UpstreamFormat: models.UpstreamFormatGemini,
		Models:         []models.Model{},
		ModelMappings:  map[string]string{"public-gemini": "gemini-real"},
		Enabled:        true,
		HealthStatus:   "unknown",
		Availability7d: 100,
		CreatedAt:      store.Now(),
		UpdatedAt:      store.Now(),
	})

	rec := postJSON(t, app, "/responses", map[string]interface{}{
		"model":  "public-gemini",
		"input":  "hello",
		"stream": false,
	}, apiKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("/responses returned %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "gemini ok") {
		t.Fatalf("expected converted Gemini response, got %s", rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if gotPath != "/v1beta/models/gemini-real:generateContent" {
		t.Fatalf("upstream path = %q, want Gemini generateContent path", gotPath)
	}
	if _, ok := gotBody["contents"].([]interface{}); !ok {
		t.Fatalf("expected Gemini contents body, got %#v", gotBody)
	}
	if _, ok := gotBody["messages"]; ok {
		t.Fatalf("did not expect OpenAI messages in forced Gemini body: %#v", gotBody)
	}
}

func TestAnthropicMessagesProxyUsesForcedNativeAnthropicFormat(t *testing.T) {
	var mu sync.Mutex
	var gotPath string
	var gotBody map[string]interface{}
	var gotAPIKey string
	var gotAuth string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("x-api-key")
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		mu.Unlock()

		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":            "msg_test",
			"type":          "message",
			"role":          "assistant",
			"content":       []map[string]interface{}{{"type": "text", "text": "anthropic ok"}},
			"model":         "claude-real",
			"stop_reason":   "end_turn",
			"stop_sequence": nil,
			"usage": map[string]interface{}{
				"input_tokens":  1,
				"output_tokens": 1,
			},
		})
	}))
	defer upstream.Close()

	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_anthropic",
		Name:           "Generic Anthropic Gateway",
		BaseURL:        upstream.URL,
		APIKey:         "sk-ant",
		UpstreamFormat: models.UpstreamFormatAnthropic,
		ModelMappings:  map[string]string{"public-claude": "claude-real"},
		Enabled:        true,
		HealthStatus:   "unknown",
		Availability7d: 100,
		CreatedAt:      store.Now(),
		UpdatedAt:      store.Now(),
	})

	rec := postJSON(t, app, "/v1/messages", map[string]interface{}{
		"model":      "public-claude",
		"max_tokens": 16,
		"stream":     false,
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hello",
		}},
	}, apiKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("/v1/messages returned %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "anthropic ok") {
		t.Fatalf("expected native Anthropic response, got %s", rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if gotPath != "/v1/messages" {
		t.Fatalf("upstream path = %q, want /v1/messages", gotPath)
	}
	if gotAPIKey != "sk-ant" || gotAuth != "" {
		t.Fatalf("unexpected auth headers x-api-key=%q authorization=%q", gotAPIKey, gotAuth)
	}
	if gotBody["model"] != "claude-real" {
		t.Fatalf("expected mapped native Anthropic model, got %#v", gotBody["model"])
	}
	if _, ok := gotBody["messages"].([]interface{}); !ok {
		t.Fatalf("expected Anthropic messages body, got %#v", gotBody)
	}
}

func TestChatCompletionsRejectsGPTModels(t *testing.T) {
	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_gpt",
		Name:           "OpenAI",
		BaseURL:        "http://127.0.0.1:1/v1",
		APIKey:         "upstream-key",
		UpstreamFormat: models.UpstreamFormatOpenAI,
		Models:         []models.Model{{ID: "gpt-4o-mini", Name: "gpt-4o-mini"}},
		ModelMappings:  map[string]string{"public-gpt": "gpt-4o-mini"},
		Enabled:        true,
		HealthStatus:   "unknown",
		Availability7d: 100,
		CreatedAt:      store.Now(),
		UpdatedAt:      store.Now(),
	})

	tests := []struct {
		name  string
		path  string
		model string
	}{
		{name: "v1 direct gpt", path: "/v1/chat/completions", model: "gpt-4o-mini"},
		{name: "root direct gpt", path: "/chat/completions", model: "chatgpt-4o-latest"},
		{name: "mapped upstream gpt", path: "/v1/chat/completions", model: "public-gpt"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := postJSON(t, app, tt.path, map[string]interface{}{
				"model": tt.model,
				"messages": []map[string]string{{
					"role":    "user",
					"content": "hello",
				}},
			}, apiKey)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s returned %d body=%s", tt.path, rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "gpt_chat_completions_disabled") {
				t.Fatalf("expected gpt_chat_completions_disabled error, got %s", rec.Body.String())
			}
		})
	}
}

func setupForcedFormatProxyTest(t *testing.T, provider models.Provider) (http.Handler, string) {
	t.Helper()
	middleware.ResetSecurityStateForTest()
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")

	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}

	apiKey := auth.RandomAPIKey()
	store.MutateDB(func(db *models.Database) interface{} {
		db.Providers = []models.Provider{provider}
		db.Users = []models.User{{
			ID:       "usr_proxy",
			Name:     "Proxy Test",
			Username: "proxy",
			Enabled:  true,
			APIKeys: []models.APIKeyRecord{{
				ID:       "key_proxy",
				Name:     "Proxy Key",
				Key:      apiKey,
				Enabled:  true,
				RPMLimit: 100,
			}},
		}}
		return nil
	})

	mux := http.NewServeMux()
	MountProxyRoutes(mux)
	return mux, apiKey
}
