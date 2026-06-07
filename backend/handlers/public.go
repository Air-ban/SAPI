package handlers

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"sort"
	"strings"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/proxy"
	"sapi/security"
	"sapi/store"
	"sapi/utils"
)

func getSMTPConfig(db *models.Database) SMTPInfo {
	cfg := config.Load()
	info := SMTPInfo{
		Host:   cfg.SmtpHost,
		Port:   cfg.SmtpPort,
		Secure: cfg.SmtpSecure,
		User:   cfg.SmtpUser,
		Pass:   cfg.SmtpPass,
		From:   cfg.SmtpFrom,
	}
	if db.SMTPConfig != nil {
		if db.SMTPConfig.Host != "" {
			info.Host = db.SMTPConfig.Host
		}
		if db.SMTPConfig.Port > 0 {
			info.Port = db.SMTPConfig.Port
		}
		info.Secure = db.SMTPConfig.Secure
		if db.SMTPConfig.User != "" {
			info.User = db.SMTPConfig.User
		}
		if db.SMTPConfig.Pass != "" {
			info.Pass = db.SMTPConfig.Pass
		}
		if db.SMTPConfig.From != "" {
			info.From = db.SMTPConfig.From
		}
	}
	return info
}

type SMTPInfo struct {
	Host   string
	Port   int
	Secure bool
	User   string
	Pass   string
	From   string
}

func createSMTPTransport(info SMTPInfo) bool {
	return info.Host != "" && info.User != "" && info.Pass != ""
}

func sendMail(info SMTPInfo, to, subject, body string) error {
	if !createSMTPTransport(info) {
		return nil
	}

	from := strings.TrimSpace(info.From)
	if from == "" {
		from = strings.TrimSpace(info.User)
	}

	msg := "From: " + sanitizeMailHeader(from) + "\r\n" +
		"To: " + sanitizeMailHeader(to) + "\r\n" +
		"Subject: " + sanitizeMailHeader(subject) + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=\"UTF-8\"\r\n" +
		"\r\n" +
		body

	auth := smtp.PlainAuth("", info.User, info.Pass, info.Host)
	addr := fmt.Sprintf("%s:%d", info.Host, info.Port)
	return sendSMTPMail(info, addr, auth, from, []string{to}, []byte(msg))
}

func parseSiteEmails(values []string) ([]string, []string) {
	emails := make([]string, 0, len(values))
	invalid := []string{}
	seen := map[string]bool{}

	for _, value := range values {
		parts := strings.FieldsFunc(value, func(r rune) bool {
			return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
		})
		for _, part := range parts {
			email := strings.ToLower(security.SafeSingleLine(part, 254))
			if email == "" {
				continue
			}
			if !isPlainEmailAddress(email) {
				invalid = append(invalid, email)
				continue
			}
			if !seen[email] {
				seen[email] = true
				emails = append(emails, email)
			}
		}
	}

	return emails, invalid
}

func isPlainEmailAddress(email string) bool {
	if email == "" || !strings.Contains(email, "@") || strings.ContainsAny(email, "<>") {
		return false
	}
	parsed, err := mail.ParseAddress(email)
	return err == nil && strings.EqualFold(parsed.Address, email)
}

func siteEmailsFromDB(db *models.Database) []string {
	if db == nil {
		return nil
	}
	emails, _ := parseSiteEmails(db.SiteEmails)
	if len(emails) > 0 {
		return emails
	}
	emails, _ = parseSiteEmails([]string{db.SiteEmail})
	return emails
}

func firstSiteEmail(emails []string) string {
	if len(emails) == 0 {
		return ""
	}
	return emails[0]
}

func sendSMTPMail(info SMTPInfo, addr string, auth smtp.Auth, from string, recipients []string, msg []byte) error {
	var client *smtp.Client
	var err error

	if useImplicitSMTPTLS(info) {
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", addr, &tls.Config{
			ServerName: info.Host,
			MinVersion: tls.VersionTLS12,
		})
		if err != nil {
			return err
		}
		client, err = smtp.NewClient(conn, info.Host)
		if err != nil {
			conn.Close()
			return err
		}
	} else {
		conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
		if err != nil {
			return err
		}
		client, err = smtp.NewClient(conn, info.Host)
		if err != nil {
			conn.Close()
			return err
		}
	}
	defer client.Close()

	if err := client.Hello("localhost"); err != nil {
		return err
	}

	if !useImplicitSMTPTLS(info) {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{
				ServerName: info.Host,
				MinVersion: tls.VersionTLS12,
			}); err != nil {
				return err
			}
		}
	}

	if auth != nil {
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(auth); err != nil {
				return err
			}
		}
	}

	if err := client.Mail(from); err != nil {
		return err
	}
	for _, recipient := range recipients {
		if err := client.Rcpt(recipient); err != nil {
			return err
		}
	}

	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(msg); err != nil {
		writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}

	if err := client.Quit(); err != nil && err != io.EOF {
		return err
	}
	return nil
}

