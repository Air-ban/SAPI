package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sapi/config"
	"sapi/models"
	"sapi/store"
)

func TestGitHubRedirectURLUsesExplicitCallbackWhenConfigured(t *testing.T) {
	cfg := &config.Config{
		PublicBaseURL:             "https://sapi.eterultimate.asia",
		GitHubRedirectURL:         "https://sapi.eterultimate.asia/api/auth/github/callback",
		GitHubRedirectURLExplicit: true,
		PublicBaseURLs: []string{
			"https://sapi.eterultimate.asia",
			"https://sapi.hanguan.icu",
			"https://sapicn.eterultimate.asia",
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start", nil)
	req.Host = "sapicn.eterultimate.asia"

	got := githubRedirectURLForRequest(req, cfg)
	want := "https://sapi.eterultimate.asia/api/auth/github/callback"
	if got != want {
		t.Fatalf("redirect URL = %q, want %q", got, want)
	}
}

func TestGitHubRedirectURLUsesRequestHostAllowlistWithoutExplicitCallback(t *testing.T) {
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

func TestGitHubSharedCallbackAllowsConfiguredSiblingSubdomain(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "client-secret")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.eterultimate.asia")
	t.Setenv("SAPI_PUBLIC_BASE_URLS", "https://sapi.eterultimate.asia,https://sapi.hanguan.icu,https://sapicn.eterultimate.asia")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", "https://sapi.eterultimate.asia/api/auth/github/callback")
	t.Setenv("SAPI_GITHUB_CLIENT_ID_SAPI_HANGUAN_ICU", " ")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET_SAPI_HANGUAN_ICU", " ")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL_SAPI_HANGUAN_ICU", " ")

	blockedReq := httptest.NewRequest(http.MethodGet, "/api/auth/github/start", nil)
	blockedReq.Host = "sapi.hanguan.icu"
	blockedRec := httptest.NewRecorder()

	handleGitHubStart(blockedRec, blockedReq)

	if blockedRec.Code != http.StatusNotFound {
		t.Fatalf("blocked host status = %d, want 404 body=%s", blockedRec.Code, blockedRec.Body.String())
	}

	blockedConfig := publicConfigForRequest(blockedReq)
	blockedGitHub := blockedConfig["github"].(map[string]interface{})
	if blockedGitHub["enabled"] != false {
		t.Fatalf("blocked host github enabled = %#v, want false", blockedGitHub["enabled"])
	}

	siblingReq := httptest.NewRequest(http.MethodGet, "/api/auth/github/start?terms=1", nil)
	siblingReq.Host = "sapicn.eterultimate.asia"
	siblingRec := httptest.NewRecorder()

	handleGitHubStart(siblingRec, siblingReq)

	if siblingRec.Code != http.StatusOK {
		t.Fatalf("sibling status = %d, want 200 body=%s", siblingRec.Code, siblingRec.Body.String())
	}
	siblingLocation := browserRedirectTarget(t, siblingRec)
	siblingParsed, err := url.Parse(siblingLocation)
	if err != nil {
		t.Fatal(err)
	}
	want := "https://sapi.eterultimate.asia/api/auth/github/callback"
	if got := siblingParsed.Query().Get("redirect_uri"); got != want {
		t.Fatalf("sibling redirect_uri = %q, want %q", got, want)
	}
	siblingState, err := verifyGitHubOAuthState(siblingParsed.Query().Get("state"), config.GitHubOAuthApp{
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		RedirectURL:  want,
	}, config.Load())
	if err != nil {
		t.Fatal(err)
	}
	if got := siblingState.ReturnBaseURL; got != "https://sapicn.eterultimate.asia" {
		t.Fatalf("sibling ReturnBaseURL = %q, want sapicn host", got)
	}
	if cookie := siblingRec.Header().Get("Set-Cookie"); !strings.Contains(cookie, "Domain=eterultimate.asia") {
		t.Fatalf("sibling Set-Cookie = %q, want shared eterultimate.asia domain", cookie)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start", nil)
	req.Host = "sapi.eterultimate.asia"
	rec := httptest.NewRecorder()

	handleGitHubStart(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	location := browserRedirectTarget(t, rec)
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	redirectURI := parsed.Query().Get("redirect_uri")
	if redirectURI != want {
		t.Fatalf("redirect_uri = %q, want %q location=%s", redirectURI, want, location)
	}
	stateValue := parsed.Query().Get("state")
	state, err := verifyGitHubOAuthState(stateValue, config.GitHubOAuthApp{
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		RedirectURL:  want,
	}, config.Load())
	if err != nil {
		t.Fatal(err)
	}
	if got := state.ReturnBaseURL; got != "https://sapi.eterultimate.asia" {
		t.Fatalf("ReturnBaseURL = %q, want sapi host", got)
	}
	if cookie := rec.Header().Get("Set-Cookie"); !strings.Contains(cookie, "Secure") {
		t.Fatalf("Set-Cookie = %q, want Secure for HTTPS public base URL", cookie)
	}
}

func TestGitHubOAuthUsesPerHostApp(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "primary-client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "primary-secret")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", "https://sapi.eterultimate.asia/api/auth/github/callback")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.eterultimate.asia")
	t.Setenv("SAPI_PUBLIC_BASE_URLS", "https://sapi.eterultimate.asia,https://sapicn.eterultimate.asia")
	t.Setenv("SAPI_GITHUB_CLIENT_ID_SAPICN_ETERULTIMATE_ASIA", "sapicn-client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET_SAPICN_ETERULTIMATE_ASIA", "sapicn-secret")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL_SAPICN_ETERULTIMATE_ASIA", "https://sapicn.eterultimate.asia/api/auth/github/callback")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start?terms=1", nil)
	req.Host = "sapicn.eterultimate.asia"
	rec := httptest.NewRecorder()

	handleGitHubStart(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	location := browserRedirectTarget(t, rec)
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("client_id"); got != "sapicn-client-id" {
		t.Fatalf("client_id = %q, want sapicn-client-id", got)
	}
	wantRedirect := "https://sapicn.eterultimate.asia/api/auth/github/callback"
	if got := parsed.Query().Get("redirect_uri"); got != wantRedirect {
		t.Fatalf("redirect_uri = %q, want %q", got, wantRedirect)
	}
	state, err := verifyGitHubOAuthState(parsed.Query().Get("state"), config.GitHubOAuthApp{
		ClientID:     "sapicn-client-id",
		ClientSecret: "sapicn-secret",
		RedirectURL:  wantRedirect,
	}, config.Load())
	if err != nil {
		t.Fatal(err)
	}
	if got := state.ReturnBaseURL; got != "https://sapicn.eterultimate.asia" {
		t.Fatalf("ReturnBaseURL = %q, want sapicn host", got)
	}
}

func TestGitHubOAuthRejectsUnconfiguredRequestHost(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "client-secret")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.eterultimate.asia")
	t.Setenv("SAPI_PUBLIC_BASE_URLS", "https://sapi.eterultimate.asia,https://sapicn.eterultimate.asia")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", "https://sapi.eterultimate.asia/api/auth/github/callback")
	t.Setenv("SAPI_GITHUB_CLIENT_ID_SAPI_HANGUAN_ICU", " ")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET_SAPI_HANGUAN_ICU", " ")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL_SAPI_HANGUAN_ICU", " ")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start", nil)
	req.Host = "sapi.hanguan.icu"
	rec := httptest.NewRecorder()

	handleGitHubStart(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 body=%s", rec.Code, rec.Body.String())
	}
}

func TestGitHubStartBindsAcceptedTermsToOAuthState(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "client-secret")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.hanguan.icu")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", " ")
	t.Setenv("SAPI_GITHUB_CLIENT_ID_SAPI_HANGUAN_ICU", " ")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET_SAPI_HANGUAN_ICU", " ")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL_SAPI_HANGUAN_ICU", " ")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start?terms=1", nil)
	req.Host = "sapi.hanguan.icu"
	rec := httptest.NewRecorder()

	handleGitHubStart(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
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

	location := browserRedirectTarget(t, rec)
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("state"); got != stateCookie.Value {
		t.Fatalf("oauth state = %q, want cookie state %q", got, stateCookie.Value)
	}
	state, err := verifyGitHubOAuthState(stateCookie.Value, config.GitHubOAuthApp{
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		RedirectURL:  "https://sapi.hanguan.icu/api/auth/github/callback",
	}, config.Load())
	if err != nil {
		t.Fatal(err)
	}
	if !state.TermsAccepted {
		t.Fatal("expected signed state to preserve terms acceptance")
	}
}

