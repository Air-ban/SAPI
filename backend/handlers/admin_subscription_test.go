package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
)

func TestAdminUpdateUserSubscriptionTier(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:               "usr_sub",
			Username:         "subscriber",
			Name:             "Subscriber",
			Enabled:          true,
			SubscriptionTier: subscription.TierLite,
		}}
		return nil
	})
	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, db.AppSecret)

	req := httptest.NewRequest(http.MethodPut, "/api/admin/users/usr_sub", strings.NewReader(`{"subscriptionTier":"ultra"}`))
	req.SetPathValue("id", "usr_sub")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateUser)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if got := payload["subscriptionTier"]; got != subscription.TierUltra {
		t.Fatalf("subscriptionTier = %#v, want %q", got, subscription.TierUltra)
	}
	if got := int(payload["subscriptionRpmLimit"].(float64)); got != 100 {
		t.Fatalf("subscriptionRpmLimit = %d, want 100", got)
	}

	updated := store.ReadDB()
	if got := updated.Users[0].SubscriptionTier; got != subscription.TierUltra {
		t.Fatalf("stored subscriptionTier = %q, want %q", got, subscription.TierUltra)
	}
}

func TestAdminApplyGlobalSubscriptionTier(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{
			{ID: "usr_lite", Username: "lite-user", Name: "Lite User", Enabled: true, SubscriptionTier: subscription.TierLite},
			{ID: "usr_base", Username: "base-user", Name: "Base User", Enabled: true, SubscriptionTier: subscription.TierBase},
			{ID: "usr_max", Username: "max-user", Name: "Max User", Enabled: true, SubscriptionTier: subscription.TierMax},
		}
		return nil
	})
	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, db.AppSecret)

	req := httptest.NewRequest(http.MethodPut, "/api/admin/subscriptions/global-tier", strings.NewReader(`{"subscriptionTier":"pro"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminApplyGlobalSubscriptionTier)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if got := payload["subscriptionTier"]; got != subscription.TierPro {
		t.Fatalf("subscriptionTier = %#v, want %q", got, subscription.TierPro)
	}
	if got := int(payload["subscriptionRpmLimit"].(float64)); got != 50 {
		t.Fatalf("subscriptionRpmLimit = %d, want 50", got)
	}
	if got := int(payload["changedUsers"].(float64)); got != 3 {
		t.Fatalf("changedUsers = %d, want 3", got)
	}
	if got := int(payload["totalUsers"].(float64)); got != 3 {
		t.Fatalf("totalUsers = %d, want 3", got)
	}

	updated := store.ReadDB()
	for _, user := range updated.Users {
		if got := user.SubscriptionTier; got != subscription.TierPro {
			t.Fatalf("user %s subscriptionTier = %q, want %q", user.ID, got, subscription.TierPro)
		}
	}
}

func TestAdminRestoreDefaultSubscriptionTiers(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{
			{ID: "usr_email", Username: "email-user", Email: "user@example.com", Source: "email", Enabled: true, SubscriptionTier: subscription.TierPro},
			{ID: "usr_edu", Username: "edu-user", Email: "student@example.edu.cn", Source: "edu", Enabled: true, SubscriptionTier: subscription.TierLite},
			{ID: "usr_github", Username: "github-user", Email: "octo@example.com", Source: "github", GitHubLogin: "octo", Enabled: true, SubscriptionTier: subscription.TierBase},
		}
		return nil
	})
	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, db.AppSecret)

	req := httptest.NewRequest(http.MethodPut, "/api/admin/subscriptions/global-tier", strings.NewReader(`{"restoreDefaults":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminApplyGlobalSubscriptionTier)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	updated := store.ReadDB()
	want := map[string]string{
		"usr_email":  subscription.TierEmail,
		"usr_edu":    subscription.TierBase,
		"usr_github": subscription.TierLite,
	}
	for _, user := range updated.Users {
		if got := user.SubscriptionTier; got != want[user.ID] {
			t.Fatalf("user %s subscriptionTier = %q, want %q", user.ID, got, want[user.ID])
		}
	}
}

func TestAdminEmailUpdateRestoresEduDefaultTier(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:               "usr_email",
			Username:         "email-user",
			Email:            "user@example.com",
			Source:           "email",
			Enabled:          true,
			SubscriptionTier: subscription.TierEmail,
		}}
		return nil
	})
	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, db.AppSecret)

	req := httptest.NewRequest(http.MethodPut, "/api/admin/users/usr_email", strings.NewReader(`{"email":"student@example.edu.cn"}`))
	req.SetPathValue("id", "usr_email")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateUser)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	updated := store.ReadDB()
	if got := updated.Users[0].Source; got != "edu" {
		t.Fatalf("source = %q, want edu", got)
	}
	if got := updated.Users[0].SubscriptionTier; got != subscription.TierBase {
		t.Fatalf("subscriptionTier = %q, want %q", got, subscription.TierBase)
	}
	if got := subscription.RPMLimitForUserInDB(&updated.Users[0], updated); got != 30 {
		t.Fatalf("rpm = %d, want 30", got)
	}
}