func useImplicitSMTPTLS(info SMTPInfo) bool {
	return info.Secure || info.Port == 465
}

func sanitizeMailHeader(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), "\r", " "), "\n", " ")
}

func publicConfig() map[string]interface{} {
	return publicConfigForRequest(nil)
}

func publicConfigForRequest(r *http.Request) map[string]interface{} {
	cfg := config.Load()
	baseURL := publicBaseURLForRequest(r, cfg)
	if baseURL == "" {
		baseURL = cfg.PublicBaseURL
	}
	_, githubEnabled := githubOAuthAppForRequest(r, cfg)
	return map[string]interface{}{
		"name":    "SAPI",
		"baseUrl": baseURL,
		"captcha": map[string]interface{}{
			"enabled": cfg.TencentCaptchaAppID != "" && cfg.TencentCaptchaAppSecretKey != "",
			"appId":   cfg.TencentCaptchaAppID,
		},
		"github": map[string]interface{}{
			"enabled":              githubEnabled,
			"requiredFollowTarget": cfg.GitHubRequiredFollowTarget,
		},
		"adminPasskey": map[string]interface{}{
			"enabled": store.AdminPasskeyCount() > 0,
		},
	}
}

func serviceConfig() map[string]interface{} {
	return serviceConfigForRequest(nil)
}

func serviceConfigForRequest(r *http.Request) map[string]interface{} {
	cfg := config.Load()
	db := store.ReadDB()
	modelsList := availableModelsForKey(db, nil)
	baseURL := publicBaseURLForRequest(r, cfg)
	if baseURL == "" {
		baseURL = cfg.PublicBaseURL
	}

	return map[string]interface{}{
		"name":    "SAPI",
		"baseUrl": baseURL,
		"endpoints": []map[string]string{
			{"method": "GET", "path": "/v1/models", "description": "列出当前可用模型"},
			{"method": "GET", "path": "/v1/models/{model}", "description": "查询单个 OpenAI 兼容模型"},
			{"method": "POST", "path": "/v1/chat/completions", "description": "OpenAI 兼容聊天补全"},
			{"method": "POST", "path": "/v1/completions", "description": "OpenAI 兼容文本补全"},
			{"method": "POST", "path": "/v1/embeddings", "description": "OpenAI 兼容向量接口"},
			{"method": "POST", "path": "/responses", "description": "OpenAI 兼容 Responses API"},
			{"method": "POST", "path": "/v1/messages", "description": "Anthropic 兼容 Messages API"},
		},
		"models": modelsList,
	}
}

func MountPublicRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("GET /api/ready", handleReady)
	mux.HandleFunc("GET /api/public/config", handlePublicConfig)
	mux.HandleFunc("GET /api/public/key", handlePublicKey)
	mux.HandleFunc("GET /v1/models", handleModelsList)
	mux.HandleFunc("GET /models", handleModelsList)
	mux.HandleFunc("GET /v1/models/{model...}", handleModelRetrieve)
	mux.HandleFunc("GET /models/{model...}", handleModelRetrieve)
	mux.HandleFunc("GET /v1/messages/v1/models", handleModelsList)
	mux.HandleFunc("GET /messages/v1/models", handleModelsList)
	mux.HandleFunc("GET /v1/responses/v1/models", handleModelsList)
	mux.HandleFunc("GET /responses/v1/models", handleModelsList)
	mux.HandleFunc("GET /v1/messages/v1/models/{model...}", handleModelRetrieve)
	mux.HandleFunc("GET /messages/v1/models/{model...}", handleModelRetrieve)
	mux.HandleFunc("GET /v1/responses/v1/models/{model...}", handleModelRetrieve)
	mux.HandleFunc("GET /responses/v1/models/{model...}", handleModelRetrieve)
	mux.HandleFunc("GET /api/announcements", handleAnnouncements)
	mux.HandleFunc("GET /api/banner", handleBanner)
	mux.HandleFunc("GET /api/maintenance", handleMaintenance)
	mux.HandleFunc("GET /api/health/providers", handleProvidersHealth)
	mux.HandleFunc("GET /api/health/models", handleModelsHealth)
	mux.HandleFunc("POST /api/suggestions", handlePostSuggestion)
	mux.HandleFunc("GET /api/swagger.json", handleSwaggerJSON)
	mux.HandleFunc("GET /swagger", handleSwaggerUI)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":   true,
		"name": "SAPI",
		"time": store.Now(),
	})
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	checks := map[string]interface{}{
		"store":    store.Health(r.Context()),
		"security": map[string]interface{}{"redis": security.Health(r.Context())},
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":     true,
		"name":   "SAPI",
		"time":   store.Now(),
		"checks": checks,
	})
}

