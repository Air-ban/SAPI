package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
	"sapi/usage"
	"sapi/utils"
)

func MountUserRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/user/me", handleDeprecatedSessionGET)
	mux.HandleFunc("POST /api/user/session", middleware.RequireUserAccount(handleUserSession))
	mux.HandleFunc("POST /api/user/api-key", middleware.RequireUserAccount(handleUserCreateAPIKey))
	mux.HandleFunc("POST /api/user/api-key/rotate", middleware.RequireUserAccount(handleUserRotateAPIKey))
	mux.HandleFunc("POST /api/user/api-keys/{id}/rotate", middleware.RequireUserAccount(handleUserRotateSpecificKey))
	mux.HandleFunc("PUT /api/user/api-keys/{id}", middleware.RequireUserAccount(handleUserUpdateAPIKey))
	mux.HandleFunc("DELETE /api/user/api-keys/{id}", middleware.RequireUserAccount(handleUserDeleteAPIKey))
	mux.HandleFunc("PUT /api/user/settings", middleware.RequireUserAccount(handleUserSettings))
	mux.HandleFunc("DELETE /api/user/account", middleware.RequireUserAccount(handleUserDeleteAccount))
	mux.HandleFunc("GET /api/user/usage", middleware.RequireUserAccount(handleUserUsage))
	mux.HandleFunc("GET /api/user/request-logs/{id}", middleware.RequireUserAccount(handleUserRequestLog))
	mux.HandleFunc("GET /api/user/suggestions", middleware.RequireUserAccount(handleUserSuggestions))
}

func handleUserSession(w http.ResponseWriter, r *http.Request) {
	writeUserSession(w, r, true)
}

func handleDeprecatedSessionGET(w http.ResponseWriter, r *http.Request) {
	setSessionNoStoreHeaders(w.Header())
	utils.SendError(w, http.StatusGone, "This session endpoint has been replaced by POST session validation.", "session_endpoint_deprecated")
}

func setSessionNoStoreHeaders(header http.Header) {
	header.Set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate, private")
	header.Set("CDN-Cache-Control", "no-store")
	header.Set("Surrogate-Control", "no-store")
	header.Set("Pragma", "no-cache")
	header.Set("Expires", "0")
	addHeaderValue(header, "Vary", "Authorization")
	addHeaderValue(header, "Vary", "X-API-Key")
	addHeaderValue(header, "Vary", "Cookie")
}

func addHeaderValue(header http.Header, key, value string) {
	for _, existing := range header.Values(key) {
		for _, part := range strings.Split(existing, ",") {
			if strings.EqualFold(strings.TrimSpace(part), value) {
				return
			}
		}
	}
	header.Add(key, value)
}

func writeUserSession(w http.ResponseWriter, r *http.Request, includeSession bool) {
	user := middleware.GetUser(r)
	if user == nil {
		utils.SendError(w, 401, "User not found.", "not_found")
		return
	}
	payload := map[string]interface{}{
		"user":   sanitizeUser(user),
		"config": serviceConfigForRequest(r, user),
	}
	if includeSession {
		session := currentSessionPayload(r)
		if !sessionMatchesUser(session, user) {
			utils.SendError(w, 401, "User authentication is invalid.", "unauthorized")
			return
		}
		payload["session"] = session
	}
	json.NewEncoder(w).Encode(payload)
}

func sessionMatchesUser(session map[string]interface{}, user *models.User) bool {
	if session == nil || user == nil {
		return false
	}
	role, _ := session["role"].(string)
	sub, _ := session["sub"].(string)
	if isAdminVirtualUser(user) {
		return role == "admin" && auth.SafeEqual(sub, config.Load().AdminUser)
	}
	return role == "user" && auth.SafeEqual(sub, user.ID)
}

func currentSessionPayload(r *http.Request) map[string]interface{} {
	payload := middleware.GetTokenPayload(r)
	if payload == nil {
		return nil
	}
	return map[string]interface{}{
		"role": payload.Role,
		"sub":  payload.Sub,
		"exp":  payload.Exp,
	}
}

func handleUserCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	name := security.SafeSingleLine(toString(body["name"]), 120)
	allowedModels := []string{}
	if am, ok := body["allowedModels"].([]interface{}); ok {
		for _, m := range am {
			if item := security.SafeSingleLine(toString(m), 200); item != "" {
				allowedModels = append(allowedModels, item)
			}
		}
	}
	rpmLimit := 0
	if v, ok := body["rpmLimit"].(float64); ok {
		rpmLimit = int(v)
	}

	if isAdminVirtualUser(user) {
		result := store.MutateDB(func(db *models.Database) interface{} {
			createAdminUserAPIKeyRecord(db, name, allowedModels)
			return adminVirtualUserFromDB(db)
		})
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"user": sanitizeUser(result.(*models.User)),
		})
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				createUserAPIKeyRecord(u, db, name, allowedModels, rpmLimit)
				return u
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}

	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user": sanitizeUser(result.(*models.User)),
	})
}

func handleUserRotateAPIKey(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	if isAdminVirtualUser(user) {
		result := store.MutateDB(func(db *models.Database) interface{} {
			targetID, _ := body["id"].(string)
			if rotateAdminAPIKeyRecord(db, targetID) {
				return adminVirtualUserFromDB(db)
			}
			createAdminUserAPIKeyRecord(db, toString(body["name"]), nil)
			return adminVirtualUserFromDB(db)
		})
		json.NewEncoder(w).Encode(map[string]interface{}{
			"user": sanitizeUser(result.(*models.User)),
		})
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				apiKeys := getAPIKeys(u)

				targetID, _ := body["id"].(string)
				var target *models.APIKeyRecord
				for j := range apiKeys {
					if apiKeys[j].ID == targetID {
						target = &apiKeys[j]
						break
					}
				}
				if target == nil {
					for j := range apiKeys {
						if apiKeys[j].Enabled {
							target = &apiKeys[j]
							break
						}
					}
				}

				if target == nil {
					createUserAPIKeyRecord(u, db, toString(body["name"]), nil, 0)
					return u
				}

				now := store.Now()
				for j := range u.APIKeys {
					if u.APIKeys[j].ID == target.ID {
						u.APIKeys[j].Key = auth.RandomAPIKey()
						u.APIKeys[j].UpdatedAt = now
					}
				}
				u.APIKey = primaryAPIKeyFromRecords(getAPIKeys(u))
				u.UpdatedAt = now
				return u
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user": sanitizeUser(result.(*models.User)),
	})
}

func handleUserRotateSpecificKey(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	keyID := r.PathValue("id")

	if isAdminVirtualUser(user) {
		result := store.MutateDB(func(db *models.Database) interface{} {
			if rotateAdminAPIKeyRecord(db, keyID) {
				return adminVirtualUserFromDB(db)
			}
			return false
		})
		if found, ok := result.(bool); ok && !found {
			utils.SendError(w, 404, "API key not found.", "not_found")
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"user": sanitizeUser(result.(*models.User)),
		})
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				for j := range u.APIKeys {
					if u.APIKeys[j].ID == keyID {
						now := store.Now()
						u.APIKeys[j].Key = auth.RandomAPIKey()
						u.APIKeys[j].UpdatedAt = now
						u.APIKey = primaryAPIKeyFromRecords(getAPIKeys(u))
						u.UpdatedAt = now
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

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user": sanitizeUser(result.(*models.User)),
	})
}

func handleUserUpdateAPIKey(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	keyID := r.PathValue("id")
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	if isAdminVirtualUser(user) {
		result := store.MutateDB(func(db *models.Database) interface{} {
			for i := range db.AdminAPIKeys {
				if db.AdminAPIKeys[i].ID == keyID {
					updateUserAPIKeyRecord(&db.AdminAPIKeys[i], user, body)
					db.AdminAPIKeys[i].RPMLimit = 0
					return adminVirtualUserFromDB(db)
				}
			}
			return false
		})
		if found, ok := result.(bool); ok && !found {
			utils.SendError(w, 404, "API key not found.", "not_found")
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"user": sanitizeUser(result.(*models.User)),
		})
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				for j := range u.APIKeys {
					if u.APIKeys[j].ID == keyID {
						k := &u.APIKeys[j]
						updateUserAPIKeyRecord(k, u, body)
						now := store.Now()
						k.UpdatedAt = now
						u.APIKey = primaryAPIKeyFromRecords(getAPIKeys(u))
						u.UpdatedAt = now
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

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user": sanitizeUser(result.(*models.User)),
	})
}

func handleUserDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	keyID := r.PathValue("id")

	if isAdminVirtualUser(user) {
		result := store.MutateDB(func(db *models.Database) interface{} {
			before := len(db.AdminAPIKeys)
			filtered := make([]models.APIKeyRecord, 0, len(db.AdminAPIKeys))
			for _, k := range db.AdminAPIKeys {
				if k.ID != keyID {
					filtered = append(filtered, k)
				}
			}
			db.AdminAPIKeys = filtered
			return before != len(filtered)
		})
		if !result.(bool) {
			utils.SendError(w, 404, "API key not found.", "not_found")
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				before := len(u.APIKeys)
				filtered := make([]models.APIKeyRecord, 0)
				for _, k := range u.APIKeys {
					if k.ID != keyID {
						filtered = append(filtered, k)
					}
				}
				removed := before != len(filtered)
				if removed {
					u.APIKeys = filtered
					u.APIKey = primaryAPIKeyFromRecords(getAPIKeys(u))
					u.UpdatedAt = store.Now()
				}
				return removed
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}
	if !result.(bool) {
		utils.SendError(w, 404, "API key not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleUserSettings(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	if isAdminVirtualUser(user) {
		if v, ok := body["collapseModelProviders"].(bool); ok {
			store.MutateDB(func(db *models.Database) interface{} {
				db.AdminCollapseModelProviders = v
				return nil
			})
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"user": sanitizeUser(adminVirtualUserFromDB(store.ReadDB())),
		})
		return
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				if v, ok := body["receiveAnnouncementEmail"].(bool); ok {
					u.ReceiveAnnouncementEmail = v
				}
				if v, ok := body["collapseModelProviders"].(bool); ok {
					u.CollapseModelProviders = v
				}
				u.UpdatedAt = store.Now()
				return u
			}
		}
		return nil
	})

	if result == nil {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user": sanitizeUser(result.(*models.User)),
	})
}

func handleUserDeleteAccount(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		utils.SendError(w, 401, "User authentication is required.", "unauthorized")
		return
	}
	if isAdminVirtualUser(user) {
		utils.SendError(w, 403, "Admin account cannot be deleted from the user portal.", "admin_account_cannot_be_deleted")
		return
	}

	if !store.DeleteUserAccount(user.ID) {
		utils.SendError(w, 404, "User not found.", "not_found")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleUserUsage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	db := store.ReadDB()
	days := 30
	if d, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil {
		days = min(max(d, 1), 365)
	}
	userID := user.ID
	if isAdminVirtualUser(user) {
		userID = ""
	}
	stats := usage.GetUsageStats(db, userID, days)
	stats.Recent = store.RequestLogsForUserView(stats.Recent)
	stats.RecentRequests = store.RequestLogsForUserView(stats.RecentRequests)
	json.NewEncoder(w).Encode(stats)
}

func handleUserRequestLog(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		utils.SendError(w, 401, "User authentication is required.", "unauthorized")
		return
	}
	userID := user.ID
	if isAdminVirtualUser(user) {
		userID = ""
	}
	item, ok := store.FindRequestLog(r.PathValue("id"), userID)
	if !ok {
		utils.SendError(w, 404, "Request log not found.", "not_found")
		return
	}
	safe := store.RequestLogForUserView(*item)
	json.NewEncoder(w).Encode(map[string]interface{}{"requestLog": safe})
}

func handleUserSuggestions(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	db := store.ReadDB()
	items := make([]models.Suggestion, 0)
	for _, suggestion := range db.Suggestions {
		if isAdminVirtualUser(user) || suggestion.UserID == user.ID {
			items = append(items, suggestion)
		}
	}
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].CreatedAt > items[i].CreatedAt {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"suggestions": items})
}

