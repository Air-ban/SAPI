package config

import (
	"bufio"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type Config struct {
	Port                       int
	AdminUser                  string
	AdminPassword              string
	PublicBaseURL              string
	PublicBaseURLs             []string
	DataFile                   string
	PostgresURL                string
	PostgresMaxConns           int
	RedisURL                   string
	RedisPoolSize              int
	RedisKeyPrefix             string
	RequestBodyLimitBytes      int64
	ProxyBodyLimitBytes        int64
	TrustProxyHeaders          bool
	TrustedProxyCIDRs          []string
	IPPureEnabled              bool
	IPPureEndpoint             string
	IPPureAPIKey               string
	IPPureMethod               string
	IPPureTimeoutMs            int
	TencentCaptchaAppID        string
	TencentCaptchaAppSecretKey string
	TencentSecretID            string
	TencentSecretKey           string
	TurnstileSiteKey           string
	TurnstileSecretKey         string
	TurnstileProxy             string
	AdminTurnstileDisabled     bool
	GitHubClientID             string
	GitHubClientSecret         string
	GitHubRedirectURL          string
	GitHubRedirectURLExplicit  bool
	GitHubOAuthApps            map[string]GitHubOAuthApp
	GitHubHostResolve          map[string]string
	GitHubProxyURL             string
	GitHubRequiredFollowTarget string
	SmtpHost                   string
	SmtpPort                   int
	SmtpSecure                 bool
	SmtpUser                   string
	SmtpPass                   string
	SmtpFrom                   string
}

type GitHubOAuthApp struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

var HopByHopHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailers":            true,
	"transfer-encoding":   true,
	"upgrade":             true,
	"content-encoding":    true,
	"content-length":      true,
}

func Load() *Config {
	loadDotenv()

	port, _ := strconv.Atoi(getEnv("SAPI_PORT", getEnv("PORT", "3000")))

	githubRedirectURL := strings.TrimSpace(getEnv("SAPI_GITHUB_REDIRECT_URL", ""))
	cfg := &Config{
		Port:                       port,
		AdminUser:                  getEnv("SAPI_ADMIN_USER", "admin"),
		AdminPassword:              getEnv("SAPI_ADMIN_PASSWORD", "sapi-admin"),
		PublicBaseURL:              getEnv("SAPI_PUBLIC_BASE_URL", "http://localhost:"+strconv.Itoa(port)),
		PublicBaseURLs:             splitCSV(getEnv("SAPI_PUBLIC_BASE_URLS", "")),
		DataFile:                   getEnv("SAPI_DATA_FILE", ""),
		PostgresURL:                getEnv("SAPI_POSTGRES_URL", getEnv("DATABASE_URL", "")),
		PostgresMaxConns:           intEnv("SAPI_POSTGRES_MAX_CONNS", 20),
		RedisURL:                   getEnv("SAPI_REDIS_URL", getEnv("REDIS_URL", "")),
		RedisPoolSize:              intEnv("SAPI_REDIS_POOL_SIZE", 64),
		RedisKeyPrefix:             getEnv("SAPI_REDIS_KEY_PREFIX", "sapi"),
		RequestBodyLimitBytes:      int64Env("SAPI_REQUEST_BODY_LIMIT_BYTES", 1<<20),
		ProxyBodyLimitBytes:        int64Env("SAPI_PROXY_BODY_LIMIT_BYTES", 32<<20),
		TrustProxyHeaders:          boolEnv("SAPI_TRUST_PROXY_HEADERS", false),
		TrustedProxyCIDRs:          splitCSV(getEnv("SAPI_TRUSTED_PROXY_CIDRS", "")),
		IPPureEnabled:              boolEnv("SAPI_IPPURE_ENABLED", true),
		IPPureEndpoint:             getEnv("SAPI_IPPURE_ENDPOINT", "https://api.ippure.com/api/info/ip-risk/{ip}"),
		IPPureAPIKey:               getEnv("SAPI_IPPURE_API_KEY", ""),
		IPPureMethod:               getEnv("SAPI_IPPURE_METHOD", "POST"),
		IPPureTimeoutMs:            intEnv("SAPI_IPPURE_TIMEOUT_MS", 1200),
		TencentCaptchaAppID:        getEnv("SAPI_TENCENT_CAPTCHA_APP_ID", ""),
		TencentCaptchaAppSecretKey: getEnv("SAPI_TENCENT_CAPTCHA_APP_SECRET_KEY", ""),
		TencentSecretID:            getEnv("SAPI_TENCENT_SECRET_ID", ""),
		TencentSecretKey:           getEnv("SAPI_TENCENT_SECRET_KEY", ""),
		TurnstileSiteKey:           getEnv("SAPI_TURNSTILE_SITE_KEY", ""),
		TurnstileSecretKey:         getEnv("SAPI_TURNSTILE_SECRET_KEY", ""),
		TurnstileProxy:             getEnv("SAPI_TURNSTILE_PROXY", ""),
		AdminTurnstileDisabled:     boolEnv("SAPI_ADMIN_TURNSTILE_DISABLED", false),
		GitHubClientID:             getEnv("SAPI_GITHUB_CLIENT_ID", ""),
		GitHubClientSecret:         getEnv("SAPI_GITHUB_CLIENT_SECRET", ""),
		GitHubRedirectURL:          githubRedirectURL,
		GitHubRedirectURLExplicit:  strings.TrimSpace(githubRedirectURL) != "",
		GitHubOAuthApps:            map[string]GitHubOAuthApp{},
		GitHubHostResolve:          parseGitHubHostResolve(getEnv("SAPI_GITHUB_HOST_RESOLVE", "")),
		GitHubProxyURL:             strings.TrimSpace(getEnv("SAPI_GITHUB_PROXY_URL", "")),
		GitHubRequiredFollowTarget: strings.TrimPrefix(strings.TrimSpace(getEnv("SAPI_GITHUB_REQUIRED_FOLLOW_TARGET", "")), "@"),
		SmtpHost:                   getEnv("SAPI_SMTP_HOST", ""),
		SmtpPort:                   intEnv("SAPI_SMTP_PORT", 587),
		SmtpSecure:                 getEnv("SAPI_SMTP_SECURE", "false") == "true",
		SmtpUser:                   getEnv("SAPI_SMTP_USER", ""),
		SmtpPass:                   getEnv("SAPI_SMTP_PASS", ""),
		SmtpFrom:                   getEnv("SAPI_SMTP_FROM", ""),
	}

	if cfg.PublicBaseURL == "" {
		cfg.PublicBaseURL = "http://localhost:" + strconv.Itoa(port)
	}
	cfg.PublicBaseURLs = appendPublicBaseURL(cfg.PublicBaseURLs, cfg.PublicBaseURL)
	if cfg.GitHubRedirectURL == "" && cfg.PublicBaseURL != "" {
		cfg.GitHubRedirectURL = strings.TrimRight(cfg.PublicBaseURL, "/") + "/api/auth/github/callback"
	}
	cfg.GitHubOAuthApps = loadGitHubOAuthApps(cfg.PublicBaseURLs)

	return cfg
}

