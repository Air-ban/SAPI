package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/models"
	"sapi/store"
	"sapi/utils"
)

func MountAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/admin/login", handleAdminLogin)
	mux.HandleFunc("POST /api/auth/login", handleAuthLogin)
	mux.HandleFunc("POST /api/auth/send-verification-code", handleSendVerificationCode)
	mux.HandleFunc("POST /api/auth/register", handleRegister)
	mux.HandleFunc("POST /api/auth/forgot-password/send-code", handleForgotPasswordSendCode)
	mux.HandleFunc("POST /api/auth/forgot-password/reset", handleForgotPasswordReset)
}

func handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	username, _ := body["username"].(string)
	password, _ := body["password"].(string)

	if !auth.SafeEqual(username, cfg.AdminUser) || !auth.SafeEqual(password, cfg.AdminPassword) {
		utils.SendError(w, 401, "Invalid admin username or password.", "invalid_login")
		return
	}

	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "admin", Sub: cfg.AdminUser}, db.AppSecret)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":    token,
		"username": cfg.AdminUser,
	})
}

func handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	identifier := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", body["username"])))
	password, _ := body["password"].(string)

	if auth.SafeEqual(identifier, normalizeUsername(cfg.AdminUser)) && auth.SafeEqual(password, cfg.AdminPassword) {
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
		utils.SendError(w, 401, "Invalid username, email or password.", "invalid_login")
		return
	}

	if !foundUser.Enabled {
		utils.SendError(w, 403, "User account is disabled.", "user_disabled")
		return
	}

	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: foundUser.ID}, db.AppSecret)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"role":  "user",
		"token": token,
		"user":  sanitizeUser(foundUser),
	})
}

func handleSendVerificationCode(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	email := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", body["email"])))
	purpose := strings.TrimSpace(fmt.Sprintf("%v", body["purpose"]))
	if purpose == "" {
		purpose = "register"
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
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	username := normalizeUsername(fmt.Sprintf("%v", body["username"]))
	email := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", body["email"])))
	password, _ := body["password"].(string)
	verificationCode := strings.TrimSpace(fmt.Sprintf("%v", body["verificationCode"]))
	invitationCode := strings.TrimSpace(fmt.Sprintf("%v", body["invitationCode"]))
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

	if len(username) < 3 || len(username) > 64 {
		matched := false
		for _, c := range username {
			if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '@' || c == '-' {
				matched = true
			}
		}
		if !matched || len(username) < 3 {
			utils.SendError(w, 400, "Username must be 3-64 characters.", "invalid_username")
			return
		}
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
			ID:           auth.RandomID("usr"),
			Username:     username,
			Email:        email,
			Name:         username,
			PasswordHash: auth.HashPassword(password),
			APIKey:       "",
			APIKeys:      []models.APIKeyRecord{},
			Enabled:      true,
			CreatedAt:    createdAt,
			UpdatedAt:    createdAt,
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
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	email := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", body["email"])))
	if email == "" || !strings.Contains(email, "@") {
		utils.SendError(w, 400, "Valid email address is required.", "invalid_email")
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
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	email := strings.ToLower(strings.TrimSpace(fmt.Sprintf("%v", body["email"])))
	verificationCode := strings.TrimSpace(fmt.Sprintf("%v", body["verificationCode"]))
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

func sanitizeUser(user *models.User) map[string]interface{} {
	apiKeys := getAPIKeys(user)
	primaryKey := getPrimaryAPIKey(user)

	sanitizedKeys := make([]map[string]interface{}, len(apiKeys))
	for i, k := range apiKeys {
		sanitizedKeys[i] = sanitizeAPIKeyRecord(&k)
	}

	return map[string]interface{}{
		"id":                        user.ID,
		"name":                      user.Name,
		"username":                  user.Username,
		"email":                     user.Email,
		"apiKey":                    primaryKey,
		"apiKeys":                   sanitizedKeys,
		"hasApiKey":                 len(apiKeys) > 0 || primaryKey != "",
		"enabled":                   user.Enabled,
		"receiveAnnouncementEmail":  user.ReceiveAnnouncementEmail,
		"createdAt":                 user.CreatedAt,
		"updatedAt":                 user.UpdatedAt,
	}
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
	key := ""
	if record != nil {
		key = record.Key
	}
	preview := maskKey(key)
	return map[string]interface{}{
		"id":             getRecordID(record),
		"name":           getRecordName(record),
		"key":            key,
		"preview":        preview,
		"enabled":        getRecordEnabled(record),
		"allowedModels":  getRecordAllowedModels(record),
		"rpmLimit":       getRecordRPMLimit(record),
		"createdAt":      getRecordCreatedAt(record),
		"updatedAt":      getRecordUpdatedAt(record),
		"lastUsedAt":     getRecordLastUsedAt(record),
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
