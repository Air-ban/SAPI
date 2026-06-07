package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"sapi/config"
	"sapi/models"
	"sapi/store"
)

func TestGitHubRedirectURLUsesRequestHostAllowlist(t *testing.T) {
	cfg := &config.Config{
		PublicBaseURL: "https://sapi.hanguan.icu",
		PublicBaseURLs: []string{
			"https://sapi.hanguan.icu",
			"https://sapicn.eterultimate.asia",
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start", nil)
	req.Host = "sapicn.eterultimate.asia"

	got := githubRedirectURLForRequest(req, cfg)
	want := "https://sapicn.eterultimate.asia/api/auth/github/callback"
	if got != want {
		t.Fatalf("redirect URL = %q, want %q", got, want)
	}

	req.Host = "sapi.hanguan.icu"
	got = githubRedirectURLForRequest(req, cfg)
	want = "https://sapi.hanguan.icu/api/auth/github/callback"
	if got != want {
		t.Fatalf("redirect URL = %q, want %q", got, want)
	}
}

func TestGitHubStartSendsRequestHostRedirectURI(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "client-secret")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.hanguan.icu")
	t.Setenv("SAPI_PUBLIC_BASE_URLS", "https://sapi.hanguan.icu,https://sapicn.eterultimate.asia")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", "")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start", nil)
	req.Host = "sapicn.eterultimate.asia"
	rec := httptest.NewRecorder()

	handleGitHubStart(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 body=%s", rec.Code, rec.Body.String())
	}
	location := rec.Header().Get("Location")
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	redirectURI := parsed.Query().Get("redirect_uri")
	want := "https://sapicn.eterultimate.asia/api/auth/github/callback"
	if redirectURI != want {
		t.Fatalf("redirect_uri = %q, want %q location=%s", redirectURI, want, location)
	}
	if cookie := rec.Header().Get("Set-Cookie"); !strings.Contains(cookie, "Secure") {
		t.Fatalf("Set-Cookie = %q, want Secure for HTTPS public base URL", cookie)
	}
}

func TestGitHubStartBindsAcceptedTermsToOAuthState(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "client-secret")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.hanguan.icu")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", "")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start?terms=1", nil)
	req.Host = "sapi.hanguan.icu"
	rec := httptest.NewRecorder()

	handleGitHubStart(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 body=%s", rec.Code, rec.Body.String())
	}

	var stateCookie, termsCookie *http.Cookie
	for _, cookie := range rec.Result().Cookies() {
		switch cookie.Name {
		case githubStateCookieName:
			stateCookie = cookie
		case githubTermsCookieName:
			termsCookie = cookie
		}
	}
	if stateCookie == nil || stateCookie.Value == "" {
		t.Fatalf("state cookie = %#v, want non-empty", stateCookie)
	}
	if termsCookie == nil || termsCookie.Value == "" {
		t.Fatalf("terms cookie = %#v, want non-empty", termsCookie)
	}
	if termsCookie.Value != stateCookie.Value {
		t.Fatalf("terms cookie = %q, want state %q", termsCookie.Value, stateCookie.Value)
	}

	location := rec.Header().Get("Location")
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("state"); got != stateCookie.Value {
		t.Fatalf("oauth state = %q, want cookie state %q", got, stateCookie.Value)
	}
}

