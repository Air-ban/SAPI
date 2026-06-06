package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
	"sapi/utils"
)

func MountAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/admin/login", handleAdminLogin)
	mux.HandleFunc("POST /api/auth/login", handleAuthLogin)
	mux.HandleFunc("GET /api/auth/github/start", handleGitHubStart)
	mux.HandleFunc("GET /api/auth/github/callback", handleGitHubCallback)
	mux.HandleFunc("POST /api/auth/send-verification-code", handleSendVerificationCode)
	mux.HandleFunc("POST /api/auth/register", handleRegister)
	mux.HandleFunc("POST /api/auth/forgot-password/send-code", handleForgotPasswordSendCode)
	mux.HandleFunc("POST /api/auth/forgot-password/reset", handleForgotPasswordReset)
	mux.HandleFunc("POST /api/admin/passkeys/register/options", middleware.RequireAdmin(handleAdminPasskeyRegisterOptions))
	mux.HandleFunc("POST /api/admin/passkeys/register/finish", middleware.RequireAdmin(handleAdminPasskeyRegisterFinish))
	mux.HandleFunc("POST /api/admin/passkeys/login/options", handleAdminPasskeyLoginOptions)
	mux.HandleFunc("POST /api/admin/passkeys/login/finish", handleAdminPasskeyLoginFinish)
	mux.HandleFunc("DELETE /api/admin/passkeys/{id}", middleware.RequireAdmin(handleAdminPasskeyDelete))
}

func handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	username := security.SafeSingleLine(toString(body["username"]), 128)
	password, _ := body["password"].(string)

	if !checkLoginRateLimit(w, r, username) {
		return
	}

	if !auth.SafeEqual(username, cfg.AdminUser) || !auth.SafeEqual(password, cfg.AdminPassword) {
		recordLoginFailure(r, username)
		utils.SendError(w, 401, "Invalid admin username or password.", "invalid_login")
		return
	}

	clearLoginFailures(username)

	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: cfg.AdminUser}, db.AppSecret)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":    token,
		"username": cfg.AdminUser,
	})
}

func handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	identifier := strings.ToLower(security.SafeSingleLine(fmt.Sprintf("%v", body["username"]), 128))
	password, _ := body["password"].(string)

	if !checkLoginRateLimit(w, r, identifier) {
		return
	}

	if auth.SafeEqual(identifier, normalizeUsername(cfg.AdminUser)) && auth.SafeEqual(password, cfg.AdminPassword) {
		clearLoginFailures(identifier)
		db := store.ReadDB()
		token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: cfg.AdminUser}, db.AppSecret)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"role":     "admin",
			"token":    token,
			"username": cfg.AdminUser,
		})
		return
	}

	db := store.ReadDB()
	normalizedID := normalizeUsername(identifier)

	var foundUser *models.User
	for i := range db.Users {
		u := &db.Users[i]
		matchUsername := normalizeUsername(u.Username) == normalizedID
		if u.Username == "" {
			matchUsername = normalizeUsername(u.Name) == normalizedID
		}
		matchEmail := u.Email == identifier
		if matchUsername || matchEmail {
			foundUser = u
			break
		}
	}

	if foundUser == nil || foundUser.PasswordHash == "" || !auth.VerifyPassword(password, foundUser.PasswordHash) {
		recordLoginFailure(r, identifier)
		utils.SendError(w, 401, "Invalid username, email or password.", "invalid_login")
		return
	}

	if !foundUser.Enabled {
		recordLoginFailure(r, identifier)
		utils.SendError(w, 403, "User account is disabled.", "user_disabled")
		return
	}

	clearLoginFailures(identifier)

	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: foundUser.ID}, db.AppSecret)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"role":  "user",
		"token": token,
		"user":  sanitizeUser(foundUser),
	})
}

