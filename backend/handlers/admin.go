package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/proxy"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
	"sapi/usage"
	"sapi/utils"
)

func MountAdminRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/state", middleware.RequireAdmin(handleAdminState))
	mux.HandleFunc("GET /api/admin/usage", middleware.RequireAdmin(handleAdminUsage))
	mux.HandleFunc("GET /api/admin/request-logs/{id}", middleware.RequireAdmin(handleAdminRequestLog))
	mux.HandleFunc("GET /api/admin/smtp-config", middleware.RequireAdmin(handleAdminGetSMTP))
	mux.HandleFunc("PUT /api/admin/smtp-config", middleware.RequireAdmin(handleAdminUpdateSMTP))
	mux.HandleFunc("POST /api/admin/smtp-config/test", middleware.RequireAdmin(handleAdminTestSMTP))
	mux.HandleFunc("GET /api/admin/invitation-codes", middleware.RequireAdmin(handleAdminListInvCodes))
	mux.HandleFunc("POST /api/admin/invitation-codes", middleware.RequireAdmin(handleAdminCreateInvCode))
	mux.HandleFunc("DELETE /api/admin/invitation-codes/{id}", middleware.RequireAdmin(handleAdminDeleteInvCode))
	mux.HandleFunc("POST /api/admin/invitation-codes/send", middleware.RequireAdmin(handleAdminSendInvitation))
	mux.HandleFunc("GET /api/admin/api-keys", middleware.RequireAdmin(handleAdminListAPIKeys))
	mux.HandleFunc("POST /api/admin/api-keys", middleware.RequireAdmin(handleAdminCreateAPIKey))
	mux.HandleFunc("POST /api/admin/api-keys/{id}/rotate", middleware.RequireAdmin(handleAdminRotateAPIKey))
	mux.HandleFunc("PUT /api/admin/api-keys/{id}", middleware.RequireAdmin(handleAdminUpdateAPIKey))
	mux.HandleFunc("DELETE /api/admin/api-keys/{id}", middleware.RequireAdmin(handleAdminDeleteAPIKey))
	mux.HandleFunc("POST /api/admin/providers", middleware.RequireAdmin(handleAdminCreateProvider))
	mux.HandleFunc("PUT /api/admin/providers/{id}", middleware.RequireAdmin(handleAdminUpdateProvider))
	mux.HandleFunc("DELETE /api/admin/providers/{id}", middleware.RequireAdmin(handleAdminDeleteProvider))
	mux.HandleFunc("POST /api/admin/providers/models", middleware.RequireAdmin(handleAdminFetchProviderModels))
	mux.HandleFunc("PUT /api/admin/users/{id}", middleware.RequireAdmin(handleAdminUpdateUser))
	mux.HandleFunc("DELETE /api/admin/users/{id}", middleware.RequireAdmin(handleAdminDeleteUser))
	mux.HandleFunc("PUT /api/admin/users/{id}/password", middleware.RequireAdmin(handleAdminResetUserPassword))
	mux.HandleFunc("PUT /api/admin/users/{userId}/api-keys/{keyId}", middleware.RequireAdmin(handleAdminUpdateUserAPIKey))
	mux.HandleFunc("GET /api/admin/announcements", middleware.RequireAdmin(handleAdminListAnnouncements))
	mux.HandleFunc("POST /api/admin/announcements", middleware.RequireAdmin(handleAdminCreateAnnouncement))
	mux.HandleFunc("PUT /api/admin/announcements/{id}", middleware.RequireAdmin(handleAdminUpdateAnnouncement))
	mux.HandleFunc("DELETE /api/admin/announcements/{id}", middleware.RequireAdmin(handleAdminDeleteAnnouncement))
	mux.HandleFunc("GET /api/admin/suggestions", middleware.RequireAdmin(handleAdminListSuggestions))
	mux.HandleFunc("PUT /api/admin/suggestions/{id}/reply", middleware.RequireAdmin(handleAdminReplySuggestion))
	mux.HandleFunc("DELETE /api/admin/suggestions/{id}", middleware.RequireAdmin(handleAdminDeleteSuggestion))
	mux.HandleFunc("GET /api/admin/site-email", middleware.RequireAdmin(handleAdminGetSiteEmail))
	mux.HandleFunc("PUT /api/admin/site-email", middleware.RequireAdmin(handleAdminUpdateSiteEmail))
	mux.HandleFunc("PUT /api/admin/rpm-limit", middleware.RequireAdmin(handleAdminUpdateRPMLimit))
	mux.HandleFunc("PUT /api/admin/banner", middleware.RequireAdmin(handleAdminUpdateBanner))
	mux.HandleFunc("PUT /api/admin/maintenance", middleware.RequireAdmin(handleAdminUpdateMaintenance))
}

