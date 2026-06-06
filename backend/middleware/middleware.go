package middleware

import (
	"context"
	"net/http"
	"sync"
	"time"

	"sapi/auth"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
	"sapi/utils"
)

type contextKey string

const userContextKey contextKey = "user"

const (
	apiKeyFailureLimit  = 60
	apiKeyFailureWindow = 5 * time.Minute
	apiKeyBlockDuration = 10 * time.Minute
	rpmWindowDuration   = time.Minute
)

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
				DB:   db,
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
					Source:   "admin",
				},
				APIKeyRecord: k,
			}
		}
	}

	return &FindUserByKeyResult{DB: db, User: nil, APIKeyRecord: nil}
}

func CheckAPIKeyFailureLimit(r *http.Request) (bool, time.Duration) {
	key := "api-key-ip:" + security.SensitiveKey(security.ClientIP(r))
	blocked, retryAfter, err := security.RedisCheckBlocked(r.Context(), []string{key})
	if err == nil {
		return !blocked, retryAfter
	}
	return apiKeyFailureLimiter.Allow(key)
}

func RecordAPIKeyFailure(r *http.Request) {
	key := "api-key-ip:" + security.SensitiveKey(security.ClientIP(r))
	if err := security.RedisRecordFailure(r.Context(), key, apiKeyFailureLimit, apiKeyFailureWindow, apiKeyBlockDuration); err == nil {
		return
	}
	apiKeyFailureLimiter.RecordFailure(key)
}

func ClearAPIKeyFailures(r *http.Request) {
	key := "api-key-ip:" + security.SensitiveKey(security.ClientIP(r))
	_ = security.RedisClearFailures(r.Context(), []string{key})
	apiKeyFailureLimiter.Clear(key)
}

var rpmWindows sync.Map

type rpmWindow struct {
	mu         sync.Mutex
	timestamps []int64
}

func CheckRPMLimit(user *models.User, apiKeyRecord *models.APIKeyRecord, db *models.Database) (bool, int, int) {
	if user != nil && user.ID == "__admin__" {
		return true, 0, 0
	}

	limit := subscription.EffectiveAPIKeyRPMLimit(user, apiKeyRecord)

	key := ""
	if apiKeyRecord != nil {
		key = apiKeyRecord.Key
	}
	if key == "" || limit <= 0 {
		return true, limit, 0
	}

	if allowed, current, _, err := security.RedisSlidingWindowAllow(context.Background(), "rpm:"+security.SensitiveKey(key), limit, rpmWindowDuration); err == nil {
		return allowed, limit, current
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

func defaultRPMLimitForUser(user *models.User, db *models.Database) int {
	return subscription.RPMLimitForUser(user)
}

type failureLimiter struct {
	mu      sync.Mutex
	records map[string]*failureRecord
}

type failureRecord struct {
	count        int
	firstFailure time.Time
	blockedUntil time.Time
}

var apiKeyFailureLimiter = &failureLimiter{records: map[string]*failureRecord{}}

func (l *failureLimiter) Allow(key string) (bool, time.Duration) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	record := l.records[key]
	if record == nil {
		return true, 0
	}
	if record.blockedUntil.After(now) {
		return false, record.blockedUntil.Sub(now)
	}
	if now.Sub(record.firstFailure) > apiKeyFailureWindow {
		delete(l.records, key)
	}
	return true, 0
}

func (l *failureLimiter) RecordFailure(key string) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	record := l.records[key]
	if record == nil || now.Sub(record.firstFailure) > apiKeyFailureWindow {
		record = &failureRecord{firstFailure: now}
		l.records[key] = record
	}
	record.count++
	if record.count >= apiKeyFailureLimit {
		record.blockedUntil = now.Add(apiKeyBlockDuration)
	}
}

func (l *failureLimiter) Clear(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.records, key)
}

func ResetSecurityStateForTest() {
	apiKeyFailureLimiter.mu.Lock()
	defer apiKeyFailureLimiter.mu.Unlock()
	apiKeyFailureLimiter.records = map[string]*failureRecord{}
	rpmWindows = sync.Map{}
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