func appendPublicBaseURL(items []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return items
	}
	for _, item := range items {
		if strings.EqualFold(strings.TrimRight(strings.TrimSpace(item), "/"), strings.TrimRight(value, "/")) {
			return items
		}
	}
	return append(items, value)
}

func loadGitHubOAuthApps(baseURLs []string) map[string]GitHubOAuthApp {
	apps := map[string]GitHubOAuthApp{}
	for _, base := range baseURLs {
		host := hostFromURL(base)
		if host == "" {
			continue
		}
		suffix := envSuffixForHost(host)
		clientID := strings.TrimSpace(getEnv("SAPI_GITHUB_CLIENT_ID_"+suffix, ""))
		clientSecret := strings.TrimSpace(getEnv("SAPI_GITHUB_CLIENT_SECRET_"+suffix, ""))
		if clientID == "" || clientSecret == "" {
			continue
		}
		redirectURL := strings.TrimSpace(getEnv("SAPI_GITHUB_REDIRECT_URL_"+suffix, strings.TrimRight(strings.TrimSpace(base), "/")+"/api/auth/github/callback"))
		apps[host] = GitHubOAuthApp{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
		}
	}
	return apps
}

func parseGitHubHostResolve(value string) map[string]string {
	items := splitCSV(value)
	if len(items) == 0 {
		return nil
	}
	result := map[string]string{}
	for _, item := range items {
		host, ipValue, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		host = hostFromURL(host)
		ip := net.ParseIP(strings.Trim(strings.TrimSpace(ipValue), "[]"))
		if host == "" || ip == nil {
			continue
		}
		result[host] = ip.String()
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func hostFromURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	withoutScheme := value
	if idx := strings.Index(withoutScheme, "://"); idx >= 0 {
		withoutScheme = withoutScheme[idx+3:]
	}
	if idx := strings.IndexAny(withoutScheme, "/?#"); idx >= 0 {
		withoutScheme = withoutScheme[:idx]
	}
	if idx := strings.LastIndex(withoutScheme, "@"); idx >= 0 {
		withoutScheme = withoutScheme[idx+1:]
	}
	if strings.HasPrefix(withoutScheme, "[") {
		if idx := strings.Index(withoutScheme, "]"); idx >= 0 {
			return strings.ToLower(withoutScheme[1:idx])
		}
	}
	if idx := strings.LastIndex(withoutScheme, ":"); idx >= 0 {
		withoutScheme = withoutScheme[:idx]
	}
	return strings.ToLower(strings.TrimSpace(withoutScheme))
}

func envSuffixForHost(host string) string {
	host = strings.ToUpper(strings.TrimSpace(host))
	var b strings.Builder
	for _, c := range host {
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
		} else {
			b.WriteByte('_')
		}
	}
	return strings.Trim(b.String(), "_")
}

func loadDotenv() {
	var paths []string

	// 1. 基于源文件位置（支持 go run）
	if _, file, _, ok := runtime.Caller(0); ok {
		paths = append(paths, filepath.Join(filepath.Dir(file), "..", "..", ".env"))
	}

	// 2. 基于可执行文件位置（支持编译后运行）
	if exePath, err := os.Executable(); err == nil {
		paths = append(paths, filepath.Join(filepath.Dir(exePath), "..", ".env"))
	}

	// 3. 当前工作目录
	if cwd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(cwd, ".env"))
	}

	for _, envPath := range paths {
		f, err := os.Open(envPath)
		if err != nil {
			continue
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			idx := strings.Index(line, "=")
			if idx <= 0 {
				continue
			}
			key := strings.TrimSpace(line[:idx])
			val := strings.TrimSpace(line[idx+1:])
			val = strings.Trim(val, `"`)
			val = strings.Trim(val, `'`)
			if os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
		return
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func intEnv(key string, fallback int) int {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return fallback
	}
	return n
}

func int64Env(key string, fallback int64) int64 {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	n, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}

func boolEnv(key string, fallback bool) bool {
	val := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if val == "" {
		return fallback
	}
	return val == "1" || val == "true" || val == "yes" || val == "on"
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			result = append(result, item)
		}
	}
	return result
}
