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
