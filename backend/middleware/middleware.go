package middleware

import (
	"context"
	"net/http"
	"sync"
	"time"

	"sapi/auth"
	"sapi/models"
	"sapi/store"
	"sapi/utils"
)

type contextKey string

const userContextKey contextKey = "user"

func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, anthropic-version, anthropic-beta")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := utils.GetBearerToken(r)
		db := store.ReadDB()
		payload := auth.VerifyToken(token, db.AppSecret)

		if payload == nil || payload.Role != "admin" {
			utils.SendError(w, 401, "Admin authentication is required.", "unauthorized")
			return
		}
		next(w, r)
	}
}

func RequireUserAccount(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := utils.GetBearerToken(r)
		db := store.ReadDB()
		payload := auth.VerifyToken(token, db.AppSecret)

		if payload == nil || payload.Role != "user" || payload.Sub == "" {
			utils.SendError(w, 401, "User authentication is required.", "unauthorized")
			return
		}

		for _, u := range db.Users {
			if u.ID == payload.Sub {
				if !u.Enabled {
					utils.SendError(w, 403, "User account is disabled.", "user_disabled")
					return
				}
				ctx := context.WithValue(r.Context(), userContextKey, &u)
				next(w, r.WithContext(ctx))
				return
			}
		}

		utils.SendError(w, 401, "User account was not found.", "unauthorized")
	}
}

func GetUser(r *http.Request) *models.User {
	u, _ := r.Context().Value(userContextKey).(*models.User)
	return u
}

type FindUserByKeyResult struct {
	DB           *models.Database
	User         *models.User
	APIKeyRecord *models.APIKeyRecord
}

func FindUserByKey(apiKey string) *FindUserByKeyResult {
	db := store.ReadDB()

	for i := range db.Users {
		u := &db.Users[i]
		if !u.Enabled {
			continue
		}

		for j := range u.APIKeys {
			k := &u.APIKeys[j]
			if k.Enabled && auth.SafeEqual(k.Key, apiKey) {
				return &FindUserByKeyResult{
					DB:           db,
					User:         u,
					APIKeyRecord: k,
				}
			}
		}

		if len(u.APIKeys) == 0 && u.APIKey != "" && auth.SafeEqual(u.APIKey, apiKey) {
			return &FindUserByKeyResult{
				DB: db,
				User: u,
				APIKeyRecord: &models.APIKeyRecord{
					ID:      "legacy",
					Name:    "默认 Key",
					Key:     u.APIKey,
					Enabled: true,
				},
			}
		}
	}

	for i := range db.AdminAPIKeys {
		k := &db.AdminAPIKeys[i]
		if k.Enabled && auth.SafeEqual(k.Key, apiKey) {
			return &FindUserByKeyResult{
				DB: db,
				User: &models.User{
					ID:       "__admin__",
					Name:     "Administrator",
					Username: "admin",
					Enabled:  true,
				},
				APIKeyRecord: k,
			}
		}
	}

	return &FindUserByKeyResult{DB: db, User: nil, APIKeyRecord: nil}
}

var rpmWindows sync.Map

type rpmWindow struct {
	mu         sync.Mutex
	timestamps []int64
}

func CheckRPMLimit(apiKeyRecord *models.APIKeyRecord, db *models.Database) (bool, int, int) {
	limit := 30
	if db != nil && db.DefaultRPMLimit > 0 {
		limit = db.DefaultRPMLimit
	}
	if apiKeyRecord != nil && apiKeyRecord.RPMLimit > 0 {
		limit = apiKeyRecord.RPMLimit
	}

	key := ""
	if apiKeyRecord != nil {
		key = apiKeyRecord.Key
	}
	if key == "" || limit <= 0 {
		return true, limit, 0
	}

	now := time.Now().UnixMilli()
	windowStart := now - 60000

	win, _ := rpmWindows.LoadOrStore(key, &rpmWindow{})
	w := win.(*rpmWindow)

	w.mu.Lock()
	defer w.mu.Unlock()

	cutoffIdx := -1
	for i, t := range w.timestamps {
		if t >= windowStart {
			cutoffIdx = i
			break
		}
	}
	if cutoffIdx > 0 {
		w.timestamps = w.timestamps[cutoffIdx:]
	} else if cutoffIdx == -1 {
		w.timestamps = nil
	}

	if len(w.timestamps) >= limit {
		return false, limit, len(w.timestamps)
	}

	w.timestamps = append(w.timestamps, now)
	return true, limit, len(w.timestamps)
}

func CheckMaintenanceMode(db *models.Database, w http.ResponseWriter) bool {
	if db.MaintenanceMode {
		endTime := db.MaintenanceEndTime
		msg := "站点维护中，请稍后重试。"
		if endTime != "" {
			t, err := time.Parse(time.RFC3339, endTime)
			if err == nil {
				loc, _ := time.LoadLocation("Asia/Shanghai")
				msg = "站点维护中，预计 " + t.In(loc).Format("2006-01-02 15:04:05") + " 恢复。"
			}
		}
		utils.SendError(w, 503, msg, "maintenance_mode")
		return true
	}
	return false
}
