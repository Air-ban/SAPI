package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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

func TestProxyRejectsInvalidJSONBeforeProviderLookup(t *testing.T) {
	middleware.ResetSecurityStateForTest()
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	security.Configure(config.Load())
	if err := store.Init(context.Background(), config.Load()); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = append(db.Users, models.User{
			ID:      "usr_test",
			Name:    "Test User",
			Enabled: true,
			APIKeys: []models.APIKeyRecord{{
				ID:      "key_test",
				Name:    "Test Key",
				Key:     "sk-sapi-test",
				Enabled: true,
			}},
		})
		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":`))
	req.Header.Set("Authorization", "Bearer sk-sapi-test")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleProxyToProvider(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid JSON to return 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestProxyAutoBansAPIKeyAfterRepeatedInvalidRequestBodies(t *testing.T) {
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
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:       "usr_body_ban",
			Name:     "Body Ban User",
			Username: "body-ban",
			Enabled:  true,
			APIKeys: []models.APIKeyRecord{{
				ID:       "key_body_ban",
				Name:     "Body Ban Key",
				Key:      "sk-sapi-body-ban",
				Enabled:  true,
				RPMLimit: 1000,
			}},
		}}
		return nil
	})

	for i := 0; i < 19; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":`))
		req.Header.Set("Authorization", "Bearer sk-sapi-body-ban")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		handleProxyToProvider(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid request %d returned %d, want 400 body=%s", i+1, rec.Code, rec.Body.String())
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":`))
	req.Header.Set("Authorization", "Bearer sk-sapi-body-ban")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleProxyToProvider(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("20th invalid request returned %d, want 429 body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on automatic API key ban")
	}

	db := store.ReadDB()
	key := db.Users[0].APIKeys[0]
	if key.BannedUntil == "" || key.BanReason != "invalid_request_body" {
		t.Fatalf("expected stored invalid body ban, got bannedUntil=%q reason=%q", key.BannedUntil, key.BanReason)
	}
	if key.InvalidRequestCount != 20 {
		t.Fatalf("invalidRequestCount = %d, want 20", key.InvalidRequestCount)
	}

	validReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"test"}`))
	validReq.Header.Set("Authorization", "Bearer sk-sapi-body-ban")
	validReq.Header.Set("Content-Type", "application/json")
	validRec := httptest.NewRecorder()

	handleProxyToProvider(validRec, validReq)

	if validRec.Code != http.StatusTooManyRequests {
		t.Fatalf("banned key valid request returned %d, want 429 body=%s", validRec.Code, validRec.Body.String())
	}
}

func TestAdminCanBanAndUnbanAPIKeys(t *testing.T) {
	middleware.ResetSecurityStateForTest()
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")
	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.AdminAPIKeys = []models.APIKeyRecord{{
			ID:      "adm_key",
			Name:    "Admin Key",
			Key:     "sk-admin-ban",
			Enabled: true,
		}}
		db.Users = []models.User{{
			ID:       "usr_key_ban",
			Name:     "Key Ban User",
			Username: "key-ban",
			Enabled:  true,
			APIKeys: []models.APIKeyRecord{{
				ID:                  "usr_key",
				Name:                "User Key",
				Key:                 "sk-user-ban",
				Enabled:             true,
				InvalidRequestCount: 7,
			}},
		}}
		return nil
	})
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, store.ReadDB().AppSecret)

	adminBanReq := httptest.NewRequest(http.MethodPut, "/api/admin/api-keys/adm_key", strings.NewReader(`{"banned":true}`))
	adminBanReq.SetPathValue("id", "adm_key")
	adminBanReq.Header.Set("Authorization", "Bearer "+token)
	adminBanReq.Header.Set("Content-Type", "application/json")
	adminBanRec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateAPIKey)(adminBanRec, adminBanReq)

	if adminBanRec.Code != http.StatusOK {
		t.Fatalf("admin key ban returned %d body=%s", adminBanRec.Code, adminBanRec.Body.String())
	}
	if result := middleware.FindUserByKey("sk-admin-ban"); !result.Banned {
		t.Fatal("expected admin API key to be banned")
	}

	userBanReq := httptest.NewRequest(http.MethodPut, "/api/admin/users/usr_key_ban/api-keys/usr_key", strings.NewReader(`{"banned":true}`))
	userBanReq.SetPathValue("userId", "usr_key_ban")
	userBanReq.SetPathValue("keyId", "usr_key")
	userBanReq.Header.Set("Authorization", "Bearer "+token)
	userBanReq.Header.Set("Content-Type", "application/json")
	userBanRec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateUserAPIKey)(userBanRec, userBanReq)

	if userBanRec.Code != http.StatusOK {
		t.Fatalf("user key ban returned %d body=%s", userBanRec.Code, userBanRec.Body.String())
	}
	var userPayload map[string]interface{}
	if err := json.Unmarshal(userBanRec.Body.Bytes(), &userPayload); err != nil {
		t.Fatal(err)
	}
	apiKeys := userPayload["apiKeys"].([]interface{})
	userKey := apiKeys[0].(map[string]interface{})
	if userKey["isBanned"] != true {
		t.Fatalf("expected sanitized user key isBanned=true, got %#v", userKey["isBanned"])
	}

	userUnbanReq := httptest.NewRequest(http.MethodPut, "/api/admin/users/usr_key_ban/api-keys/usr_key", strings.NewReader(`{"banned":false}`))
	userUnbanReq.SetPathValue("userId", "usr_key_ban")
	userUnbanReq.SetPathValue("keyId", "usr_key")
	userUnbanReq.Header.Set("Authorization", "Bearer "+token)
	userUnbanReq.Header.Set("Content-Type", "application/json")
	userUnbanRec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateUserAPIKey)(userUnbanRec, userUnbanReq)

	if userUnbanRec.Code != http.StatusOK {
		t.Fatalf("user key unban returned %d body=%s", userUnbanRec.Code, userUnbanRec.Body.String())
	}
	result := middleware.FindUserByKey("sk-user-ban")
	if result.Banned {
		t.Fatal("expected user API key to be unbanned")
	}
	db := store.ReadDB()
	if got := db.Users[0].APIKeys[0].InvalidRequestCount; got != 0 {
		t.Fatalf("invalidRequestCount after unban = %d, want 0", got)
	}
}

func TestAdminUpdateProviderRejectsInvalidBaseURL(t *testing.T) {
	middleware.ResetSecurityStateForTest()
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.Providers = append(db.Providers, models.Provider{
			ID:      "prv_test",
			Name:    "Test",
			BaseURL: "https://api.example.com/v1",
			APIKey:  "key",
			Enabled: true,
		})
		return nil
	})
	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, db.AppSecret)

	req := httptest.NewRequest(http.MethodPut, "/api/admin/providers/prv_test", strings.NewReader(`{"baseUrl":"javascript:alert(1)"}`))
	req.SetPathValue("id", "prv_test")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateProvider)(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid provider URL to return 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAPIKeyFailureLimiterBlocksAfterRepeatedFailures(t *testing.T) {
	middleware.ResetSecurityStateForTest()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"test"}`))
	req.RemoteAddr = "198.51.100.10:4444"

	for i := 0; i < 60; i++ {
		middleware.RecordAPIKeyFailure(req)
	}

	allowed, retryAfter := middleware.CheckAPIKeyFailureLimit(req)
	if allowed {
		t.Fatal("expected API key failure limiter to block after repeated failures")
	}
	if retryAfter <= 0 {
		t.Fatalf("expected positive retryAfter, got %v", retryAfter)
	}
}

func TestReadJSONBodyRejectsOversizedBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"`+strings.Repeat("x", 1024)+`"}`))
	rec := httptest.NewRecorder()
	req.Body = http.MaxBytesReader(rec, req.Body, 32)

	_, ok := readJSONBody(rec, req)
	if ok {
		t.Fatal("expected oversized JSON body to be rejected")
	}
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", rec.Code)
	}
}

func TestMain(m *testing.M) {
	code := m.Run()
	os.Exit(code)
}
