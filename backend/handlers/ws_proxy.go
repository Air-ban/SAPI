package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"sapi/config"
	"sapi/security"
)

const websocketProxyReadLimit = 64 << 20

var websocketProxyUpgrader = websocket.Upgrader{
	HandshakeTimeout: 8 * time.Second,
	CheckOrigin:      websocketProxyOriginAllowed,
}

type websocketProxyRequest struct {
	ID      string                   `json:"id"`
	Method  string                   `json:"method"`
	Path    string                   `json:"path"`
	URL     string                   `json:"url,omitempty"`
	Headers map[string]string        `json:"headers"`
	Body    json.RawMessage          `json:"body"`
	Form    []websocketProxyFormPart `json:"form"`
}

type websocketProxyTarget struct {
	URL      *url.URL
	External bool
}

type websocketProxyFormPart struct {
	Name        string `json:"name"`
	Value       string `json:"value"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	DataURL     string `json:"dataUrl"`
	Base64      string `json:"base64"`
}

type websocketProxyResponse struct {
	ID      string              `json:"id"`
	Type    string              `json:"type"`
	Status  int                 `json:"status,omitempty"`
	Headers map[string][]string `json:"headers,omitempty"`
	Body    string              `json:"body,omitempty"`
	Error   string              `json:"error,omitempty"`
	Code    string              `json:"code,omitempty"`
}

func handleWebSocketProxy(w http.ResponseWriter, r *http.Request) {
	conn, err := websocketProxyUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(websocketProxyReadLimit)

	for {
		var msg websocketProxyRequest
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}
		resp := executeWebSocketProxyRequest(r, msg)
		if err := conn.WriteJSON(resp); err != nil {
			return
		}
	}
}

func executeWebSocketProxyRequest(source *http.Request, msg websocketProxyRequest) websocketProxyResponse {
	if strings.TrimSpace(msg.ID) == "" {
		msg.ID = "request"
	}
	method := strings.ToUpper(strings.TrimSpace(msg.Method))
	if method == "" {
		method = http.MethodPost
	}
	target, err := safeWebSocketProxyTarget(method, msg.Path, msg.URL)
	if err != nil {
		return websocketProxyError(msg.ID, "invalid_request", err.Error())
	}

	body, contentType, err := websocketProxyBody(msg)
	if err != nil {
		return websocketProxyError(msg.ID, "invalid_request", err.Error())
	}

	req, err := http.NewRequestWithContext(source.Context(), method, target.URL.String(), bytes.NewReader(body))
	if err != nil {
		return websocketProxyError(msg.ID, "invalid_request", "Request could not be created.")
	}
	req.RemoteAddr = source.RemoteAddr
	if !target.External {
		req.Host = source.Host
		copyWebSocketProxyClientHeaders(req.Header, source.Header)
	}
	for key, value := range msg.Headers {
		key = security.SafeSingleLine(key, 128)
		value = security.SafeSingleLine(value, 8192)
		if key == "" || !webSocketProxyRequestHeaderAllowed(key) {
			continue
		}
		req.Header.Set(key, value)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if len(body) > 0 {
		req.ContentLength = int64(len(body))
	}

	if target.External {
		return executeExternalWebSocketProxyRequest(msg.ID, req)
	}

	rec := httptest.NewRecorder()
	dispatchWebSocketProxyRequest(rec, req)
	result := rec.Result()
	defer result.Body.Close()
	raw, _ := io.ReadAll(result.Body)
	return websocketProxyResponse{
		ID:      msg.ID,
		Type:    "response",
		Status:  result.StatusCode,
		Headers: websocketProxyResponseHeaders(result.Header),
		Body:    string(raw),
	}
}

func safeWebSocketProxyTarget(method, rawPath, rawURL string) (websocketProxyTarget, error) {
	if strings.TrimSpace(rawURL) != "" {
		targetURL, err := safeExternalWebSocketProxyURL(method, rawURL)
		if err != nil {
			return websocketProxyTarget{}, err
		}
		return websocketProxyTarget{URL: targetURL, External: true}, nil
	}
	targetURL, err := safeInternalWebSocketProxyURL(method, rawPath)
	if err != nil {
		return websocketProxyTarget{}, err
	}
	return websocketProxyTarget{URL: targetURL}, nil
}

func safeInternalWebSocketProxyURL(method, rawPath string) (*url.URL, error) {
	rawPath = strings.TrimSpace(rawPath)
	if rawPath == "" || !strings.HasPrefix(rawPath, "/") || strings.ContainsAny(rawPath, "\x00\r\n") {
		return nil, fmt.Errorf("Proxy path is invalid.")
	}
	parsed, err := url.ParseRequestURI(rawPath)
	if err != nil || parsed.Path == "" {
		return nil, fmt.Errorf("Proxy path is invalid.")
	}
	if !webSocketProxyPathAllowed(method, parsed.Path) {
		return nil, fmt.Errorf("Proxy path is not allowed for WebSocket.")
	}
	parsed.Scheme = ""
	parsed.Host = ""
	return parsed, nil
}

func safeExternalWebSocketProxyURL(method, rawURL string) (*url.URL, error) {
	if method != http.MethodGet && method != http.MethodPost {
		return nil, fmt.Errorf("Only GET and POST external proxy requests are supported over WebSocket.")
	}
	if strings.ContainsAny(rawURL, "\x00\r\n") {
		return nil, fmt.Errorf("Proxy URL is invalid.")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Path == "" {
		return nil, fmt.Errorf("Proxy URL is invalid.")
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return nil, fmt.Errorf("External proxy URL must use HTTPS.")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("External proxy URL must not include credentials.")
	}
	if !webSocketProxyPathAllowed(method, parsed.Path) {
		return nil, fmt.Errorf("Proxy path is not allowed for WebSocket.")
	}
	if err := validateExternalWebSocketProxyHost(parsed.Hostname()); err != nil {
		return nil, err
	}
	return parsed, nil
}

func webSocketProxyPathAllowed(method, path string) bool {
	cleaned := strings.TrimRight(path, "/")
	switch method {
	case http.MethodGet:
		return cleaned == "/v1/models" || cleaned == "/models" || cleaned == "/ai/generate-image/suggest-tags"
	case http.MethodPost:
	default:
		return false
	}
	switch cleaned {
	case "/responses", "/v1/responses", "/v1/chat/completions", "/chat/completions", "/v1/images/generations", "/v1/images/edits", "/ai/generate-image", "/ai/generate-image-stream":
		return true
	default:
		return false
	}
}

var websocketProxyLookupIP = net.LookupIP
var websocketProxyDialer = &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
var websocketProxyExternalClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           websocketProxyExternalDialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          512,
		MaxIdleConnsPerHost:   64,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    true,
	},
	Timeout: 10 * time.Minute,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}
var websocketProxyDoExternal = func(req *http.Request) (*http.Response, error) {
	return websocketProxyExternalClient.Do(req)
}

func validateExternalWebSocketProxyHost(host string) error {
	host = strings.ToLower(strings.TrimSpace(strings.Trim(host, "[]")))
	if host == "" {
		return fmt.Errorf("External proxy host is invalid.")
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return fmt.Errorf("External proxy host is not allowed.")
	}
	if ip := net.ParseIP(host); ip != nil {
		if webSocketProxyIPBlocked(ip) {
			return fmt.Errorf("External proxy host is not allowed.")
		}
		return nil
	}
	ips, err := websocketProxyLookupIP(host)
	if err != nil || len(ips) == 0 {
		return fmt.Errorf("External proxy host could not be resolved.")
	}
	for _, ip := range ips {
		if webSocketProxyIPBlocked(ip) {
			return fmt.Errorf("External proxy host is not allowed.")
		}
	}
	return nil
}

func websocketProxyExternalDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil || strings.TrimSpace(port) == "" {
		return nil, fmt.Errorf("External proxy address is invalid.")
	}
	host = strings.Trim(host, "[]")
	if err := validateExternalWebSocketProxyHost(host); err != nil {
		return nil, err
	}
	if ip := net.ParseIP(host); ip != nil {
		return websocketProxyDialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}
	ips, err := websocketProxyLookupIP(host)
	if err != nil || len(ips) == 0 {
		return nil, fmt.Errorf("External proxy host could not be resolved.")
	}
	for _, ip := range ips {
		if webSocketProxyIPBlocked(ip) {
			continue
		}
		return websocketProxyDialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}
	return nil, fmt.Errorf("External proxy host is not allowed.")
}

func webSocketProxyIPBlocked(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsMulticast()
}

func webSocketProxyRequestHeaderAllowed(key string) bool {
	switch http.CanonicalHeaderKey(key) {
	case "Authorization",
		"X-Api-Key",
		"X-Correlation-Id",
		"Accept",
		"Cache-Control",
		"Pragma",
		"Openai-Organization",
		"Openai-Project",
		"Openai-Beta",
		"Anthropic-Version",
		"Anthropic-Beta":
		return true
	default:
		return false
	}
}

func executeExternalWebSocketProxyRequest(id string, req *http.Request) websocketProxyResponse {
	resp, err := websocketProxyDoExternal(req)
	if err != nil {
		return websocketProxyError(id, "upstream_request_failed", "External API request failed: "+err.Error())
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, websocketProxyReadLimit))
	return websocketProxyResponse{
		ID:      id,
		Type:    "response",
		Status:  resp.StatusCode,
		Headers: websocketProxyResponseHeaders(resp.Header),
		Body:    string(raw),
	}
}

func websocketProxyBody(msg websocketProxyRequest) ([]byte, string, error) {
	if len(msg.Form) > 0 {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		for _, part := range msg.Form {
			name := security.SafeSingleLine(part.Name, 128)
			if name == "" {
				continue
			}
			if strings.TrimSpace(part.DataURL) == "" && strings.TrimSpace(part.Base64) == "" && part.Filename == "" {
				if err := writer.WriteField(name, part.Value); err != nil {
					return nil, "", err
				}
				continue
			}
			data, contentType, err := decodeWebSocketProxyFormFile(part)
			if err != nil {
				return nil, "", err
			}
			if part.ContentType != "" {
				contentType = security.SafeSingleLine(part.ContentType, 128)
			}
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			filename := security.SafeSingleLine(part.Filename, 180)
			if filename == "" {
				filename = "upload"
			}
			header := textproto.MIMEHeader{}
			header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, multipartQuote(name), multipartQuote(filename)))
			header.Set("Content-Type", contentType)
			fileWriter, err := writer.CreatePart(header)
			if err != nil {
				return nil, "", err
			}
			if _, err := fileWriter.Write(data); err != nil {
				return nil, "", err
			}
		}
		if err := writer.Close(); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), writer.FormDataContentType(), nil
	}
	if len(bytes.TrimSpace(msg.Body)) == 0 || bytes.Equal(bytes.TrimSpace(msg.Body), []byte("null")) {
		return nil, "", nil
	}
	return msg.Body, "application/json", nil
}

func decodeWebSocketProxyFormFile(part websocketProxyFormPart) ([]byte, string, error) {
	if raw := strings.TrimSpace(part.DataURL); raw != "" {
		meta, payload, ok := strings.Cut(raw, ",")
		if !ok || !strings.Contains(strings.ToLower(meta), ";base64") {
			return nil, "", fmt.Errorf("Form file %q must be a base64 data URL.", part.Name)
		}
		data, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return nil, "", fmt.Errorf("Form file %q is not valid base64.", part.Name)
		}
		contentType := ""
		if strings.HasPrefix(strings.ToLower(meta), "data:") {
			contentType = strings.TrimPrefix(strings.Split(strings.TrimPrefix(meta, "data:"), ";")[0], " ")
		}
		return data, contentType, nil
	}
	if raw := strings.TrimSpace(part.Base64); raw != "" {
		data, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, "", fmt.Errorf("Form file %q is not valid base64.", part.Name)
		}
		return data, "", nil
	}
	return []byte(part.Value), "", nil
}

func multipartQuote(value string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, "\\\"").Replace(value)
}

func dispatchWebSocketProxyRequest(w http.ResponseWriter, r *http.Request) {
	switch strings.TrimRight(r.URL.Path, "/") {
	case "/responses", "/v1/responses":
		handleResponsesProxyHandler(w, r)
	default:
		handleProxyToProvider(w, r)
	}
}

func copyWebSocketProxyClientHeaders(dst, src http.Header) {
	for _, key := range []string{
		"User-Agent",
		"Accept-Language",
		"CF-Connecting-IP",
		"True-Client-IP",
		"X-Real-IP",
		"X-Forwarded-For",
		"X-Forwarded-Host",
		"Forwarded",
		"Sec-CH-UA",
		"Sec-CH-UA-Mobile",
		"Sec-CH-UA-Platform",
		"Sec-CH-UA-Platform-Version",
		"Sec-CH-UA-Model",
	} {
		if values, ok := src[key]; ok {
			for _, value := range values {
				dst.Add(key, value)
			}
		}
	}
}

func websocketProxyResponseHeaders(header http.Header) map[string][]string {
	result := map[string][]string{}
	for key, values := range header {
		if strings.EqualFold(key, "Set-Cookie") || strings.EqualFold(key, "Authorization") || strings.EqualFold(key, "X-API-Key") {
			continue
		}
		result[key] = append([]string{}, values...)
	}
	return result
}

func websocketProxyError(id, code, message string) websocketProxyResponse {
	return websocketProxyResponse{
		ID:    id,
		Type:  "error",
		Error: message,
		Code:  code,
	}
}

func websocketProxyOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	originHost := normalizeHost(parsed.Host)
	for _, requestHost := range normalizedRequestHosts(r) {
		if originHost == requestHost {
			return true
		}
	}
	cfg := config.Load()
	for _, base := range cfgPublicBaseURLs(cfg) {
		if publicBaseURLMatchesHost(base, originHost) {
			return true
		}
	}
	return false
}