func TestGitHubStartPageCarriesOAuthCookiesBeforeGitHubNavigation(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "client-secret")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.eterultimate.asia")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", "https://sapi.eterultimate.asia/api/auth/github/callback")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start?terms=1", nil)
	req.Host = "sapi.eterultimate.asia"
	rec := httptest.NewRecorder()

	handleGitHubStart(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Location"); got != "" {
		t.Fatalf("Location = %q, want empty so CDN cannot follow oauth redirect", got)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Fatalf("Content-Type = %q, want html", got)
	}
	target := browserRedirectTarget(t, rec)
	if !strings.HasPrefix(target, "https://github.com/login/oauth/authorize?") {
		t.Fatalf("target = %q, want GitHub authorize URL", target)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected oauth cookies to be set before browser navigation")
	}
}

func TestGitHubCallbackPageCarriesTokenWithoutFollowableRedirect(t *testing.T) {
	rec := httptest.NewRecorder()

	redirectGitHubAuthToBase(rec, "https://sapi.eterultimate.asia", "signed-token", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Location"); got != "" {
		t.Fatalf("Location = %q, want empty so CDN cannot follow callback redirect", got)
	}
	target := browserRedirectTarget(t, rec)
	if !strings.HasPrefix(target, "https://sapi.eterultimate.asia/#github-auth?") {
		t.Fatalf("target = %q, want app github-auth route", target)
	}
	parsed, err := url.Parse(target)
	if err != nil {
		t.Fatal(err)
	}
	fragmentQuery := ""
	if idx := strings.Index(parsed.Fragment, "?"); idx >= 0 {
		fragmentQuery = parsed.Fragment[idx+1:]
	}
	params, err := url.ParseQuery(fragmentQuery)
	if err != nil {
		t.Fatal(err)
	}
	if got := params.Get("token"); got != "signed-token" {
		t.Fatalf("token = %q, want signed-token", got)
	}
}

