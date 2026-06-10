package store

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"sapi/auth"
	"sapi/config"
	"sapi/models"
	"sapi/subscription"
)

var (
	mu                      sync.RWMutex
	requestLogMu            sync.Mutex
	cachedDB                *models.Database
	lastRequestLogPruneTime time.Time
	lastFileRequestLogPrune time.Time
	lastStatePersistTime    time.Time
)

const (
	fileRequestLogPruneInterval = time.Hour
	statePersistInterval        = 30 * time.Second
	recentFileRequestLogMaxScan = 128 * 1024 * 1024
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

func RequestLogFilePath() string {
	filePath := DataFilePath()
	ext := filepath.Ext(filePath)
	if ext == "" {
		return filePath + ".request-logs.jsonl"
	}
	return strings.TrimSuffix(filePath, ext) + ".request-logs.jsonl"
}

func RequestLogArchiveDir() string {
	return filepath.Join(filepath.Dir(RequestLogFilePath()), "request-log-archives")
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
		Version:       1,
		AppSecret:     auth.RandomSecret(),
		Providers:     []models.Provider{},
		Users:         []models.User{},
		TokenUsage:    []interface{}{},
		RequestLogs:   []models.RequestLog{},
		AdminPasskeys: []models.AdminPasskey{},
		CreatedAt:     createdAt,
		UpdatedAt:     createdAt,
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
	writeDBDirect(stateForPersist(db))
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

	if postgresEnabled() {
		db, result, err := mutatePostgresState(context.Background(), mutator)
		if err != nil {
			log.Printf("[STORE] mutate postgres state failed: %v", err)
			return result
		}
		if db != nil {
			cachedDB = cloneDatabase(db)
		}
		return result
	}

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

func DeleteUserAccount(userID string) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return false
	}

	if postgresEnabled() {
		mu.Lock()
		db, deleted, err := deletePostgresUserAccountState(context.Background(), userID)
		if err != nil {
			log.Printf("[STORE] delete postgres user account failed: %v", err)
			mu.Unlock()
			return false
		}
		if db != nil {
			cachedDB = cloneDatabase(db)
		}
		mu.Unlock()
		return deleted
	}

	mu.Lock()
	if cachedDB == nil {
		if err := loadCacheLocked(context.Background(), true); err != nil {
			log.Printf("[STORE] delete account load failed: %v", err)
			cachedDB = newDefaultDB()
		}
	}

	db := cloneDatabase(cachedDB)
	deleted := removeUserAccountFromDB(db, userID)
	if !deleted {
		mu.Unlock()
		return false
	}
	normalizeDB(db)
	if err := persistStateLocked(context.Background(), db); err != nil {
		log.Printf("[STORE] persist account deletion failed: %v", err)
	}
	cachedDB = cloneDatabase(db)
	mu.Unlock()

	if err := deleteFileRequestLogsByUser(userID); err != nil {
		log.Printf("[STORE] delete user request logs failed: %v", err)
	}
	return true
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

func AdminPasskeyCount() int {
	EnsureDB()
	mu.RLock()
	defer mu.RUnlock()
	if cachedDB == nil {
		return 0
	}
	return len(cachedDB.AdminPasskeys)
}

func loadCacheLocked(ctx context.Context, createIfMissing bool) error {
	if postgresEnabled() {
		if db, ok, err := loadPostgresState(ctx); err != nil {
			return err
		} else if ok {
			changed := normalizeDB(db)
			if len(db.RequestLogs) > 0 {
				for _, item := range db.RequestLogs {
					if item.ID != "" {
						if err := insertPostgresRequestLog(ctx, item); err != nil {
							log.Printf("[STORE] migrate request log to postgres failed: %v", err)
						}
					}
				}
				db.RequestLogs = []models.RequestLog{}
				changed = true
			}
			if changed {
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
	if !postgresEnabled() && len(db.RequestLogs) > 0 {
		if err := migrateFileRequestLogs(db.RequestLogs); err != nil {
			log.Printf("[STORE] migrate request logs to jsonl failed: %v", err)
		} else {
			db.RequestLogs = requestLogsForMemory(db.RequestLogs)
		}
	} else if !postgresEnabled() {
		db.RequestLogs = []models.RequestLog{}
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
	if !postgresEnabled() && len(db.RequestLogs) == 0 {
		writeDB(db)
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
	writeDBDirect(stateForPersist(db))
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

func stateForPersist(db *models.Database) *models.Database {
	state := cloneDatabase(db)
	if state == nil {
		return nil
	}
	state.RequestLogs = []models.RequestLog{}
	return state
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

func RequestLogForUserView(item models.RequestLog) models.RequestLog {
	item = requestLogForList(item)
	item.ClientGeo = nil
	item.ClientIPInfo = nil
	item.ClientDevice = nil
	item.HasRequestContent = false
	return item
}

func RequestLogsForUserView(items []models.RequestLog) []models.RequestLog {
	result := make([]models.RequestLog, len(items))
	for i := range items {
		result[i] = RequestLogForUserView(items[i])
	}
	return result
}

func requestLogsForMemory(items []models.RequestLog) []models.RequestLog {
	cutoff := requestLogCutoff()
	result := make([]models.RequestLog, 0, len(items))
	for _, item := range items {
		if requestLogAtOrAfter(item, cutoff) {
			result = append(result, requestLogForList(item))
		}
	}
	if len(result) > 50000 {
		result = result[len(result)-50000:]
	}
	return result
}

func AppendRequestLog(item models.RequestLog) {
	timestamp := item.Timestamp
	if timestamp == "" {
		timestamp = Now()
		item.Timestamp = timestamp
	}

	mu.Lock()
	if cachedDB == nil {
		if err := loadCacheLocked(context.Background(), true); err != nil {
			log.Printf("[STORE] request log load failed: %v", err)
			cachedDB = newDefaultDB()
		}
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
		cachedDB.RequestLogs = []models.RequestLog{}
		mu.Unlock()
		if err := insertPostgresRequestLog(context.Background(), item); err != nil {
			log.Printf("[STORE] insert postgres request log failed: %v", err)
		}
		prunePostgresRequestLogsIfDue(context.Background())
		return
	}

	cachedDB.RequestLogs = append(cachedDB.RequestLogs, requestLogForList(item))
	cachedDB.RequestLogs = pruneRequestLogs(cachedDB.RequestLogs, requestLogCutoff())
	if len(cachedDB.RequestLogs) > 50000 {
		cachedDB.RequestLogs = cachedDB.RequestLogs[len(cachedDB.RequestLogs)-50000:]
	}
	now := time.Now().UTC()
	if lastStatePersistTime.IsZero() || now.Sub(lastStatePersistTime) >= statePersistInterval {
		if err := persistStateLocked(context.Background(), cachedDB); err != nil {
			log.Printf("[STORE] persist state failed: %v", err)
		}
		lastStatePersistTime = now
	}
	mu.Unlock()

	if err := appendFileRequestLog(item); err != nil {
		log.Printf("[STORE] append file request log failed: %v", err)
	}
	pruneFileRequestLogsIfDue(requestLogCutoff())
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
	if len(result) == 0 && len(db.RequestLogs) == 0 {
		if items, err := queryFileRequestLogs(since, userID, limit); err == nil {
			return items
		} else {
			log.Printf("[STORE] query file request logs failed: %v", err)
		}
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

	if item, ok, err := findFileRequestLog(id, userID); err == nil {
		if ok {
			return item, true
		}
	} else {
		log.Printf("[STORE] find file request log failed: %v", err)
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

func migrateFileRequestLogs(items []models.RequestLog) error {
	if len(items) == 0 {
		return nil
	}
	requestLogMu.Lock()
	defer requestLogMu.Unlock()
	for _, item := range items {
		if item.ID == "" {
			continue
		}
		if err := appendFileRequestLogLocked(item); err != nil {
			return err
		}
	}
	lastFileRequestLogPrune = time.Time{}
	return pruneFileRequestLogsLocked(requestLogCutoff())
}

func appendFileRequestLog(item models.RequestLog) error {
	if item.ID == "" {
		return nil
	}
	requestLogMu.Lock()
	defer requestLogMu.Unlock()
	return appendFileRequestLogLocked(item)
}

func appendFileRequestLogLocked(item models.RequestLog) error {
	filePath := RequestLogFilePath()
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return err
	}
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	if _, err := f.Write(raw); err != nil {
		return err
	}
	_, err = f.Write([]byte("\n"))
	return err
}

func queryFileRequestLogs(since time.Time, userID string, limit int) ([]models.RequestLog, error) {
	requestLogMu.Lock()
	defer requestLogMu.Unlock()
	if limit > 0 {
		return readRecentFileRequestLogsLocked(since, userID, limit)
	}
	items, err := readFileRequestLogsLocked(func(item models.RequestLog) bool {
		if userID != "" && item.UserID != userID {
			return false
		}
		return requestLogAtOrAfter(item, since)
	}, true)
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(items) > limit {
		items = items[len(items)-limit:]
	}
	return items, nil
}

func readRecentFileRequestLogsLocked(since time.Time, userID string, limit int) ([]models.RequestLog, error) {
	filePath := RequestLogFilePath()
	f, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []models.RequestLog{}, nil
		}
		return nil, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	offset := info.Size()
	if offset == 0 {
		return []models.RequestLog{}, nil
	}

	const chunkSize int64 = 1024 * 1024
	result := make([]models.RequestLog, 0, min(limit, 256))
	remainder := []byte{}
	shouldStop := false
	scanned := int64(0)

	for offset > 0 && len(result) < limit && !shouldStop && scanned < recentFileRequestLogMaxScan {
		readSize := chunkSize
		if offset < readSize {
			readSize = offset
		}
		if remaining := recentFileRequestLogMaxScan - scanned; remaining < readSize {
			readSize = remaining
		}
		offset -= readSize
		scanned += readSize

		chunk := make([]byte, readSize)
		if _, err := f.ReadAt(chunk, offset); err != nil && err != io.EOF {
			return nil, err
		}
		if len(remainder) > 0 {
			chunk = append(chunk, remainder...)
			remainder = nil
		}

		start := 0
		if offset > 0 {
			if idx := bytes.IndexByte(chunk, '\n'); idx >= 0 {
				remainder = append(remainder[:0], chunk[:idx+1]...)
				start = idx + 1
			} else {
				remainder = append(remainder[:0], chunk...)
				continue
			}
		}

		lines := bytes.Split(chunk[start:], []byte{'\n'})
		for i := len(lines) - 1; i >= 0; i-- {
			if len(result) >= limit {
				break
			}
			trimmed := bytes.TrimSpace(lines[i])
			if len(trimmed) == 0 {
				continue
			}

			item, jsonErr := unmarshalRequestLogSummaryLine(trimmed)
			if jsonErr != nil {
				continue
			}
			if !requestLogAtOrAfter(item, since) {
				shouldStop = true
				break
			}
			if userID != "" && item.UserID != userID {
				continue
			}
			result = append(result, requestLogForList(item))
		}
	}

	if offset == 0 && len(remainder) > 0 && len(result) < limit && !shouldStop {
		trimmed := bytes.TrimSpace(remainder)
		if len(trimmed) > 0 {
			item, jsonErr := unmarshalRequestLogSummaryLine(trimmed)
			if jsonErr == nil && requestLogAtOrAfter(item, since) {
				if userID == "" || item.UserID == userID {
					result = append(result, requestLogForList(item))
				}
			}
		}
	}

	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result, nil
}

func unmarshalRequestLogSummaryLine(line []byte) (models.RequestLog, error) {
	type requestLogSummary struct {
		ID                  string                      `json:"id"`
		UserID              string                      `json:"userId"`
		UserName            string                      `json:"userName"`
		Username            string                      `json:"username"`
		APIKeyID            string                      `json:"apiKeyId"`
		APIKeyName          string                      `json:"apiKeyName"`
		APIKeyPreview       string                      `json:"apiKeyPreview"`
		ProviderID          string                      `json:"providerId"`
		ProviderName        string                      `json:"providerName"`
		Model               string                      `json:"model"`
		UpstreamModel       string                      `json:"upstreamModel"`
		Endpoint            string                      `json:"endpoint"`
		Method              string                      `json:"method"`
		Status              int                         `json:"status"`
		OK                  bool                        `json:"ok"`
		Stream              bool                        `json:"stream"`
		DurationMs          int                         `json:"durationMs"`
		PromptTokens        int                         `json:"promptTokens"`
		CompletionTokens    int                         `json:"completionTokens"`
		TotalTokens         int                         `json:"totalTokens"`
		CachedTokens        int                         `json:"cachedTokens"`
		CacheCreationTokens int                         `json:"cacheCreationTokens"`
		CacheMissTokens     int                         `json:"cacheMissTokens"`
		ReasoningTokens     int                         `json:"reasoningTokens"`
		ErrorCode           string                      `json:"errorCode"`
		ErrorMessage        string                      `json:"errorMessage"`
		ClientIPInfo        *models.RequestClientIPInfo `json:"clientIpInfo,omitempty"`
		ClientDevice        *models.RequestClientDevice `json:"clientDevice,omitempty"`
		HasRequestContent   bool                        `json:"hasRequestContent,omitempty"`
		Timestamp           string                      `json:"timestamp"`
	}

	var summary requestLogSummary
	if err := json.Unmarshal(line, &summary); err != nil {
		return models.RequestLog{}, err
	}
	return models.RequestLog{
		ID:                  summary.ID,
		UserID:              summary.UserID,
		UserName:            summary.UserName,
		Username:            summary.Username,
		APIKeyID:            summary.APIKeyID,
		APIKeyName:          summary.APIKeyName,
		APIKeyPreview:       summary.APIKeyPreview,
		ProviderID:          summary.ProviderID,
		ProviderName:        summary.ProviderName,
		Model:               summary.Model,
		UpstreamModel:       summary.UpstreamModel,
		Endpoint:            summary.Endpoint,
		Method:              summary.Method,
		Status:              summary.Status,
		OK:                  summary.OK,
		Stream:              summary.Stream,
		DurationMs:          summary.DurationMs,
		PromptTokens:        summary.PromptTokens,
		CompletionTokens:    summary.CompletionTokens,
		TotalTokens:         summary.TotalTokens,
		CachedTokens:        summary.CachedTokens,
		CacheCreationTokens: summary.CacheCreationTokens,
		CacheMissTokens:     summary.CacheMissTokens,
		ReasoningTokens:     summary.ReasoningTokens,
		ErrorCode:           summary.ErrorCode,
		ErrorMessage:        summary.ErrorMessage,
		ClientIPInfo:        summary.ClientIPInfo,
		ClientDevice:        summary.ClientDevice,
		HasRequestContent:   summary.HasRequestContent || bytes.Contains(line, []byte(`"requestContent"`)),
		Timestamp:           summary.Timestamp,
	}, nil
}

func findFileRequestLog(id, userID string) (*models.RequestLog, bool, error) {
	requestLogMu.Lock()
	defer requestLogMu.Unlock()
	var found *models.RequestLog
	_, err := readFileRequestLogsLocked(func(item models.RequestLog) bool {
		if item.ID != id {
			return false
		}
		if userID != "" && item.UserID != userID {
			return false
		}
		cloned := cloneRequestLog(item)
		found = &cloned
		return false
	}, false)
	if err != nil {
		return nil, false, err
	}
	return found, found != nil, nil
}

func deleteFileRequestLogsByUser(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return nil
	}

	requestLogMu.Lock()
	defer requestLogMu.Unlock()

	filePath := RequestLogFilePath()
	input, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer input.Close()

	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return err
	}
	tempFile := filePath + ".tmp"
	output, err := os.OpenFile(tempFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}

	reader := bufio.NewReaderSize(input, 1024*1024)
	writer := bufio.NewWriterSize(output, 1024*1024)
	for {
		line, readErr := reader.ReadBytes('\n')
		trimmed := bytes.TrimSpace(line)
		if len(trimmed) > 0 {
			keep := true
			var item models.RequestLog
			if jsonErr := json.Unmarshal(trimmed, &item); jsonErr == nil && item.UserID == userID {
				keep = false
			}
			if keep {
				if _, err := writer.Write(trimmed); err != nil {
					output.Close()
					return err
				}
				if err := writer.WriteByte('\n'); err != nil {
					output.Close()
					return err
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			output.Close()
			return readErr
		}
	}
	if err := writer.Flush(); err != nil {
		output.Close()
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	input.Close()
	return os.Rename(tempFile, filePath)
}

func readFileRequestLogsLocked(keep func(models.RequestLog) bool, forList bool) ([]models.RequestLog, error) {
	filePath := RequestLogFilePath()
	f, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []models.RequestLog{}, nil
		}
		return nil, err
	}
	defer f.Close()

	result := make([]models.RequestLog, 0)
	reader := bufio.NewReaderSize(f, 1024*1024)
	for {
		line, err := reader.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			var item models.RequestLog
			if jsonErr := json.Unmarshal(bytes.TrimSpace(line), &item); jsonErr == nil && keep(item) {
				if forList {
					item = requestLogForList(item)
				}
				result = append(result, item)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp < result[j].Timestamp
	})
	return result, nil
}

func pruneFileRequestLogsIfDue(cutoff time.Time) {
	now := time.Now().UTC()
	requestLogMu.Lock()
	defer requestLogMu.Unlock()
	if now.Sub(lastFileRequestLogPrune) < fileRequestLogPruneInterval {
		return
	}
	lastFileRequestLogPrune = now
	if err := pruneFileRequestLogsLocked(cutoff); err != nil {
		log.Printf("[STORE] prune file request logs failed: %v", err)
	}
}

func pruneFileRequestLogsLocked(cutoff time.Time) error {
	filePath := RequestLogFilePath()
	input, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer input.Close()

	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return err
	}
	tempFile := filePath + ".tmp"
	output, err := os.OpenFile(tempFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}

	reader := bufio.NewReaderSize(input, 1024*1024)
	writer := bufio.NewWriterSize(output, 1024*1024)
	expired := make([]models.RequestLog, 0)
	for {
		line, readErr := reader.ReadBytes('\n')
		trimmed := bytes.TrimSpace(line)
		if len(trimmed) > 0 {
			var item models.RequestLog
			if jsonErr := json.Unmarshal(trimmed, &item); jsonErr == nil {
				if requestLogAtOrAfter(item, cutoff) {
					if _, err := writer.Write(trimmed); err != nil {
						output.Close()
						return err
					}
					if err := writer.WriteByte('\n'); err != nil {
						output.Close()
						return err
					}
				} else {
					expired = append(expired, item)
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			output.Close()
			return readErr
		}
	}
	if err := writer.Flush(); err != nil {
		output.Close()
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	if err := input.Close(); err != nil {
		return err
	}
	if len(expired) > 0 {
		if err := writeRequestLogArchive(expired, "expired"); err != nil {
			log.Printf("[STORE] archive expired request logs failed: %v", err)
		}
	}
	return os.Rename(tempFile, filePath)
}

func WriteRequestLogsTarGZ(w io.Writer, logs []models.RequestLog, meta map[string]interface{}) error {
	gz := gzip.NewWriter(w)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	if meta == nil {
		meta = map[string]interface{}{}
	}
	meta["requestLogCount"] = len(logs)
	metaRaw, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	if err := writeTarFile(tw, "metadata.json", metaRaw); err != nil {
		return err
	}

	var jsonl bytes.Buffer
	enc := json.NewEncoder(&jsonl)
	for _, item := range logs {
		if err := enc.Encode(item); err != nil {
			return err
		}
	}
	return writeTarFile(tw, "request-logs.jsonl", jsonl.Bytes())
}

func writeRequestLogArchive(logs []models.RequestLog, reason string) error {
	if len(logs) == 0 {
		return nil
	}
	archiveDir := RequestLogArchiveDir()
	if err := os.MkdirAll(archiveDir, 0755); err != nil {
		return err
	}
	name := fmt.Sprintf("sapi-request-logs-%s-%s.tar.gz", reason, time.Now().UTC().Format("20060102-150405"))
	path := filepath.Join(archiveDir, name)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	return WriteRequestLogsTarGZ(f, logs, map[string]interface{}{
		"archivedAt": time.Now().UTC().Format(time.RFC3339),
		"reason":     reason,
	})
}

func writeTarFile(tw *tar.Writer, name string, data []byte) error {
	header := &tar.Header{
		Name:    name,
		Mode:    0644,
		Size:    int64(len(data)),
		ModTime: time.Now().UTC(),
	}
	if err := tw.WriteHeader(header); err != nil {
		return err
	}
	_, err := tw.Write(data)
	return err
}

func requestLogAtOrAfter(item models.RequestLog, cutoff time.Time) bool {
	if item.Timestamp == "" {
		return true
	}
	if ts, err := time.Parse(time.RFC3339, item.Timestamp); err == nil {
		return !ts.Before(cutoff.UTC())
	}
	if ts, err := time.Parse("2006-01-02T15:04:05.000Z", item.Timestamp); err == nil {
		return !ts.Before(cutoff.UTC())
	}
	return item.Timestamp >= cutoff.UTC().Format(time.RFC3339)
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

func removeUserAccountFromDB(db *models.Database, userID string) bool {
	if db == nil || userID == "" {
		return false
	}

	removed := false
	users := make([]models.User, 0, len(db.Users))
	for _, user := range db.Users {
		if user.ID == userID {
			removed = true
			continue
		}
		users = append(users, user)
	}
	if !removed {
		return false
	}
	db.Users = users

	for i := range db.InvitationCodes {
		uses := make([]models.InvitationCodeUse, 0, len(db.InvitationCodes[i].UsedBy))
		for _, use := range db.InvitationCodes[i].UsedBy {
			if use.UserID != userID {
				uses = append(uses, use)
			}
		}
		db.InvitationCodes[i].UsedBy = uses
		db.InvitationCodes[i].UsedCount = len(uses)
	}

	suggestions := make([]models.Suggestion, 0, len(db.Suggestions))
	for _, suggestion := range db.Suggestions {
		if suggestion.UserID != userID {
			suggestions = append(suggestions, suggestion)
		}
	}
	db.Suggestions = suggestions

	logs := make([]models.RequestLog, 0, len(db.RequestLogs))
	for _, item := range db.RequestLogs {
		if item.UserID != userID {
			logs = append(logs, item)
		}
	}
	db.RequestLogs = logs

	return true
}

func newDefaultDB() *models.Database {
	createdAt := Now()
	return &models.Database{
		Version:       1,
		AppSecret:     auth.RandomSecret(),
		Providers:     []models.Provider{},
		Users:         []models.User{},
		TokenUsage:    []interface{}{},
		RequestLogs:   []models.RequestLog{},
		AdminPasskeys: []models.AdminPasskey{},
		CreatedAt:     createdAt,
		UpdatedAt:     createdAt,
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
	if db.AdminPasskeys == nil {
		db.AdminPasskeys = []models.AdminPasskey{}
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
	if len(db.SiteEmails) == 0 && db.SiteEmail != "" {
		db.SiteEmails = []string{db.SiteEmail}
		changed = true
	}
	if len(db.SiteEmails) > 0 && db.SiteEmail != db.SiteEmails[0] {
		db.SiteEmail = db.SiteEmails[0]
		changed = true
	}
	if db.DefaultRPMLimit == 0 {
		db.DefaultRPMLimit = 30
		changed = true
	}
	if db.SiteBanner == nil {
		db.SiteBanner = &models.SiteBanner{}
		changed = true
	}

	for i := range db.AdminAPIKeys {
		if normalizeAPIKeyBanState(&db.AdminAPIKeys[i]) {
			changed = true
		}
	}

	for i := range db.Providers {
		p := &db.Providers[i]
		normalizedFormat := models.NormalizeUpstreamFormat(p.UpstreamFormat)
		if p.UpstreamFormat != normalizedFormat {
			p.UpstreamFormat = normalizedFormat
			changed = true
		}
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
		hadStoredSubscriptionTier := subscription.IsValidTier(u.SubscriptionTier)
		normalizedTier := subscription.NormalizeTier(u.SubscriptionTier)
		if u.SubscriptionTier != normalizedTier {
			u.SubscriptionTier = normalizedTier
			changed = true
		}
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
			if !hadStoredSubscriptionTier && isLegacyDefaultKeyRPMForUser(k.RPMLimit, u) {
				k.RPMLimit = 0
				itemChanged = true
			}
			if normalizeAPIKeyBanState(&k) {
				itemChanged = true
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

func normalizeAPIKeyBanState(k *models.APIKeyRecord) bool {
	if k == nil {
		return false
	}
	changed := false
	now := time.Now().UTC()
	if k.BannedUntil != "" {
		if bannedUntil, ok := parseStoredTime(k.BannedUntil); !ok || !bannedUntil.After(now) {
			k.BannedUntil = ""
			k.BanReason = ""
			k.InvalidRequestCount = 0
			k.LastInvalidRequestAt = ""
			changed = true
		}
	}
	if k.BannedUntil == "" && k.InvalidRequestCount > 0 && k.LastInvalidRequestAt != "" {
		if lastInvalidAt, ok := parseStoredTime(k.LastInvalidRequestAt); !ok || now.Sub(lastInvalidAt) > time.Hour {
			k.InvalidRequestCount = 0
			k.LastInvalidRequestAt = ""
			changed = true
		}
	}
	return changed
}

func parseStoredTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

func isLegacyDefaultKeyRPMForUser(value int, user *models.User) bool {
	if value == 30 {
		return true
	}
	if value != 100 || user == nil {
		return false
	}
	if user.Source == "github" || user.GitHubID != "" {
		return true
	}
	return false
}

func RedactProvider(p models.Provider) map[string]interface{} {
	result := map[string]interface{}{
		"id":                p.ID,
		"name":              p.Name,
		"baseUrl":           p.BaseURL,
		"upstreamFormat":    models.NormalizeUpstreamFormat(p.UpstreamFormat),
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