func createUserAPIKeyRecord(user *models.User, db *models.Database, name string, allowedModels []string, rpmLimit int) *models.APIKeyRecord {
	now := store.Now()
	keyName := security.SafeSingleLine(name, 120)
	if keyName == "" {
		keyName = "API Key " + toString(len(user.APIKeys)+1)
	}
	rpmLimit = subscription.ClampAPIKeyRPMLimit(user, rpmLimit)

	record := models.APIKeyRecord{
		ID:            auth.RandomID("key"),
		Name:          keyName,
		Key:           auth.RandomAPIKey(),
		Enabled:       true,
		AllowedModels: allowedModels,
		RPMLimit:      rpmLimit,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	user.APIKeys = append(user.APIKeys, record)
	if user.APIKey == "" {
		user.APIKey = record.Key
	}
	user.UpdatedAt = now
	return &record
}

func createAdminUserAPIKeyRecord(db *models.Database, name string, allowedModels []string) *models.APIKeyRecord {
	if db.AdminAPIKeys == nil {
		db.AdminAPIKeys = []models.APIKeyRecord{}
	}
	now := store.Now()
	keyName := security.SafeSingleLine(name, 120)
	if keyName == "" {
		keyName = "Admin Key " + toString(len(db.AdminAPIKeys)+1)
	}

	record := models.APIKeyRecord{
		ID:            auth.RandomID("key"),
		Name:          keyName,
		Key:           auth.RandomAPIKey(),
		Enabled:       true,
		AllowedModels: allowedModels,
		RPMLimit:      0,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	db.AdminAPIKeys = append(db.AdminAPIKeys, record)
	return &record
}

func rotateAdminAPIKeyRecord(db *models.Database, keyID string) bool {
	if db.AdminAPIKeys == nil {
		db.AdminAPIKeys = []models.APIKeyRecord{}
	}
	targetIndex := -1
	if keyID != "" {
		for i := range db.AdminAPIKeys {
			if db.AdminAPIKeys[i].ID == keyID {
				targetIndex = i
				break
			}
		}
	}
	if targetIndex < 0 {
		for i := range db.AdminAPIKeys {
			if db.AdminAPIKeys[i].Enabled {
				targetIndex = i
				break
			}
		}
	}
	if targetIndex < 0 {
		return false
	}
	db.AdminAPIKeys[targetIndex].Key = auth.RandomAPIKey()
	db.AdminAPIKeys[targetIndex].RPMLimit = 0
	db.AdminAPIKeys[targetIndex].UpdatedAt = store.Now()
	return true
}

func updateUserAPIKeyRecord(k *models.APIKeyRecord, user *models.User, body map[string]interface{}) {
	if k == nil {
		return
	}
	if name, ok := body["name"].(string); ok {
		k.Name = security.SafeSingleLine(name, 120)
	}
	if enabled, ok := body["enabled"].(bool); ok {
		k.Enabled = enabled
	}
	if am, ok := body["allowedModels"].([]interface{}); ok {
		models := make([]string, 0)
		for _, m := range am {
			if item := security.SafeSingleLine(toString(m), 200); item != "" {
				models = append(models, item)
			}
		}
		k.AllowedModels = models
	}
	if rpm, ok := body["rpmLimit"].(float64); ok {
		k.RPMLimit = subscription.ClampAPIKeyRPMLimit(user, int(rpm))
	}
	k.UpdatedAt = store.Now()
}

func adminVirtualUserFromDB(db *models.Database) *models.User {
	keys := []models.APIKeyRecord{}
	collapse := false
	if db != nil {
		keys = db.AdminAPIKeys
		collapse = db.AdminCollapseModelProviders
	}
	user := middleware.AdminVirtualUserWithAPIKeys(config.Load(), keys)
	user.CollapseModelProviders = collapse
	return user
}

func isAdminVirtualUser(user *models.User) bool {
	return user != nil && user.ID == models.AdminVirtualUserID
}

func defaultRPMLimitForUser(user *models.User, db *models.Database) int {
	return subscription.RPMLimitForUser(user)
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
