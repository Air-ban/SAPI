package ippure

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"sapi/config"
	"sapi/models"
	"sapi/security"
)

const (
	providerName = "ippure"
	cacheTTL     = 6 * time.Hour
)

var (
	cacheMu sync.Mutex
	cache   = map[string]cacheEntry{}
)

var reservedCIDRs = mustParseCIDRs([]string{
	"0.0.0.0/8",
	"100.64.0.0/10",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
	"2001:db8::/32",
	"2002::/16",
	"fc00::/7",
})

type cacheEntry struct {
	info      *models.RequestClientIPInfo
	expiresAt time.Time
}

func LookupRequest(r *http.Request) *models.RequestClientIPInfo {
	if r == nil {
		return nil
	}
	info := LookupIP(r.Context(), security.ClientIP(r))
	if info == nil {
		return nil
	}
	if security.TrustsProxyHeaders(r) {
		if loc := trustedProxyLocation(r); locationHasData(loc) {
			info.Locations = appendLocation(info.Locations, loc)
			info.ProxyGeoSource = loc.Provider
		}
	}
	return info
}

func LookupIP(ctx context.Context, ipValue string) *models.RequestClientIPInfo {
	if ctx == nil {
		ctx = context.Background()
	}
	ip := net.ParseIP(strings.TrimSpace(ipValue))
	if ip == nil {
		return nil
	}

	info := baseInfo(ip)
	if info.NetworkScope != "public" {
		info.LookupStatus = "skipped_" + info.NetworkScope
		return info
	}

	cfg := config.Load()
	if cfg == nil || !cfg.IPPureEnabled || strings.TrimSpace(cfg.IPPureEndpoint) == "" {
		info.LookupStatus = "disabled"
		return info
	}

	if cached := cachedInfo(info.IP); cached != nil {
		return mergeInfo(info, cached)
	}

	remote, err := fetchRemoteInfo(ctx, cfg, info.IP)
	if err != nil {
		info.LookupStatus = "error"
		info.LookupError = sanitizeText(err.Error(), 180)
		rememberInfo(info.IP, info)
		return info
	}
	remote.LookupStatus = "ok"
	remote.Provider = providerName
	rememberInfo(info.IP, remote)
	return mergeInfo(info, remote)
}

func ResetForTest() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	cache = map[string]cacheEntry{}
}

func baseInfo(ip net.IP) *models.RequestClientIPInfo {
	ipText := ip.String()
	scope := networkScope(ip)
	version := "ipv6"
	if ip.To4() != nil {
		version = "ipv4"
	}
	networkHash := ""
	if scope == "public" {
		if network := coarseNetwork(ip); network != "" {
			networkHash = security.SensitiveKey(network)[:16]
		}
	}
	return &models.RequestClientIPInfo{
		IP:           ipText,
		LookupIP:     ipText,
		IPVersion:    version,
		IPHash:       security.SensitiveKey(ipText),
		Provider:     providerName,
		LookupStatus: "local",
		FetchedAt:    nowISO(),
		NetworkHash:  networkHash,
		NetworkScope: scope,
	}
}

func fetchRemoteInfo(ctx context.Context, cfg *config.Config, ip string) (*models.RequestClientIPInfo, error) {
	timeout := time.Duration(cfg.IPPureTimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 1200 * time.Millisecond
	}
	lookupCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	method := strings.ToUpper(strings.TrimSpace(cfg.IPPureMethod))
	if method == "" {
		method = http.MethodPost
	}
	endpoint, err := endpointForIP(cfg.IPPureEndpoint, ip)
	if err != nil {
		return nil, err
	}

	var body io.Reader
	if method != http.MethodGet && method != http.MethodHead {
		raw, _ := json.Marshal(map[string]string{"ip": ip})
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(lookupCtx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "SAPI IPPure client")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key := strings.TrimSpace(cfg.IPPureAPIKey); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("X-API-Key", key)
		req.Header.Set("X-IPPure-API-Key", key)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ippure returned HTTP %d", resp.StatusCode)
	}
	var payload interface{}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("ippure returned non-json response")
	}
	return normalizePayload(ip, payload), nil
}

