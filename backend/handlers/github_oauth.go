package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
	"sapi/utils"
)

const (
	githubStateCookieName = "sapi_github_oauth_state"
	githubTermsCookieName = "sapi_github_terms_state"
	githubStateMaxAge     = 10 * time.Minute
	githubStateKind       = "oauth_state"
)

var (
	githubAPIBaseURL = "https://api.github.com"
	githubHTTPClient = http.DefaultClient
)

type githubUserProfile struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

type githubEmailRecord struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

type githubTokenResponse struct {
	AccessToken      string `json:"access_token"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

type githubOAuthState struct {
	Kind          string `json:"kind"`
	Nonce         string `json:"nonce"`
	ClientID      string `json:"clientId"`
	RedirectURL   string `json:"redirectUrl"`
	ReturnBaseURL string `json:"returnBaseUrl"`
	TermsAccepted bool   `json:"termsAccepted"`
	ExpiresAt     int64  `json:"expiresAt"`
}

func handleGitHubStart(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	app, ok := githubOAuthAppForRequest(r, cfg)
	if !ok {
		utils.SendError(w, 404, "GitHub login is not configured.", "github_not_configured")
		return
	}

	statePayload := githubOAuthState{
		Kind:          githubStateKind,
		Nonce:         auth.RandomSecret(),
		ClientID:      app.ClientID,
		RedirectURL:   app.RedirectURL,
		ReturnBaseURL: publicBaseURLForRequest(r, cfg),
		TermsAccepted: githubTermsAcceptedFromStart(r),
		ExpiresAt:     time.Now().Add(githubStateMaxAge).Unix(),
	}
	state, err := signGitHubPayload(statePayload, app.ClientSecret)
	if err != nil {
		utils.SendError(w, 500, "GitHub login is temporarily unavailable.", "github_not_configured")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     githubStateCookieName,
		Value:    state,
		Path:     "/api/auth/github",
		MaxAge:   int(githubStateMaxAge.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   shouldUseSecureCookie(r, cfg),
	})
	if statePayload.TermsAccepted {
		http.SetCookie(w, &http.Cookie{
			Name:     githubTermsCookieName,
			Value:    state,
			Path:     "/api/auth/github",
			MaxAge:   int(githubStateMaxAge.Seconds()),
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   shouldUseSecureCookie(r, cfg),
		})
	} else {
		clearGitHubTermsCookie(w, r, cfg)
	}

	params := url.Values{}
	params.Set("client_id", app.ClientID)
	params.Set("redirect_uri", app.RedirectURL)
	params.Set("scope", "read:user user:email")
	params.Set("state", state)

	writeBrowserRedirectPage(w, "https://github.com/login/oauth/authorize?"+params.Encode())
}

func handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	app, ok := githubOAuthAppForRequest(r, cfg)
	if !ok {
		redirectGitHubAuth(w, r, cfg, "", "github_not_configured")
		return
	}

	cookie, cookieErr := r.Cookie(githubStateCookieName)
	clearGitHubStateCookie(w, r, cfg)
	clearGitHubTermsCookie(w, r, cfg)
	state := security.SafeSingleLine(r.URL.Query().Get("state"), 4096)
	if cookieErr != nil || state == "" || !auth.SafeEqual(cookie.Value, state) {
		redirectGitHubAuth(w, r, cfg, "", "invalid_state")
		return
	}
	statePayload, err := verifyGitHubOAuthState(state, app, cfg)
	if err != nil {
		redirectGitHubAuth(w, r, cfg, "", "invalid_state")
		return
	}
	termsAccepted := statePayload.TermsAccepted
	if githubTermsAcceptedForState(r, cookie.Value) {
		termsAccepted = true
	}
	returnBaseURL := statePayload.ReturnBaseURL

	code := security.SafeSingleLine(r.URL.Query().Get("code"), 512)
	if code == "" {
		redirectGitHubAuthToBase(w, returnBaseURL, "", "missing_code")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	accessToken, err := exchangeGitHubCode(ctx, app, code)
	if err != nil {
		redirectGitHubAuthToBase(w, returnBaseURL, "", "token_exchange_failed")
		return
	}

	profile, emails, err := fetchGitHubProfile(ctx, accessToken)
	if err != nil {
		redirectGitHubAuthToBase(w, returnBaseURL, "", "profile_fetch_failed")
		return
	}

	followAllowed := true
	if shouldCheckGitHubFollowRequirement(profile, cfg) {
		var err error
		followAllowed, err = checkGitHubFollowRequirement(ctx, accessToken, profile, cfg)
		if err != nil {
			redirectGitHubAuthToBase(w, returnBaseURL, "", "github_follow_check_failed")
			return
		}
	}

	userResult := upsertGitHubUser(profile, emails, cfg, followAllowed, termsAccepted)
	if errCode, ok := userResult.(string); ok {
		redirectGitHubAuthToBase(w, returnBaseURL, "", errCode)
		return
	}

	db := store.ReadDB()
	user := userResult.(*models.User)
	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: user.ID}, db.AppSecret)
	redirectGitHubAuthToBase(w, returnBaseURL, token, "")
}

func exchangeGitHubCode(ctx context.Context, app config.GitHubOAuthApp, code string) (string, error) {
	form := url.Values{}
	form.Set("client_id", app.ClientID)
	form.Set("client_secret", app.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", app.RedirectURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "SAPI")

	resp, err := githubHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var payload githubTokenResponse
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 || payload.AccessToken == "" || payload.Error != "" {
		if payload.ErrorDescription != "" {
			return "", fmt.Errorf("%s", payload.ErrorDescription)
		}
		return "", fmt.Errorf("github token exchange returned HTTP %d", resp.StatusCode)
	}
	return payload.AccessToken, nil
}

func fetchGitHubProfile(ctx context.Context, token string) (*githubUserProfile, []githubEmailRecord, error) {
	var profile githubUserProfile
	if err := getGitHubJSON(ctx, token, githubAPIURL("/user"), &profile); err != nil {
		return nil, nil, err
	}

	var emails []githubEmailRecord
	if err := getGitHubJSON(ctx, token, githubAPIURL("/user/emails"), &emails); err != nil {
		emails = []githubEmailRecord{}
	}

	return &profile, emails, nil
}

func getGitHubJSON(ctx context.Context, token, endpoint string, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "SAPI")

	resp, err := githubHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("github API returned HTTP %d", resp.StatusCode)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	return decoder.Decode(target)
}

func checkGitHubFollowRequirement(ctx context.Context, token string, profile *githubUserProfile, cfg *config.Config) (bool, error) {
	target := ""
	if cfg != nil {
		target = strings.TrimSpace(strings.TrimPrefix(cfg.GitHubRequiredFollowTarget, "@"))
	}
	if target == "" {
		return true, nil
	}
	if profile == nil || strings.TrimSpace(profile.Login) == "" {
		return false, fmt.Errorf("github profile login is empty")
	}
	login := strings.TrimSpace(profile.Login)
	if strings.EqualFold(login, target) {
		return true, nil
	}
	return isGitHubUserFollowing(ctx, token, login, target)
}

func shouldCheckGitHubFollowRequirement(profile *githubUserProfile, cfg *config.Config) bool {
	if cfg == nil || strings.TrimSpace(cfg.GitHubRequiredFollowTarget) == "" {
		return false
	}
	if profile == nil {
		return true
	}
	githubID := strconv.FormatInt(profile.ID, 10)
	if githubID == "" || githubID == "0" {
		return true
	}
	db := store.ReadDB()
	for _, user := range db.Users {
		if user.GitHubID != "" && auth.SafeEqual(user.GitHubID, githubID) {
			return false
		}
	}
	return true
}

func isGitHubUserFollowing(ctx context.Context, token, username, target string) (bool, error) {
	endpoint := fmt.Sprintf("%s/users/%s/following/%s",
		strings.TrimRight(githubAPIBaseURL, "/"),
		url.PathEscape(strings.TrimSpace(username)),
		url.PathEscape(strings.TrimSpace(target)),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "SAPI")

	resp, err := githubHTTPClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNoContent:
		return true, nil
	case http.StatusNotFound:
		return false, nil
	default:
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return false, fmt.Errorf("github follow check returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
}

func githubAPIURL(path string) string {
	return strings.TrimRight(githubAPIBaseURL, "/") + path
}

func upsertGitHubUser(profile *githubUserProfile, emails []githubEmailRecord, cfg *config.Config, allowGitHubRegistration, termsAccepted bool) interface{} {
	githubID := strconv.FormatInt(profile.ID, 10)
	if githubID == "" || githubID == "0" {
		return "invalid_profile"
	}
	login := security.SafeSingleLine(profile.Login, 120)
	name := security.SafeSingleLine(profile.Name, 120)
	if name == "" {
		name = login
	}
	email := chooseGitHubEmail(profile, emails)
	avatar := security.SafeSingleLine(profile.AvatarURL, 2048)

	return store.MutateDB(func(db *models.Database) interface{} {
		foundIdx := -1
		for i := range db.Users {
			if db.Users[i].GitHubID != "" && auth.SafeEqual(db.Users[i].GitHubID, githubID) {
				foundIdx = i
				break
			}
		}
		if foundIdx < 0 && email != "" {
			for i := range db.Users {
				if strings.EqualFold(db.Users[i].Email, email) {
					foundIdx = i
					break
				}
			}
		}

		now := store.Now()
		if foundIdx >= 0 {
			u := &db.Users[foundIdx]
			if !u.Enabled {
				return "user_disabled"
			}
			if u.GitHubID != "" && !auth.SafeEqual(u.GitHubID, githubID) {
				return "github_account_conflict"
			}
			if u.GitHubID == "" {
				if !termsAccepted {
					return "terms_required"
				}
				if !allowGitHubRegistration {
					return "github_follow_required"
				}
			}
			u.GitHubID = githubID
			u.GitHubLogin = login
			u.GitHubAvatarURL = avatar
			if u.GitHubLinkedAt == "" {
				u.GitHubLinkedAt = now
			}
			if u.Source == "" || u.PasswordHash == "" {
				u.Source = "github"
			}
			if u.Name == "" {
				u.Name = name
			}
			if u.Username == "" {
				u.Username = uniqueGitHubUsername(db, login, githubID, cfg.AdminUser)
			}
			if u.Email == "" && email != "" {
				u.Email = email
			}
			u.UpdatedAt = now
			return u
		}

		if !termsAccepted {
			return "terms_required"
		}
		if !allowGitHubRegistration {
			return "github_follow_required"
		}

		username := uniqueGitHubUsername(db, login, githubID, cfg.AdminUser)
		if name == "" {
			name = username
		}
		user := models.User{
			ID:                       auth.RandomID("usr"),
			Username:                 username,
			Email:                    email,
			Name:                     name,
			APIKey:                   "",
			APIKeys:                  []models.APIKeyRecord{},
			Enabled:                  true,
			ReceiveAnnouncementEmail: true,
			Source:                   "github",
			GitHubID:                 githubID,
			GitHubLogin:              login,
			GitHubAvatarURL:          avatar,
			GitHubLinkedAt:           now,
			SubscriptionTier:         subscription.TierLite,
			CreatedAt:                now,
			UpdatedAt:                now,
		}
		db.Users = append(db.Users, user)
		return &db.Users[len(db.Users)-1]
	})
}

func chooseGitHubEmail(profile *githubUserProfile, emails []githubEmailRecord) string {
	for _, item := range emails {
		if item.Primary && item.Verified && item.Email != "" {
			return strings.ToLower(security.SafeSingleLine(item.Email, 254))
		}
	}
	for _, item := range emails {
		if item.Verified && item.Email != "" {
			return strings.ToLower(security.SafeSingleLine(item.Email, 254))
		}
	}
	if profile.Email != "" {
		return strings.ToLower(security.SafeSingleLine(profile.Email, 254))
	}
	return ""
}

func uniqueGitHubUsername(db *models.Database, login, githubID, adminUser string) string {
	base := cleanGitHubUsername(login)
	if !validUsername(base) {
		base = "github-" + strings.TrimSpace(githubID)
	}
	if len(base) > 54 {
		base = strings.TrimRight(base[:54], ".-_")
	}
	if !validUsername(base) {
		base = "github-user"
	}

	for i := 0; i < 1000; i++ {
		candidate := base
		if i > 0 {
			suffix := "-" + strconv.Itoa(i+1)
			trimLen := 64 - len(suffix)
			if len(candidate) > trimLen {
				candidate = strings.TrimRight(candidate[:trimLen], ".-_")
			}
			candidate += suffix
		}
		if !validUsername(candidate) || auth.SafeEqual(candidate, normalizeUsername(adminUser)) {
			continue
		}
		taken := false
		for _, u := range db.Users {
			if normalizeUsername(u.Username) == candidate {
				taken = true
				break
			}
			if u.Username == "" && normalizeUsername(u.Name) == candidate {
				taken = true
				break
			}
		}
		if !taken {
			return candidate
		}
	}

	return uniqueFallbackGitHubUsername(db, adminUser)
}

func cleanGitHubUsername(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, c := range value {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' {
			b.WriteRune(c)
		}
	}
	return strings.Trim(b.String(), ".-_")
}

func uniqueFallbackGitHubUsername(db *models.Database, adminUser string) string {
	for i := 0; i < 1000; i++ {
		candidate := "github-user-" + strconv.Itoa(i+1)
		if auth.SafeEqual(candidate, normalizeUsername(adminUser)) {
			continue
		}
		taken := false
		for _, u := range db.Users {
			if normalizeUsername(u.Username) == candidate {
				taken = true
				break
			}
		}
		if !taken {
			return candidate
		}
	}
	return "github-user"
}

func redirectGitHubAuth(w http.ResponseWriter, r *http.Request, cfg *config.Config, token, errCode string) {
	base := strings.TrimRight(publicBaseURLForRequest(r, cfg), "/")
	if base == "" {
		base = "/"
	}
	redirectGitHubAuthToBase(w, base, token, errCode)
}

func redirectGitHubAuthToBase(w http.ResponseWriter, base, token, errCode string) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		base = "/"
	}
	params := url.Values{}
	if token != "" {
		params.Set("token", token)
	}
	if errCode != "" {
		params.Set("error", errCode)
	}
	target := base + "/#github-auth"
	if encoded := params.Encode(); encoded != "" {
		target += "?" + encoded
	}
	writeBrowserRedirectPage(w, target)
}

func writeBrowserRedirectPage(w http.ResponseWriter, target string) {
	targetJSON, _ := json.Marshal(target)
	targetHTML := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
	).Replace(target)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0;url=%s">
  <title>Redirecting</title>
</head>
<body>
  <p>Redirecting...</p>
  <p><a href="%s">Continue</a></p>
  <script>window.location.replace(%s);</script>
</body>
</html>`, targetHTML, targetHTML, string(targetJSON))
}

