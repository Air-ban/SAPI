package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	"sapi/utils"
)

const githubStateCookieName = "sapi_github_oauth_state"

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
	if cfg.GitHubClientID == "" || cfg.GitHubClientSecret == "" {
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

	params := url.Values{}
	params.Set("client_id", cfg.GitHubClientID)
	params.Set("redirect_uri", cfg.GitHubRedirectURL)
	params.Set("scope", "read:user user:email")
	params.Set("state", state)

	http.Redirect(w, r, "https://github.com/login/oauth/authorize?"+params.Encode(), http.StatusFound)
}

func handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	if cfg.GitHubClientID == "" || cfg.GitHubClientSecret == "" {
		redirectGitHubAuth(w, r, cfg, "", "github_not_configured")
		return
	}

	cookie, err := r.Cookie(githubStateCookieName)
	clearGitHubStateCookie(w, r, cfg)
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

	accessToken, err := exchangeGitHubCode(ctx, cfg, code)
	if err != nil {
		redirectGitHubAuth(w, r, cfg, "", "token_exchange_failed")
		return
	}

	profile, emails, err := fetchGitHubProfile(ctx, accessToken)
	if err != nil {
		redirectGitHubAuth(w, r, cfg, "", "profile_fetch_failed")
		return
	}

	userResult := upsertGitHubUser(profile, emails, cfg)
	if errCode, ok := userResult.(string); ok {
		redirectGitHubAuth(w, r, cfg, "", errCode)
		return
	}

	db := store.ReadDB()
	user := userResult.(*models.User)
	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: user.ID}, db.AppSecret)
	redirectGitHubAuth(w, r, cfg, token, "")
}

func exchangeGitHubCode(ctx context.Context, cfg *config.Config, code string) (string, error) {
	form := url.Values{}
	form.Set("client_id", cfg.GitHubClientID)
	form.Set("client_secret", cfg.GitHubClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", cfg.GitHubRedirectURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "SAPI")

	resp, err := http.DefaultClient.Do(req)
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
	if err := getGitHubJSON(ctx, token, "https://api.github.com/user", &profile); err != nil {
		return nil, nil, err
	}

	var emails []githubEmailRecord
	if err := getGitHubJSON(ctx, token, "https://api.github.com/user/emails", &emails); err != nil {
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

	resp, err := http.DefaultClient.Do(req)
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

func upsertGitHubUser(profile *githubUserProfile, emails []githubEmailRecord, cfg *config.Config) interface{} {
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
	base := strings.TrimRight(cfg.PublicBaseURL, "/")
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

func shouldUseSecureCookie(r *http.Request, cfg *config.Config) bool {
	if r != nil && r.TLS != nil {
		return true
	}
	if cfg != nil && strings.HasPrefix(strings.ToLower(cfg.PublicBaseURL), "https://") {
		return true
	}
	return false
}