func endpointForIP(endpoint, ip string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return "", fmt.Errorf("ippure endpoint is empty")
	}
	if strings.Contains(endpoint, "{ip}") {
		return strings.ReplaceAll(endpoint, "{ip}", url.PathEscape(ip)), nil
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	q := parsed.Query()
	if q.Get("ip") == "" {
		q.Set("ip", ip)
	}
	parsed.RawQuery = q.Encode()
	return parsed.String(), nil
}

func normalizePayload(ip string, payload interface{}) *models.RequestClientIPInfo {
	root := unwrapPayload(payload)
	info := &models.RequestClientIPInfo{
		LookupIP:  firstString(root, "ip", "query", "lookupIp", "lookup_ip", "ipAddress", "ip_address"),
		Provider:  providerName,
		FetchedAt: nowISO(),
	}
	if info.LookupIP == "" {
		info.LookupIP = ip
	}

	info.ASN = firstString(root, "asn", "asNumber", "as_number", "asNum", "autonomousSystemNumber")
	info.ASDomain = firstString(root, "asDomain", "as_domain", "asndomain", "organizationDomain", "orgDomain")
	info.ASName = firstString(root, "asName", "as_name", "asOrganization", "organization", "org", "isp", "asnName")
	info.IPRange = firstString(root, "ipRange", "ip_range", "range", "netRange", "networkRange", "route", "cidr", "prefix")
	info.HumanBotRatio = humanBotRatio(root)
	info.IPSource = firstString(root, "ipSource", "ip_source", "source", "ipType", "ip_type", "usageType", "usage_type", "native")
	info.IPPureLevel = firstString(root, "ipPureLevel", "ippureLevel", "pureLevel", "riskLevel", "level")
	if score, ok := firstFloat(root, "ipPureScore", "ippureScore", "pureScore", "coefficient", "riskScore", "fraudScore", "score"); ok {
		info.IPPureScore = &score
	}
	info.IPAttributes = collectAttributes(root)
	info.Locations = extractLocations(root)
	return info
}

func unwrapPayload(payload interface{}) interface{} {
	current := payload
	for i := 0; i < 4; i++ {
		m, ok := current.(map[string]interface{})
		if !ok {
			return current
		}
		for _, key := range []string{"data", "result", "detail", "ipinfo", "ipInfo", "basicInfo"} {
			if value, exists := m[key]; exists && value != nil {
				if _, nested := value.(map[string]interface{}); nested {
					current = value
					goto next
				}
			}
		}
		return current
	next:
	}
	return current
}

func mergeInfo(base, remote *models.RequestClientIPInfo) *models.RequestClientIPInfo {
	if base == nil {
		return remote
	}
	if remote == nil {
		return base
	}
	if remote.LookupIP != "" {
		base.LookupIP = remote.LookupIP
	}
	base.ASN = choose(base.ASN, remote.ASN)
	base.ASDomain = choose(base.ASDomain, remote.ASDomain)
	base.ASName = choose(base.ASName, remote.ASName)
	base.IPRange = choose(base.IPRange, remote.IPRange)
	base.HumanBotRatio = choose(base.HumanBotRatio, remote.HumanBotRatio)
	base.IPSource = choose(base.IPSource, remote.IPSource)
	base.IPPureLevel = choose(base.IPPureLevel, remote.IPPureLevel)
	base.LookupStatus = choose(base.LookupStatus, remote.LookupStatus)
	base.LookupError = choose(base.LookupError, remote.LookupError)
	base.Provider = choose(base.Provider, remote.Provider)
	base.FetchedAt = choose(base.FetchedAt, remote.FetchedAt)
	if remote.IPPureScore != nil {
		base.IPPureScore = remote.IPPureScore
	}
	base.IPAttributes = uniqueStrings(append(base.IPAttributes, remote.IPAttributes...))
	for _, loc := range remote.Locations {
		base.Locations = appendLocation(base.Locations, loc)
	}
	return base
}

