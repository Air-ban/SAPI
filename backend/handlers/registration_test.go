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

func setupRegistrationTestStore(t *testing.T) *config.Config {
	t.Helper()
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")
	t.Setenv("SAPI_ADMIN_USER", "admin")
	t.Setenv("SAPI_ADMIN_PASSWORD", "secret-password")

	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestAdminUpdateRegistrationTogglesPublicConfig(t *testing.T) {
	setupRegistrationTestStore(t)
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, store.ReadDB().AppSecret)

	req := httptest.NewRequest(http.MethodPut, "/api/admin/registration", strings.NewReader(`{"registrationDisabled":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireAdmin(handleAdminUpdateRegistration)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["registrationDisabled"] != true || payload["registrationEnabled"] != false {
		t.Fatalf("payload = %#v, want disabled true/enabled false", payload)
	}
	if !store.ReadDB().RegistrationDisabled {
		t.Fatal("expected registrationDisabled to be persisted")
	}

	public := publicConfig()
	if public["registrationDisabled"] != true {
		t.Fatalf("public config registrationDisabled = %#v, want true", public["registrationDisabled"])
	}
	registration, ok := public["registration"].(map[string]interface{})
	if !ok || registration["enabled"] != false {
		t.Fatalf("public config registration = %#v, want enabled false", public["registration"])
	}
}

func TestClosedRegistrationBlocksEmailRegistrationAndVerificationCode(t *testing.T) {
	setupRegistrationTestStore(t)
	store.MutateDB(func(db *models.Database) interface{} {
		db.RegistrationDisabled = true
		db.VerificationCodes = []models.VerificationCode{{
			Email:     "closed@example.com",
			Code:      "123456",
			Purpose:   "register",
			CreatedAt: store.Now(),
		}}
		return nil
	})

	registerReq := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(`{
		"username":"closed-user",
		"email":"closed@example.com",
		"password":"valid-password-123",
		"verificationCode":"123456",
		"termsAccepted":true
	}`))
	registerReq.Header.Set("Content-Type", "application/json")
	registerRec := httptest.NewRecorder()

	handleRegister(registerRec, registerReq)

	if registerRec.Code != http.StatusForbidden {
		t.Fatalf("register status = %d, want 403 body=%s", registerRec.Code, registerRec.Body.String())
	}
	if !strings.Contains(registerRec.Body.String(), `"code":"registration_closed"`) {
		t.Fatalf("register body = %s, want registration_closed", registerRec.Body.String())
	}

	codeReq := httptest.NewRequest(http.MethodPost, "/api/auth/send-verification-code", strings.NewReader(`{"email":"closed@example.com","purpose":"register"}`))
	codeReq.Header.Set("Content-Type", "application/json")
	codeRec := httptest.NewRecorder()

	handleSendVerificationCode(codeRec, codeReq)

	if codeRec.Code != http.StatusForbidden {
		t.Fatalf("send code status = %d, want 403 body=%s", codeRec.Code, codeRec.Body.String())
	}
	if !strings.Contains(codeRec.Body.String(), `"code":"registration_closed"`) {
		t.Fatalf("send code body = %s, want registration_closed", codeRec.Body.String())
	}

	if users := store.ReadDB().Users; len(users) != 0 {
		t.Fatalf("users = %#v, want no created users", users)
	}
}

func TestClosedRegistrationBlocksNewGitHubUsersButAllowsExistingLinkedUsers(t *testing.T) {
	cfg := setupRegistrationTestStore(t)
	store.MutateDB(func(db *models.Database) interface{} {
		db.RegistrationDisabled = true
		db.Users = []models.User{{
			ID:          "usr_existing_github",
			Username:    "existing",
			Enabled:     true,
			Source:      "github",
			GitHubID:    "42",
			GitHubLogin: "existing",
		}}
		return nil
	})

	newProfile := &githubUserProfile{ID: 77, Login: "new-github", Name: "New GitHub"}
	if result := upsertGitHubUser(newProfile, nil, cfg, true, true); result != "registration_closed" {
		t.Fatalf("new GitHub result = %#v, want registration_closed", result)
	}

	existingProfile := &githubUserProfile{ID: 42, Login: "existing", Name: "Existing GitHub"}
	result := upsertGitHubUser(existingProfile, nil, cfg, false, false)
	user, ok := result.(*models.User)
	if !ok {
		t.Fatalf("existing GitHub result = %#v, want *models.User", result)
	}
	if user.ID != "usr_existing_github" {
		t.Fatalf("existing GitHub user ID = %q, want usr_existing_github", user.ID)
	}
}