func TestGitHubCallbackForwardsSiblingSubdomainState(t *testing.T) {
	t.Setenv("SAPI_GITHUB_CLIENT_ID", "client-id")
	t.Setenv("SAPI_GITHUB_CLIENT_SECRET", "client-secret")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.eterultimate.asia")
	t.Setenv("SAPI_PUBLIC_BASE_URLS", "https://sapi.eterultimate.asia,https://sapicn.eterultimate.asia")
	t.Setenv("SAPI_GITHUB_REDIRECT_URL", "https://sapi.eterultimate.asia/api/auth/github/callback")

	app := config.GitHubOAuthApp{
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		RedirectURL:  "https://sapi.eterultimate.asia/api/auth/github/callback",
	}
	state, err := signGitHubPayload(githubOAuthState{
		Kind:          githubStateKind,
		Nonce:         "nonce",
		ClientID:      app.ClientID,
		RedirectURL:   app.RedirectURL,
		ReturnBaseURL: "https://sapicn.eterultimate.asia",
		TermsAccepted: true,
		ExpiresAt:     time.Now().Add(time.Minute).Unix(),
	}, app.ClientSecret)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/callback?code=github-code&state="+url.QueryEscape(state), nil)
	req.Host = "sapi.eterultimate.asia"
	req.AddCookie(&http.Cookie{Name: githubStateCookieName, Value: state})
	req.AddCookie(&http.Cookie{Name: githubTermsCookieName, Value: state})
	rec := httptest.NewRecorder()

	handleGitHubCallback(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	target := browserRedirectTarget(t, rec)
	parsed, err := url.Parse(target)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Scheme + "://" + parsed.Host + parsed.Path; got != "https://sapicn.eterultimate.asia/api/auth/github/callback" {
		t.Fatalf("forward target = %q, want sapicn callback", got)
	}
	if got := parsed.Query().Get("code"); got != "github-code" {
		t.Fatalf("forward code = %q, want github-code", got)
	}
	if got := parsed.Query().Get("state"); got != state {
		t.Fatalf("forward state mismatch")
	}
	if got := rec.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie = %#v, want none so sibling callback can still read state", got)
	}
}

func TestPublicBaseURLUsesForwardedHostBehindProxy(t *testing.T) {
	cfg := &config.Config{
		PublicBaseURL: "https://sapi.eterultimate.asia",
		PublicBaseURLs: []string{
			"https://sapi.eterultimate.asia",
		},
		GitHubRedirectURL:         "https://sapi.eterultimate.asia/api/auth/github/callback",
		GitHubRedirectURLExplicit: true,
		GitHubClientID:            "client-id",
		GitHubClientSecret:        "client-secret",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/github/start", nil)
	req.Host = "127.0.0.1:3000"
	req.Header.Set("X-Forwarded-Host", "sapi.eterultimate.asia")

	got := publicBaseURLForRequest(req, cfg)
	if got != "https://sapi.eterultimate.asia" {
		t.Fatalf("public base URL = %q, want forwarded public host", got)
	}
	if _, ok := githubOAuthAppForRequest(req, cfg); !ok {
		t.Fatal("expected GitHub OAuth to be enabled for forwarded public host")
	}
}

func TestGitHubOAuthStateRejectsUnconfiguredReturnBaseURL(t *testing.T) {
	cfg := &config.Config{
		PublicBaseURL:  "https://sapi.hanguan.icu",
		PublicBaseURLs: []string{"https://sapi.hanguan.icu"},
	}
	app := config.GitHubOAuthApp{
		ClientID:     "client-id",
		ClientSecret: "secret",
		RedirectURL:  "https://sapi.hanguan.icu/api/auth/github/callback",
	}
	state, err := signGitHubPayload(githubOAuthState{
		Kind:          githubStateKind,
		Nonce:         "nonce",
		ClientID:      app.ClientID,
		RedirectURL:   app.RedirectURL,
		ReturnBaseURL: "https://evil.example.com",
		ExpiresAt:     time.Now().Add(time.Minute).Unix(),
	}, app.ClientSecret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyGitHubOAuthState(state, app, cfg); err == nil {
		t.Fatal("expected unconfigured return URL to be rejected")
	}
}

func browserRedirectTarget(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	body := rec.Body.String()
	marker := "window.location.replace("
	start := strings.Index(body, marker)
	if start < 0 {
		t.Fatalf("start page missing redirect script: %s", body)
	}
	start += len(marker)
	end := strings.Index(body[start:], ");")
	if end < 0 {
		t.Fatalf("start page has malformed redirect script: %s", body)
	}
	var target string
	if err := json.Unmarshal([]byte(body[start:start+end]), &target); err != nil {
		t.Fatalf("parse redirect target: %v body=%s", err, body)
	}
	return target
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
