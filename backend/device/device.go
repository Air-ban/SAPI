package device

import (
	"net/http"
	"regexp"
	"strings"

	"sapi/models"
	"sapi/security"
)

var botUserAgentPattern = regexp.MustCompile(`(?i)\b(bot|crawler|spider|slurp|curl|wget|python-requests|httpclient|go-http-client|okhttp|postman|insomnia|headless|phantomjs|selenium)\b`)

func FromRequest(r *http.Request) *models.RequestClientDevice {
	if r == nil {
		return nil
	}

	ua := safeHeader(r.Header.Get("User-Agent"), 600)
	headers := deviceHeaders(r.Header)
	info := &models.RequestClientDevice{
		UserAgent:    ua,
		Platform:     firstNonEmpty(headerValue(r, "Sec-CH-UA-Platform"), headerValue(r, "X-Client-Platform")),
		Architecture: headerValue(r, "Sec-CH-UA-Arch"),
		Bitness:      headerValue(r, "Sec-CH-UA-Bitness"),
		DeviceModel:  headerValue(r, "Sec-CH-UA-Model"),
		Languages:    parseLanguages(r.Header.Get("Accept-Language")),
		Origin:       safeHeader(r.Header.Get("Origin"), 260),
		Referrer:     safeHeader(r.Header.Get("Referer"), 260),
		Headers:      headers,
	}

	if mobile := strings.ToLower(headerValue(r, "Sec-CH-UA-Mobile")); mobile == "true" || mobile == "?1" || mobile == "1" {
		info.Mobile = true
	}
	fillFromUserAgent(info, ua)
	if info.DeviceType == "" {
		if info.Mobile {
			info.DeviceType = "mobile"
		} else if ua != "" {
			info.DeviceType = "desktop"
		}
	}
	if info.Platform == "" {
		info.Platform = info.OSName
	}
	if info.BrowserName == "" && ua == "" && len(headers) == 0 {
		return nil
	}
	return info
}

func fillFromUserAgent(info *models.RequestClientDevice, ua string) {
	lower := strings.ToLower(ua)
	if ua == "" {
		return
	}
	info.Bot = botUserAgentPattern.MatchString(ua)

	switch {
	case strings.Contains(lower, "edg/"):
		info.BrowserName = "Microsoft Edge"
		info.BrowserVersion = versionAfter(ua, "Edg/")
	case strings.Contains(lower, "opr/"):
		info.BrowserName = "Opera"
		info.BrowserVersion = versionAfter(ua, "OPR/")
	case strings.Contains(lower, "chrome/") || strings.Contains(lower, "crios/"):
		info.BrowserName = "Chrome"
		info.BrowserVersion = firstNonEmpty(versionAfter(ua, "Chrome/"), versionAfter(ua, "CriOS/"))
	case strings.Contains(lower, "firefox/") || strings.Contains(lower, "fxios/"):
		info.BrowserName = "Firefox"
		info.BrowserVersion = firstNonEmpty(versionAfter(ua, "Firefox/"), versionAfter(ua, "FxiOS/"))
	case strings.Contains(lower, "safari/") && strings.Contains(lower, "version/"):
		info.BrowserName = "Safari"
		info.BrowserVersion = versionAfter(ua, "Version/")
	case strings.Contains(lower, "go-http-client"):
		info.BrowserName = "Go HTTP Client"
	case strings.Contains(lower, "curl/"):
		info.BrowserName = "curl"
		info.BrowserVersion = versionAfter(ua, "curl/")
	case strings.Contains(lower, "python-requests/"):
		info.BrowserName = "python-requests"
		info.BrowserVersion = versionAfter(ua, "python-requests/")
	}

	switch {
	case strings.Contains(lower, "windows nt"):
		info.OSName = "Windows"
		info.OSVersion = versionAfter(ua, "Windows NT ")
	case strings.Contains(lower, "iphone"):
		info.OSName = "iOS"
		info.OSVersion = strings.ReplaceAll(versionAfter(ua, "iPhone OS "), "_", ".")
		info.DeviceType = "mobile"
		info.Mobile = true
	case strings.Contains(lower, "ipad"):
		info.OSName = "iPadOS"
		info.OSVersion = strings.ReplaceAll(versionAfter(ua, "CPU OS "), "_", ".")
		info.DeviceType = "tablet"
		info.Mobile = true
	case strings.Contains(lower, "android"):
		info.OSName = "Android"
		info.OSVersion = versionAfter(ua, "Android ")
		info.Mobile = true
		if strings.Contains(lower, "mobile") {
			info.DeviceType = "mobile"
		} else {
			info.DeviceType = "tablet"
		}
	case strings.Contains(lower, "mac os x"):
		info.OSName = "macOS"
		info.OSVersion = strings.ReplaceAll(versionAfter(ua, "Mac OS X "), "_", ".")
	case strings.Contains(lower, "linux"):
		info.OSName = "Linux"
	}

	if info.DeviceType == "" {
		switch {
		case strings.Contains(lower, "mobile"):
			info.DeviceType = "mobile"
			info.Mobile = true
		case strings.Contains(lower, "tablet"):
			info.DeviceType = "tablet"
		}
	}
}

func deviceHeaders(header http.Header) map[string]string {
	allowed := []string{
		"Accept-Language",
		"User-Agent",
		"Sec-CH-UA",
		"Sec-CH-UA-Mobile",
		"Sec-CH-UA-Platform",
		"Sec-CH-UA-Platform-Version",
		"Sec-CH-UA-Arch",
		"Sec-CH-UA-Bitness",
		"Sec-CH-UA-Model",
		"Origin",
		"Referer",
		"X-Requested-With",
		"X-Client-Platform",
		"X-Client-Version",
	}
	result := map[string]string{}
	for _, name := range allowed {
		if value := safeHeader(header.Get(name), 600); value != "" {
			result[name] = value
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func parseLanguages(value string) []string {
	value = safeHeader(value, 300)
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, min(len(parts), 6))
	for _, part := range parts {
		lang := strings.TrimSpace(strings.Split(part, ";")[0])
		if lang == "" {
			continue
		}
		result = append(result, security.SafeSingleLine(lang, 32))
		if len(result) >= 6 {
			break
		}
	}
	return result
}

func headerValue(r *http.Request, name string) string {
	if r == nil {
		return ""
	}
	return strings.Trim(safeHeader(r.Header.Get(name), 120), `"`)
}

func safeHeader(value string, maxLen int) string {
	return security.SafeSingleLine(value, maxLen)
}

func versionAfter(value, marker string) string {
	idx := strings.Index(value, marker)
	if idx < 0 {
		return ""
	}
	rest := value[idx+len(marker):]
	end := len(rest)
	for i, ch := range rest {
		if ch == ' ' || ch == ';' || ch == ')' {
			end = i
			break
		}
	}
	return security.SafeSingleLine(rest[:end], 40)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
