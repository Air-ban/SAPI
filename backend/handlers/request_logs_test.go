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
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
)

func setupRequestLogTest(t *testing.T) (*http.ServeMux, string, string, string) {
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
		db.Users = append(db.Users,
			models.User{ID: "usr_owner", Name: "Owner", Username: "owner", Enabled: true},
			models.User{ID: "usr_other", Name: "Other", Username: "other", Enabled: true},
		)
		return nil
	})
	store.AppendRequestLog(models.RequestLog{
		ID:             "log_with_content",
		UserID:         "usr_owner",
		UserName:       "Owner",
		Username:       "owner",
		Model:          "test-model",
		Endpoint:       "/v1/chat/completions",
		Method:         http.MethodPost,
		Status:         http.StatusOK,
		OK:             true,
		PromptTokens:   3,
		TotalTokens:    5,
		RequestContent: map[string]interface{}{"messages": []interface{}{"large-secret-payload"}},
		Timestamp:      store.Now(),
	})

	db := store.ReadDB()
	adminToken := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: "admin"}, db.AppSecret)
	ownerToken := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: "usr_owner"}, db.AppSecret)
	otherToken := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: "usr_other"}, db.AppSecret)

	mux := http.NewServeMux()
	MountAdminRoutes(mux)
	MountUserRoutes(mux)
	return mux, adminToken, ownerToken, otherToken
}

func TestAdminSessionOmitsUsageByDefault(t *testing.T) {
	mux, adminToken, _, _ := setupRequestLogTest(t)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/session", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected admin session to return 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, `"usage"`) || strings.Contains(body, "requestContent") ||
		strings.Contains(body, "hasRequestContent") || strings.Contains(body, "large-secret-payload") {
		t.Fatalf("admin session should be lightweight by default, body=%s", body)
	}
}

func TestAdminSessionCanIncludeUsageWithoutRequestContent(t *testing.T) {
	mux, adminToken, _, _ := setupRequestLogTest(t)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/session?includeUsage=true", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected admin session to return 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"usage"`) {
		t.Fatalf("admin session should include usage when requested, body=%s", body)
	}
	if strings.Contains(body, "requestContent") || strings.Contains(body, "large-secret-payload") {
		t.Fatalf("admin session usage should not include full request content, body=%s", body)
	}
	if !strings.Contains(body, `"hasRequestContent":true`) {
		t.Fatalf("admin session usage should include request content marker, body=%s", body)
	}
}

func TestRequestLogDetailReturnsContentWithAccessControl(t *testing.T) {
	mux, adminToken, ownerToken, otherToken := setupRequestLogTest(t)

	adminReq := httptest.NewRequest(http.MethodGet, "/api/admin/request-logs/log_with_content", nil)
	adminReq.Header.Set("Authorization", "Bearer "+adminToken)
	adminRec := httptest.NewRecorder()
	mux.ServeHTTP(adminRec, adminReq)
	if adminRec.Code != http.StatusOK || !strings.Contains(adminRec.Body.String(), "large-secret-payload") {
		t.Fatalf("expected admin detail to include request content, got %d body=%s", adminRec.Code, adminRec.Body.String())
	}

	ownerReq := httptest.NewRequest(http.MethodGet, "/api/user/request-logs/log_with_content", nil)
	ownerReq.Header.Set("Authorization", "Bearer "+ownerToken)
	ownerRec := httptest.NewRecorder()
	mux.ServeHTTP(ownerRec, ownerReq)
	if ownerRec.Code != http.StatusOK || !strings.Contains(ownerRec.Body.String(), "large-secret-payload") {
		t.Fatalf("expected owner detail to include request content, got %d body=%s", ownerRec.Code, ownerRec.Body.String())
	}

	otherReq := httptest.NewRequest(http.MethodGet, "/api/user/request-logs/log_with_content", nil)
	otherReq.Header.Set("Authorization", "Bearer "+otherToken)
	otherRec := httptest.NewRecorder()
	mux.ServeHTTP(otherRec, otherReq)
	if otherRec.Code != http.StatusNotFound {
		t.Fatalf("expected other user to get 404, got %d body=%s", otherRec.Code, otherRec.Body.String())
	}
}