func handleAdminState(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	smtp := getSMTPConfig(db)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"providers":          store.RedactProviders(db.Providers),
		"users":              sanitizeUsers(db.Users),
		"adminApiKeys":       sanitizeAdminAPIKeys(db.AdminAPIKeys),
		"adminPasskeys":      sanitizeAdminPasskeys(db.AdminPasskeys),
		"publicConfig":       serviceConfig(),
		"usage":              usage.GetUsageStats(db, "", 30),
		"invitationCodes":    db.InvitationCodes,
		"announcements":      db.Announcements,
		"suggestions":        db.Suggestions,
		"siteBanner":         db.SiteBanner,
		"maintenanceMode":    db.MaintenanceMode,
		"maintenanceEndTime": db.MaintenanceEndTime,
		"siteEmail":          db.SiteEmail,
		"defaultRpmLimit":    db.DefaultRPMLimit,
		"subscriptionTiers":  subscription.Tiers,
		"smtpConfig": map[string]interface{}{
			"host":    smtp.Host,
			"port":    smtp.Port,
			"secure":  smtp.Secure,
			"user":    smtp.User,
			"from":    smtp.From,
			"hasPass": smtp.Pass != "",
		},
	})
}

func handleAdminUsage(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	days := 30
	if d, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil {
		days = min(max(d, 1), 365)
	}
	json.NewEncoder(w).Encode(usage.GetUsageStats(db, "", days))
}

func handleAdminRequestLog(w http.ResponseWriter, r *http.Request) {
	item, ok := store.FindRequestLog(r.PathValue("id"), "")
	if !ok {
		utils.SendError(w, 404, "Request log not found.", "not_found")
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"requestLog": item})
}

func handleAdminGetSMTP(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	smtp := getSMTPConfig(db)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"host":    smtp.Host,
		"port":    smtp.Port,
		"secure":  smtp.Secure,
		"user":    smtp.User,
		"from":    smtp.From,
		"hasPass": smtp.Pass != "",
	})
}

func handleAdminUpdateSMTP(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	updated := store.MutateDB(func(db *models.Database) interface{} {
		pass := security.SafeSingleLine(toString(body["pass"]), 512)
		if pass == "" && db.SMTPConfig != nil {
			pass = db.SMTPConfig.Pass
		}

		db.SMTPConfig = &models.SMTPConfig{
			Host:   security.SafeSingleLine(toString(body["host"]), 255),
			Port:   int(toFloat(body["port"])),
			Secure: toBool(body["secure"]),
			User:   security.SafeSingleLine(toString(body["user"]), 255),
			Pass:   pass,
			From:   security.SafeSingleLine(toString(body["from"]), 255),
		}
		if db.SMTPConfig.Port == 0 {
			db.SMTPConfig.Port = 587
		}
		return db.SMTPConfig
	})

	s := updated.(*models.SMTPConfig)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"host":    s.Host,
		"port":    s.Port,
		"secure":  s.Secure,
		"user":    s.User,
		"from":    s.From,
		"hasPass": s.Pass != "",
	})
}