func handlePublicConfig(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(publicConfigForRequest(r))
}

func handlePublicKey(w http.ResponseWriter, r *http.Request) {
	apiKey := utils.GetUserAPIKey(r)
	result := middleware.FindUserByKey(apiKey)
	if result.User == nil {
		utils.SendError(w, 404, "API key was not found or is disabled.", "key_not_found")
		return
	}
	if result.Banned {
		sendAPIKeyBannedError(w, result.RetryAfter, result.BanReason)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":  true,
		"config": serviceConfigForRequest(r),
	})
}

func handleModelsList(w http.ResponseWriter, r *http.Request) {
	result, ok := validateModelsRequest(w, r)
	if !ok {
		return
	}

	modelList := availableModelsForKey(result.DB, result.APIKeyRecord)
	data := make([]map[string]interface{}, len(modelList))
	for i, m := range modelList {
		data[i] = modelToOpenAIObject(m)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"object": "list",
		"data":   data,
	})
}

func handleModelRetrieve(w http.ResponseWriter, r *http.Request) {
	result, ok := validateModelsRequest(w, r)
	if !ok {
		return
	}

	modelID := modelIDFromModelsPath(r)
	if modelID == "" {
		handleModelsList(w, r)
		return
	}

	for _, model := range availableModelsForKey(result.DB, result.APIKeyRecord) {
		if model.ID == modelID {
			json.NewEncoder(w).Encode(modelToOpenAIObject(model))
			return
		}
	}

	utils.SendError(w, 404, fmt.Sprintf("Model %q was not found or is not allowed for this API key.", modelID), "model_not_found")
}

func validateModelsRequest(w http.ResponseWriter, r *http.Request) (*middleware.FindUserByKeyResult, bool) {
	apiKey := utils.GetUserAPIKey(r)
	result := middleware.FindUserByKey(apiKey)
	if result.User == nil {
		utils.SendError(w, 401, "Invalid or disabled SAPI API key.", "invalid_api_key")
		return nil, false
	}
	if result.Banned {
		sendAPIKeyBannedError(w, result.RetryAfter, result.BanReason)
		return nil, false
	}

	if middleware.CheckMaintenanceMode(result.DB, w) {
		return nil, false
	}

	return result, true
}

func availableModelsForKey(db *models.Database, apiKeyRecord *models.APIKeyRecord) []models.Model {
	modelMap := make(map[string]models.Model)
	if db == nil {
		return []models.Model{}
	}
	for _, p := range db.Providers {
		if !p.Enabled {
			continue
		}
		for _, m := range p.Models {
			if m.ID != "" {
				modelMap[m.ID] = m
			}
		}
		for customID, upstreamID := range p.ModelMappings {
			if customID == "" || upstreamID == "" {
				continue
			}
			if _, exists := modelMap[customID]; exists {
				continue
			}
			name := customID
			for _, m := range p.Models {
				if m.ID == upstreamID && m.Name != "" {
					name = m.Name
					break
				}
			}
			modelMap[customID] = models.Model{ID: customID, Name: name}
		}
	}

	modelList := make([]models.Model, 0, len(modelMap))
	for _, v := range modelMap {
		modelList = append(modelList, v)
	}

	if apiKeyRecord != nil && len(apiKeyRecord.AllowedModels) > 0 {
		allowedSet := make(map[string]bool)
		for _, m := range apiKeyRecord.AllowedModels {
			allowedSet[strings.TrimSpace(m)] = true
		}
		filtered := make([]models.Model, 0)
		for _, m := range modelList {
			if allowedSet[m.ID] {
				filtered = append(filtered, m)
			}
		}
		modelList = filtered
	}

	sort.Slice(modelList, func(i, j int) bool {
		return modelList[i].ID < modelList[j].ID
	})

	return modelList
}

func modelToOpenAIObject(m models.Model) map[string]interface{} {
	item := map[string]interface{}{
		"id":          m.ID,
		"object":      "model",
		"created":     0,
		"owned_by":    "sapi",
		"name":        m.Name,
		"cli_support": m.CliSupport,
	}
	if m.CliSupport == nil {
		item["cli_support"] = []string{}
	}
	if m.Description != "" {
		item["description"] = m.Description
	}
	return item
}

