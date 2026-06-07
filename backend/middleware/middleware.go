package middleware

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
	"sapi/utils"
)

type contextKey string

const userContextKey contextKey = "user"
const tokenPayloadContextKey contextKey = "tokenPayload"

const (
	apiKeyFailureLimit  = 60
	apiKeyFailureWindow = 5 * time.Minute
	apiKeyBlockDuration = 10 * time.Minute
	rpmWindowDuration   = time.Minute

	apiKeyInvalidBodyLimit  = 20
	apiKeyInvalidBodyWindow = time.Hour
	apiKeyBanDuration       = time.Hour

	apiKeyBanReasonInvalidBody = "invalid_request_body"
	apiKeyBanReasonManual      = "manual"
)

func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, Cache-Control, Pragma, anthropic-version, anthropic-beta")
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

		cfg := config.Load()
		if payload == nil || payload.Role != "admin" || !auth.SafeEqual(payload.Sub, cfg.AdminUser) {
			utils.SendError(w, 401, "Admin authentication is required.", "unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), tokenPayloadContextKey, payload)
		next(w, r.WithContext(ctx))
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
				ctx = context.WithValue(ctx, tokenPayloadContextKey, payload)
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

func GetTokenPayload(r *http.Request) *auth.TokenPayload {
	payload, _ := r.Context().Value(tokenPayloadContextKey).(*auth.TokenPayload)
	return payload
}

type FindUserByKeyResult struct {
	DB           *models.Database
	User         *models.User
	APIKeyRecord *models.APIKeyRecord
	Banned       bool
	RetryAfter   time.Duration
	BanReason    string
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
				banned, retryAfter, reason := APIKeyBanStatus(k)
				return &FindUserByKeyResult{
					DB:           db,
					User:         u,
					APIKeyRecord: k,
					Banned:       banned,
					RetryAfter:   retryAfter,
					BanReason:    reason,
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
			banned, retryAfter, reason := APIKeyBanStatus(k)
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
				Banned:       banned,
				RetryAfter:   retryAfter,
				BanReason:    reason,
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

func APIKeyBanStatus(k *models.APIKeyRecord) (bool, time.Duration, string) {
	if k == nil || k.BannedUntil == "" {
		return false, 0, ""
	}
	bannedUntil, ok := parseAPIKeyTime(k.BannedUntil)
	if !ok {
		return false, 0, ""
	}
	now := time.Now().UTC()
	if !bannedUntil.After(now) {
		return false, 0, ""
	}
	return true, bannedUntil.Sub(now), k.BanReason
}

func SetAPIKeyBan(k *models.APIKeyRecord, banned bool, reason string, now time.Time) {
	if k == nil {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if banned {
		if reason == "" {
			reason = apiKeyBanReasonManual
		}
		k.BannedUntil = formatAPIKeyTime(now.Add(apiKeyBanDuration))
		k.BanReason = reason
		k.UpdatedAt = formatAPIKeyTime(now)
		return
	}
	k.BannedUntil = ""
	k.BanReason = ""
	k.InvalidRequestCount = 0
	k.LastInvalidRequestAt = ""
	k.UpdatedAt = formatAPIKeyTime(now)
}

func RecordInvalidRequestBody(apiKey string) (bool, time.Duration, int) {
	if apiKey == "" {
		return false, 0, 0
	}
	limitKey := "api-key-body:" + security.SensitiveKey(apiKey)
	count, retryAfter, err := security.RedisRecordFailureState(context.Background(), limitKey, apiKeyInvalidBodyLimit, apiKeyInvalidBodyWindow, apiKeyBanDuration)
	if err != nil {
		count, retryAfter = apiKeyBodyFailureLimiter.RecordFailureWindow(limitKey, apiKeyInvalidBodyLimit, apiKeyInvalidBodyWindow, apiKeyBanDuration)
	}

	now := time.Now().UTC()
	bannedUntil := ""
	if retryAfter > 0 {
		bannedUntil = formatAPIKeyTime(now.Add(retryAfter))
	}
	updateAPIKeyInvalidBodyState(apiKey, count, bannedUntil, now)
	return retryAfter > 0, retryAfter, count
}

func ClearInvalidRequestBodyFailures(apiKey string) {
	if apiKey == "" {
		return
	}
	limitKey := "api-key-body:" + security.SensitiveKey(apiKey)
	_ = security.RedisClearFailures(context.Background(), []string{limitKey})
	apiKeyBodyFailureLimiter.Clear(limitKey)
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
var apiKeyBodyFailureLimiter = &failureLimiter{records: map[string]*failureRecord{}}

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

func (l *failureLimiter) RecordFailureWindow(key string, maxFailures int, window, blockFor time.Duration) (int, time.Duration) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	record := l.records[key]
	if record == nil || now.Sub(record.firstFailure) > window {
		record = &failureRecord{firstFailure: now}
		l.records[key] = record
	}
	if record.blockedUntil.After(now) {
		return record.count, record.blockedUntil.Sub(now)
	}
	record.count++
	if record.count >= maxFailures {
		record.blockedUntil = now.Add(blockFor)
		return record.count, blockFor
	}
	return record.count, 0
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
	apiKeyBodyFailureLimiter.mu.Lock()
	defer apiKeyBodyFailureLimiter.mu.Unlock()
	apiKeyBodyFailureLimiter.records = map[string]*failureRecord{}
	rpmWindows = sync.Map{}
}

func updateAPIKeyInvalidBodyState(apiKey string, count int, bannedUntil string, now time.Time) {
	if apiKey == "" {
		return
	}
	store.MutateDB(func(db *models.Database) interface{} {
		updated := false
		for i := range db.Users {
			u := &db.Users[i]
			for j := range u.APIKeys {
				k := &u.APIKeys[j]
				if !auth.SafeEqual(k.Key, apiKey) {
					continue
				}
				applyInvalidBodyState(k, count, bannedUntil, now)
				u.UpdatedAt = formatAPIKeyTime(now)
				updated = true
				break
			}
			if updated {
				break
			}
		}
		if !updated {
			for i := range db.AdminAPIKeys {
				k := &db.AdminAPIKeys[i]
				if auth.SafeEqual(k.Key, apiKey) {
					applyInvalidBodyState(k, count, bannedUntil, now)
					updated = true
					break
				}
			}
		}
		return updated
	})
}

func applyInvalidBodyState(k *models.APIKeyRecord, count int, bannedUntil string, now time.Time) {
	if k == nil {
		return
	}
	k.InvalidRequestCount = count
	k.LastInvalidRequestAt = formatAPIKeyTime(now)
	if bannedUntil != "" {
		k.BannedUntil = bannedUntil
		k.BanReason = apiKeyBanReasonInvalidBody
	}
	k.UpdatedAt = formatAPIKeyTime(now)
}

func formatAPIKeyTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func parseAPIKeyTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
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
