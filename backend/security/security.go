package security

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"sapi/config"
)

const redisUnavailableLogEvery = time.Minute

var (
	cfgMu               sync.RWMutex
	runtimeConfig       = config.Config{RedisKeyPrefix: "sapi", RequestBodyLimitBytes: 1 << 20, ProxyBodyLimitBytes: 32 << 20}
	trustedProxyNets    []*net.IPNet
	redisClient         *redis.Client
	redisPrefix         = "sapi"
	lastRedisErrorLogAt time.Time
)

var slidingWindowScript = redis.NewScript(`
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
local count = redis.call("ZCARD", KEYS[1])
if count >= tonumber(ARGV[3]) then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local retry = tonumber(ARGV[2])
  if oldest[2] then
    retry = math.max(1, (tonumber(oldest[2]) + tonumber(ARGV[2])) - tonumber(ARGV[4]))
  end
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  return {0, count, retry}
end
redis.call("ZADD", KEYS[1], ARGV[4], ARGV[5])
redis.call("PEXPIRE", KEYS[1], ARGV[2])
return {1, count + 1, 0}
`)

func Init(ctx context.Context, cfg *config.Config) error {
	Configure(cfg)
	if cfg == nil || strings.TrimSpace(cfg.RedisURL) == "" {
		return nil
	}

	options, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("parse redis url: %w", err)
	}
	if cfg.RedisPoolSize > 0 {
		options.PoolSize = cfg.RedisPoolSize
	}

	client := redis.NewClient(options)
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return fmt.Errorf("connect redis: %w", err)
	}

	redisClient = client
	return nil
}

func Configure(cfg *config.Config) {
	if cfg == nil {
		return
	}

	cfgMu.Lock()
	defer cfgMu.Unlock()

	runtimeConfig = *cfg
	if runtimeConfig.RequestBodyLimitBytes <= 0 {
		runtimeConfig.RequestBodyLimitBytes = 1 << 20
	}
	if runtimeConfig.ProxyBodyLimitBytes <= 0 {
		runtimeConfig.ProxyBodyLimitBytes = 32 << 20
	}
	if strings.TrimSpace(runtimeConfig.RedisKeyPrefix) == "" {
		runtimeConfig.RedisKeyPrefix = "sapi"
	}
	redisPrefix = sanitizeRedisPart(runtimeConfig.RedisKeyPrefix)

	trustedProxyNets = trustedProxyNets[:0]
	for _, cidr := range runtimeConfig.TrustedProxyCIDRs {
		if _, network, err := net.ParseCIDR(cidr); err == nil {
			trustedProxyNets = append(trustedProxyNets, network)
		}
	}
}

func Close() {
	if redisClient != nil {
		_ = redisClient.Close()
	}
}

func RedisEnabled() bool {
	return redisClient != nil
}

func Health(ctx context.Context) map[string]interface{} {
	if redisClient == nil {
		return map[string]interface{}{"enabled": false, "status": "disabled"}
	}
	pingCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err := redisClient.Ping(pingCtx).Err(); err != nil {
		return map[string]interface{}{"enabled": true, "status": "degraded", "error": err.Error()}
	}
	return map[string]interface{}{"enabled": true, "status": "ok"}
}

func RequestGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w)

		if strings.ContainsAny(r.URL.Path, "\x00\r\n") {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if r.Body != nil && requestBodyMayExist(r.Method) {
			limit := requestBodyLimitForPath(r.URL.Path)
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}

		next.ServeHTTP(w, r)
	})
}

func ClientIP(r *http.Request) string {
	if r == nil {
		return "unknown"
	}

	remoteIP := remoteAddrIP(r.RemoteAddr)
	cfgMu.RLock()
	trustProxy := runtimeConfig.TrustProxyHeaders && isTrustedProxy(remoteIP)
	cfgMu.RUnlock()

	if trustProxy {
		for _, candidate := range []string{
			r.Header.Get("CF-Connecting-IP"),
			r.Header.Get("True-Client-IP"),
			r.Header.Get("X-Real-IP"),
			firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		} {
			if ip := normalizeIP(candidate); ip != "" {
				return ip
			}
		}
	}

	if ip := normalizeIP(remoteIP); ip != "" {
		return ip
	}
	if strings.TrimSpace(r.RemoteAddr) != "" {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return "unknown"
}

func SensitiveKey(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "empty"
	}
	sum := sha256.Sum256([]byte(trimmed))
	return hex.EncodeToString(sum[:])
}

func RedisSlidingWindowAllow(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Duration, error) {
	if redisClient == nil || limit <= 0 || key == "" {
		return true, 0, 0, errRedisDisabled()
	}

	now := time.Now()
	windowMs := int64(window / time.Millisecond)
	member := fmt.Sprintf("%d-%s", now.UnixNano(), randomSuffix())
	redisKey := prefixedKey("rate", key)

	values, err := slidingWindowScript.Run(ctx, redisClient, []string{redisKey},
		now.Add(-window).UnixMilli(), windowMs, limit, now.UnixMilli(), member,
	).Result()
	if err != nil {
		logRedisError(err)
		return true, 0, 0, err
	}

	result, ok := values.([]interface{})
	if !ok || len(result) < 3 {
		return true, 0, 0, errors.New("unexpected redis rate limiter response")
	}

	allowed := toInt64(result[0]) == 1
	current := int(toInt64(result[1]))
	retryAfter := time.Duration(toInt64(result[2])) * time.Millisecond
	if retryAfter < 0 {
		retryAfter = 0
	}
	return allowed, current, retryAfter, nil
}