func handleAdminTestSMTP(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	to := security.SafeSingleLine(toString(body["to"]), 254)
	if to == "" {
		utils.SendError(w, 400, "Recipient email is required.", "invalid_email")
		return
	}

	db := store.ReadDB()
	smtpCfg := getSMTPConfig(db)
	if !createSMTPTransport(smtpCfg) {
		utils.SendError(w, 400, "SMTP is not configured.", "smtp_not_configured")
		return
	}

	err := sendMail(smtpCfg, to, "SAPI SMTP Test", "This is a test email from SAPI. If you received this, your SMTP configuration is working.")
	if err != nil {
		utils.SendError(w, 502, "Failed to send test email: "+err.Error(), "smtp_send_failed")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func handleAdminListInvCodes(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	json.NewEncoder(w).Encode(db.InvitationCodes)
}

func handleAdminCreateInvCode(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	code := security.SafeSingleLine(toString(body["code"]), 128)
	note := security.SafeSingleLine(toString(body["note"]), 500)
	expiresAt := security.SafeSingleLine(toString(body["expiresAt"]), 64)
	maxUses := int(toFloat(body["maxUses"]))

	if code == "" {
		code = auth.RandomSecret()[:16]
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for _, c := range db.InvitationCodes {
			if auth.SafeEqual(c.Code, code) {
				return nil
			}
		}
		record := models.InvitationCode{
			ID:        auth.RandomID("inv"),
			Code:      code,
			Note:      note,
			CreatedAt: store.Now(),
			ExpiresAt: expiresAt,
			MaxUses:   maxUses,
		}
		db.InvitationCodes = append(db.InvitationCodes, record)
		return &record
	})

	if result == nil {
		utils.SendError(w, 409, "Invitation code already exists.", "code_exists")
		return
	}

	w.WriteHeader(201)
	json.NewEncoder(w).Encode(result)
}

func handleAdminDeleteInvCode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	removed := store.MutateDB(func(db *models.Database) interface{} {
		before := len(db.InvitationCodes)
		filtered := make([]models.InvitationCode, 0)
		for _, c := range db.InvitationCodes {
			if c.ID != id {
				filtered = append(filtered, c)
			}
		}
		db.InvitationCodes = filtered
		return before != len(filtered)
	})

	if !removed.(bool) {
		utils.SendError(w, 404, "Invitation code not found.", "not_found")
		return
	}

	w.WriteHeader(204)
}

func handleAdminSendInvitation(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	email := security.SafeSingleLine(toString(body["email"]), 254)
	codeID := security.SafeSingleLine(toString(body["codeId"]), 128)
	customCode := security.SafeSingleLine(toString(body["code"]), 128)

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

	inviteCode := customCode
	if codeID != "" {
		found := false
		for _, c := range db.InvitationCodes {
			if c.ID == codeID {
				inviteCode = c.Code
				found = true
				break
			}
		}
		if !found {
			utils.SendError(w, 404, "Invitation code not found.", "not_found")
			return
		}
	} else if inviteCode == "" {
		utils.SendError(w, 400, "Invitation code or code ID is required.", "invalid_code")
		return
	}

	err := sendMail(smtpCfg, email, "You have been invited to join SAPI",
		"You are invited to register on SAPI.\n\nInvitation code: "+inviteCode+
			"\n\nRegister at: "+config.Load().PublicBaseURL+"/#register\n\nIf you did not expect this invitation, you can safely ignore it.")
	if err != nil {
		utils.SendError(w, 502, "Failed to send invitation email: "+err.Error(), "smtp_send_failed")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func handleAdminListAPIKeys(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	rawKeys := db.AdminAPIKeys
	if rawKeys == nil {
		rawKeys = []models.APIKeyRecord{}
	}
	sanitized := make([]map[string]interface{}, len(rawKeys))
	for i, k := range rawKeys {
		sanitized[i] = sanitizeAPIKeyRecord(&k)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"apiKeys": sanitized})
}

func handleAdminCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}
	name := security.SafeSingleLine(toString(body["name"]), 120)

	record := store.MutateDB(func(db *models.Database) interface{} {
		if db.AdminAPIKeys == nil {
			db.AdminAPIKeys = []models.APIKeyRecord{}
		}
		now := store.Now()
		keyName := name
		if keyName == "" {
			keyName = "Admin Key " + toString(len(db.AdminAPIKeys)+1)
		}
		k := models.APIKeyRecord{
			ID:        auth.RandomID("key"),
			Name:      keyName,
			Key:       auth.RandomAPIKey(),
			Enabled:   true,
			CreatedAt: now,
			UpdatedAt: now,
		}
		db.AdminAPIKeys = append(db.AdminAPIKeys, k)
		return &k
	})

	w.WriteHeader(201)
	rk := record.(*models.APIKeyRecord)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"apiKey": sanitizeAPIKeyRecord(rk),
	})
}