func modelIDFromModelsPath(r *http.Request) string {
	for _, prefix := range []string{"/v1/models/", "/models/"} {
		if strings.HasPrefix(r.URL.EscapedPath(), prefix) {
			raw := strings.TrimPrefix(r.URL.EscapedPath(), prefix)
			modelID, err := url.PathUnescape(raw)
			if err == nil {
				return strings.TrimSpace(modelID)
			}
		}
		if strings.HasPrefix(r.URL.Path, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(r.URL.Path, prefix))
		}
	}
	for _, marker := range []string{"/v1/models/"} {
		if idx := strings.Index(r.URL.EscapedPath(), marker); idx >= 0 {
			raw := r.URL.EscapedPath()[idx+len(marker):]
			modelID, err := url.PathUnescape(raw)
			if err == nil {
				return strings.TrimSpace(modelID)
			}
		}
		if idx := strings.Index(r.URL.Path, marker); idx >= 0 {
			return strings.TrimSpace(r.URL.Path[idx+len(marker):])
		}
	}
	return ""
}

func handleAnnouncements(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	announcements := make([]models.Announcement, 0)
	for _, a := range db.Announcements {
		if a.Enabled {
			announcements = append(announcements, a)
		}
	}
	for i := 0; i < len(announcements); i++ {
		for j := i + 1; j < len(announcements); j++ {
			if announcements[j].CreatedAt > announcements[i].CreatedAt {
				announcements[i], announcements[j] = announcements[j], announcements[i]
			}
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"announcements": announcements,
	})
}

func handleBanner(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	if db.SiteBanner != nil {
		json.NewEncoder(w).Encode(db.SiteBanner)
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"content":   "",
			"updatedAt": "",
		})
	}
}

func handleMaintenance(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"maintenanceMode":    db.MaintenanceMode,
		"maintenanceEndTime": db.MaintenanceEndTime,
	})
}

func handleProvidersHealth(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	providers := make([]map[string]interface{}, 0)
	for _, p := range db.Providers {
		if !p.Enabled {
			continue
		}
		counter := proxy.GetProviderFailureCounter(p.ID)
		threshold := p.FailoverThreshold
		history := p.HealthHistory
		if len(history) > 60 {
			history = history[len(history)-60:]
		}
		providers = append(providers, map[string]interface{}{
			"id":                     p.ID,
			"name":                   p.Name,
			"baseUrl":                p.BaseURL,
			"models":                 p.Models,
			"modelMappings":          p.ModelMappings,
			"healthStatus":           p.HealthStatus,
			"latency":                p.Latency,
			"ping":                   p.Ping,
			"availability7d":         p.Availability7d,
			"lastHealthCheck":        p.LastHealthCheck,
			"healthHistory":          history,
			"consecutiveFailures":    counter.ConsecutiveFailures,
			"failoverThreshold":      threshold,
			"isAvailableForFailover": threshold <= 0 || counter.ConsecutiveFailures < threshold,
		})
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"providers": providers,
	})
}

func handlePostSuggestion(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}

	title := security.SafeSingleLine(fmt.Sprintf("%v", body["title"]), 160)
	content := security.SafeText(fmt.Sprintf("%v", body["content"]), 20000)
	contact := security.SafeSingleLine(fmt.Sprintf("%v", body["contact"]), 254)

	if title == "" {
		utils.SendError(w, 400, "Title is required.", "invalid_title")
		return
	}
	if content == "" {
		utils.SendError(w, 400, "Content is required.", "invalid_content")
		return
	}

	token := utils.GetBearerToken(r)
	db := store.ReadDB()
	payload := auth.VerifyToken(token, db.AppSecret)
	userID := ""
	userName := ""
	if payload != nil && payload.Role == "user" {
		for _, u := range db.Users {
			if u.ID == payload.Sub {
				userID = u.ID
				userName = u.Name
				break
			}
		}
	}

	suggestion := models.Suggestion{
		ID:        auth.RandomID("sg"),
		Title:     title,
		Content:   content,
		Contact:   contact,
		UserID:    userID,
		UserName:  userName,
		CreatedAt: store.Now(),
		UpdatedAt: store.Now(),
	}

	store.MutateDB(func(db *models.Database) interface{} {
		db.Suggestions = append([]models.Suggestion{suggestion}, db.Suggestions...)
		return nil
	})

	siteEmails := siteEmailsFromDB(db)
	if len(siteEmails) > 0 {
		smtpCfg := getSMTPConfig(db)
		body := buildSuggestionEmailBody(title, content, contact, userName, suggestion.CreatedAt)
		go func() {
			for _, email := range siteEmails {
				_ = sendMail(smtpCfg, email, "[SAPI 建议反馈] "+title, body)
			}
		}()
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"suggestion": suggestion,
	})
}

