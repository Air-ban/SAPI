package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/models"
)

var (
	mu      sync.RWMutex
	dataDir string
)

func DataFilePath() string {
	cfg := config.Load()
	if cfg.DataFile != "" {
		return cfg.DataFile
	}
	if _, file, _, ok := runtime.Caller(0); ok {
		if _, err := os.Stat(file); err == nil {
			return filepath.Join(filepath.Dir(file), "..", "..", "data", "sapi.json")
		}
	}
	exePath, _ := os.Executable()
	return filepath.Join(filepath.Dir(exePath), "..", "data", "sapi.json")
}

func Now() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func EnsureDB() {
	filePath := DataFilePath()
	if _, err := os.Stat(filePath); err == nil {
		return
	}

	createdAt := Now()
	db := &models.Database{
		Version:     1,
		AppSecret:   auth.RandomSecret(),
		Providers:   []models.Provider{},
		Users:       []models.User{},
		TokenUsage:  []interface{}{},
		RequestLogs: []models.RequestLog{},
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	}

	os.MkdirAll(filepath.Dir(filePath), 0755)
	writeDBDirect(db)
}

func ReadDB() *models.Database {
	mu.RLock()
	defer mu.RUnlock()

	EnsureDB()
	filePath := DataFilePath()

	data, err := os.ReadFile(filePath)
	if err != nil {
		return newDefaultDB()
	}

	var db models.Database
	if err := json.Unmarshal(data, &db); err != nil {
		return newDefaultDB()
	}

	changed := normalizeDB(&db)
	if changed {
		writeDB(&db)
	}
	return &db
}

func writeDB(db *models.Database) {
	db.UpdatedAt = Now()
	writeDBDirect(db)
}

func writeDBDirect(db *models.Database) {
	filePath := DataFilePath()
	os.MkdirAll(filepath.Dir(filePath), 0755)

	data, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		return
	}

	tempFile := filePath + ".tmp"
	if err := os.WriteFile(tempFile, data, 0644); err != nil {
		return
	}
	os.Rename(tempFile, filePath)
}

func MutateDB(mutator func(*models.Database) interface{}) interface{} {
	mu.Lock()
	defer mu.Unlock()

	db := ReadDBInternal()
	result := mutator(db)
	writeDB(db)
	return result
}

func ReadDBInternal() *models.Database {
	EnsureDB()
	filePath := DataFilePath()

	data, err := os.ReadFile(filePath)
	if err != nil {
		return newDefaultDB()
	}

	var db models.Database
	if err := json.Unmarshal(data, &db); err != nil {
		return newDefaultDB()
	}

	normalizeDB(&db)
	return &db
}

func newDefaultDB() *models.Database {
	createdAt := Now()
	return &models.Database{
		Version:     1,
		AppSecret:   auth.RandomSecret(),
		Providers:   []models.Provider{},
		Users:       []models.User{},
		TokenUsage:  []interface{}{},
		RequestLogs: []models.RequestLog{},
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	}
}