func handleAdminRotateAPIKey(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result := store.MutateDB(func(db *models.Database) interface{} {
		if db.AdminAPIKeys == nil {
			db.AdminAPIKeys = []models.APIKeyRecord{}
		}
		for i := range db.AdminAPIKeys {
			if db.AdminAPIKeys[i].ID == id {
				db.AdminAPIKeys[i].Key = auth.RandomAPIKey()
				db.AdminAPIKeys[i].UpdatedAt = store.Now()
				return &db.AdminAPIKeys[i]
			}
		}
		return false
	})

	if found, ok := result.(bool); ok && !found {
		utils.SendError(w, 404, "API key not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"apiKey": sanitizeAPIKeyRecord(result.(*models.APIKeyRecord)),
	})
}

func handleAdminUpdateAPIKey(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.AdminAPIKeys {
			if db.AdminAPIKeys[i].ID == id {
				k := &db.AdminAPIKeys[i]
				if name, ok := body["name"].(string); ok {
					k.Name = security.SafeSingleLine(name, 120)
				}
				if enabled, ok := body["enabled"].(bool); ok {
					k.Enabled = enabled
				}
				k.UpdatedAt = store.Now()
				return k
			}
		}
		return false
	})

	if found, ok := result.(bool); ok && !found {
		utils.SendError(w, 404, "API key not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"apiKey": sanitizeAPIKeyRecord(result.(*models.APIKeyRecord)),
	})
}

func handleAdminDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	removed := store.MutateDB(func(db *models.Database) interface{} {
		before := len(db.AdminAPIKeys)
		filtered := make([]models.APIKeyRecord, 0)
		for _, k := range db.AdminAPIKeys {
			if k.ID != id {
				filtered = append(filtered, k)
			}
		}
		db.AdminAPIKeys = filtered
		return before != len(filtered)
	})

	if !removed.(bool) {
		utils.SendError(w, 404, "API key not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleAdminCreateProvider(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	name := security.SafeSingleLine(toString(body["name"]), 120)
	baseURL := security.SafeSingleLine(toString(body["baseUrl"]), 2048)
	apiKey := security.SafeSingleLine(toString(body["apiKey"]), 2048)

	if name == "" || baseURL == "" || apiKey == "" || !security.ValidHTTPBaseURL(baseURL) {
		utils.SendError(w, 400, "Provider name, base URL and API key are required.", "invalid_provider")
		return
	}

	baseURL = strings.TrimRight(baseURL, "/")

	result := store.MutateDB(func(db *models.Database) interface{} {
		now := store.Now()
		p := models.Provider{
			ID:                auth.RandomID("prv"),
			Name:              name,
			BaseURL:           baseURL,
			APIKey:            apiKey,
			Models:            normalizeModelList(body["models"]),
			ModelMappings:     normalizeModelMappings(body["modelMappings"]),
			Enabled:           true,
			FailoverThreshold: 3,
			HealthStatus:      "unknown",
			Availability7d:    100,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		db.Providers = append(db.Providers, p)
		return &p
	})

	w.WriteHeader(201)
	json.NewEncoder(w).Encode(store.RedactProvider(*result.(*models.Provider)))
}

func handleAdminUpdateProvider(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	if baseURL, ok := body["baseUrl"].(string); ok && strings.TrimSpace(baseURL) != "" {
		cleaned := security.SafeSingleLine(baseURL, 2048)
		if !security.ValidHTTPBaseURL(cleaned) {
			utils.SendError(w, 400, "Provider base URL is invalid.", "invalid_provider")
			return
		}
		body["baseUrl"] = cleaned
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Providers {
			if db.Providers[i].ID == id {
				p := &db.Providers[i]
				if name, ok := body["name"].(string); ok && name != "" {
					p.Name = security.SafeSingleLine(name, 120)
				}
				if baseURL, ok := body["baseUrl"].(string); ok && baseURL != "" {
					p.BaseURL = strings.TrimRight(baseURL, "/")
				}
				if apiKey, ok := body["apiKey"].(string); ok && apiKey != "" {
					p.APIKey = security.SafeSingleLine(apiKey, 2048)
				}
				if models, ok := body["models"]; ok {
					p.Models = normalizeModelList(models)
				}
				if mappings, ok := body["modelMappings"]; ok {
					p.ModelMappings = normalizeModelMappings(mappings)
				}
				if enabled, ok := body["enabled"].(bool); ok {
					p.Enabled = enabled
				}
				if ft, ok := body["failoverThreshold"].(float64); ok {
					p.FailoverThreshold = int(ft)
				}
				if pri, ok := body["priority"].(float64); ok {
					p.Priority = int(pri)
				}
				p.UpdatedAt = store.Now()
				return p
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "Provider not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(store.RedactProvider(*result.(*models.Provider)))
}

func handleAdminDeleteProvider(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	removed := store.MutateDB(func(db *models.Database) interface{} {
		before := len(db.Providers)
		filtered := make([]models.Provider, 0)
		for _, p := range db.Providers {
			if p.ID != id {
				filtered = append(filtered, p)
			}
		}
		db.Providers = filtered
		return before != len(filtered)
	})

	if !removed.(bool) {
		utils.SendError(w, 404, "Provider not found.", "not_found")
		return
	}

	w.WriteHeader(204)
}

func handleAdminFetchProviderModels(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	baseURL := security.SafeSingleLine(toString(body["baseUrl"]), 2048)
	apiKey := security.SafeSingleLine(toString(body["apiKey"]), 2048)

	if baseURL == "" || apiKey == "" || !security.ValidHTTPBaseURL(baseURL) {
		utils.SendError(w, 400, "Provider base URL and API key are required.", "invalid_provider")
		return
	}

	url := utils.BuildUpstreamURL(baseURL, "/v1/models")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		utils.SendError(w, 400, "Invalid provider URL.", "invalid_provider")
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := proxy.DoUpstream(req)
	if err != nil {
		utils.SendError(w, 502, "Failed to fetch upstream models: "+err.Error(), "models_fetch_failed")
		return
	}
	defer resp.Body.Close()

	var payload map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&payload)

	if resp.StatusCode >= 400 {
		utils.SendError(w, 502, fmt.Sprintf("Failed to fetch upstream models. Upstream responded with HTTP %d.", resp.StatusCode), "models_fetch_failed")
		return
	}

	modelIDs := extractModelIDs(payload)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"models": modelIDs,
		"count":  len(modelIDs),
	})
}

func handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	cfg := config.Load()
	username, usernameSet := "", false
	if raw, ok := body["username"].(string); ok {
		usernameSet = true
		username = normalizeUsername(security.SafeSingleLine(raw, 64))
		if !validUsername(username) {
			utils.SendError(w, 400, "Username must be 3-64 characters and contain only letters, numbers, dot, underscore or hyphen.", "invalid_username")
			return
		}
		if auth.SafeEqual(username, normalizeUsername(cfg.AdminUser)) {
			utils.SendError(w, 409, "Username is reserved.", "username_reserved")
			return
		}
	}

	email, emailSet := "", false
	if raw, ok := body["email"].(string); ok {
		emailSet = true
		email = strings.ToLower(security.SafeSingleLine(raw, 254))
		if email != "" && !strings.Contains(email, "@") {
			utils.SendError(w, 400, "Valid email address is required.", "invalid_email")
			return
		}
	}

	subscriptionTier, subscriptionTierSet := "", false
	if raw, ok := body["subscriptionTier"].(string); ok {
		subscriptionTierSet = true
		subscriptionTier = security.SafeSingleLine(raw, 32)
		if !subscription.IsValidTier(subscriptionTier) {
			utils.SendError(w, 400, "Subscription tier is invalid.", "invalid_subscription_tier")
			return
		}
		subscriptionTier = subscription.NormalizeTier(subscriptionTier)
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		targetIdx := -1
		for i := range db.Users {
			if db.Users[i].ID == id {
				targetIdx = i
				break
			}
		}
		if targetIdx < 0 {
			return nil
		}

		if usernameSet {
			for i := range db.Users {
				if i == targetIdx {
					continue
				}
				if normalizeUsername(db.Users[i].Username) == username {
					return "username_exists"
				}
				if db.Users[i].Username == "" && normalizeUsername(db.Users[i].Name) == username {
					return "username_exists"
				}
			}
		}
		if emailSet && email != "" {
			for i := range db.Users {
				if i == targetIdx {
					continue
				}
				if strings.EqualFold(db.Users[i].Email, email) {
					return "email_exists"
				}
			}
		}

		u := &db.Users[targetIdx]
		if name, ok := body["name"].(string); ok {
			u.Name = security.SafeSingleLine(name, 120)
		}
		if usernameSet {
			u.Username = username
		}
		if emailSet {
			u.Email = email
			if u.Source == "" {
				u.Source = userSourceForEmail(email)
			}
		}
		if enabled, ok := body["enabled"].(bool); ok {
			u.Enabled = enabled
		}
		if receiveEmail, ok := body["receiveAnnouncementEmail"].(bool); ok {
			u.ReceiveAnnouncementEmail = receiveEmail
		}
		if subscriptionTierSet {
			u.SubscriptionTier = subscriptionTier
		}
		u.UpdatedAt = store.Now()
		return u
	})

	if result == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}
	if errCode, ok := result.(string); ok {
		switch errCode {
		case "username_exists":
			utils.SendError(w, 409, "Username is already registered.", errCode)
		case "email_exists":
			utils.SendError(w, 409, "Email is already registered.", errCode)
		default:
			utils.SendError(w, 400, "User could not be updated.", errCode)
		}
		return
	}

	json.NewEncoder(w).Encode(sanitizeUser(result.(*models.User)))
}

func handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	removed := store.MutateDB(func(db *models.Database) interface{} {
		before := len(db.Users)
		filtered := make([]models.User, 0)
		for _, u := range db.Users {
			if u.ID != id {
				filtered = append(filtered, u)
			}
		}
		db.Users = filtered
		return before != len(filtered)
	})

	if !removed.(bool) {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}

	w.WriteHeader(204)
}

func handleAdminResetUserPassword(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	password, _ := body["password"].(string)
	if len(password) < 8 {
		utils.SendError(w, 400, "Password must be at least 8 characters.", "invalid_password")
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == id {
				db.Users[i].PasswordHash = auth.HashPassword(password)
				db.Users[i].UpdatedAt = store.Now()
				return &db.Users[i]
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(sanitizeUser(result.(*models.User)))
}

func handleAdminUpdateUserAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	keyID := r.PathValue("keyId")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == userID {
				u := &db.Users[i]
				for j := range u.APIKeys {
					if u.APIKeys[j].ID == keyID {
						if rpm, ok := body["rpmLimit"].(float64); ok {
							u.APIKeys[j].RPMLimit = subscription.ClampAPIKeyRPMLimit(u, int(rpm))
						}
						u.APIKeys[j].UpdatedAt = store.Now()
						return u
					}
				}
				return false
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}
	if found, ok := result.(bool); ok && !found {
		utils.SendError(w, 404, "API key not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(sanitizeUser(result.(*models.User)))
}

func handleAdminListAnnouncements(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"announcements": db.Announcements,
	})
}

func handleAdminCreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	title := security.SafeSingleLine(toString(body["title"]), 160)
	content := security.SafeText(toString(body["content"]), 20000)
	annType := security.SafeSingleLine(toString(body["type"]), 20)
	sendEmail := toBool(body["sendEmail"])

	if title == "" {
		utils.SendError(w, 400, "Title is required.", "invalid_title")
		return
	}
	if content == "" {
		utils.SendError(w, 400, "Content is required.", "invalid_content")
		return
	}

	validTypes := map[string]bool{"info": true, "warning": true, "success": true, "error": true}
	if !validTypes[annType] {
		annType = "info"
	}

	record := store.MutateDB(func(db *models.Database) interface{} {
		now := store.Now()
		item := models.Announcement{
			ID:        auth.RandomID("ann"),
			Title:     title,
			Content:   content,
			Type:      annType,
			Enabled:   true,
			SendEmail: sendEmail,
			CreatedAt: now,
			UpdatedAt: now,
		}
		db.Announcements = append(db.Announcements, item)
		return &item
	})

	if sendEmail {
		go func() {
			db := store.ReadDB()
			smtpCfg := getSMTPConfig(db)
			if createSMTPTransport(smtpCfg) {
				for _, u := range db.Users {
					if u.Email != "" && u.Enabled && u.ReceiveAnnouncementEmail {
						sendMail(smtpCfg, u.Email, "【公告】"+title,
							title+"\n\n"+content+"\n\n---\n此邮件由系统自动发送。"+
								fmt.Sprintf("\n如果您觉得邮件比较打扰，可以前往 %s/#portal 关闭通知。", config.Load().PublicBaseURL))
					}
				}
			}
		}()
	}

	w.WriteHeader(201)
	json.NewEncoder(w).Encode(record)
}

