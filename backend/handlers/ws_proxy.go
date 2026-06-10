package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
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
	Headers map[string]string        `json:"headers"`
	Body    json.RawMessage          `json:"body"`
	Form    []websocketProxyFormPart `json:"form"`
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
	targetURL, err := safeWebSocketProxyURL(method, msg.Path)
	if err != nil {
		return websocketProxyError(msg.ID, "invalid_request", err.Error())
	}

	body, contentType, err := websocketProxyBody(msg)
	if err != nil {
		return websocketProxyError(msg.ID, "invalid_request", err.Error())
	}

	req, err := http.NewRequestWithContext(source.Context(), method, targetURL.String(), bytes.NewReader(body))
	if err != nil {
		return websocketProxyError(msg.ID, "invalid_request", "Request could not be created.")
	}
	req.RemoteAddr = source.RemoteAddr
	req.Host = source.Host
	copyWebSocketProxyClientHeaders(req.Header, source.Header)
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

func safeWebSocketProxyURL(method, rawPath string) (*url.URL, error) {
	if method != http.MethodPost {
		return nil, fmt.Errorf("Only POST proxy requests are supported over WebSocket.")
	}
	rawPath = strings.TrimSpace(rawPath)
	if rawPath == "" || !strings.HasPrefix(rawPath, "/") || strings.ContainsAny(rawPath, "\x00\r\n") {
		return nil, fmt.Errorf("Proxy path is invalid.")
	}
	parsed, err := url.ParseRequestURI(rawPath)
	if err != nil || parsed.Path == "" {
		return nil, fmt.Errorf("Proxy path is invalid.")
	}
	if !webSocketProxyPathAllowed(parsed.Path) {
		return nil, fmt.Errorf("Proxy path is not allowed for WebSocket.")
	}
	parsed.Scheme = ""
	parsed.Host = ""
	return parsed, nil
}

func webSocketProxyPathAllowed(path string) bool {
	cleaned := strings.TrimRight(path, "/")
	switch cleaned {
	case "/responses", "/v1/responses", "/v1/chat/completions", "/chat/completions", "/v1/images/generations", "/v1/images/edits":
		return true
	default:
		return false
	}
}

func webSocketProxyRequestHeaderAllowed(key string) bool {
	switch http.CanonicalHeaderKey(key) {
	case "Authorization",
		"X-Api-Key",
		"Accept",
		"Cache-Control",
		"Pragma",
		"Openai-Beta",
		"Anthropic-Version",
		"Anthropic-Beta":
		return true
	default:
		return false
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
