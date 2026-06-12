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
	"log"
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
		Domain:   githubOAuthCookieDomainForApp(r, cfg, app),
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
			Domain:   githubOAuthCookieDomainForApp(r, cfg, app),
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
	startedAt := time.Now()
	cfg := config.Load()
	app, ok := githubOAuthAppForRequest(r, cfg)
	if !ok {
		log.Printf("[GITHUB_OAUTH] callback failed stage=config host=%s err=github_not_configured", r.Host)
		redirectGitHubAuth(w, r, cfg, "", "github_not_configured")
		return
	}

	cookie, cookieErr := r.Cookie(githubStateCookieName)
	state := security.SafeSingleLine(r.URL.Query().Get("state"), 4096)
	if cookieErr != nil || state == "" || !auth.SafeEqual(cookie.Value, state) {
		log.Printf("[GITHUB_OAUTH] callback failed stage=state host=%s cookie=%v state_present=%v", r.Host, cookieErr == nil, state != "")
		clearGitHubOAuthCookies(w, r, cfg)
		redirectGitHubAuth(w, r, cfg, "", "invalid_state")
		return
	}
	statePayload, verifiedApp, err := verifyGitHubOAuthStateForCallback(state, app, cfg)
	if err != nil {
		log.Printf("[GITHUB_OAUTH] callback failed stage=verify_state host=%s err=%v", r.Host, err)
		clearGitHubOAuthCookies(w, r, cfg)
		redirectGitHubAuth(w, r, cfg, "", "invalid_state")
		return
	}
	app = verifiedApp
	termsAccepted := statePayload.TermsAccepted
	if githubTermsAcceptedForState(r, cookie.Value) {
		termsAccepted = true
	}
	returnBaseURL := statePayload.ReturnBaseURL

	code := security.SafeSingleLine(r.URL.Query().Get("code"), 512)
	if code == "" {
		log.Printf("[GITHUB_OAUTH] callback failed stage=code host=%s return_base=%s", r.Host, returnBaseURL)
		clearGitHubOAuthCookies(w, r, cfg)
		redirectGitHubAuthToBase(w, returnBaseURL, "", "missing_code")
		return
	}
	if forwardTarget := githubCallbackForwardTarget(r, cfg, returnBaseURL, code, state); forwardTarget != "" {
		log.Printf("[GITHUB_OAUTH] callback forwarding host=%s return_base=%s target_host=%s", r.Host, returnBaseURL, hostFromPublicBaseURL(publicBaseURLFromAbsoluteURL(forwardTarget)))
		writeBrowserRedirectPage(w, forwardTarget)
		return
	}

	clearGitHubOAuthCookies(w, r, cfg)

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	githubClient := githubClientForConfig(cfg)

	accessToken, err := exchangeGitHubCode(ctx, app, code, githubClient)
	if err != nil {
		log.Printf("[GITHUB_OAUTH] callback failed stage=token_exchange host=%s duration_ms=%d err=%v", r.Host, int(time.Since(startedAt).Milliseconds()), err)
		redirectGitHubAuthToBase(w, returnBaseURL, "", "token_exchange_failed")
		return
	}

	profile, emails, err := fetchGitHubProfile(ctx, accessToken, githubClient)
	if err != nil {
		log.Printf("[GITHUB_OAUTH] callback failed stage=profile_fetch host=%s duration_ms=%d err=%v", r.Host, int(time.Since(startedAt).Milliseconds()), err)
		redirectGitHubAuthToBase(w, returnBaseURL, "", "profile_fetch_failed")
		return
	}

	followAllowed := true
	if shouldCheckGitHubFollowRequirement(profile, cfg) {
		var err error
		followAllowed, err = checkGitHubFollowRequirement(ctx, accessToken, profile, cfg, githubClient)
		if err != nil {
			log.Printf("[GITHUB_OAUTH] callback failed stage=follow_check host=%s github_login=%s duration_ms=%d err=%v", r.Host, profile.Login, int(time.Since(startedAt).Milliseconds()), err)
			redirectGitHubAuthToBase(w, returnBaseURL, "", "github_follow_check_failed")
			return
		}
	}

	userResult := upsertGitHubUser(profile, emails, cfg, followAllowed, termsAccepted)
	if errCode, ok := userResult.(string); ok {
		log.Printf("[GITHUB_OAUTH] callback failed stage=upsert host=%s github_login=%s err=%s", r.Host, profile.Login, errCode)
		redirectGitHubAuthToBase(w, returnBaseURL, "", errCode)
		return
	}

	db := store.ReadDB()
	user := userResult.(*models.User)
	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: user.ID}, db.AppSecret)
	log.Printf("[GITHUB_OAUTH] callback success host=%s user=%s github_login=%s duration_ms=%d", r.Host, user.ID, profile.Login, int(time.Since(startedAt).Milliseconds()))
	redirectGitHubAuthToBase(w, returnBaseURL, token, "")
}