func handleAdminUpdateAnnouncement(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Announcements {
			if db.Announcements[i].ID == id {
				a := &db.Announcements[i]
				if title, ok := body["title"].(string); ok {
					a.Title = security.SafeSingleLine(title, 160)
				}
				if content, ok := body["content"].(string); ok {
					a.Content = security.SafeText(content, 20000)
				}
				if annType, ok := body["type"].(string); ok {
					annType = security.SafeSingleLine(annType, 20)
					validTypes := map[string]bool{"info": true, "warning": true, "success": true, "error": true}
					if validTypes[annType] {
						a.Type = annType
					}
				}
				if enabled, ok := body["enabled"].(bool); ok {
					a.Enabled = enabled
				}
				if sendEmail, ok := body["sendEmail"].(bool); ok {
					a.SendEmail = sendEmail
				}
				a.UpdatedAt = store.Now()
				return a
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "Announcement not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(result)
}

func handleAdminDeleteAnnouncement(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	removed := store.MutateDB(func(db *models.Database) interface{} {
		before := len(db.Announcements)
		filtered := make([]models.Announcement, 0)
		for _, a := range db.Announcements {
			if a.ID != id {
				filtered = append(filtered, a)
			}
		}
		db.Announcements = filtered
		return before != len(filtered)
	})

	if !removed.(bool) {
		utils.SendError(w, 404, "Announcement not found.", "not_found")
		return
	}

	w.WriteHeader(204)
}

func handleAdminListSuggestions(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	suggestions := make([]models.Suggestion, len(db.Suggestions))
	copy(suggestions, db.Suggestions)
	for i := 0; i < len(suggestions); i++ {
		for j := i + 1; j < len(suggestions); j++ {
			if suggestions[j].CreatedAt > suggestions[i].CreatedAt {
				suggestions[i], suggestions[j] = suggestions[j], suggestions[i]
			}
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"suggestions": suggestions})
}

func handleAdminReplySuggestion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}
	reply := security.SafeText(toString(body["reply"]), 20000)

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Suggestions {
			if db.Suggestions[i].ID == id {
				now := store.Now()
				db.Suggestions[i].Reply = reply
				db.Suggestions[i].UpdatedAt = now
				if reply == "" {
					db.Suggestions[i].RepliedAt = ""
					db.Suggestions[i].RepliedBy = ""
				} else {
					db.Suggestions[i].RepliedAt = now
					db.Suggestions[i].RepliedBy = "admin"
				}
				return &db.Suggestions[i]
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "Suggestion not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"suggestion": result})
}

func handleAdminDeleteSuggestion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	removed := store.MutateDB(func(db *models.Database) interface{} {
		before := len(db.Suggestions)
		filtered := make([]models.Suggestion, 0)
		for _, s := range db.Suggestions {
			if s.ID != id {
				filtered = append(filtered, s)
			}
		}
		db.Suggestions = filtered
		return before != len(filtered)
	})

	if !removed.(bool) {
		utils.SendError(w, 404, "Suggestion not found.", "not_found")
		return
	}

	w.WriteHeader(204)
}

func handleAdminGetSiteEmail(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"siteEmail": db.SiteEmail,
	})
}