func cachedInfo(ip string) *models.RequestClientIPInfo {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	entry, ok := cache[ip]
	if !ok || time.Now().After(entry.expiresAt) {
		if ok {
			delete(cache, ip)
		}
		return nil
	}
	cloned := cloneInfo(entry.info)
	if cloned != nil {
		switch cloned.LookupStatus {
		case "ok":
			cloned.LookupStatus = "cached"
		case "":
			cloned.LookupStatus = "cached"
		default:
			cloned.LookupStatus = "cached_" + cloned.LookupStatus
		}
	}
	return cloned
}

func rememberInfo(ip string, info *models.RequestClientIPInfo) {
	if ip == "" || info == nil {
		return
	}
	cacheMu.Lock()
	defer cacheMu.Unlock()
	cache[ip] = cacheEntry{info: cloneInfo(info), expiresAt: time.Now().Add(cacheTTL)}
}

func cloneInfo(info *models.RequestClientIPInfo) *models.RequestClientIPInfo {
	if info == nil {
		return nil
	}
	raw, err := json.Marshal(info)
	if err != nil {
		cloned := *info
		return &cloned
	}
	var cloned models.RequestClientIPInfo
	if err := json.Unmarshal(raw, &cloned); err != nil {
		copied := *info
		return &copied
	}
	return &cloned
}

func firstString(root interface{}, keys ...string) string {
	keySet := canonicalSet(keys...)
	if value, ok := firstMatchingValue(root, keySet, 0); ok {
		return sanitizeText(stringFromValue(value), 200)
	}
	return ""
}

func firstFloat(root interface{}, keys ...string) (float64, bool) {
	keySet := canonicalSet(keys...)
	value, ok := firstMatchingValue(root, keySet, 0)
	if !ok {
		return 0, false
	}
	return floatFromValue(value)
}

func firstMatchingValue(value interface{}, keySet map[string]bool, depth int) (interface{}, bool) {
	if depth > 8 || value == nil {
		return nil, false
	}
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, item := range typed {
			if keySet[canonicalKey(key)] {
				return item, true
			}
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if item, ok := firstMatchingValue(typed[key], keySet, depth+1); ok {
				return item, true
			}
		}
	case []interface{}:
		for _, item := range typed {
			if found, ok := firstMatchingValue(item, keySet, depth+1); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func humanBotRatio(root interface{}) string {
	if value := firstString(root, "humanBotRatio", "human_bot_ratio", "botHumanRatio", "bot_human_ratio"); value != "" {
		return value
	}
	if value, ok := firstMatchingValue(root, canonicalSet("botClass", "bot_class", "humanTraffic", "human_traffic"), 0); ok {
		switch typed := unwrapPayload(value).(type) {
		case map[string]interface{}:
			human := firstString(typed, "human", "humanRatio", "human_ratio", "normal", "native")
			bot := firstString(typed, "bot", "botRatio", "bot_ratio", "robot", "crawler")
			if human != "" || bot != "" {
				return strings.TrimSpace(fmt.Sprintf("human:%s bot:%s", human, bot))
			}
		default:
			return sanitizeText(stringFromValue(value), 200)
		}
	}
	return ""
}

func collectAttributes(root interface{}) []string {
	result := []string{}
	for _, key := range []string{"attributes", "attribute", "tags", "tag", "properties", "ipAttributes", "ip_attributes"} {
		if value, ok := firstMatchingValue(root, canonicalSet(key), 0); ok {
			result = append(result, stringsFromValue(value)...)
		}
	}
	boolLabels := map[string]string{
		"proxy":       "proxy",
		"vpn":         "vpn",
		"tor":         "tor",
		"relay":       "relay",
		"hosting":     "hosting",
		"datacenter":  "datacenter",
		"dataCenter":  "datacenter",
		"residential": "residential",
		"native":      "native",
		"crawler":     "crawler",
		"bot":         "bot",
		"fraud":       "fraud",
		"abuser":      "abuser",
	}
	for key, label := range boolLabels {
		if value, ok := firstMatchingValue(root, canonicalSet(key), 0); ok && boolFromValue(value) {
			result = append(result, label)
		}
	}
	return uniqueStrings(result)
}

func stringsFromValue(value interface{}) []string {
	switch typed := value.(type) {
	case []interface{}:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := sanitizeText(stringFromValue(item), 100); text != "" {
				result = append(result, text)
			}
		}
		return result
	case []string:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := sanitizeText(item, 100); text != "" {
				result = append(result, text)
			}
		}
		return result
	case map[string]interface{}:
		result := []string{}
		for key, item := range typed {
			if boolFromValue(item) {
				result = append(result, sanitizeText(key, 100))
			}
		}
		return result
	default:
		text := sanitizeText(stringFromValue(value), 100)
		if text == "" {
			return nil
		}
		return []string{text}
	}
}