func exchangeGitHubCode(ctx context.Context, app config.GitHubOAuthApp, code string, clients ...*http.Client) (string, error) {
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

	resp, err := githubDo(clients...).Do(req)
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

func fetchGitHubProfile(ctx context.Context, token string, clients ...*http.Client) (*githubUserProfile, []githubEmailRecord, error) {
	var profile githubUserProfile
	if err := getGitHubJSON(ctx, token, githubAPIURL("/user"), &profile, clients...); err != nil {
		return nil, nil, err
	}

	var emails []githubEmailRecord
	if err := getGitHubJSON(ctx, token, githubAPIURL("/user/emails"), &emails, clients...); err != nil {
		emails = []githubEmailRecord{}
	}

	return &profile, emails, nil
}

func getGitHubJSON(ctx context.Context, token, endpoint string, target interface{}, clients ...*http.Client) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "SAPI")

	resp, err := githubDo(clients...).Do(req)
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

func checkGitHubFollowRequirement(ctx context.Context, token string, profile *githubUserProfile, cfg *config.Config, clients ...*http.Client) (bool, error) {
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
	return isGitHubUserFollowing(ctx, token, login, target, clients...)
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

func isGitHubUserFollowing(ctx context.Context, token, username, target string, clients ...*http.Client) (bool, error) {
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

	resp, err := githubDo(clients...).Do(req)
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

func githubDo(clients ...*http.Client) *http.Client {
	for _, client := range clients {
		if client != nil {
			return client
		}
	}
	return githubHTTPClient
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
			if u.PasswordHash == "" || subscription.TierForUser(u) == subscription.TierEmail {
				u.SubscriptionTier = subscription.DefaultTierForUser(u)
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
		if db.RegistrationDisabled {
			return "registration_closed"
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
	if !githubReturnBaseURLAllowed(state.ReturnBaseURL, app.RedirectURL, cfg) {
		return nil, fmt.Errorf("invalid github return base URL")
	}
	state.ReturnBaseURL = strings.TrimRight(strings.TrimSpace(state.ReturnBaseURL), "/")
	return &state, nil
}

func verifyGitHubOAuthStateForCallback(value string, requestApp config.GitHubOAuthApp, cfg *config.Config) (*githubOAuthState, config.GitHubOAuthApp, error) {
	candidates := githubOAuthAppCandidatesForCallback(requestApp, cfg)
	if len(candidates) == 0 {
		return nil, config.GitHubOAuthApp{}, fmt.Errorf("missing github oauth app")
	}

	var lastErr error
	for _, candidate := range candidates {
		state, err := verifyGitHubOAuthState(value, candidate, cfg)
		if err == nil {
			return state, candidate, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, config.GitHubOAuthApp{}, lastErr
	}
	return nil, config.GitHubOAuthApp{}, fmt.Errorf("invalid github state")
}

func githubOAuthAppCandidatesForCallback(requestApp config.GitHubOAuthApp, cfg *config.Config) []config.GitHubOAuthApp {
	var candidates []config.GitHubOAuthApp
	add := func(app config.GitHubOAuthApp) {
		app.ClientID = strings.TrimSpace(app.ClientID)
		app.ClientSecret = strings.TrimSpace(app.ClientSecret)
		app.RedirectURL = strings.TrimSpace(app.RedirectURL)
		if app.ClientID == "" || app.ClientSecret == "" || app.RedirectURL == "" {
			return
		}
		for _, existing := range candidates {
			if existing.ClientID == app.ClientID && auth.SafeEqual(existing.ClientSecret, app.ClientSecret) && auth.SafeEqual(existing.RedirectURL, app.RedirectURL) {
				return
			}
		}
		candidates = append(candidates, app)
	}

	add(requestApp)
	if cfg != nil {
		add(config.GitHubOAuthApp{
			ClientID:     cfg.GitHubClientID,
			ClientSecret: cfg.GitHubClientSecret,
			RedirectURL:  cfg.GitHubRedirectURL,
		})
		for _, app := range cfg.GitHubOAuthApps {
			add(app)
		}
	}
	return candidates
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
	clearSharedGitHubCookie(w, r, cfg, githubStateCookieName)
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
	clearSharedGitHubCookie(w, r, cfg, githubTermsCookieName)
}

func clearGitHubOAuthCookies(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	clearGitHubStateCookie(w, r, cfg)
	clearGitHubTermsCookie(w, r, cfg)
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
	requestBaseURL, matchedRequestHost := publicBaseURLForRequestMatch(r, cfg)
	if len(normalizedRequestHosts(r)) > 0 && !matchedRequestHost {
		return config.GitHubOAuthApp{}, false
	}
	if matchedRequestHost {
		if app, ok := githubOAuthAppForBaseURL(requestBaseURL, cfg); ok {
			return app, true
		}
	}
	if cfg.GitHubClientID == "" || cfg.GitHubClientSecret == "" {
		return config.GitHubOAuthApp{}, false
	}
	redirectURL := githubRedirectURLForRequest(r, cfg)
	oauthBaseURL := publicBaseURLFromAbsoluteURL(redirectURL)
	if oauthBaseURL == "" {
		return config.GitHubOAuthApp{}, false
	}
	if matchedRequestHost && !samePublicBaseURL(requestBaseURL, oauthBaseURL) {
		if !githubBaseURLsShareCookieDomain(requestBaseURL, oauthBaseURL, cfg) {
			return config.GitHubOAuthApp{}, false
		}
	}

	return config.GitHubOAuthApp{
		ClientID:     cfg.GitHubClientID,
		ClientSecret: cfg.GitHubClientSecret,
		RedirectURL:  redirectURL,
	}, true
}

func githubOAuthAppForBaseURL(baseURL string, cfg *config.Config) (config.GitHubOAuthApp, bool) {
	if cfg == nil || len(cfg.GitHubOAuthApps) == 0 {
		return config.GitHubOAuthApp{}, false
	}
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Host == "" {
		return config.GitHubOAuthApp{}, false
	}
	app, ok := cfg.GitHubOAuthApps[normalizeHost(parsed.Host)]
	if !ok || app.ClientID == "" || app.ClientSecret == "" || strings.TrimSpace(app.RedirectURL) == "" {
		return config.GitHubOAuthApp{}, false
	}
	if !samePublicBaseURL(baseURL, publicBaseURLFromAbsoluteURL(app.RedirectURL)) {
		return config.GitHubOAuthApp{}, false
	}
	return app, true
}

func githubReturnBaseURLAllowed(returnBaseURL, redirectURL string, cfg *config.Config) bool {
	redirectBaseURL := publicBaseURLFromAbsoluteURL(redirectURL)
	if samePublicBaseURL(returnBaseURL, redirectBaseURL) {
		return true
	}
	return publicBaseURLConfigured(returnBaseURL, cfg) && githubBaseURLsShareCookieDomain(returnBaseURL, redirectBaseURL, cfg)
}

func githubCallbackForwardTarget(r *http.Request, cfg *config.Config, returnBaseURL, code, state string) string {
	currentBaseURL := publicBaseURLForRequest(r, cfg)
	if samePublicBaseURL(currentBaseURL, returnBaseURL) {
		return ""
	}
	if !publicBaseURLConfigured(returnBaseURL, cfg) || !githubBaseURLsShareCookieDomain(currentBaseURL, returnBaseURL, cfg) {
		return ""
	}
	params := url.Values{}
	params.Set("code", code)
	params.Set("state", state)
	return strings.TrimRight(returnBaseURL, "/") + "/api/auth/github/callback?" + params.Encode()
}

func publicBaseURLConfigured(baseURL string, cfg *config.Config) bool {
	if cfg == nil {
		return false
	}
	for _, item := range cfg.PublicBaseURLs {
		if samePublicBaseURL(baseURL, item) {
			return true
		}
	}
	return samePublicBaseURL(baseURL, cfg.PublicBaseURL)
}

func githubOAuthCookieDomainForApp(r *http.Request, cfg *config.Config, app config.GitHubOAuthApp) string {
	requestBaseURL := publicBaseURLForRequest(r, cfg)
	redirectBaseURL := publicBaseURLFromAbsoluteURL(app.RedirectURL)
	if samePublicBaseURL(requestBaseURL, redirectBaseURL) {
		return ""
	}
	return githubSharedCookieDomain(requestBaseURL, redirectBaseURL, cfg)
}

func clearSharedGitHubCookie(w http.ResponseWriter, r *http.Request, cfg *config.Config, name string) {
	domain := githubParentCookieDomainForRequest(r, cfg)
	if domain == "" {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/api/auth/github",
		Domain:   domain,
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   shouldUseSecureCookie(r, cfg),
	})
}

func githubParentCookieDomainForRequest(r *http.Request, cfg *config.Config) string {
	for _, requestHost := range normalizedRequestHosts(r) {
		baseURL := "https://" + requestHost
		for _, configured := range cfgPublicBaseURLs(cfg) {
			if samePublicBaseURL(baseURL, configured) {
				return parentCookieDomainFromHost(requestHost)
			}
		}
	}
	return ""
}

func githubBaseURLsShareCookieDomain(left, right string, cfg *config.Config) bool {
	return githubSharedCookieDomain(left, right, cfg) != ""
}

func githubSharedCookieDomain(left, right string, cfg *config.Config) string {
	leftHost := hostFromPublicBaseURL(left)
	rightHost := hostFromPublicBaseURL(right)
	if leftHost == "" || rightHost == "" {
		return ""
	}
	if parentCookieDomainFromHost(leftHost) != parentCookieDomainFromHost(rightHost) {
		return ""
	}
	domain := parentCookieDomainFromHost(leftHost)
	if domain == "" {
		return ""
	}
	for _, item := range cfgPublicBaseURLs(cfg) {
		if samePublicBaseURL(left, item) {
			return domain
		}
	}
	return ""
}

func cfgPublicBaseURLs(cfg *config.Config) []string {
	if cfg == nil {
		return nil
	}
	items := append([]string{}, cfg.PublicBaseURLs...)
	if strings.TrimSpace(cfg.PublicBaseURL) != "" {
		items = append(items, cfg.PublicBaseURL)
	}
	return items
}

func hostFromPublicBaseURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return ""
	}
	return normalizeHost(parsed.Host)
}

func parentCookieDomainFromHost(host string) string {
	host = normalizeHost(host)
	if host == "" || strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil {
		return ""
	}
	parts := strings.Split(host, ".")
	if len(parts) < 3 {
		return ""
	}
	parent := strings.Join(parts[len(parts)-2:], ".")
	if parent == "" {
		return ""
	}
	return "." + parent
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
