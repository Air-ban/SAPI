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

func setupSessionSecurityTest(t *testing.T) (*http.ServeMux, string, string, string) {
	t.Helper()
	middleware.ResetSecurityStateForTest()
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
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:       "usr_session",
			Name:     "Session User",
			Username: "session-user",
			Enabled:  true,
		}}
		return nil
	})

	db := store.ReadDB()
	adminToken := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, db.AppSecret)
	adminWrongSubToken := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "other-admin"}, db.AppSecret)
	userToken := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: "usr_session"}, db.AppSecret)

	mux := http.NewServeMux()
	MountAdminRoutes(mux)
	MountUserRoutes(mux)
	return mux, adminToken, adminWrongSubToken, userToken
}

func TestSessionEndpointsRequireMatchingRoles(t *testing.T) {
	mux, adminToken, adminWrongSubToken, userToken := setupSessionSecurityTest(t)

	adminRec := authedRequest(mux, http.MethodPost, "/api/admin/session", adminToken)
	if adminRec.Code != http.StatusOK {
		t.Fatalf("admin session returned %d body=%s", adminRec.Code, adminRec.Body.String())
	}
	assertSessionPayload(t, adminRec.Body.Bytes(), "admin", "admin")

	userRec := authedRequest(mux, http.MethodPost, "/api/user/session", userToken)
	if userRec.Code != http.StatusOK {
		t.Fatalf("user session returned %d body=%s", userRec.Code, userRec.Body.String())
	}
	assertSessionPayload(t, userRec.Body.Bytes(), "user", "usr_session")

	userToAdmin := authedRequest(mux, http.MethodPost, "/api/admin/session", userToken)
	if userToAdmin.Code != http.StatusUnauthorized {
		t.Fatalf("user token admin session returned %d, want 401 body=%s", userToAdmin.Code, userToAdmin.Body.String())
	}

	adminToUser := authedRequest(mux, http.MethodPost, "/api/user/session", adminToken)
	if adminToUser.Code != http.StatusUnauthorized {
		t.Fatalf("admin token user session returned %d, want 401 body=%s", adminToUser.Code, adminToUser.Body.String())
	}

	wrongSub := authedRequest(mux, http.MethodPost, "/api/admin/session", adminWrongSubToken)
	if wrongSub.Code != http.StatusUnauthorized {
		t.Fatalf("wrong admin sub session returned %d, want 401 body=%s", wrongSub.Code, wrongSub.Body.String())
	}
}

func TestDeprecatedSessionGETEndpointsDoNotReturnSessionData(t *testing.T) {
	mux, adminToken, _, userToken := setupSessionSecurityTest(t)

	tests := []struct {
		name  string
		path  string
		token string
	}{
		{name: "admin state", path: "/api/admin/state", token: adminToken},
		{name: "user me", path: "/api/user/me", token: userToken},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := authedRequest(mux, http.MethodGet, tt.path, tt.token)
			if rec.Code != http.StatusGone {
				t.Fatalf("%s returned %d, want 410 body=%s", tt.path, rec.Code, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), `"session"`) || strings.Contains(rec.Body.String(), `"user"`) {
				t.Fatalf("%s returned session-bearing data: %s", tt.path, rec.Body.String())
			}
			assertDeprecatedSessionNoStoreHeaders(t, rec.Header())
		})
	}
}

func TestDeletingLastUserAPIKeyDoesNotRestoreLegacyPrimaryKey(t *testing.T) {
	mux, _, _, userToken := setupSessionSecurityTest(t)

	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:       "usr_session",
			Name:     "Session User",
			Username: "session-user",
			Enabled:  true,
			APIKey:   "sk-sapi-delete-me",
			APIKeys: []models.APIKeyRecord{{
				ID:      "key_delete_me",
				Name:    "Delete Me",
				Key:     "sk-sapi-delete-me",
				Enabled: true,
			}},
		}}
		return nil
	})

	deleteRec := authedRequest(mux, http.MethodDelete, "/api/user/api-keys/key_delete_me", userToken)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete key returned %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	db := store.ReadDB()
	if len(db.Users) != 1 {
		t.Fatalf("users = %d, want 1", len(db.Users))
	}
	user := db.Users[0]
	if user.APIKey != "" {
		t.Fatalf("legacy APIKey was restored to %q, want empty", user.APIKey)
	}
	if len(user.APIKeys) != 0 {
		t.Fatalf("APIKeys = %#v, want empty", user.APIKeys)
	}
	if found := middleware.FindUserByKey("sk-sapi-delete-me"); found.User != nil || found.APIKeyRecord != nil {
		t.Fatalf("deleted API key still authenticates: user=%#v key=%#v", found.User, found.APIKeyRecord)
	}

	sessionRec := authedRequest(mux, http.MethodPost, "/api/user/session", userToken)
	if sessionRec.Code != http.StatusOK {
		t.Fatalf("user session returned %d body=%s", sessionRec.Code, sessionRec.Body.String())
	}
	var payload struct {
		User struct {
			APIKey    string        `json:"apiKey"`
			APIKeys   []interface{} `json:"apiKeys"`
			HasAPIKey bool          `json:"hasApiKey"`
		} `json:"user"`
	}
	if err := json.Unmarshal(sessionRec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.User.APIKey != "" || len(payload.User.APIKeys) != 0 || payload.User.HasAPIKey {
		t.Fatalf("session user still exposes deleted key: %#v", payload.User)
	}
}