func TestAdminUserUsageFiltersByUser(t *testing.T) {
	mux, adminToken, _, _ := setupRequestLogTest(t)

	store.AppendRequestLog(models.RequestLog{
		ID:           "log_other_usage",
		UserID:       "usr_other",
		UserName:     "Other",
		Username:     "other",
		Model:        "test-model",
		Status:       http.StatusOK,
		OK:           true,
		PromptTokens: 100,
		TotalTokens:  150,
		Timestamp:    store.Now(),
	})

	req := httptest.NewRequest(http.MethodGet, "/api/admin/users/usr_owner/usage?days=365", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected admin user usage to return 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Days  int `json:"days"`
		Usage struct {
			Requests    int `json:"requests"`
			TotalTokens int `json:"totalTokens"`
			ByUser      []struct {
				UserID string `json:"userId"`
			} `json:"byUser"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Days != 365 {
		t.Fatalf("days = %d, want 365", payload.Days)
	}
	if payload.Usage.Requests != 1 || payload.Usage.TotalTokens != 5 {
		t.Fatalf("expected only owner usage, got requests=%d totalTokens=%d", payload.Usage.Requests, payload.Usage.TotalTokens)
	}
	for _, row := range payload.Usage.ByUser {
		if row.UserID != "usr_owner" {
			t.Fatalf("usage included unexpected user %q", row.UserID)
		}
	}
}

func TestAdminUserRequestLogsExportIncludesContent(t *testing.T) {
	mux, adminToken, _, _ := setupRequestLogTest(t)

	req := httptest.NewRequest(http.MethodGet, "/api/admin/users/usr_owner/request-logs/export?days=7", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected export to return 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") || !strings.Contains(got, "owner") {
		t.Fatalf("unexpected content disposition %q", got)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "large-secret-payload") {
		t.Fatalf("expected export to include request content, body=%s", body)
	}

	var payload struct {
		RequestLogCount int `json:"requestLogCount"`
		RequestLogs     []struct {
			UserID         string                 `json:"userId"`
			RequestContent map[string]interface{} `json:"requestContent"`
		} `json:"requestLogs"`
		User map[string]interface{} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.RequestLogCount != 1 || len(payload.RequestLogs) != 1 {
		t.Fatalf("expected one exported log, got count=%d len=%d", payload.RequestLogCount, len(payload.RequestLogs))
	}
	if payload.RequestLogs[0].UserID != "usr_owner" || payload.RequestLogs[0].RequestContent == nil {
		t.Fatalf("unexpected exported log %#v", payload.RequestLogs[0])
	}
	if _, ok := payload.User["apiKey"]; ok {
		t.Fatal("exported user summary should not include API key material")
	}
}

func TestFileStoreKeepsRequestContentOutOfMainState(t *testing.T) {
	dataFile := filepath.Join(t.TempDir(), "sapi.json")
	t.Setenv("SAPI_DATA_FILE", dataFile)
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	if err := store.Init(context.Background(), config.Load()); err != nil {
		t.Fatal(err)
	}

	store.AppendRequestLog(models.RequestLog{
		ID:             "log_file_split",
		UserID:         "usr_file",
		Status:         http.StatusOK,
		OK:             true,
		RequestContent: map[string]interface{}{"prompt": "payload-kept-in-jsonl"},
		Timestamp:      store.Now(),
	})

	mainState, err := os.ReadFile(dataFile)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(mainState), "payload-kept-in-jsonl") || strings.Contains(string(mainState), "requestContent") {
		t.Fatalf("main state should not persist full request content, got %s", string(mainState))
	}

	item, ok := store.FindRequestLog("log_file_split", "usr_file")
	if !ok {
		t.Fatal("expected request log detail to be found from jsonl")
	}
	if item.RequestContent["prompt"] != "payload-kept-in-jsonl" {
		t.Fatalf("expected full request content from jsonl, got %#v", item.RequestContent)
	}

	if err := store.Init(context.Background(), config.Load()); err != nil {
		t.Fatal(err)
	}
	db := store.ReadDB()
	if len(db.RequestLogs) != 0 {
		t.Fatalf("startup should not preload jsonl request logs, got %d", len(db.RequestLogs))
	}
	logs := store.RequestLogsSince(db, time.Now().UTC().Add(-time.Hour), "usr_file", 10)
	if len(logs) != 1 || logs[0].ID != "log_file_split" {
		t.Fatalf("expected request log summary to be loaded on demand, got %#v", logs)
	}
}