func normalizeDB(db *models.Database) bool {
	changed := false

	if db.AppSecret == "" {
		db.AppSecret = auth.RandomSecret()
		changed = true
	}
	if db.Providers == nil {
		db.Providers = []models.Provider{}
		changed = true
	}
	if db.Users == nil {
		db.Users = []models.User{}
		changed = true
	}
	if db.TokenUsage == nil {
		db.TokenUsage = []interface{}{}
		changed = true
	}
	if db.RequestLogs == nil {
		db.RequestLogs = []models.RequestLog{}
		changed = true
	}
	if db.AdminAPIKeys == nil {
		db.AdminAPIKeys = []models.APIKeyRecord{}
		changed = true
	}
	if db.InvitationCodes == nil {
		db.InvitationCodes = []models.InvitationCode{}
		changed = true
	}
	if db.SMTPConfig == nil {
		db.SMTPConfig = &models.SMTPConfig{}
		changed = true
	}
	if db.VerificationCodes == nil {
		db.VerificationCodes = []models.VerificationCode{}
		changed = true
	}
	if db.Announcements == nil {
		db.Announcements = []models.Announcement{}
		changed = true
	}
	if db.Documents == nil {
		db.Documents = []interface{}{}
		changed = true
	}
	if db.Suggestions == nil {
		db.Suggestions = []models.Suggestion{}
		changed = true
	}
	if db.SiteEmail == "" {
		for _, user := range db.Users {
			if user.Email != "" {
				db.SiteEmail = user.Email
				break
			}
		}
		if db.SiteEmail == "" {
			changed = true
		}
	}
	if db.DefaultRPMLimit == 0 {
		db.DefaultRPMLimit = 30
		changed = true
	}
	if db.SiteBanner == nil {
		db.SiteBanner = &models.SiteBanner{}
		changed = true
	}

	for i := range db.Providers {
		p := &db.Providers[i]
		if p.HealthStatus == "" {
			p.HealthStatus = "unknown"
			changed = true
		}
		if p.FailoverThreshold == 0 {
			p.FailoverThreshold = 3
			changed = true
		}
		if p.ModelMappings == nil {
			p.ModelMappings = map[string]string{}
			changed = true
		}
		if p.HealthHistory == nil {
			p.HealthHistory = []models.HealthHistoryEntry{}
			changed = true
		}
		if p.Availability7d == 0 {
			p.Availability7d = 100
			changed = true
		}
		if p.Models == nil {
			p.Models = []models.Model{}
			changed = true
		}
	}

	for i := range db.Users {
		u := &db.Users[i]
		if u.Username == "" {
			u.Username = strings.ToLower(strings.TrimSpace(u.Name))
			changed = true
		}
		if u.Email == "" && u.Name != "" && strings.Contains(u.Name, "@") {
			u.Email = strings.ToLower(strings.TrimSpace(u.Name))
		}
		if u.ReceiveAnnouncementEmail == false && u.APIKey != "" {
			u.ReceiveAnnouncementEmail = true
			changed = true
		}
		if u.APIKeys == nil {
			u.APIKeys = []models.APIKeyRecord{}
			changed = true
		}

		if u.APIKey != "" {
			hasKey := false
			for _, k := range u.APIKeys {
				if k.Key == u.APIKey {
					hasKey = true
					break
				}
			}
			if !hasKey {
				createdAt := u.CreatedAt
				if createdAt == "" {
					createdAt = Now()
				}
				u.APIKeys = append([]models.APIKeyRecord{{
					ID:        auth.RandomID("key"),
					Name:      "默认 Key",
					Key:       u.APIKey,
					Enabled:   true,
					CreatedAt: createdAt,
					UpdatedAt: u.UpdatedAt,
				}}, u.APIKeys...)
				changed = true
			}
		}

		validKeys := make([]models.APIKeyRecord, 0)
		for j, k := range u.APIKeys {
			if strings.TrimSpace(k.Key) == "" {
				changed = true
				continue
			}
			itemChanged := false
			if k.ID == "" {
				k.ID = auth.RandomID("key")
				itemChanged = true
			}
			if k.Name == "" {
				if j == 0 {
					k.Name = "默认 Key"
				} else {
					k.Name = fmt.Sprintf("API Key %d", j+1)
				}
				itemChanged = true
			}
			if !k.Enabled && k.Enabled != false {
				k.Enabled = true
				itemChanged = true
			}
			if k.CreatedAt == "" {
				k.CreatedAt = u.CreatedAt
				itemChanged = true
			}
			if k.UpdatedAt == "" {
				k.UpdatedAt = u.UpdatedAt
			}
			if itemChanged {
				changed = true
			}
			validKeys = append(validKeys, k)
		}
		u.APIKeys = validKeys

		primaryKey := ""
		for _, k := range u.APIKeys {
			if k.Enabled {
				primaryKey = k.Key
				break
			}
		}
		if primaryKey == "" && len(u.APIKeys) > 0 {
			primaryKey = u.APIKeys[0].Key
		}
		if u.APIKey != primaryKey {
			u.APIKey = primaryKey
			changed = true
		}
	}

	return changed
}

func RedactProvider(p models.Provider) map[string]interface{} {
	result := map[string]interface{}{
		"id":                  p.ID,
		"name":                p.Name,
		"baseUrl":             p.BaseURL,
		"models":              p.Models,
		"modelMappings":       p.ModelMappings,
		"enabled":             p.Enabled,
		"failoverThreshold":   p.FailoverThreshold,
		"priority":            p.Priority,
		"healthStatus":        p.HealthStatus,
		"latency":             p.Latency,
		"ping":                p.Ping,
		"availability7d":      p.Availability7d,
		"healthHistory":       p.HealthHistory,
		"lastHealthCheck":     p.LastHealthCheck,
		"createdAt":           p.CreatedAt,
		"updatedAt":           p.UpdatedAt,
	}
	if p.APIKey != "" {
		result["apiKey"] = "••••" + p.APIKey[len(p.APIKey)-min(4, len(p.APIKey)):]
		result["hasApiKey"] = true
	} else {
		result["apiKey"] = ""
		result["hasApiKey"] = false
	}
	return result
}

func NormalizeModel(item interface{}) models.Model {
	switch v := item.(type) {
	case map[string]interface{}:
		id := strings.TrimSpace(fmt.Sprintf("%v", v["id"]))
		if id == "" {
			id = strings.TrimSpace(fmt.Sprintf("%v", v["name"]))
		}
		cliSupport := []string{}
		if cs, ok := v["cliSupport"].([]interface{}); ok {
			for _, c := range cs {
				if s := strings.TrimSpace(fmt.Sprintf("%v", c)); s != "" {
					cliSupport = append(cliSupport, s)
				}
			}
		}
		return models.Model{
			ID:          id,
			Name:        strings.TrimSpace(fmt.Sprintf("%v", v["name"])),
			Description: strings.TrimSpace(fmt.Sprintf("%v", v["description"])),
			CliSupport:  cliSupport,
		}
	case string:
		id := strings.TrimSpace(v)
		return models.Model{ID: id, Name: id}
	default:
		id := strings.TrimSpace(fmt.Sprintf("%v", v))
		return models.Model{ID: id, Name: id}
	}
}



func RedactProviders(providers []models.Provider) []map[string]interface{} {
	result := make([]map[string]interface{}, len(providers))
	for i, p := range providers {
		result[i] = RedactProvider(p)
	}
	return result
}
