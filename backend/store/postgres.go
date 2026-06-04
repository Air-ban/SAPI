package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"sapi/config"
	"sapi/models"
)

var pgPool *pgxpool.Pool

func initPostgres(ctx context.Context, cfg *config.Config) error {
	poolCfg, err := pgxpool.ParseConfig(cfg.PostgresURL)
	if err != nil {
		return fmt.Errorf("parse postgres url: %w", err)
	}
	if cfg.PostgresMaxConns > 0 {
		poolCfg.MaxConns = int32(cfg.PostgresMaxConns)
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return fmt.Errorf("ping postgres: %w", err)
	}
	if err := migratePostgres(ctx, pool); err != nil {
		pool.Close()
		return err
	}

	if pgPool != nil {
		pgPool.Close()
	}
	pgPool = pool
	return nil
}

func migratePostgres(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS sapi_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sapi_request_logs (
  id text PRIMARY KEY,
  user_id text NOT NULL DEFAULT '',
  user_name text NOT NULL DEFAULT '',
  username text NOT NULL DEFAULT '',
  api_key_id text NOT NULL DEFAULT '',
  api_key_name text NOT NULL DEFAULT '',
  api_key_preview text NOT NULL DEFAULT '',
  provider_id text NOT NULL DEFAULT '',
  provider_name text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  upstream_model text NOT NULL DEFAULT '',
  endpoint text NOT NULL DEFAULT '',
  method text NOT NULL DEFAULT '',
  status integer NOT NULL DEFAULT 0,
  ok boolean NOT NULL DEFAULT false,
  stream boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  cache_creation_tokens integer NOT NULL DEFAULT 0,
  cache_miss_tokens integer NOT NULL DEFAULT 0,
  reasoning_tokens integer NOT NULL DEFAULT 0,
  error_code text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sapi_request_logs_timestamp_idx ON sapi_request_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS sapi_request_logs_user_timestamp_idx ON sapi_request_logs (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS sapi_request_logs_api_key_idx ON sapi_request_logs (api_key_id, timestamp DESC);
`)
	if err != nil {
		return fmt.Errorf("migrate postgres: %w", err)
	}
	return nil
}

func closePostgres() {
	if pgPool != nil {
		pgPool.Close()
		pgPool = nil
	}
}

func postgresEnabled() bool {
	return pgPool != nil
}

func postgresHealth(ctx context.Context) map[string]interface{} {
	if pgPool == nil {
		return map[string]interface{}{"enabled": false, "status": "disabled"}
	}
	pingCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err := pgPool.Ping(pingCtx); err != nil {
		return map[string]interface{}{"enabled": true, "status": "degraded", "error": err.Error()}
	}
	stat := pgPool.Stat()
	return map[string]interface{}{
		"enabled":       true,
		"status":        "ok",
		"acquiredConns": stat.AcquiredConns(),
		"idleConns":     stat.IdleConns(),
		"totalConns":    stat.TotalConns(),
	}
}

func loadPostgresState(ctx context.Context) (*models.Database, bool, error) {
	if pgPool == nil {
		return nil, false, nil
	}

	var raw []byte
	err := pgPool.QueryRow(ctx, `SELECT payload FROM sapi_state WHERE id = 'main'`).Scan(&raw)
	if err == pgx.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	var db models.Database
	if err := json.Unmarshal(raw, &db); err != nil {
		return nil, false, err
	}
	return &db, true, nil
}

func savePostgresState(ctx context.Context, db *models.Database) error {
	if pgPool == nil {
		return nil
	}

	state := cloneDatabase(db)
	state.RequestLogs = nil
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}

	_, err = pgPool.Exec(ctx, `
INSERT INTO sapi_state (id, payload, updated_at)
VALUES ('main', $1::jsonb, now())
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
`, raw)
	return err
}

func insertPostgresRequestLog(ctx context.Context, item models.RequestLog) error {
	if pgPool == nil {
		return nil
	}

	ts, err := time.Parse(time.RFC3339, item.Timestamp)
	if err != nil {
		ts, err = time.Parse("2006-01-02T15:04:05.000Z", item.Timestamp)
	}
	if err != nil {
		ts = time.Now().UTC()
	}

	_, err = pgPool.Exec(ctx, `
INSERT INTO sapi_request_logs (
  id, user_id, user_name, username, api_key_id, api_key_name, api_key_preview,
  provider_id, provider_name, model, upstream_model, endpoint, method, status,
  ok, stream, duration_ms, prompt_tokens, completion_tokens, total_tokens,
  cached_tokens, cache_creation_tokens, cache_miss_tokens, reasoning_tokens,
  error_code, error_message, timestamp
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
  $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
)
ON CONFLICT (id) DO NOTHING
`, item.ID, item.UserID, item.UserName, item.Username, item.APIKeyID, item.APIKeyName, item.APIKeyPreview,
		item.ProviderID, item.ProviderName, item.Model, item.UpstreamModel, item.Endpoint, item.Method, item.Status,
		item.OK, item.Stream, item.DurationMs, item.PromptTokens, item.CompletionTokens, item.TotalTokens,
		item.CachedTokens, item.CacheCreationTokens, item.CacheMissTokens, item.ReasoningTokens,
		item.ErrorCode, item.ErrorMessage, ts)
	return err
}

func queryPostgresRequestLogs(ctx context.Context, since time.Time, userID string, limit int) ([]models.RequestLog, error) {
	if pgPool == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50000
	}

	query := `
SELECT id, user_id, user_name, username, api_key_id, api_key_name, api_key_preview,
  provider_id, provider_name, model, upstream_model, endpoint, method, status,
  ok, stream, duration_ms, prompt_tokens, completion_tokens, total_tokens,
  cached_tokens, cache_creation_tokens, cache_miss_tokens, reasoning_tokens,
  error_code, error_message, timestamp
FROM sapi_request_logs
WHERE timestamp >= $1`
	args := []interface{}{since}
	if userID != "" {
		query += ` AND user_id = $2`
		args = append(args, userID)
	}
	query += ` ORDER BY timestamp ASC LIMIT `
	query += fmt.Sprintf("%d", limit)

	rows, err := pgPool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]models.RequestLog, 0)
	for rows.Next() {
		var item models.RequestLog
		var ts time.Time
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.UserName, &item.Username, &item.APIKeyID, &item.APIKeyName, &item.APIKeyPreview,
			&item.ProviderID, &item.ProviderName, &item.Model, &item.UpstreamModel, &item.Endpoint, &item.Method, &item.Status,
			&item.OK, &item.Stream, &item.DurationMs, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens,
			&item.CachedTokens, &item.CacheCreationTokens, &item.CacheMissTokens, &item.ReasoningTokens,
			&item.ErrorCode, &item.ErrorMessage, &ts,
		); err != nil {
			return nil, err
		}
		item.Timestamp = ts.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}
