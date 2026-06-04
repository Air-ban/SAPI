package handlers

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/smtp"
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
	cfg := config.Load()
	return map[string]interface{}{
		"name":    "SAPI",
		"baseUrl": cfg.PublicBaseURL,
		"captcha": map[string]interface{}{
			"enabled": cfg.TencentCaptchaAppID != "" && cfg.TencentCaptchaAppSecretKey != "",
			"appId":   cfg.TencentCaptchaAppID,
		},
	}
}

func serviceConfig() map[string]interface{} {
	cfg := config.Load()
	db := store.ReadDB()

	modelMap := make(map[string]models.Model)
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

	modelsList := make([]models.Model, 0, len(modelMap))
	for _, v := range modelMap {
		modelsList = append(modelsList, v)
	}

	return map[string]interface{}{
		"name":    "SAPI",
		"baseUrl": cfg.PublicBaseURL,
		"endpoints": []map[string]string{
			{"method": "GET", "path": "/v1/models", "description": "列出当前可用模型"},
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
	mux.HandleFunc("GET /api/announcements", handleAnnouncements)
	mux.HandleFunc("GET /api/banner", handleBanner)
	mux.HandleFunc("GET /api/maintenance", handleMaintenance)
	mux.HandleFunc("GET /api/health/providers", handleProvidersHealth)
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
	json.NewEncoder(w).Encode(publicConfig())
}

func handlePublicKey(w http.ResponseWriter, r *http.Request) {
	apiKey := utils.GetUserAPIKey(r)
	result := middleware.FindUserByKey(apiKey)
	if result.User == nil {
		utils.SendError(w, 404, "API key was not found or is disabled.", "key_not_found")
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":  true,
		"config": serviceConfig(),
	})
}

func handleModelsList(w http.ResponseWriter, r *http.Request) {
	apiKey := utils.GetUserAPIKey(r)
	result := middleware.FindUserByKey(apiKey)
	if result.User == nil {
		utils.SendError(w, 401, "Invalid or disabled SAPI API key.", "invalid_api_key")
		return
	}

	if result.DB.MaintenanceMode {
		endTime := result.DB.MaintenanceEndTime
		msg := "站点维护中，请稍后重试。"
		if endTime != "" {
			t, err := time.Parse(time.RFC3339, endTime)
			if err == nil {
				loc, _ := time.LoadLocation("Asia/Shanghai")
				msg = "站点维护中，预计 " + t.In(loc).Format("2006-01-02 15:04:05") + " 恢复。"
			}
		}
		utils.SendError(w, 503, msg, "maintenance_mode")
		return
	}

	modelMap := make(map[string]models.Model)
	for _, p := range result.DB.Providers {
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

	if result.APIKeyRecord != nil && len(result.APIKeyRecord.AllowedModels) > 0 {
		allowedSet := make(map[string]bool)
		for _, m := range result.APIKeyRecord.AllowedModels {
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

	data := make([]map[string]interface{}, len(modelList))
	for i, m := range modelList {
		data[i] = map[string]interface{}{
			"id":          m.ID,
			"object":      "model",
			"created":     0,
			"owned_by":    "sapi",
			"name":        m.Name,
			"cli_support": m.CliSupport,
		}
		if m.CliSupport == nil {
			data[i]["cli_support"] = []string{}
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"object": "list",
		"data":   data,
	})
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

	siteEmail := db.SiteEmail
	if siteEmail != "" && strings.Contains(siteEmail, "@") {
		smtpCfg := getSMTPConfig(db)
		go sendMail(smtpCfg, siteEmail, "[SAPI 建议反馈] "+title,
			"用户提交了新的建议反馈。\n\n标题："+title+"\n内容："+content+"\n"+
				func() string {
					if contact != "" {
						return "联系方式：" + contact + "\n"
					}
					return ""
				}()+
				func() string {
					if userName != "" {
						return "提交用户：" + userName + "\n"
					}
					return ""
				}()+
				"提交时间："+suggestion.CreatedAt+"\n\n请在管理后台查看详情。",
		)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"suggestion": suggestion,
	})
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
