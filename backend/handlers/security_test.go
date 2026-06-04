package handlers

import (
	"context"
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
