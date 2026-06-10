package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/proxy"
	"sapi/security"
	"sapi/store"
	"sapi/utils"
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
		{name: "generic v1 get", method: http.MethodGet, path: "/v1/files", status: http.StatusUnauthorized},
		{name: "generic v1 delete", method: http.MethodDelete, path: "/v1/files/file_123", status: http.StatusUnauthorized},
		{name: "generic audio post", method: http.MethodPost, path: "/v1/audio/transcriptions", status: http.StatusUnauthorized},
		{name: "generic images post", method: http.MethodPost, path: "/v1/images/generations", status: http.StatusUnauthorized},
		{name: "responses resource get", method: http.MethodGet, path: "/responses/resp_123", status: http.StatusUnauthorized},
		{name: "v1 responses resource get", method: http.MethodGet, path: "/v1/responses/resp_123", status: http.StatusUnauthorized},
		{name: "file content get", method: http.MethodGet, path: "/v1/files/file_123/content", status: http.StatusUnauthorized},
		{name: "unsupported messages get", method: http.MethodGet, path: "/messages", status: http.StatusMethodNotAllowed},
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

func TestAnthropicCountTokensProxiesToNativeAnthropicUpstream(t *testing.T) {
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
			"input_tokens":            42,
			"cache_read_input_tokens": 7,
		})
	}))
	defer upstream.Close()

	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_anthropic_count",
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

	rec := postJSON(t, app, "/v1/messages/count_tokens", map[string]interface{}{
		"model": "public-claude",
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hello",
		}},
	}, apiKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("/v1/messages/count_tokens returned %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"input_tokens":42`) || !strings.Contains(rec.Body.String(), `"cache_read_input_tokens":7`) {
		t.Fatalf("expected upstream token count response, got %s", rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if gotPath != "/v1/messages/count_tokens" {
		t.Fatalf("upstream path = %q, want /v1/messages/count_tokens", gotPath)
	}
	if gotAPIKey != "sk-ant" || gotAuth != "" {
		t.Fatalf("unexpected auth headers x-api-key=%q authorization=%q", gotAPIKey, gotAuth)
	}
	if gotBody["model"] != "claude-real" {
		t.Fatalf("expected mapped Anthropic count_tokens model, got %#v", gotBody["model"])
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

func TestChatCompletionsAggregatesUpstreamSSEForNonStreamRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `data: {"id":"chatcmpl_sse","object":"chat.completion.chunk","created":123,"model":"claude-real","choices":[{"index":0,"delta":{"role":"assistant","content":"hello "},"finish_reason":null}]}`+"\n\n")
		fmt.Fprint(w, `data: {"id":"chatcmpl_sse","object":"chat.completion.chunk","created":123,"model":"claude-real","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}`+"\n\n")
		fmt.Fprint(w, `data: {"id":"chatcmpl_sse","object":"chat.completion.chunk","created":123,"model":"claude-real","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6,"prompt_tokens_details":{"cached_tokens":1}}}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_openai_sse",
		Name:           "OpenAI SSE Gateway",
		BaseURL:        upstream.URL,
		APIKey:         "upstream-key",
		UpstreamFormat: models.UpstreamFormatOpenAI,
		Models:         []models.Model{{ID: "claude-public", Name: "claude-public"}},
		Enabled:        true,
		HealthStatus:   "unknown",
		Availability7d: 100,
		CreatedAt:      store.Now(),
		UpdatedAt:      store.Now(),
	})

	rec := postJSON(t, app, "/v1/chat/completions", map[string]interface{}{
		"model":  "claude-public",
		"stream": false,
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hello",
		}},
	}, apiKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("chat completions returned %d body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "data:") {
		t.Fatalf("expected aggregated JSON response, got SSE text: %s", rec.Body.String())
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("response is not JSON: %v body=%s", err, rec.Body.String())
	}
	if payload["object"] != "chat.completion" {
		t.Fatalf("object = %v, want chat.completion", payload["object"])
	}
	text, _, usagePayload := proxy.ExtractChatCompletionText(payload)
	if text != "hello world" {
		t.Fatalf("aggregated text = %q, want hello world", text)
	}
	normalized := utils.NormalizeUsage(usagePayload)
	if normalized == nil || normalized.PromptTokens != 4 || normalized.CompletionTokens != 2 || normalized.CachedTokens != 1 {
		t.Fatalf("unexpected aggregated usage: %#v", normalized)
	}
}

func TestWebSocketProxyForwardsChatJSONRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("upstream path = %q, want /v1/chat/completions", r.URL.Path)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "claude-public" {
			t.Fatalf("model = %#v, want claude-public", body["model"])
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":      "chatcmpl_ws",
			"object":  "chat.completion",
			"created": 123,
			"model":   "claude-public",
			"choices": []map[string]interface{}{{
				"index": 0,
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": "ws ok",
				},
				"finish_reason": "stop",
			}},
		})
	}))
	defer upstream.Close()

	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_ws_chat",
		Name:           "OpenAI WS Chat",
		BaseURL:        upstream.URL,
		APIKey:         "upstream-key",
		UpstreamFormat: models.UpstreamFormatOpenAI,
		Models:         []models.Model{{ID: "claude-public", Name: "claude-public"}},
		Enabled:        true,
		HealthStatus:   "unknown",
		Availability7d: 100,
		CreatedAt:      store.Now(),
		UpdatedAt:      store.Now(),
	})

	resp := sendWebSocketProxyTestRequest(t, app, map[string]interface{}{
		"id":     "chat",
		"method": "POST",
		"path":   "/v1/chat/completions",
		"headers": map[string]string{
			"Authorization": "Bearer " + apiKey,
			"Accept":        "application/json",
		},
		"body": map[string]interface{}{
			"model": "claude-public",
			"messages": []map[string]string{{
				"role":    "user",
				"content": "hello",
			}},
		},
	})
	if resp.Type != "response" || resp.Status != http.StatusOK {
		t.Fatalf("ws response = %#v", resp)
	}
	if !strings.Contains(resp.Body, "ws ok") {
		t.Fatalf("ws body = %s, want upstream response", resp.Body)
	}
}

func TestWebSocketProxyForwardsImageEditMultipartRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Fatalf("upstream path = %q, want /v1/images/edits", r.URL.Path)
		}
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatal(err)
		}
		if got := r.FormValue("model"); got != "real-image" {
			t.Fatalf("multipart model = %q, want real-image", got)
		}
		files := r.MultipartForm.File["image[]"]
		if len(files) != 1 {
			t.Fatalf("image files = %d, want 1", len(files))
		}
		file, err := files[0].Open()
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		raw, _ := io.ReadAll(file)
		if string(raw) != "abc" {
			t.Fatalf("image file = %q, want abc", string(raw))
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"data": []map[string]string{{"b64_json": "aW1hZ2U="}},
		})
	}))
	defer upstream.Close()

	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_ws_image",
		Name:           "OpenAI WS Images",
		BaseURL:        upstream.URL,
		APIKey:         "upstream-key",
		UpstreamFormat: models.UpstreamFormatOpenAI,
		Models:         []models.Model{{ID: "real-image", Name: "real-image"}},
		ModelMappings:  map[string]string{"public-image": "real-image"},
		Enabled:        true,
		HealthStatus:   "unknown",
		Availability7d: 100,
		CreatedAt:      store.Now(),
		UpdatedAt:      store.Now(),
	})

	resp := sendWebSocketProxyTestRequest(t, app, map[string]interface{}{
		"id":     "image",
		"method": "POST",
		"path":   "/v1/images/edits",
		"headers": map[string]string{
			"Authorization": "Bearer " + apiKey,
		},
		"form": []map[string]string{
			{"name": "model", "value": "public-image"},
			{"name": "prompt", "value": "edit it"},
			{"name": "image[]", "filename": "ref.png", "contentType": "image/png", "dataUrl": "data:image/png;base64,YWJj"},
		},
	})
	if resp.Type != "response" || resp.Status != http.StatusOK {
		t.Fatalf("ws response = %#v", resp)
	}
	if !strings.Contains(resp.Body, "aW1hZ2U=") {
		t.Fatalf("ws body = %s, want image response", resp.Body)
	}
}

func TestProxyRequestLogCapturesClientDeviceWithoutSensitiveHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":      "chatcmpl_device",
			"object":  "chat.completion",
			"created": 123,
			"model":   "claude-public",
			"choices": []map[string]interface{}{{
				"index": 0,
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": "ok",
				},
				"finish_reason": "stop",
			}},
			"usage": map[string]interface{}{
				"prompt_tokens":     1,
				"completion_tokens": 1,
				"total_tokens":      2,
			},
		})
	}))
	defer upstream.Close()

	app, apiKey := setupForcedFormatProxyTest(t, models.Provider{
		ID:             "prv_device",
		Name:           "OpenAI Device Gateway",
		BaseURL:        upstream.URL,
		APIKey:         "upstream-key",
		UpstreamFormat: models.UpstreamFormatOpenAI,
		Models:         []models.Model{{ID: "claude-public", Name: "claude-public"}},
		Enabled:        true,
		HealthStatus:   "unknown",
		Availability7d: 100,
		CreatedAt:      store.Now(),
		UpdatedAt:      store.Now(),
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"claude-public","messages":[{"role":"user","content":"hello"}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("Cookie", "session=secret")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Sec-CH-UA-Platform", `"Windows"`)
	rec := httptest.NewRecorder()
	app.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("chat completions returned %d body=%s", rec.Code, rec.Body.String())
	}

	logs := store.ReadDB().RequestLogs
	if len(logs) != 1 {
		t.Fatalf("expected one request log, got %d: %#v", len(logs), logs)
	}
	device := logs[0].ClientDevice
	if device == nil {
		t.Fatal("expected client device info to be recorded")
	}
	if device.BrowserName != "Chrome" || device.OSName != "Windows" || device.DeviceType != "desktop" {
		t.Fatalf("unexpected parsed device info: %#v", device)
	}
	if len(device.Languages) == 0 || device.Languages[0] != "zh-CN" {
		t.Fatalf("unexpected device languages: %#v", device.Languages)
	}
	for _, sensitive := range []string{"Authorization", "X-API-Key", "Cookie"} {
		if _, ok := device.Headers[sensitive]; ok {
			t.Fatalf("sensitive header %s should not be recorded: %#v", sensitive, device.Headers)
		}
	}
}

func sendWebSocketProxyTestRequest(t *testing.T, app http.Handler, payload interface{}) websocketProxyResponse {
	t.Helper()
	server := httptest.NewServer(app)
	defer server.Close()

	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	wsURL := url.URL{Scheme: "ws", Host: serverURL.Host, Path: "/api/ws/proxy"}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(payload); err != nil {
		t.Fatal(err)
	}
	var resp websocketProxyResponse
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatal(err)
	}
	return resp
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