func handleSendVerificationCode(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	email := strings.ToLower(security.SafeSingleLine(fmt.Sprintf("%v", body["email"]), 254))
	purpose := security.SafeSingleLine(fmt.Sprintf("%v", body["purpose"]), 64)
	if purpose == "" {
		purpose = "register"
	}

	if !checkVerificationRequestLimit(w, r) {
		return
	}

	if email == "" || !strings.Contains(email, "@") {
		utils.SendError(w, 400, "Valid email address is required.", "invalid_email")
		return
	}

	db := store.ReadDB()
	smtpCfg := getSMTPConfig(db)
	if !createSMTPTransport(smtpCfg) {
		utils.SendError(w, 400, "SMTP is not configured.", "smtp_not_configured")
		return
	}

	if purpose == "register" {
		for _, u := range db.Users {
			if u.Email == email {
				utils.SendError(w, 409, "Email is already registered.", "email_exists")
				return
			}
		}
	}

	cleanupExpiredVerificationCodes(db)

	oneMinuteAgo := time.Now().Add(-60 * time.Second).UTC().Format(time.RFC3339)
	recentCount := 0
	for _, c := range db.VerificationCodes {
		if c.Email == email && c.CreatedAt > oneMinuteAgo {
			recentCount++
		}
	}
	if recentCount >= 1 {
		utils.SendError(w, 429, "Please wait before requesting another code.", "rate_limited")
		return
	}

	code := auth.GenerateVerificationCode()
	store.MutateDB(func(db *models.Database) interface{} {
		db.VerificationCodes = append(db.VerificationCodes, models.VerificationCode{
			Email:     email,
			Code:      code,
			Purpose:   purpose,
			CreatedAt: store.Now(),
			Used:      false,
		})
		return nil
	})

	go sendMail(smtpCfg, email, "SAPI 验证码",
		"您的验证码是："+code+"\n\n验证码 10 分钟内有效。如未收到，请检查垃圾邮件文件夹。如非本人操作，请忽略此邮件。")

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	username := normalizeUsername(security.SafeSingleLine(fmt.Sprintf("%v", body["username"]), 64))
	email := strings.ToLower(security.SafeSingleLine(fmt.Sprintf("%v", body["email"]), 254))
	password, _ := body["password"].(string)
	verificationCode := security.SafeSingleLine(fmt.Sprintf("%v", body["verificationCode"]), 16)
	invitationCode := security.SafeSingleLine(fmt.Sprintf("%v", body["invitationCode"]), 128)
	isEduEmail := strings.HasSuffix(email, ".edu.cn")

	if !isEduEmail && invitationCode == "" {
		utils.SendError(w, 400, "Invitation code is required for non-edu emails.", "invitation_code_required")
		return
	}

	if invitationCode != "" {
		validation := validateInvitationCode(invitationCode)
		if !validation["valid"].(bool) {
			reason, _ := validation["reason"].(string)
			msg := "Invalid invitation code."
			if reason == "expired_code" {
				msg = "Invitation code has expired."
			} else if reason == "max_uses_reached" {
				msg = "Invitation code has reached its maximum usage limit."
			}
			utils.SendError(w, 400, msg, reason)
			return
		}
	}

	if !validUsername(username) {
		utils.SendError(w, 400, "Username must be 3-64 characters and contain only letters, numbers, dot, underscore or hyphen.", "invalid_username")
		return
	}

	if email == "" || !strings.Contains(email, "@") {
		utils.SendError(w, 400, "Valid email address is required.", "invalid_email")
		return
	}

	if len(password) < 8 {
		utils.SendError(w, 400, "Password must be at least 8 characters.", "invalid_password")
		return
	}

	if auth.SafeEqual(username, normalizeUsername(cfg.AdminUser)) {
		utils.SendError(w, 409, "Username is reserved.", "username_reserved")
		return
	}

	if len(verificationCode) != 6 {
		utils.SendError(w, 400, "Verification code must be 6 digits.", "invalid_verification_code")
		return
	}

	if !verifyEmailCode(email, verificationCode, "register") {
		utils.SendError(w, 400, "Invalid or expired verification code.", "invalid_verification_code")
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for _, u := range db.Users {
			if normalizeUsername(u.Username) == username {
				return "username_exists"
			}
			if u.Username == "" && normalizeUsername(u.Name) == username {
				return "username_exists"
			}
			if u.Email == email {
				return "email_exists"
			}
		}

		createdAt := store.Now()
		user := models.User{
			ID:                       auth.RandomID("usr"),
			Username:                 username,
			Email:                    email,
			Name:                     username,
			PasswordHash:             auth.HashPassword(password),
			APIKey:                   "",
			APIKeys:                  []models.APIKeyRecord{},
			Enabled:                  true,
			ReceiveAnnouncementEmail: true,
			Source:                   userSourceForEmail(email),
			SubscriptionTier:         subscription.TierLite,
			CreatedAt:                createdAt,
			UpdatedAt:                createdAt,
		}
		db.Users = append(db.Users, user)
		return &user
	})

	errMsg, isErr := result.(string)
	if isErr {
		utils.SendError(w, 409, "Username or email is already registered.", errMsg)
		return
	}

	user := result.(*models.User)

	if invitationCode != "" {
		consumeInvitationCode(invitationCode, user.ID)
	}

	newDB := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: user.ID}, newDB.AppSecret)
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"role":  "user",
		"token": token,
		"user":  sanitizeUser(user),
	})
}

