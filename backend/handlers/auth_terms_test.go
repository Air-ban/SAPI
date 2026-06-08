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

func TestForgotPasswordRejectsGitHubOnlyUser(t *testing.T) {
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
		db.Users = []models.User{{
			ID:          "usr_github_only",
			Username:    "github-only",
			Email:       "github-only@example.com",
			Name:        "GitHub Only",
			Enabled:     true,
			Source:      "github",
			GitHubID:    "42",
			GitHubLogin: "github-only",
		}}
		db.VerificationCodes = []models.VerificationCode{{
			Email:     "github-only@example.com",
			Code:      "654321",
			Purpose:   "reset_password",
			CreatedAt: store.Now(),
		}}
		return nil
	})

	sendReq := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password/send-code", strings.NewReader(`{"email":"github-only@example.com"}`))
	sendReq.Header.Set("Content-Type", "application/json")
	sendRec := httptest.NewRecorder()

	handleForgotPasswordSendCode(sendRec, sendReq)

	if sendRec.Code != http.StatusForbidden {
		t.Fatalf("send-code status = %d, want 403 body=%s", sendRec.Code, sendRec.Body.String())
	}
	if !strings.Contains(sendRec.Body.String(), `"code":"password_reset_unavailable"`) {
		t.Fatalf("send-code body = %s, want password_reset_unavailable", sendRec.Body.String())
	}

	resetReq := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password/reset", strings.NewReader(`{
		"email":"github-only@example.com",
		"verificationCode":"654321",
		"password":"new-password-123"
	}`))
	resetReq.Header.Set("Content-Type", "application/json")
	resetRec := httptest.NewRecorder()

	handleForgotPasswordReset(resetRec, resetReq)

	if resetRec.Code != http.StatusForbidden {
		t.Fatalf("reset status = %d, want 403 body=%s", resetRec.Code, resetRec.Body.String())
	}
	if !strings.Contains(resetRec.Body.String(), `"code":"password_reset_unavailable"`) {
		t.Fatalf("reset body = %s, want password_reset_unavailable", resetRec.Body.String())
	}

	db := store.ReadDB()
	if got := db.Users[0].PasswordHash; got != "" {
		t.Fatalf("github-only password hash = %q, want empty", got)
	}
	if db.VerificationCodes[0].Used {
		t.Fatal("reset code was consumed for an ineligible GitHub-only user")
	}

	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"github-only@example.com","password":"new-password-123"}`))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()

	handleAuthLogin(loginRec, loginReq)

	if loginRec.Code != http.StatusUnauthorized {
		t.Fatalf("login status = %d, want 401 body=%s", loginRec.Code, loginRec.Body.String())
	}
}

func TestForgotPasswordAllowsLocalUser(t *testing.T) {
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
		db.Users = []models.User{{
			ID:           "usr_local",
			Username:     "local-user",
			Email:        "local@example.com",
			Name:         "Local User",
			PasswordHash: auth.HashPassword("old-password-123"),
			Enabled:      true,
			Source:       "email",
		}}
		db.VerificationCodes = []models.VerificationCode{{
			Email:     "local@example.com",
			Code:      "123456",
			Purpose:   "reset_password",
			CreatedAt: store.Now(),
		}}
		return nil
	})

	resetReq := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password/reset", strings.NewReader(`{
		"email":"local@example.com",
		"verificationCode":"123456",
		"password":"new-password-123"
	}`))
	resetReq.Header.Set("Content-Type", "application/json")
	resetRec := httptest.NewRecorder()

	handleForgotPasswordReset(resetRec, resetReq)

	if resetRec.Code != http.StatusOK {
		t.Fatalf("reset status = %d, want 200 body=%s", resetRec.Code, resetRec.Body.String())
	}

	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"local-user","password":"new-password-123"}`))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()

	handleAuthLogin(loginRec, loginReq)

	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d, want 200 body=%s", loginRec.Code, loginRec.Body.String())
	}
}

func TestAuthLoginRejectsAdminCredentials(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")

	cfg := config.Load()
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}

	userLoginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"secret-password"}`))
	userLoginReq.Header.Set("Content-Type", "application/json")
	userLoginRec := httptest.NewRecorder()

	handleAuthLogin(userLoginRec, userLoginReq)

	if userLoginRec.Code != http.StatusUnauthorized {
		t.Fatalf("user login status = %d, want 401 body=%s", userLoginRec.Code, userLoginRec.Body.String())
	}
	if !strings.Contains(userLoginRec.Body.String(), `"code":"admin_login_required"`) {
		t.Fatalf("user login body = %s, want admin_login_required", userLoginRec.Body.String())
	}
	if strings.Contains(userLoginRec.Body.String(), `"token"`) {
		t.Fatalf("user login leaked token: %s", userLoginRec.Body.String())
	}

	adminLoginReq := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{"username":"admin","password":"secret-password"}`))
	adminLoginReq.Header.Set("Content-Type", "application/json")
	adminLoginRec := httptest.NewRecorder()

	handleAdminLogin(adminLoginRec, adminLoginReq)

	if adminLoginRec.Code != http.StatusOK {
		t.Fatalf("admin login status = %d, want 200 body=%s", adminLoginRec.Code, adminLoginRec.Body.String())
	}

	var payload map[string]string
	if err := json.Unmarshal(adminLoginRec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	token := payload["token"]
	if token == "" {
		t.Fatalf("admin login token is empty: %#v", payload)
	}
	verified := auth.VerifyToken(token, store.ReadDB().AppSecret)
	if verified == nil || verified.Role != "admin" || verified.Sub != "admin" {
		t.Fatalf("admin login token payload = %#v, want admin/admin", verified)
	}
}