func RedisCheckBlocked(ctx context.Context, keys []string) (bool, time.Duration, error) {
	if redisClient == nil {
		return false, 0, errRedisDisabled()
	}

	var longest time.Duration
	for _, key := range keys {
		if key == "" {
			continue
		}
		ttl, err := redisClient.TTL(ctx, prefixedKey("block", key)).Result()
		if err != nil {
			logRedisError(err)
			return false, 0, err
		}
		if ttl > longest {
			longest = ttl
		}
	}
	return longest > 0, longest, nil
}

func RedisRecordFailure(ctx context.Context, key string, maxFailures int, window, blockFor time.Duration) error {
	if redisClient == nil || key == "" || maxFailures <= 0 {
		return errRedisDisabled()
	}

	failKey := prefixedKey("fail", key)
	count, err := redisClient.Incr(ctx, failKey).Result()
	if err != nil {
		logRedisError(err)
		return err
	}
	if count == 1 {
		_ = redisClient.Expire(ctx, failKey, window).Err()
	}
	if count >= int64(maxFailures) {
		blockKey := prefixedKey("block", key)
		if err := redisClient.Set(ctx, blockKey, "1", blockFor).Err(); err != nil {
			logRedisError(err)
			return err
		}
		_ = redisClient.Expire(ctx, failKey, window).Err()
	}
	return nil
}

func RedisClearFailures(ctx context.Context, keys []string) error {
	if redisClient == nil {
		return errRedisDisabled()
	}
	allKeys := make([]string, 0, len(keys)*2)
	for _, key := range keys {
		if key == "" {
			continue
		}
		allKeys = append(allKeys, prefixedKey("fail", key), prefixedKey("block", key))
	}
	if len(allKeys) == 0 {
		return nil
	}
	if err := redisClient.Del(ctx, allKeys...).Err(); err != nil {
		logRedisError(err)
		return err
	}
	return nil
}

func ValidHTTPBaseURL(value string) bool {
	item := strings.TrimSpace(value)
	if item == "" || strings.ContainsAny(item, "\x00\r\n") {
		return false
	}
	if len(item) > 2048 {
		return false
	}
	parsed, err := http.NewRequest(http.MethodGet, item, nil)
	if err != nil || parsed.URL == nil {
		return false
	}
	if parsed.URL.Scheme != "https" && parsed.URL.Scheme != "http" {
		return false
	}
	if parsed.URL.Host == "" || parsed.URL.User != nil {
		return false
	}
	return true
}

func SafeText(value string, maxLen int) string {
	value = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\x00", ""), "\r", "\n"))
	if maxLen > 0 && len(value) > maxLen {
		return value[:maxLen]
	}
	return value
}

func SafeSingleLine(value string, maxLen int) string {
	value = strings.TrimSpace(strings.NewReplacer("\x00", "", "\r", " ", "\n", " ").Replace(value))
	if maxLen > 0 && len(value) > maxLen {
		return value[:maxLen]
	}
	return value
}

func requestBodyMayExist(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch
}

func requestBodyLimitForPath(path string) int64 {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	if path == "/chat/completions" || path == "/responses" || path == "/messages" ||
		strings.HasPrefix(path, "/v1/") {
		return runtimeConfig.ProxyBodyLimitBytes
	}
	return runtimeConfig.RequestBodyLimitBytes
}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("X-Frame-Options", "DENY")
}

func remoteAddrIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(remoteAddr)
}

func firstForwardedFor(value string) string {
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[0])
}

func normalizeIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, "\x00\r\n") {
		return ""
	}
	ip := net.ParseIP(value)
	if ip == nil {
		return ""
	}
	return ip.String()
}

func isTrustedProxy(remoteIP string) bool {
	if len(trustedProxyNets) == 0 {
		return false
	}
	ip := net.ParseIP(remoteIP)
	if ip == nil {
		return false
	}
	for _, network := range trustedProxyNets {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func prefixedKey(parts ...string) string {
	clean := make([]string, 0, len(parts)+1)
	clean = append(clean, redisPrefix)
	for _, part := range parts {
		clean = append(clean, sanitizeRedisPart(part))
	}
	return strings.Join(clean, ":")
}

func sanitizeRedisPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "default"
	}
	replacer := strings.NewReplacer(" ", "_", "\n", "_", "\r", "_", "\t", "_", ":", "_")
	return replacer.Replace(value)
}

func randomSuffix() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000_000))
	if err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return n.String()
}

func toInt64(value interface{}) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case string:
		var n int64
		_, _ = fmt.Sscanf(v, "%d", &n)
		return n
	default:
		return 0
	}
}

func errRedisDisabled() error {
	return errors.New("redis is disabled")
}

func logRedisError(err error) {
	now := time.Now()
	if now.Sub(lastRedisErrorLogAt) < redisUnavailableLogEvery {
		return
	}
	lastRedisErrorLogAt = now
	log.Printf("[SECURITY] redis limiter unavailable, falling back locally: %v", err)
}
