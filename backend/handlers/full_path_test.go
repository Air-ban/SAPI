package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
)

func TestFullPathSmokeWithMockUpstream(t *testing.T) {
	middleware.ResetSecurityStateForTest()
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	cfg := config.Load()
	security.Configure(cfg)
	store.EnsureDB()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"data": []map[string]interface{}{{"id": "test-model"}},
			})
			return
		}
		if r.URL.Path == "/v1/chat/completions" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id":      "chatcmpl_test",
				"object":  "chat.completion",
				"created": 1,
				"model":   "test-model",
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
			return
		}
		http.NotFound(w, r)
	}))
	defer upstream.Close()

	userKey := auth.RandomAPIKey()
	store.MutateDB(func(db *models.Database) interface{} {
		db.Providers = append(db.Providers, models.Provider{
			ID:            "prv_test",
			Name:          "Mock",
			BaseURL:       upstream.URL + "/v1",
			APIKey:        "upstream-key",
			Models:        []models.Model{{ID: "test-model", Name: "test-model"}},
			ModelMappings: map[string]string{"openrouter/test-model": "test-model"},
			Enabled:       true,
			CreatedAt:     store.Now(),
			UpdatedAt:     store.Now(),
		})
		db.Users = append(db.Users, models.User{
			ID:       "usr_test",
			Name:     "Test User",
			Username: "test",
			Enabled:  true,
			APIKeys: []models.APIKeyRecord{{
				ID:       "key_test",
				Name:     "Test Key",
				Key:      userKey,
				Enabled:  true,
				RPMLimit: 10,
			}},
		})
		return nil
	})

	mux := http.NewServeMux()
	MountPublicRoutes(mux)
	MountAuthRoutes(mux)
	MountAdminRoutes(mux)
	MountProxyRoutes(mux)
	app := security.RequestGuard(middleware.CORS(mux))

	adminLogin := postJSON(t, app, "/api/admin/login", map[string]interface{}{
		"username": "admin",
		"password": "secret-password",
	}, "")
	if adminLogin.Code != http.StatusOK {
		t.Fatalf("admin login returned %d body=%s", adminLogin.Code, adminLogin.Body.String())
	}

	ready := get(t, app, "/api/ready", "")
	if ready.Code != http.StatusOK || !strings.Contains(ready.Body.String(), `"redis"`) {
		t.Fatalf("ready returned %d body=%s", ready.Code, ready.Body.String())
	}

	modelsResp := get(t, app, "/v1/models", userKey)
	if modelsResp.Code != http.StatusOK || !strings.Contains(modelsResp.Body.String(), `"id":"prv_test/test-model"`) {
		t.Fatalf("models returned %d body=%s", modelsResp.Code, modelsResp.Body.String())
	}

	modelResp := get(t, app, "/v1/models/prv_test/test-model", userKey)
	if modelResp.Code != http.StatusOK || !strings.Contains(modelResp.Body.String(), `"id":"prv_test/test-model"`) {
		t.Fatalf("model retrieve returned %d body=%s", modelResp.Code, modelResp.Body.String())
	}

	compatModelsResp := get(t, app, "/v1/messages/v1/models", userKey)
	if compatModelsResp.Code != http.StatusOK || !strings.Contains(compatModelsResp.Body.String(), `"id":"prv_test/test-model"`) {
		t.Fatalf("compat models returned %d body=%s", compatModelsResp.Code, compatModelsResp.Body.String())
	}

	encodedMappedModel := "/v1/models/" + url.PathEscape("prv_test/openrouter/test-model")
	mappedModelResp := get(t, app, encodedMappedModel, userKey)
	if mappedModelResp.Code != http.StatusOK || !strings.Contains(mappedModelResp.Body.String(), `"id":"prv_test/openrouter/test-model"`) {
		t.Fatalf("encoded mapped model retrieve returned %d body=%s", mappedModelResp.Code, mappedModelResp.Body.String())
	}

	compatMappedModel := "/v1/messages/v1/models/" + url.PathEscape("prv_test/openrouter/test-model")
	compatMappedModelResp := get(t, app, compatMappedModel, userKey)
	if compatMappedModelResp.Code != http.StatusOK || !strings.Contains(compatMappedModelResp.Body.String(), `"id":"prv_test/openrouter/test-model"`) {
		t.Fatalf("compat encoded mapped model retrieve returned %d body=%s", compatMappedModelResp.Code, compatMappedModelResp.Body.String())
	}

	chatResp := postJSON(t, app, "/v1/chat/completions", map[string]interface{}{
		"model": "test-model",
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hello",
		}},
	}, userKey)
	if chatResp.Code != http.StatusOK || !strings.Contains(chatResp.Body.String(), `"content":"ok"`) {
		t.Fatalf("chat returned %d body=%s", chatResp.Code, chatResp.Body.String())
	}

	prefixedChatResp := postJSON(t, app, "/v1/chat/completions", map[string]interface{}{
		"model": "prv_test/test-model",
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hello",
		}},
	}, userKey)
	if prefixedChatResp.Code != http.StatusOK || !strings.Contains(prefixedChatResp.Body.String(), `"content":"ok"`) {
		t.Fatalf("prefixed chat returned %d body=%s", prefixedChatResp.Code, prefixedChatResp.Body.String())
	}

	for i := 0; i < 61; i++ {
		rec := postRawFrom(app, "/v1/chat/completions", `{"model":"test-model"}`, "sk-sapi-wrong", "203.0.113.200:5555")
		if i == 60 && rec.Code != http.StatusTooManyRequests {
			t.Fatalf("expected failed key attempts to hit 429, got %d body=%s", rec.Code, rec.Body.String())
		}
	}
}

func postJSON(t *testing.T, handler http.Handler, path string, body map[string]interface{}, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return postRaw(handler, path, string(raw), bearer)
}

func postRaw(handler http.Handler, path, body, bearer string) *httptest.ResponseRecorder {
	return postRawFrom(handler, path, body, bearer, "")
}

func postRawFrom(handler http.Handler, path, body, bearer, remoteAddr string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func get(t *testing.T, handler http.Handler, path, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