func handleForgotPasswordSendCode(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	email := strings.ToLower(security.SafeSingleLine(fmt.Sprintf("%v", body["email"]), 254))
	if email == "" || !strings.Contains(email, "@") {
		utils.SendError(w, 400, "Valid email address is required.", "invalid_email")
		return
	}

	if !checkVerificationRequestLimit(w, r) {
		return
	}

	db := store.ReadDB()
	found := false
	for _, u := range db.Users {
		if u.Email == email {
			found = true
			break
		}
	}
	if !found {
		utils.SendError(w, 404, "No account found with this email.", "user_not_found")
		return
	}

	smtpCfg := getSMTPConfig(db)
	if !createSMTPTransport(smtpCfg) {
		utils.SendError(w, 400, "SMTP is not configured.", "smtp_not_configured")
		return
	}

	cleanupExpiredVerificationCodes(db)

	oneMinuteAgo := time.Now().Add(-60 * time.Second).UTC().Format(time.RFC3339)
	recentCount := 0
	for _, c := range db.VerificationCodes {
		if c.Email == email && c.Purpose == "reset_password" && c.CreatedAt > oneMinuteAgo {
			recentCount++
		}
	}
	if recentCount >= 1 {
		utils.SendError(w, 429, "Please wait before requesting another code.", "rate_limited")
		return
	}

	code := auth.GenerateVerificationCode()
	store.MutateDB(func(db *models.Database) interface{} {
		db.VerificationCodes = append(db.VerificationCodes, models.VerificationCode{
			Email:     email,
			Code:      code,
			Purpose:   "reset_password",
			CreatedAt: store.Now(),
			Used:      false,
		})
		return nil
	})

	go sendMail(smtpCfg, email, "SAPI 密码重置验证码",
		"您的密码重置验证码是："+code+"\n\n验证码 10 分钟内有效。如未收到，请检查垃圾邮件文件夹。如非本人操作，请忽略此邮件。")

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func handleForgotPasswordReset(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	email := strings.ToLower(security.SafeSingleLine(fmt.Sprintf("%v", body["email"]), 254))
	verificationCode := security.SafeSingleLine(fmt.Sprintf("%v", body["verificationCode"]), 16)
	newPassword, _ := body["password"].(string)

	if email == "" || !strings.Contains(email, "@") {
		utils.SendError(w, 400, "Valid email address is required.", "invalid_email")
		return
	}
	if len(verificationCode) != 6 {
		utils.SendError(w, 400, "Verification code must be 6 digits.", "invalid_verification_code")
		return
	}
	if len(newPassword) < 8 {
		utils.SendError(w, 400, "Password must be at least 8 characters.", "invalid_password")
		return
	}

	if !verifyEmailCode(email, verificationCode, "reset_password") {
		utils.SendError(w, 400, "Invalid or expired verification code.", "invalid_verification_code")
		return
	}

	updated := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].Email == email {
				db.Users[i].PasswordHash = auth.HashPassword(newPassword)
				db.Users[i].UpdatedAt = store.Now()
				return &db.Users[i]
			}
		}
		return nil
	})

	if updated == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func validateInvitationCode(code string) map[string]interface{} {
	db := store.ReadDB()
	for _, c := range db.InvitationCodes {
		if auth.SafeEqual(c.Code, code) {
			if c.ExpiresAt != "" {
				expiry, err := time.Parse(time.RFC3339, c.ExpiresAt)
				if err == nil && time.Now().After(expiry) {
					return map[string]interface{}{"valid": false, "reason": "expired_code"}
				}
			}
			if c.MaxUses > 0 && c.UsedCount >= c.MaxUses {
				return map[string]interface{}{"valid": false, "reason": "max_uses_reached"}
			}
			return map[string]interface{}{"valid": true}
		}
	}
	return map[string]interface{}{"valid": false, "reason": "invalid_code"}
}

