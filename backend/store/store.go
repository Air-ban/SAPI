package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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
	mu                      sync.RWMutex
	cachedDB                *models.Database
	lastRequestLogPruneTime time.Time
)

func Init(ctx context.Context, cfg *config.Config) error {
	mu.Lock()
	defer mu.Unlock()

	if cfg != nil && strings.TrimSpace(cfg.PostgresURL) != "" {
		if err := initPostgres(ctx, cfg); err != nil {
			return err
		}
	}
	return loadCacheLocked(ctx, true)
}

func Close() {
	closePostgres()
}

func Health(ctx context.Context) map[string]interface{} {
	return map[string]interface{}{
		"postgres": postgresHealth(ctx),
	}
}

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
	mu.Lock()
	defer mu.Unlock()

	if cachedDB != nil {
		return
	}
	if err := loadCacheLocked(context.Background(), true); err != nil {
		log.Printf("[STORE] initialize store failed: %v", err)
	}
}

func ensureFileDB() {
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
	if cachedDB != nil {
		db := cloneDatabaseForRead(cachedDB)
		mu.RUnlock()
		return db
	}
	mu.RUnlock()

	mu.Lock()
	defer mu.Unlock()
	if cachedDB == nil {
		if err := loadCacheLocked(context.Background(), true); err != nil {
			log.Printf("[STORE] read store failed: %v", err)
			cachedDB = newDefaultDB()
		}
	}
	return cloneDatabaseForRead(cachedDB)
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

	if cachedDB == nil {
		if err := loadCacheLocked(context.Background(), true); err != nil {
			log.Printf("[STORE] mutate load failed: %v", err)
			cachedDB = newDefaultDB()
		}
	}

	db := cloneDatabase(cachedDB)
	result := mutator(db)
	normalizeDB(db)
	if err := persistStateLocked(context.Background(), db); err != nil {
		log.Printf("[STORE] persist state failed: %v", err)
	}
	cachedDB = cloneDatabase(db)
	return result
}

func ReadDBInternal() *models.Database {
	if cachedDB != nil {
		return cloneDatabase(cachedDB)
	}
	if err := loadCacheLocked(context.Background(), true); err != nil {
		log.Printf("[STORE] internal read failed: %v", err)
		cachedDB = newDefaultDB()
	}
	return cloneDatabase(cachedDB)
}

func loadCacheLocked(ctx context.Context, createIfMissing bool) error {
	if postgresEnabled() {
		if db, ok, err := loadPostgresState(ctx); err != nil {
			return err
		} else if ok {
			if normalizeDB(db) {
				if err := savePostgresState(ctx, db); err != nil {
					return err
				}
			}
			cachedDB = cloneDatabase(db)
			return nil
		}
	}

	db := readFileDB(createIfMissing)
	if db == nil {
		db = newDefaultDB()
	}
	if normalizeDB(db) {
		if postgresEnabled() {
			if err := savePostgresState(ctx, db); err != nil {
				return err
			}
		} else {
			writeDB(db)
		}
	}
	if postgresEnabled() {
		for _, item := range db.RequestLogs {
			if item.ID != "" {
				if err := insertPostgresRequestLog(ctx, item); err != nil {
					log.Printf("[STORE] migrate request log to postgres failed: %v", err)
				}
			}
		}
		db.RequestLogs = []models.RequestLog{}
		if err := savePostgresState(ctx, db); err != nil {
			return err
		}
	}
	cachedDB = cloneDatabase(db)
	return nil
}

func persistStateLocked(ctx context.Context, db *models.Database) error {
	db.UpdatedAt = Now()
	if postgresEnabled() {
		return savePostgresState(ctx, db)
	}
	writeDBDirect(db)
	return nil
}