func signGitHubPayload(payload interface{}, secret string) (string, error) {
	if strings.TrimSpace(secret) == "" {
		return "", fmt.Errorf("missing github secret")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return body + "." + signature, nil
}

func verifyGitHubPayload(value, secret string, target interface{}) error {
	parts := strings.Split(value, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.TrimSpace(secret) == "" {
		return fmt.Errorf("invalid signed payload")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !auth.SafeEqual(parts[1], expected) {
		return fmt.Errorf("invalid signed payload signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return err
	}
	return nil
}

func verifyGitHubOAuthState(value string, app config.GitHubOAuthApp, cfg *config.Config) (*githubOAuthState, error) {
	var state githubOAuthState
	if err := verifyGitHubPayload(value, app.ClientSecret, &state); err != nil {
		return nil, err
	}
	if state.Kind != githubStateKind || state.Nonce == "" || state.ExpiresAt < time.Now().Unix() {
		return nil, fmt.Errorf("expired github state")
	}
	if state.ClientID != app.ClientID || !auth.SafeEqual(state.RedirectURL, app.RedirectURL) {
		return nil, fmt.Errorf("github state audience mismatch")
	}
	if !samePublicBaseURL(state.ReturnBaseURL, publicBaseURLFromAbsoluteURL(app.RedirectURL)) {
		return nil, fmt.Errorf("invalid github return base URL")
	}
	state.ReturnBaseURL = strings.TrimRight(strings.TrimSpace(state.ReturnBaseURL), "/")
	return &state, nil
}

func clearGitHubStateCookie(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	http.SetCookie(w, &http.Cookie{
		Name:     githubStateCookieName,
		Value:    "",
		Path:     "/api/auth/github",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   shouldUseSecureCookie(r, cfg),
	})
}

func clearGitHubTermsCookie(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	http.SetCookie(w, &http.Cookie{
		Name:     githubTermsCookieName,
		Value:    "",
		Path:     "/api/auth/github",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   shouldUseSecureCookie(r, cfg),
	})
}

func githubTermsAcceptedFromStart(r *http.Request) bool {
	if r == nil {
		return false
	}
	value := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("terms")))
	return value == "1" || value == "true" || value == "yes"
}

func githubTermsAcceptedForState(r *http.Request, state string) bool {
	if r == nil || strings.TrimSpace(state) == "" {
		return false
	}
	cookie, err := r.Cookie(githubTermsCookieName)
	if err != nil {
		return false
	}
	return auth.SafeEqual(cookie.Value, state)
}

func shouldUseSecureCookie(r *http.Request, cfg *config.Config) bool {
	if r != nil && r.TLS != nil {
		return true
	}
	if cfg != nil && strings.HasPrefix(strings.ToLower(publicBaseURLForRequest(r, cfg)), "https://") {
		return true
	}
	return false
}

func githubOAuthAppForRequest(r *http.Request, cfg *config.Config) (config.GitHubOAuthApp, bool) {
	if cfg == nil {
		return config.GitHubOAuthApp{}, false
	}
	if cfg.GitHubClientID == "" || cfg.GitHubClientSecret == "" {
		return config.GitHubOAuthApp{}, false
	}
	redirectURL := githubRedirectURLForRequest(r, cfg)
	oauthBaseURL := publicBaseURLFromAbsoluteURL(redirectURL)
	if oauthBaseURL == "" {
		return config.GitHubOAuthApp{}, false
	}
	requestBaseURL, matchedRequestHost := publicBaseURLForRequestMatch(r, cfg)
	if matchedRequestHost && !samePublicBaseURL(requestBaseURL, oauthBaseURL) {
		return config.GitHubOAuthApp{}, false
	}

	return config.GitHubOAuthApp{
		ClientID:     cfg.GitHubClientID,
		ClientSecret: cfg.GitHubClientSecret,
		RedirectURL:  redirectURL,
	}, true
}

func githubRedirectURLForRequest(r *http.Request, cfg *config.Config) string {
	if cfg != nil && cfg.GitHubRedirectURLExplicit && strings.TrimSpace(cfg.GitHubRedirectURL) != "" {
		return strings.TrimSpace(cfg.GitHubRedirectURL)
	}
	if base := publicBaseURLForRequest(r, cfg); base != "" {
		return strings.TrimRight(base, "/") + "/api/auth/github/callback"
	}
	return "/api/auth/github/callback"
}

func publicBaseURLForRequest(r *http.Request, cfg *config.Config) string {
	baseURL, _ := publicBaseURLForRequestMatch(r, cfg)
	return baseURL
}

func publicBaseURLForRequestMatch(r *http.Request, cfg *config.Config) (string, bool) {
	if cfg == nil {
		return "", false
	}

	for _, requestHost := range normalizedRequestHosts(r) {
		for _, base := range cfg.PublicBaseURLs {
			if publicBaseURLMatchesHost(base, requestHost) {
				return strings.TrimRight(strings.TrimSpace(base), "/"), true
			}
		}
		if publicBaseURLMatchesHost(cfg.PublicBaseURL, requestHost) {
			return strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/"), true
		}
		if strings.TrimSpace(cfg.GitHubRedirectURL) != "" {
			githubBaseURL := publicBaseURLFromAbsoluteURL(cfg.GitHubRedirectURL)
			if publicBaseURLMatchesHost(githubBaseURL, requestHost) {
				return githubBaseURL, true
			}
		}
	}

	if strings.TrimSpace(cfg.PublicBaseURL) != "" {
		return strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/"), false
	}
	return "", false
}

func samePublicBaseURL(left, right string) bool {
	leftCanonical, ok := canonicalPublicBaseURL(left)
	if !ok {
		return false
	}
	rightCanonical, ok := canonicalPublicBaseURL(right)
	if !ok {
		return false
	}
	return leftCanonical == rightCanonical
}

func canonicalPublicBaseURL(value string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", false
	}
	return scheme + "://" + normalizeHost(parsed.Host), true
}

func publicBaseURLFromAbsoluteURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return strings.ToLower(parsed.Scheme) + "://" + normalizeHost(parsed.Host)
}