func consumeInvitationCode(code string, userID string) {
	store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.InvitationCodes {
			if auth.SafeEqual(db.InvitationCodes[i].Code, code) {
				db.InvitationCodes[i].UsedCount++
				db.InvitationCodes[i].UsedBy = append(db.InvitationCodes[i].UsedBy, models.InvitationCodeUse{
					UserID: userID,
					UsedAt: store.Now(),
				})
				break
			}
		}
		return nil
	})
}

func verifyEmailCode(email, code, purpose string) bool {
	db := store.ReadDB()
	cleanupExpiredVerificationCodes(db)

	for _, c := range db.VerificationCodes {
		if c.Email == email && c.Code == code && c.Purpose == purpose && !c.Used {
			store.MutateDB(func(db *models.Database) interface{} {
				for i := range db.VerificationCodes {
					if db.VerificationCodes[i].Email == email &&
						db.VerificationCodes[i].Code == code &&
						db.VerificationCodes[i].Purpose == purpose {
						db.VerificationCodes[i].Used = true
						break
					}
				}
				return nil
			})
			return true
		}
	}
	return false
}

func cleanupExpiredVerificationCodes(db *models.Database) {
	cutoff := time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339)
	filtered := make([]models.VerificationCode, 0)
	for _, c := range db.VerificationCodes {
		if c.CreatedAt > cutoff {
			filtered = append(filtered, c)
		}
	}
	db.VerificationCodes = filtered
}

func normalizeUsername(v string) string {
	return strings.ToLower(strings.TrimSpace(v))
}

func validUsername(username string) bool {
	if len(username) < 3 || len(username) > 64 {
		return false
	}
	for _, c := range username {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' {
			continue
		}
		return false
	}
	return true
}

func sanitizeUser(user *models.User) map[string]interface{} {
	apiKeys := getAPIKeys(user)
	primaryKey := getPrimaryAPIKey(user)

	sanitizedKeys := make([]map[string]interface{}, len(apiKeys))
	for i, k := range apiKeys {
		sanitizedKeys[i] = sanitizeUserAPIKeyRecord(user, &k)
	}
	tier := subscription.TierForUser(user)
	rpmLimit := subscription.RPMLimitForUser(user)

	return map[string]interface{}{
		"id":                       user.ID,
		"name":                     user.Name,
		"username":                 user.Username,
		"email":                    user.Email,
		"apiKey":                   primaryKey,
		"apiKeys":                  sanitizedKeys,
		"hasApiKey":                len(apiKeys) > 0 || primaryKey != "",
		"enabled":                  user.Enabled,
		"receiveAnnouncementEmail": user.ReceiveAnnouncementEmail,
		"source":                   user.Source,
		"githubId":                 user.GitHubID,
		"githubLogin":              user.GitHubLogin,
		"githubAvatarUrl":          user.GitHubAvatarURL,
		"githubLinkedAt":           user.GitHubLinkedAt,
		"subscriptionTier":         tier,
		"subscriptionRpmLimit":     rpmLimit,
		"defaultRpmLimit":          rpmLimit,
		"createdAt":                user.CreatedAt,
		"updatedAt":                user.UpdatedAt,
	}
}