func extractLocations(root interface{}) []models.RequestIPLocation {
	providers := map[string]string{
		"ip2location": "IP2Location",
		"dbip":        "DB-IP",
		"maxmind":     "MaxMind",
		"ipinfo":      "IPInfo.io",
		"ipinfoio":    "IPInfo.io",
		"ipip":        "IPIP",
		"bilibili":    "Bilibili",
	}
	result := []models.RequestIPLocation{}
	walkProviderLocations(root, providers, &result, 0)
	if len(result) == 0 {
		if loc := locationFromValue("IPPure", root); locationHasData(loc) {
			result = append(result, loc)
		}
	}
	return result
}

func walkProviderLocations(value interface{}, providers map[string]string, result *[]models.RequestIPLocation, depth int) {
	if depth > 8 || value == nil {
		return
	}
	switch typed := value.(type) {
	case map[string]interface{}:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			item := typed[key]
			if label, ok := providers[canonicalKey(key)]; ok {
				if loc := locationFromValue(label, item); locationHasData(loc) {
					*result = appendLocation(*result, loc)
				}
			}
			walkProviderLocations(item, providers, result, depth+1)
		}
	case []interface{}:
		for _, item := range typed {
			walkProviderLocations(item, providers, result, depth+1)
		}
	}
}

func locationFromValue(provider string, value interface{}) models.RequestIPLocation {
	value = unwrapPayload(value)
	loc := models.RequestIPLocation{Provider: provider}
	switch typed := value.(type) {
	case map[string]interface{}:
		loc.Country = firstString(typed, "country", "countryName", "country_name", "countryCode", "country_code")
		loc.Region = firstString(typed, "region", "regionName", "region_name", "province", "state")
		loc.City = firstString(typed, "city")
		loc.District = firstString(typed, "district", "county")
		loc.ISP = firstString(typed, "isp", "operator", "organization", "org")
		loc.Latitude = firstString(typed, "latitude", "lat")
		loc.Longitude = firstString(typed, "longitude", "lon", "lng")
		loc.Text = firstString(typed, "location", "detail", "address", "raw", "text")
	default:
		loc.Text = sanitizeText(stringFromValue(value), 300)
	}
	return loc
}

func trustedProxyLocation(r *http.Request) models.RequestIPLocation {
	country := firstHeaderValue(r, "CF-IPCountry", "X-Vercel-IP-Country", "X-Geo-Country", "X-Country-Code")
	region := firstHeaderValue(r, "X-Vercel-IP-Country-Region", "X-Geo-Region", "X-Region-Code")
	city := firstHeaderValue(r, "X-Vercel-IP-City", "X-Geo-City", "X-City")
	return models.RequestIPLocation{
		Provider: "trusted_proxy_header",
		Country:  country,
		Region:   region,
		City:     city,
	}
}

