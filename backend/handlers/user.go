package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"sapi/auth"
	"sapi/middleware"
	"sapi/models"
	"sapi/store"
	"sapi/usage"
	"sapi/utils"
)

func MountUserRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/user/me", middleware.RequireUserAccount(handleUserMe))
	mux.HandleFunc("POST /api/user/api-key", middleware.RequireUserAccount(handleUserCreateAPIKey))
	mux.HandleFunc("POST /api/user/api-key/rotate", middleware.RequireUserAccount(handleUserRotateAPIKey))
	mux.HandleFunc("POST /api/user/api-keys/{id}/rotate", middleware.RequireUserAccount(handleUserRotateSpecificKey))
	mux.HandleFunc("PUT /api/user/api-keys/{id}", middleware.RequireUserAccount(handleUserUpdateAPIKey))
	mux.HandleFunc("DELETE /api/user/api-keys/{id}", middleware.RequireUserAccount(handleUserDeleteAPIKey))
	mux.HandleFunc("PUT /api/user/settings", middleware.RequireUserAccount(handleUserSettings))
	mux.HandleFunc("GET /api/user/usage", middleware.RequireUserAccount(handleUserUsage))
	mux.HandleFunc("GET /api/user/suggestions", middleware.RequireUserAccount(handleUserSuggestions))
}

func handleUserMe(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		utils.SendError(w, 401, "User not found.", "not_found")
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":   sanitizeUser(user),
		"config": serviceConfig(),
	})
}

func handleUserCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	name, _ := body["name"].(string)
	allowedModels := []string{}
	if am, ok := body["allowedModels"].([]interface{}); ok {
		for _, m := range am {
			allowedModels = append(allowedModels, toString(m))
		}
	}
	rpmLimit := 0
	if v, ok := body["rpmLimit"].(float64); ok {
		rpmLimit = int(v)
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				createUserAPIKeyRecord(u, name, allowedModels, rpmLimit)
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
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

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
					createUserAPIKeyRecord(u, toString(body["name"]), nil, 0)
					return u
				}

				now := store.Now()
				for j := range u.APIKeys {
					if u.APIKeys[j].ID == target.ID {
						u.APIKeys[j].Key = auth.RandomAPIKey()
						u.APIKeys[j].UpdatedAt = now
					}
				}
				u.APIKey = getPrimaryAPIKey(u)
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

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				for j := range u.APIKeys {
					if u.APIKeys[j].ID == keyID {
						now := store.Now()
						u.APIKeys[j].Key = auth.RandomAPIKey()
						u.APIKeys[j].UpdatedAt = now
						u.APIKey = getPrimaryAPIKey(u)
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
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				for j := range u.APIKeys {
					if u.APIKeys[j].ID == keyID {
						k := &u.APIKeys[j]
						if name, ok := body["name"].(string); ok {
							k.Name = strings.TrimSpace(name)
						}
						if enabled, ok := body["enabled"].(bool); ok {
							k.Enabled = enabled
						}
						if am, ok := body["allowedModels"].([]interface{}); ok {
							models := make([]string, 0)
							for _, m := range am {
								models = append(models, toString(m))
							}
							k.AllowedModels = models
						}
						if rpm, ok := body["rpmLimit"].(float64); ok {
							k.RPMLimit = max(0, int(rpm))
						}
						now := store.Now()
						k.UpdatedAt = now
						u.APIKey = getPrimaryAPIKey(u)
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
					u.APIKey = getPrimaryAPIKey(u)
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
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	result := store.MutateDB(func(db *models.Database) interface{} {
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				u := &db.Users[i]
				if v, ok := body["receiveAnnouncementEmail"].(bool); ok {
					u.ReceiveAnnouncementEmail = v
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

func handleUserUsage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	db := store.ReadDB()
	days := 30
	if d, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil {
		days = min(max(d, 1), 365)
	}
	json.NewEncoder(w).Encode(usage.GetUsageStats(db, user.ID, days))
}

func handleUserSuggestions(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	db := store.ReadDB()
	items := make([]models.Suggestion, 0)
	for _, suggestion := range db.Suggestions {
		if suggestion.UserID == user.ID {
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

func createUserAPIKeyRecord(user *models.User, name string, allowedModels []string, rpmLimit int) *models.APIKeyRecord {
	now := store.Now()
	keyName := strings.TrimSpace(name)
	if keyName == "" {
		keyName = "API Key " + toString(len(user.APIKeys)+1)
	}

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

func toString(v interface{}) string {
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
