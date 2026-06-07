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
	"sapi/models"
	"sapi/store"
	"sapi/subscription"
)

func TestRegisterRequiresAcceptedTerms(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(`{
		"username":"terms-user",
		"email":"terms@example.edu.cn",
		"password":"valid-password-123",
		"verificationCode":"123456"
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleRegister(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"terms_required"`) {
		t.Fatalf("body = %s, want terms_required", rec.Body.String())
	}
}

func TestRegisterAllowsOrdinaryEmailWithFiveRPM(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")

	cfg := config.Load()
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{}
		db.VerificationCodes = []models.VerificationCode{{
			Email:     "ordinary@example.com",
			Code:      "123456",
			Purpose:   "register",
			CreatedAt: store.Now(),
		}}
		return nil
	})

	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(`{
		"username":"ordinary-user",
		"email":"ordinary@example.com",
		"password":"valid-password-123",
		"verificationCode":"123456",
		"termsAccepted":true
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleRegister(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	user := payload["user"].(map[string]interface{})
	if got := user["source"]; got != "email" {
		t.Fatalf("source = %#v, want email", got)
	}
	if got := user["subscriptionTier"]; got != subscription.TierEmail {
		t.Fatalf("subscriptionTier = %#v, want %q", got, subscription.TierEmail)
	}
	if got := int(user["subscriptionRpmLimit"].(float64)); got != 5 {
		t.Fatalf("subscriptionRpmLimit = %d, want 5", got)
	}

	db := store.ReadDB()
	if len(db.Users) != 1 {
		t.Fatalf("stored users = %d, want 1", len(db.Users))
	}
	if got := db.Users[0].SubscriptionTier; got != subscription.TierEmail {
		t.Fatalf("stored subscriptionTier = %q, want %q", got, subscription.TierEmail)
	}
	if got := subscription.RPMLimitForUser(&db.Users[0]); got != 5 {
		t.Fatalf("stored rpm = %d, want 5", got)
	}
}

func TestRegistrationTierSelection(t *testing.T) {
	tests := []struct {
		name           string
		email          string
		invitationCode string
		want           string
	}{
		{name: "ordinary email without invite", email: "user@example.com", want: subscription.TierEmail},
		{name: "ordinary email with invite", email: "user@example.com", invitationCode: "invite", want: subscription.TierLite},
		{name: "education email without invite", email: "student@example.edu.cn", want: subscription.TierLite},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := subscriptionTierForRegistration(tt.email, tt.invitationCode); got != tt.want {
				t.Fatalf("subscriptionTierForRegistration() = %q, want %q", got, tt.want)
			}
		})
	}
}
