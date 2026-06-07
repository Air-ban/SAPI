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
)

func TestParseSiteEmailsNormalizesAndDeduplicates(t *testing.T) {
	emails, invalid := parseSiteEmails([]string{
		"Admin@Example.com, ops@example.com\nadmin@example.com",
		"bad-address",
	})

	if len(invalid) != 1 || invalid[0] != "bad-address" {
		t.Fatalf("invalid = %#v, want bad-address", invalid)
	}
	want := []string{"admin@example.com", "ops@example.com"}
	if len(emails) != len(want) {
		t.Fatalf("emails = %#v, want %#v", emails, want)
	}
	for i := range want {
		if emails[i] != want[i] {
			t.Fatalf("emails = %#v, want %#v", emails, want)
		}
	}
}

func TestAdminUpdateSiteEmailStoresMultipleRecipientsAndCanClear(t *testing.T) {
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
		db.Users = []models.User{{
			ID:      "usr_should_not_backfill",
			Email:   "user@example.com",
			Enabled: true,
		}}
		return nil
	})
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, store.ReadDB().AppSecret)

	req := httptest.NewRequest(http.MethodPut, "/api/admin/site-email", strings.NewReader(`{"siteEmails":["Admin@Example.com","ops@example.com","admin@example.com"]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateSiteEmail)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("update returned %d body=%s", rec.Code, rec.Body.String())
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	items := payload["siteEmails"].([]interface{})
	if len(items) != 2 || items[0] != "admin@example.com" || items[1] != "ops@example.com" {
		t.Fatalf("siteEmails = %#v, want admin/ops", payload["siteEmails"])
	}
	if payload["siteEmail"] != "admin@example.com" {
		t.Fatalf("siteEmail = %#v, want first email", payload["siteEmail"])
	}

	clearReq := httptest.NewRequest(http.MethodPut, "/api/admin/site-email", strings.NewReader(`{"siteEmails":[]}`))
	clearReq.Header.Set("Authorization", "Bearer "+token)
	clearReq.Header.Set("Content-Type", "application/json")
	clearRec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateSiteEmail)(clearRec, clearReq)

	if clearRec.Code != http.StatusOK {
		t.Fatalf("clear returned %d body=%s", clearRec.Code, clearRec.Body.String())
	}
	db := store.ReadDB()
	if db.SiteEmail != "" || len(db.SiteEmails) != 0 {
		t.Fatalf("cleared site email got siteEmail=%q siteEmails=%#v", db.SiteEmail, db.SiteEmails)
	}
}

func TestAdminUpdateSiteEmailRejectsInvalidRecipient(t *testing.T) {
	req := httptest.NewRequest(http.MethodPut, "/api/admin/site-email", strings.NewReader(`{"siteEmails":["admin@example.com","bad-address"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleAdminUpdateSiteEmail(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid email returned %d body=%s", rec.Code, rec.Body.String())
	}
}
