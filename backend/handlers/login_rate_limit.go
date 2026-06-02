package handlers

import (
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"sapi/utils"
)

const (
	loginIPMaxFailures       = 30
	loginIdentityMaxFailures = 8
	loginIPWindow            = 10 * time.Minute
	loginIdentityWindow      = 15 * time.Minute
	loginBlockDuration       = 15 * time.Minute
	loginRecordTTL           = time.Hour
	loginCleanupEvery        = 100
)

var loginLimiter = newLoginRateLimiter()

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

	l.mu.Lock()
	defer l.mu.Unlock()

	delete(l.records, "id:"+normalized)
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
	client := clientIP(r)
	normalized := normalizeLoginIdentifier(identifier)

	return []loginLimitRule{
		{
			key:         "ip:" + client,
			maxFailures: loginIPMaxFailures,
			window:      loginIPWindow,
			blockFor:    loginBlockDuration,
		},
		{
			key:         "id:" + normalized,
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

func clientIP(r *http.Request) string {
	if r == nil {
		return "unknown"
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	if strings.TrimSpace(r.RemoteAddr) != "" {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return "unknown"
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
