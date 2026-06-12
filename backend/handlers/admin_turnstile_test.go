package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"sapi/config"
	"sapi/store"
)

func initAdminTurnstileTestStore(t *testing.T) {
	t.Helper()
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")
	if err := store.Init(context.Background(), config.Load()); err != nil {
		t.Fatal(err)
	}
}

func TestAdminLoginRequiresTurnstileByDefault(t *testing.T) {
	initAdminTurnstileTestStore(t)
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	t.Setenv("SAPI_TURNSTILE_SECRET_KEY", "turnstile-secret")

	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{"username":"admin","password":"secret-password"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleAdminLogin(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"turnstile_failed"`) {
		t.Fatalf("body = %s, want turnstile_failed", rec.Body.String())
	}
}

func TestAdminLoginCanSkipTurnstileWhenConfigured(t *testing.T) {
	initAdminTurnstileTestStore(t)
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	t.Setenv("SAPI_TURNSTILE_SECRET_KEY", "turnstile-secret")
	t.Setenv("SAPI_ADMIN_TURNSTILE_DISABLED", "true")

	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{"username":"admin","password":"secret-password"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleAdminLogin(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["token"] == "" || payload["username"] != "admin" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}