func TestUserCanDeleteOwnAccount(t *testing.T) {
	mux, _, _, userToken := setupSessionSecurityTest(t)

	apiKey := "sk-sapi-delete-account"
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:       "usr_session",
			Name:     "Session User",
			Username: "session-user",
			Enabled:  true,
			APIKeys: []models.APIKeyRecord{{
				ID:      "key_account",
				Name:    "Account Key",
				Key:     apiKey,
				Enabled: true,
			}},
		}}
		db.InvitationCodes = []models.InvitationCode{{
			ID:   "inv_session",
			Code: "WELCOME",
			UsedBy: []models.InvitationCodeUse{{
				UserID: "usr_session",
				UsedAt: "2026-06-08T00:00:00.000Z",
			}},
			UsedCount: 1,
		}}
		db.Suggestions = []models.Suggestion{{
			ID:      "sg_session",
			UserID:  "usr_session",
			Title:   "Feedback",
			Content: "Delete me",
		}}
		return nil
	})

	store.AppendRequestLog(models.RequestLog{
		ID:        "log_session",
		UserID:    "usr_session",
		Model:     "test-model",
		Endpoint:  "/v1/chat/completions",
		Method:    "POST",
		Status:    200,
		OK:        true,
		Timestamp: store.Now(),
	})

	deleteRec := authedRequest(mux, http.MethodDelete, "/api/user/account", userToken)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete account returned %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	db := store.ReadDB()
	if len(db.Users) != 0 {
		t.Fatalf("users = %#v, want empty", db.Users)
	}
	if len(db.Suggestions) != 0 {
		t.Fatalf("suggestions = %#v, want empty", db.Suggestions)
	}
	if len(db.InvitationCodes) != 1 || db.InvitationCodes[0].UsedCount != 0 || len(db.InvitationCodes[0].UsedBy) != 0 {
		t.Fatalf("invitation uses = %#v, want cleared", db.InvitationCodes)
	}
	if found := middleware.FindUserByKey(apiKey); found.User != nil || found.APIKeyRecord != nil {
		t.Fatalf("deleted account API key still authenticates: user=%#v key=%#v", found.User, found.APIKeyRecord)
	}

	sessionRec := authedRequest(mux, http.MethodPost, "/api/user/session", userToken)
	if sessionRec.Code != http.StatusUnauthorized {
		t.Fatalf("deleted user session returned %d body=%s", sessionRec.Code, sessionRec.Body.String())
	}
	if _, ok := store.FindRequestLog("log_session", "usr_session"); ok {
		t.Fatal("deleted account request log was still found")
	}
}

func authedRequest(handler http.Handler, method, path, bearer string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func assertDeprecatedSessionNoStoreHeaders(t *testing.T, header http.Header) {
	t.Helper()
	if cacheControl := header.Get("Cache-Control"); !strings.Contains(cacheControl, "no-store") || strings.Contains(cacheControl, "public") {
		t.Fatalf("Cache-Control = %q, want no-store without public cache directive", cacheControl)
	}
	if got := header.Get("CDN-Cache-Control"); got != "no-store" {
		t.Fatalf("CDN-Cache-Control = %q, want no-store", got)
	}
	for _, want := range []string{"Authorization", "X-API-Key", "Cookie"} {
		if !headerHasValue(header, "Vary", want) {
			t.Fatalf("Vary = %q, missing %s", header.Values("Vary"), want)
		}
	}
}

func headerHasValue(header http.Header, key, want string) bool {
	for _, value := range header.Values(key) {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), want) {
				return true
			}
		}
	}
	return false
}

func assertSessionPayload(t *testing.T, body []byte, role, sub string) {
	t.Helper()
	var payload struct {
		Session struct {
			Role string `json:"role"`
			Sub  string `json:"sub"`
			Exp  int64  `json:"exp"`
		} `json:"session"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Session.Role != role || payload.Session.Sub != sub || payload.Session.Exp == 0 {
		t.Fatalf("session = %#v, want role=%q sub=%q exp>0", payload.Session, role, sub)
	}
}
