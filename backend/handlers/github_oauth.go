package handlers

import (
	"bytes"
	"context"
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

func handleGitHubStart(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	app, ok := githubOAuthAppForRequest(r, cfg)
	if !ok {
		utils.SendError(w, 404, "GitHub login is not configured.", "github_not_configured")
		return
	}

	state := auth.RandomSecret()
	http.SetCookie(w, &http.Cookie{
		Name:     githubStateCookieName,
		Value:    state,
		Path:     "/api/auth/github",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   shouldUseSecureCookie(r, cfg),
	})
	if githubTermsAcceptedFromStart(r) {
		http.SetCookie(w, &http.Cookie{
			Name:     githubTermsCookieName,
			Value:    state,
			Path:     "/api/auth/github",
			MaxAge:   600,
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

	http.Redirect(w, r, "https://github.com/login/oauth/authorize?"+params.Encode(), http.StatusFound)
}

func handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	app, ok := githubOAuthAppForRequest(r, cfg)
	if !ok {
		redirectGitHubAuth(w, r, cfg, "", "github_not_configured")
		return
	}

	cookie, err := r.Cookie(githubStateCookieName)
	termsAccepted := false
	if err == nil {
		termsAccepted = githubTermsAcceptedForState(r, cookie.Value)
	}
	clearGitHubStateCookie(w, r, cfg)
	clearGitHubTermsCookie(w, r, cfg)
	state := security.SafeSingleLine(r.URL.Query().Get("state"), 256)
	if err != nil || state == "" || !auth.SafeEqual(cookie.Value, state) {
		redirectGitHubAuth(w, r, cfg, "", "invalid_state")
		return
	}

	code := security.SafeSingleLine(r.URL.Query().Get("code"), 512)
	if code == "" {
		redirectGitHubAuth(w, r, cfg, "", "missing_code")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	accessToken, err := exchangeGitHubCode(ctx, app, code)
	if err != nil {
		redirectGitHubAuth(w, r, cfg, "", "token_exchange_failed")
		return
	}

	profile, emails, err := fetchGitHubProfile(ctx, accessToken)
	if err != nil {
		redirectGitHubAuth(w, r, cfg, "", "profile_fetch_failed")
		return
	}

	followAllowed := true
	if shouldCheckGitHubFollowRequirement(profile, cfg) {
		var err error
		followAllowed, err = checkGitHubFollowRequirement(ctx, accessToken, profile, cfg)
		if err != nil {
			redirectGitHubAuth(w, r, cfg, "", "github_follow_check_failed")
			return
		}
	}

	userResult := upsertGitHubUser(profile, emails, cfg, followAllowed, termsAccepted)
	if errCode, ok := userResult.(string); ok {
		redirectGitHubAuth(w, r, cfg, "", errCode)
		return
	}

	db := store.ReadDB()
	user := userResult.(*models.User)
	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: user.ID}, db.AppSecret)
	redirectGitHubAuth(w, r, cfg, token, "")
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
	http.Redirect(w, r, target, http.StatusFound)
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
	requestHost := normalizedRequestHost(r)
	if cfg.GitHubOAuthApps != nil && requestHost != "" {
		if app, ok := cfg.GitHubOAuthApps[requestHost]; ok && app.ClientID != "" && app.ClientSecret != "" {
			if strings.TrimSpace(app.RedirectURL) == "" {
				app.RedirectURL = githubRedirectURLForRequest(r, cfg)
			}
			return app, true
		}
	}
	if cfg.GitHubClientID == "" || cfg.GitHubClientSecret == "" {
		return config.GitHubOAuthApp{}, false
	}
	return config.GitHubOAuthApp{
		ClientID:     cfg.GitHubClientID,
		ClientSecret: cfg.GitHubClientSecret,
		RedirectURL:  githubRedirectURLForRequest(r, cfg),
	}, true
}

func githubRedirectURLForRequest(r *http.Request, cfg *config.Config) string {
	if base := publicBaseURLForRequest(r, cfg); base != "" {
		return strings.TrimRight(base, "/") + "/api/auth/github/callback"
	}
	if cfg != nil && strings.TrimSpace(cfg.GitHubRedirectURL) != "" {
		return strings.TrimSpace(cfg.GitHubRedirectURL)
	}
	return "/api/auth/github/callback"
}

func publicBaseURLForRequest(r *http.Request, cfg *config.Config) string {
	if cfg == nil {
		return ""
	}
	requestHost := normalizedRequestHost(r)
	for _, base := range cfg.PublicBaseURLs {
		if publicBaseURLMatchesHost(base, requestHost) {
			return strings.TrimRight(strings.TrimSpace(base), "/")
		}
	}
	if publicBaseURLMatchesHost(cfg.PublicBaseURL, requestHost) {
		return strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/")
	}
	if strings.TrimSpace(cfg.PublicBaseURL) != "" {
		return strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/")
	}
	if strings.TrimSpace(cfg.GitHubRedirectURL) != "" {
		parsed, err := url.Parse(strings.TrimSpace(cfg.GitHubRedirectURL))
		if err == nil && parsed.Scheme != "" && parsed.Host != "" {
			return parsed.Scheme + "://" + parsed.Host
		}
	}
	return ""
}

func normalizedRequestHost(r *http.Request) string {
	if r == nil {
		return ""
	}
	host := security.SafeSingleLine(r.Host, 255)
	if host == "" {
		host = security.SafeSingleLine(r.Header.Get("X-Forwarded-Host"), 255)
	}
	return normalizeHost(host)
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