func buildSuggestionEmailBody(title, content, contact, userName, createdAt string) string {
	var b strings.Builder
	b.WriteString("用户提交了新的建议反馈。\n\n标题：")
	b.WriteString(title)
	b.WriteString("\n内容：")
	b.WriteString(content)
	b.WriteString("\n")
	if contact != "" {
		b.WriteString("联系方式：")
		b.WriteString(contact)
		b.WriteString("\n")
	}
	if userName != "" {
		b.WriteString("提交用户：")
		b.WriteString(userName)
		b.WriteString("\n")
	}
	b.WriteString("提交时间：")
	b.WriteString(createdAt)
	b.WriteString("\n\n请在管理后台查看详情。")
	return b.String()
}

func handleSwaggerJSON(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	spec := map[string]interface{}{
		"openapi": "3.0.3",
		"info": map[string]interface{}{
			"title":       "SAPI Proxy API",
			"description": "SAPI OpenAI-compatible proxy endpoints. Use your SAPI API Key in the Authorization header: Bearer sk-sapi-...",
			"version":     "0.1.0",
		},
		"servers": []map[string]string{{"url": cfg.PublicBaseURL}},
		"tags": []map[string]string{
			{"name": "Models", "description": "List available models"},
			{"name": "Chat", "description": "Chat completions"},
			{"name": "Completions", "description": "Text completions"},
			{"name": "Embeddings", "description": "Text embeddings"},
			{"name": "Anthropic", "description": "Anthropic-compatible endpoints"},
		},
		"paths": map[string]interface{}{
			"/v1/models":                map[string]interface{}{"get": map[string]interface{}{"tags": []string{"Models"}, "summary": "List available models", "security": []map[string][]string{{"bearerAuth": {}}}, "responses": map[string]interface{}{"200": map[string]string{"description": "Models list"}}}},
			"/v1/models/{model}":        map[string]interface{}{"get": map[string]interface{}{"tags": []string{"Models"}, "summary": "Retrieve a model", "security": []map[string][]string{{"bearerAuth": {}}}, "parameters": []map[string]interface{}{{"name": "model", "in": "path", "required": true, "schema": map[string]string{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]string{"description": "Model details"}, "404": map[string]string{"description": "Model not found"}}}},
			"/v1/chat/completions":      map[string]interface{}{"post": map[string]interface{}{"tags": []string{"Chat"}, "summary": "Chat completions", "security": []map[string][]string{{"bearerAuth": {}}}}},
			"/v1/completions":           map[string]interface{}{"post": map[string]interface{}{"tags": []string{"Completions"}, "summary": "Text completions", "security": []map[string][]string{{"bearerAuth": {}}}}},
			"/v1/embeddings":            map[string]interface{}{"post": map[string]interface{}{"tags": []string{"Embeddings"}, "summary": "Create embeddings", "security": []map[string][]string{{"bearerAuth": {}}}}},
			"/v1/messages":              map[string]interface{}{"post": map[string]interface{}{"tags": []string{"Anthropic"}, "summary": "Anthropic Messages API", "security": []map[string][]string{{"bearerAuth": {}}}}},
			"/v1/messages/count_tokens": map[string]interface{}{"post": map[string]interface{}{"tags": []string{"Anthropic"}, "summary": "Count tokens (Anthropic)", "security": []map[string][]string{{"bearerAuth": {}}}}},
			"/responses":                map[string]interface{}{"post": map[string]interface{}{"tags": []string{"Chat"}, "summary": "OpenAI Responses API", "security": []map[string][]string{{"bearerAuth": {}}}}},
		},
		"components": map[string]interface{}{
			"securitySchemes": map[string]interface{}{
				"bearerAuth": map[string]interface{}{
					"type":         "http",
					"scheme":       "bearer",
					"bearerFormat": "JWT",
				},
			},
		},
	}
	json.NewEncoder(w).Encode(spec)
}

func handleSwaggerUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	html := `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SAPI API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>html,body{margin:0;padding:0;height:100%}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    (function() {
      var token = localStorage.getItem("sapiUserToken") || localStorage.getItem("sapiAdminToken") || "";
      SwaggerUIBundle({
        url: '/api/swagger.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.presets.standalone],
        requestInterceptor: function(req) {
          if (token) {
            req.headers = req.headers || {};
            req.headers.Authorization = "Bearer " + token;
          }
          return req;
        }
      });
    })();
  </script>
</body>
</html>`
	w.Write([]byte(html))
}