func userSourceForEmail(email string) string {
	if strings.HasSuffix(strings.ToLower(strings.TrimSpace(email)), ".edu.cn") {
		return "edu"
	}
	return "email"
}

func getAPIKeys(user *models.User) []models.APIKeyRecord {
	keys := make([]models.APIKeyRecord, 0)
	for _, k := range user.APIKeys {
		if k.Key != "" {
			keys = append(keys, k)
		}
	}
	return keys
}

func getPrimaryAPIKey(user *models.User) string {
	keys := getAPIKeys(user)
	for _, k := range keys {
		if k.Enabled {
			return k.Key
		}
	}
	if len(keys) > 0 {
		return keys[0].Key
	}
	return user.APIKey
}

func sanitizeAPIKeyRecord(record *models.APIKeyRecord) map[string]interface{} {
	return sanitizeAPIKeyRecordWithEffective(record, 0)
}

func sanitizeUserAPIKeyRecord(user *models.User, record *models.APIKeyRecord) map[string]interface{} {
	return sanitizeAPIKeyRecordWithEffective(record, subscription.EffectiveAPIKeyRPMLimit(user, record))
}

func sanitizeAPIKeyRecordWithEffective(record *models.APIKeyRecord, effectiveRpmLimit int) map[string]interface{} {
	key := ""
	if record != nil {
		key = record.Key
	}
	preview := maskKey(key)
	return map[string]interface{}{
		"id":                getRecordID(record),
		"name":              getRecordName(record),
		"key":               key,
		"preview":           preview,
		"enabled":           getRecordEnabled(record),
		"allowedModels":     getRecordAllowedModels(record),
		"rpmLimit":          getRecordRPMLimit(record),
		"effectiveRpmLimit": effectiveRpmLimit,
		"createdAt":         getRecordCreatedAt(record),
		"updatedAt":         getRecordUpdatedAt(record),
		"lastUsedAt":        getRecordLastUsedAt(record),
	}
}

func maskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 12 {
		return key[:minInt(len(key), 6)] + "..."
	}
	return key[:12] + "..." + key[len(key)-minInt(6, len(key)-12):]
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func getRecordID(r *models.APIKeyRecord) string {
	if r == nil {
		return ""
	}
	return r.ID
}
func getRecordName(r *models.APIKeyRecord) string {
	if r == nil {
		return "API Key"
	}
	return r.Name
}
func getRecordEnabled(r *models.APIKeyRecord) bool {
	if r == nil {
		return true
	}
	return r.Enabled
}
func getRecordAllowedModels(r *models.APIKeyRecord) []string {
	if r == nil {
		return []string{}
	}
	return r.AllowedModels
}
func getRecordRPMLimit(r *models.APIKeyRecord) int {
	if r == nil {
		return 0
	}
	return r.RPMLimit
}
func getRecordCreatedAt(r *models.APIKeyRecord) string {
	if r == nil {
		return ""
	}
	return r.CreatedAt
}
func getRecordUpdatedAt(r *models.APIKeyRecord) string {
	if r == nil {
		return ""
	}
	return r.UpdatedAt
}
func getRecordLastUsedAt(r *models.APIKeyRecord) string {
	if r == nil {
		return ""
	}
	return r.LastUsedAt
}