func normalizedRequestHosts(r *http.Request) []string {
	if r == nil {
		return nil
	}
	var hosts []string
	addHost := func(value string) {
		host := normalizeHost(value)
		if host == "" {
			return
		}
		for _, existing := range hosts {
			if existing == host {
				return
			}
		}
		hosts = append(hosts, host)
	}

	addHost(security.SafeSingleLine(r.Host, 255))
	addHost(firstHeaderValue(r.Header.Get("X-Forwarded-Host")))
	addHost(firstForwardedHeaderParam(r.Header.Get("Forwarded"), "host"))
	addHost(firstHeaderValue(r.Header.Get("X-Original-Host")))

	return hosts
}

func firstHeaderValue(value string) string {
	if idx := strings.Index(value, ","); idx >= 0 {
		value = value[:idx]
	}
	return security.SafeSingleLine(strings.TrimSpace(value), 255)
}

func firstForwardedHeaderParam(value, param string) string {
	value = firstHeaderValue(value)
	if value == "" {
		return ""
	}
	for _, part := range strings.Split(value, ";") {
		key, raw, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || !strings.EqualFold(strings.TrimSpace(key), param) {
			continue
		}
		return strings.Trim(strings.TrimSpace(raw), `"`)
	}
	return ""
}

func publicBaseURLMatchesHost(base, requestHost string) bool {
	if requestHost == "" || strings.TrimSpace(base) == "" {
		return false
	}
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil || parsed.Host == "" {
		return false
	}
	return strings.EqualFold(normalizeHost(parsed.Host), requestHost)
}

func normalizeHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return ""
	}
	if splitHost, _, err := net.SplitHostPort(host); err == nil {
		host = splitHost
	}
	return strings.Trim(host, "[]")
}