func readFileDB(createIfMissing bool) *models.Database {
	if createIfMissing {
		ensureFileDB()
	}
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

func cloneDatabase(db *models.Database) *models.Database {
	if db == nil {
		return nil
	}
	data, err := json.Marshal(db)
	if err != nil {
		return newDefaultDB()
	}
	var cloned models.Database
	if err := json.Unmarshal(data, &cloned); err != nil {
		return newDefaultDB()
	}
	return &cloned
}

func cloneDatabaseForRead(db *models.Database) *models.Database {
	if db == nil {
		return nil
	}
	slim := *db
	if db.RequestLogs != nil {
		slim.RequestLogs = make([]models.RequestLog, len(db.RequestLogs))
		for i := range db.RequestLogs {
			slim.RequestLogs[i] = requestLogForList(db.RequestLogs[i])
		}
	}
	return cloneDatabase(&slim)
}

func stripRequestLogContent(db *models.Database) {
	if db == nil {
		return
	}
	for i := range db.RequestLogs {
		db.RequestLogs[i] = requestLogForList(db.RequestLogs[i])
	}
}

func requestLogHasContent(item models.RequestLog) bool {
	return item.HasRequestContent || len(item.RequestContent) > 0
}

func requestLogForList(item models.RequestLog) models.RequestLog {
	if requestLogHasContent(item) {
		item.HasRequestContent = true
	}
	item.RequestContent = nil
	return item
}

func AppendRequestLog(item models.RequestLog) {
	mu.Lock()
	defer mu.Unlock()

	if cachedDB == nil {
		if err := loadCacheLocked(context.Background(), true); err != nil {
			log.Printf("[STORE] request log load failed: %v", err)
			cachedDB = newDefaultDB()
		}
	}

	timestamp := item.Timestamp
	if timestamp == "" {
		timestamp = Now()
		item.Timestamp = timestamp
	}

	if item.APIKeyID != "" {
		for i := range cachedDB.Users {
			if cachedDB.Users[i].ID == item.UserID {
				for j := range cachedDB.Users[i].APIKeys {
					if cachedDB.Users[i].APIKeys[j].ID == item.APIKeyID {
						cachedDB.Users[i].APIKeys[j].LastUsedAt = timestamp
						cachedDB.Users[i].APIKeys[j].UpdatedAt = timestamp
					}
				}
			}
		}
	}

	if postgresEnabled() {
		if err := insertPostgresRequestLog(context.Background(), item); err != nil {
			log.Printf("[STORE] insert postgres request log failed: %v", err)
		}
		prunePostgresRequestLogsIfDue(context.Background())
		cachedDB.RequestLogs = []models.RequestLog{}
		return
	}

	cachedDB.RequestLogs = append(cachedDB.RequestLogs, item)
	cachedDB.RequestLogs = pruneRequestLogs(cachedDB.RequestLogs, requestLogCutoff())
	if len(cachedDB.RequestLogs) > 50000 {
		cachedDB.RequestLogs = cachedDB.RequestLogs[len(cachedDB.RequestLogs)-50000:]
	}
	if err := persistStateLocked(context.Background(), cachedDB); err != nil {
		log.Printf("[STORE] persist request log failed: %v", err)
	}
}

func RequestLogsSince(db *models.Database, since time.Time, userID string, limit int) []models.RequestLog {
	if postgresEnabled() {
		items, err := queryPostgresRequestLogs(context.Background(), since, userID, limit)
		if err == nil {
			return items
		}
		log.Printf("[STORE] query postgres request logs failed: %v", err)
	}

	if db == nil {
		db = ReadDB()
	}
	sinceIso := since.UTC().Format(time.RFC3339)
	result := make([]models.RequestLog, 0)
	for _, item := range db.RequestLogs {
		if userID != "" && item.UserID != userID {
			continue
		}
		if item.Timestamp >= sinceIso {
			result = append(result, requestLogForList(item))
		}
	}
	if limit > 0 && len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}

func FindRequestLog(id, userID string) (*models.RequestLog, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, false
	}
	if postgresEnabled() {
		item, ok, err := queryPostgresRequestLog(context.Background(), id, userID)
		if err == nil {
			return item, ok
		}
		log.Printf("[STORE] query postgres request log failed: %v", err)
	}

	mu.RLock()
	defer mu.RUnlock()
	if cachedDB == nil {
		return nil, false
	}
	for _, item := range cachedDB.RequestLogs {
		if item.ID != id {
			continue
		}
		if userID != "" && item.UserID != userID {
			return nil, false
		}
		cloned := cloneRequestLog(item)
		return &cloned, true
	}
	return nil, false
}

func cloneRequestLog(item models.RequestLog) models.RequestLog {
	raw, err := json.Marshal(item)
	if err != nil {
		return item
	}
	var cloned models.RequestLog
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return item
	}
	if requestLogHasContent(cloned) {
		cloned.HasRequestContent = true
	}
	return cloned
}

func requestLogCutoff() time.Time {
	return time.Now().UTC().AddDate(0, 0, -7)
}

func prunePostgresRequestLogsIfDue(ctx context.Context) {
	now := time.Now().UTC()
	if now.Sub(lastRequestLogPruneTime) < time.Minute {
		return
	}
	lastRequestLogPruneTime = now
	if err := prunePostgresRequestLogs(ctx, requestLogCutoff()); err != nil {
		log.Printf("[STORE] prune postgres request logs failed: %v", err)
	}
}

func pruneRequestLogs(items []models.RequestLog, cutoff time.Time) []models.RequestLog {
	if len(items) == 0 {
		return items
	}
	cutoffIso := cutoff.UTC().Format(time.RFC3339)
	result := make([]models.RequestLog, 0, len(items))
	for _, item := range items {
		if item.Timestamp == "" || item.Timestamp >= cutoffIso {
			result = append(result, item)
		}
	}
	return result
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
		"id":                p.ID,
		"name":              p.Name,
		"baseUrl":           p.BaseURL,
		"models":            p.Models,
		"modelMappings":     p.ModelMappings,
		"enabled":           p.Enabled,
		"failoverThreshold": p.FailoverThreshold,
		"priority":          p.Priority,
		"healthStatus":      p.HealthStatus,
		"latency":           p.Latency,
		"ping":              p.Ping,
		"availability7d":    p.Availability7d,
		"healthHistory":     p.HealthHistory,
		"lastHealthCheck":   p.LastHealthCheck,
		"createdAt":         p.CreatedAt,
		"updatedAt":         p.UpdatedAt,
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
