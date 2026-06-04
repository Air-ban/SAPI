package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"sapi/security"
	"sapi/utils"
)

const (
	loginIPMaxFailures       = 30
	loginIdentityMaxFailures = 8
	verificationIPLimit      = 20
	loginIPWindow            = 10 * time.Minute
	loginIdentityWindow      = 15 * time.Minute
	loginBlockDuration       = 15 * time.Minute
	loginRecordTTL           = time.Hour
	loginCleanupEvery        = 100
)

var loginLimiter = newLoginRateLimiter()
var verificationIPLimiter = newSimpleWindowLimiter(verificationIPLimit, time.Minute)

type loginRateLimiter struct {
	mu         sync.Mutex
	records    map[string]*loginRateRecord
	operations int
}

type loginRateRecord struct {
	failures     []time.Time
	blockedUntil time.Time
	lastSeen     time.Time
}

type loginLimitRule struct {
	key         string
	maxFailures int
	window      time.Duration
	blockFor    time.Duration
}

func newLoginRateLimiter() *loginRateLimiter {
	return &loginRateLimiter{records: map[string]*loginRateRecord{}}
}

func checkLoginRateLimit(w http.ResponseWriter, r *http.Request, identifier string) bool {
	allowed, retryAfter := loginLimiter.Allow(r, identifier)
	if allowed {
		return true
	}

	if retryAfter < time.Second {
		retryAfter = time.Second
	}
	w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))

	minutes := int((retryAfter + time.Minute - time.Nanosecond) / time.Minute)
	utils.SendError(w, 429, fmt.Sprintf("Too many login attempts. Try again in %d minute(s).", minutes), "login_rate_limited")
	return false
}

func recordLoginFailure(r *http.Request, identifier string) {
	loginLimiter.RecordFailure(r, identifier)
}

func clearLoginFailures(identifier string) {
	loginLimiter.ClearIdentity(identifier)
}

func (l *loginRateLimiter) Allow(r *http.Request, identifier string) (bool, time.Duration) {
	now := time.Now()
	rules := buildLoginLimitRules(r, identifier)

	redisKeys := make([]string, 0, len(rules))
	for _, rule := range rules {
		redisKeys = append(redisKeys, rule.key)
	}
	if blocked, retryAfter, err := security.RedisCheckBlocked(r.Context(), redisKeys); err == nil {
		return !blocked, retryAfter
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.maybeCleanup(now)

	var longestRetry time.Duration
	for _, rule := range rules {
		record := l.records[rule.key]
		if record == nil {
			continue
		}
		if record.blockedUntil.After(now) {
			retryAfter := record.blockedUntil.Sub(now)
			if retryAfter > longestRetry {
				longestRetry = retryAfter
			}
		}
	}

	if longestRetry > 0 {
		return false, longestRetry
	}
	return true, 0
}

func (l *loginRateLimiter) RecordFailure(r *http.Request, identifier string) {
	now := time.Now()
	rules := buildLoginLimitRules(r, identifier)

	redisOK := true
	for _, rule := range rules {
		if err := security.RedisRecordFailure(r.Context(), rule.key, rule.maxFailures, rule.window, rule.blockFor); err != nil {
			redisOK = false
			break
		}
	}
	if redisOK {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.maybeCleanup(now)

	for _, rule := range rules {
		record := l.records[rule.key]
		if record == nil {
			record = &loginRateRecord{}
			l.records[rule.key] = record
		}

		record.lastSeen = now
		record.failures = pruneLoginFailures(record.failures, now.Add(-rule.window))
		record.failures = append(record.failures, now)

		if len(record.failures) >= rule.maxFailures {
			blockedUntil := now.Add(rule.blockFor)
			if blockedUntil.After(record.blockedUntil) {
				record.blockedUntil = blockedUntil
			}
		}
	}
}

func (l *loginRateLimiter) ClearIdentity(identifier string) {
	normalized := normalizeLoginIdentifier(identifier)
	_ = security.RedisClearFailures(context.Background(), []string{"id:" + security.SensitiveKey(normalized)})

	l.mu.Lock()
	defer l.mu.Unlock()

	delete(l.records, "id:"+security.SensitiveKey(normalized))
}

func checkVerificationRequestLimit(w http.ResponseWriter, r *http.Request) bool {
	key := "verification-ip:" + security.SensitiveKey(security.ClientIP(r))
	if allowed, _, retryAfter, err := security.RedisSlidingWindowAllow(r.Context(), key, verificationIPLimit, time.Minute); err == nil {
		if allowed {
			return true
		}
		writeRetryAfter(w, retryAfter, "Please wait before requesting another code.", "rate_limited")
		return false
	}

	allowed, retryAfter := verificationIPLimiter.Allow(key)
	if allowed {
		return true
	}
	writeRetryAfter(w, retryAfter, "Please wait before requesting another code.", "rate_limited")
	return false
}

func writeRetryAfter(w http.ResponseWriter, retryAfter time.Duration, message, code string) {
	if retryAfter < time.Second {
		retryAfter = time.Second
	}
	w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))
	utils.SendError(w, 429, message, code)
}

func (l *loginRateLimiter) maybeCleanup(now time.Time) {
	l.operations++
	if l.operations%loginCleanupEvery != 0 {
		return
	}

	for key, record := range l.records {
		if record == nil || (record.blockedUntil.Before(now) && now.Sub(record.lastSeen) > loginRecordTTL) {
			delete(l.records, key)
		}
	}
}

func buildLoginLimitRules(r *http.Request, identifier string) []loginLimitRule {
	client := security.ClientIP(r)
	normalized := normalizeLoginIdentifier(identifier)

	return []loginLimitRule{
		{
			key:         "ip:" + security.SensitiveKey(client),
			maxFailures: loginIPMaxFailures,
			window:      loginIPWindow,
			blockFor:    loginBlockDuration,
		},
		{
			key:         "id:" + security.SensitiveKey(normalized),
			maxFailures: loginIdentityMaxFailures,
			window:      loginIdentityWindow,
			blockFor:    loginBlockDuration,
		},
	}
}

func normalizeLoginIdentifier(identifier string) string {
	normalized := strings.ToLower(strings.TrimSpace(identifier))
	if normalized == "" {
		return "(empty)"
	}
	return normalized
}

func pruneLoginFailures(failures []time.Time, cutoff time.Time) []time.Time {
	firstValid := 0
	for firstValid < len(failures) && failures[firstValid].Before(cutoff) {
		firstValid++
	}
	if firstValid == 0 {
		return failures
	}
	return failures[firstValid:]
}

type simpleWindowLimiter struct {
	mu         sync.Mutex
	limit      int
	window     time.Duration
	timestamps map[string][]time.Time
}

func newSimpleWindowLimiter(limit int, window time.Duration) *simpleWindowLimiter {
	return &simpleWindowLimiter{
		limit:      limit,
		window:     window,
		timestamps: map[string][]time.Time{},
	}
}

func (l *simpleWindowLimiter) Allow(key string) (bool, time.Duration) {
	now := time.Now()
	cutoff := now.Add(-l.window)

	l.mu.Lock()
	defer l.mu.Unlock()

	items := pruneLoginFailures(l.timestamps[key], cutoff)
	if len(items) >= l.limit {
		retryAfter := l.window - now.Sub(items[0])
		l.timestamps[key] = items
		return false, retryAfter
	}
	items = append(items, now)
	l.timestamps[key] = items
	return true, 0
}