func handleAdminUpdateSiteEmail(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	email := security.SafeSingleLine(toString(body["siteEmail"]), 254)
	if email != "" && !strings.Contains(email, "@") {
		utils.SendError(w, 400, "Valid email address is required.", "invalid_email")
		return
	}

	store.MutateDB(func(db *models.Database) interface{} {
		db.SiteEmail = email
		return nil
	})

	json.NewEncoder(w).Encode(map[string]interface{}{"siteEmail": email})
}

func handleAdminUpdateRPMLimit(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	limit := int(toFloat(body["defaultRpmLimit"]))
	if limit < 1 {
		utils.SendError(w, 400, "RPM limit must be a positive number.", "invalid_rpm_limit")
		return
	}

	store.MutateDB(func(db *models.Database) interface{} {
		db.DefaultRPMLimit = limit
		return nil
	})

	json.NewEncoder(w).Encode(map[string]interface{}{"defaultRpmLimit": limit})
}

func handleAdminUpdateBanner(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	content := security.SafeText(toString(body["content"]), 20000)
	updatedAt := store.Now()

	store.MutateDB(func(db *models.Database) interface{} {
		db.SiteBanner = &models.SiteBanner{
			Content:   content,
			UpdatedAt: updatedAt,
		}
		return nil
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"content":   content,
		"updatedAt": updatedAt,
	})
}

func handleAdminUpdateMaintenance(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	enabled := toBool(body["maintenanceMode"])
	endTime := security.SafeSingleLine(toString(body["maintenanceEndTime"]), 64)

	store.MutateDB(func(db *models.Database) interface{} {
		db.MaintenanceMode = enabled
		if endTime != "" {
			db.MaintenanceEndTime = endTime
		}
		if !enabled {
			db.MaintenanceEndTime = ""
		}
		return nil
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"maintenanceMode":    enabled,
		"maintenanceEndTime": endTime,
	})
}

func sanitizeUsers(users []models.User) []map[string]interface{} {
	result := make([]map[string]interface{}, len(users))
	for i, u := range users {
		result[i] = sanitizeUser(&u)
	}
	return result
}

func sanitizeAdminAPIKeys(keys []models.APIKeyRecord) []map[string]interface{} {
	if keys == nil {
		return []map[string]interface{}{}
	}
	result := make([]map[string]interface{}, len(keys))
	for i, k := range keys {
		result[i] = sanitizeAPIKeyRecord(&k)
	}
	return result
}

func normalizeModelList(value interface{}) []models.Model {
	if value == nil {
		return []models.Model{}
	}

	switch v := value.(type) {
	case []interface{}:
		models := make([]models.Model, len(v))
		for i, item := range v {
			models[i] = store.NormalizeModel(item)
		}
		return models
	case string:
		ids := strings.Split(v, "\n")
		modelList := make([]models.Model, len(ids))
		for i, id := range ids {
			id = strings.TrimSpace(id)
			if id != "" {
				modelList[i] = models.Model{ID: id, Name: id}
			}
		}
		result := make([]models.Model, 0)
		for _, m := range modelList {
			if m.ID != "" {
				result = append(result, m)
			}
		}
		return result
	default:
		return []models.Model{}
	}
}

func normalizeModelMappings(value interface{}) map[string]string {
	result := make(map[string]string)
	if value == nil {
		return result
	}

	switch v := value.(type) {
	case map[string]interface{}:
		for k, val := range v {
			customID := strings.TrimSpace(k)
			upstreamID := strings.TrimSpace(toString(val))
			if customID != "" && upstreamID != "" {
				result[customID] = upstreamID
			}
		}
	}
	return result
}

func extractModelIDs(payload map[string]interface{}) []string {
	var source []interface{}
	if arr, ok := payload["data"].([]interface{}); ok {
		source = arr
	} else if arr, ok := payload["models"].([]interface{}); ok {
		source = arr
	}

	idSet := make(map[string]bool)
	if source != nil {
		for _, item := range source {
			switch v := item.(type) {
			case string:
				idSet[strings.TrimSpace(v)] = true
			case map[string]interface{}:
				if id, ok := v["id"].(string); ok {
					idSet[strings.TrimSpace(id)] = true
				} else if name, ok := v["name"].(string); ok {
					idSet[strings.TrimSpace(name)] = true
				}
			}
		}
	}

	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		if id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func toBool(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

func toFloat(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	}
	return 0
}