func firstHeaderValue(r *http.Request, names ...string) string {
	for _, name := range names {
		if value := sanitizeText(r.Header.Get(name), 96); value != "" {
			return value
		}
	}
	return ""
}

func appendLocation(items []models.RequestIPLocation, loc models.RequestIPLocation) []models.RequestIPLocation {
	if !locationHasData(loc) {
		return items
	}
	key := strings.Join([]string{loc.Provider, loc.Country, loc.Region, loc.City, loc.District, loc.Text}, "\x00")
	for _, item := range items {
		existing := strings.Join([]string{item.Provider, item.Country, item.Region, item.City, item.District, item.Text}, "\x00")
		if existing == key {
			return items
		}
	}
	return append(items, loc)
}

func locationHasData(loc models.RequestIPLocation) bool {
	return loc.Country != "" || loc.Region != "" || loc.City != "" || loc.District != "" || loc.ISP != "" || loc.Latitude != "" || loc.Longitude != "" || loc.Text != ""
}

func canonicalSet(keys ...string) map[string]bool {
	result := map[string]bool{}
	for _, key := range keys {
		result[canonicalKey(key)] = true
	}
	return result
}

func canonicalKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	var b strings.Builder
	for _, r := range key {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func stringFromValue(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return fmt.Sprintf("%v", typed)
		}
		return string(raw)
	}
}

func floatFromValue(value interface{}) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		n, err := typed.Float64()
		return n, err == nil
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case string:
		n, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(typed, "%")), 64)
		return n, err == nil
	default:
		return 0, false
	}
}

func boolFromValue(value interface{}) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on", "y":
			return true
		}
	case json.Number:
		n, _ := typed.Int64()
		return n != 0
	case float64:
		return typed != 0
	case int:
		return typed != 0
	}
	return false
}

func choose(current, next string) string {
	if strings.TrimSpace(next) != "" {
		return next
	}
	return current
}

func uniqueStrings(items []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(items))
	for _, item := range items {
		item = sanitizeText(item, 100)
		if item == "" {
			continue
		}
		key := strings.ToLower(item)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, item)
	}
	sort.Strings(result)
	return result
}

func sanitizeText(value string, maxLen int) string {
	value = strings.TrimSpace(value)
	if idx := strings.Index(value, ","); idx >= 0 && maxLen <= 100 {
		value = strings.TrimSpace(value[:idx])
	}
	value = strings.NewReplacer("\x00", "", "\r", " ", "\n", " ", "\t", " ").Replace(value)
	for strings.Contains(value, "  ") {
		value = strings.ReplaceAll(value, "  ", " ")
	}
	if maxLen > 0 && len(value) > maxLen {
		value = value[:maxLen]
	}
	return strings.TrimSpace(value)
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func coarseNetwork(ip net.IP) string {
	if ipv4 := ip.To4(); ipv4 != nil {
		return fmt.Sprintf("%d.%d.%d.0/24", ipv4[0], ipv4[1], ipv4[2])
	}
	ipv6 := ip.To16()
	if ipv6 == nil {
		return ""
	}
	return fmt.Sprintf("%02x%02x:%02x%02x:%02x%02x:%02x%02x::/64",
		ipv6[0], ipv6[1], ipv6[2], ipv6[3], ipv6[4], ipv6[5], ipv6[6], ipv6[7])
}

func networkScope(ip net.IP) string {
	if ip == nil {
		return "invalid"
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return "private"
	}
	if ip.IsMulticast() || inAnyCIDR(ip, reservedCIDRs) {
		return "reserved"
	}
	return "public"
}

func inAnyCIDR(ip net.IP, cidrs []*net.IPNet) bool {
	for _, network := range cidrs {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func mustParseCIDRs(values []string) []*net.IPNet {
	result := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		if _, network, err := net.ParseCIDR(value); err == nil {
			result = append(result, network)
		}
	}
	return result
}