func TestGitHubFollowCheckUsesPublicFollowingEndpoint(t *testing.T) {
	originalBaseURL := githubAPIBaseURL
	originalClient := githubHTTPClient
	defer func() {
		githubAPIBaseURL = originalBaseURL
		githubHTTPClient = originalClient
	}()

	following := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/candidate/following/EterUltimate" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Accept"); got != "application/vnd.github+json" {
			t.Fatalf("Accept = %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "SAPI" {
			t.Fatalf("User-Agent = %q", got)
		}
		if following {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	githubAPIBaseURL = server.URL
	githubHTTPClient = server.Client()

	ok, err := isGitHubUserFollowing(context.Background(), "", "candidate", "EterUltimate")
	if err != nil {
		t.Fatalf("follow check returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected following user to be allowed")
	}

	following = false
	ok, err = isGitHubUserFollowing(context.Background(), "", "candidate", "EterUltimate")
	if err != nil {
		t.Fatalf("follow check returned error: %v", err)
	}
	if ok {
		t.Fatal("expected non-following user to be rejected")
	}
}

func TestGitHubRegistrationRequiresConfiguredFollowTarget(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{}
		return nil
	})

	cfg := &config.Config{AdminUser: "admin", GitHubRequiredFollowTarget: "EterUltimate"}
	profile := &githubUserProfile{ID: 42, Login: "candidate", Name: "Candidate"}

	if result := upsertGitHubUser(profile, nil, cfg, false, false); result != "terms_required" {
		t.Fatalf("result = %#v, want terms_required", result)
	}

	if result := upsertGitHubUser(profile, nil, cfg, false, true); result != "github_follow_required" {
		t.Fatalf("result = %#v, want github_follow_required", result)
	}

	result := upsertGitHubUser(profile, nil, cfg, true, true)
	user, ok := result.(*models.User)
	if !ok {
		t.Fatalf("result = %#v, want *models.User", result)
	}
	if user.Source != "github" || user.GitHubLogin != "candidate" {
		t.Fatalf("created user = %#v", user)
	}
}

func TestGitHubLoginAllowsExistingLinkedUserWithoutTerms(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:          "usr_existing",
			Username:    "existing",
			Enabled:     true,
			Source:      "github",
			GitHubID:    "42",
			GitHubLogin: "candidate",
		}}
		return nil
	})

	cfg := &config.Config{AdminUser: "admin", GitHubRequiredFollowTarget: "EterUltimate"}
	profile := &githubUserProfile{ID: 42, Login: "candidate", Name: "Candidate"}

	result := upsertGitHubUser(profile, nil, cfg, false, false)
	user, ok := result.(*models.User)
	if !ok {
		t.Fatalf("result = %#v, want existing *models.User", result)
	}
	if user.ID != "usr_existing" {
		t.Fatalf("user ID = %q, want usr_existing", user.ID)
	}
}

func TestGitHubEmailAccountLinkRequiresTerms(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:           "usr_email",
			Username:     "email-user",
			Email:        "candidate@example.com",
			PasswordHash: "password-hash",
			Enabled:      true,
			Source:       "edu",
		}}
		return nil
	})

	cfg := &config.Config{AdminUser: "admin", GitHubRequiredFollowTarget: "EterUltimate"}
	profile := &githubUserProfile{ID: 42, Login: "candidate", Name: "Candidate"}
	emails := []githubEmailRecord{{Email: "candidate@example.com", Primary: true, Verified: true}}

	if result := upsertGitHubUser(profile, emails, cfg, true, false); result != "terms_required" {
		t.Fatalf("result = %#v, want terms_required", result)
	}
	if result := upsertGitHubUser(profile, emails, cfg, false, true); result != "github_follow_required" {
		t.Fatalf("result = %#v, want github_follow_required", result)
	}

	result := upsertGitHubUser(profile, emails, cfg, true, true)
	user, ok := result.(*models.User)
	if !ok {
		t.Fatalf("result = %#v, want *models.User", result)
	}
	if user.ID != "usr_email" || user.GitHubID != "42" {
		t.Fatalf("linked user = %#v", user)
	}
}

func TestGitHubFollowRequirementSkipsExistingLinkedUser(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:          "usr_existing",
			Username:    "existing",
			Enabled:     true,
			Source:      "github",
			GitHubID:    "42",
			GitHubLogin: "candidate",
		}}
		return nil
	})

	cfg := &config.Config{GitHubRequiredFollowTarget: "EterUltimate"}
	profile := &githubUserProfile{ID: 42, Login: "candidate"}

	if shouldCheckGitHubFollowRequirement(profile, cfg) {
		t.Fatal("expected linked GitHub user to skip follow check on login")
	}
}
