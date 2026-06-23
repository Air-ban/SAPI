package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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

CREATE TABLE IF NOT EXISTS sapi_app_config (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  app_secret text NOT NULL,
  site_email text NOT NULL DEFAULT '',
  default_rpm_limit integer NOT NULL DEFAULT 30,
  registration_disabled boolean NOT NULL DEFAULT false,
  maintenance_mode boolean NOT NULL DEFAULT false,
  maintenance_end_time text NOT NULL DEFAULT '',
  show_only_available_models boolean NOT NULL DEFAULT false,
  billing_enabled boolean NOT NULL DEFAULT true,
  billing_currency text NOT NULL DEFAULT 'CNY',
  billing_usd_to_cny_rate double precision NOT NULL DEFAULT 7.2,
  billing_markup_multiplier double precision NOT NULL DEFAULT 1,
  billing_models_dev_url text NOT NULL DEFAULT 'https://models.dev/api.json',
  billing_last_price_sync_at text NOT NULL DEFAULT '',
  payment_enabled boolean NOT NULL DEFAULT false,
  payment_provider text NOT NULL DEFAULT 'ezfpy',
  payment_gateway_url text NOT NULL DEFAULT 'https://www.ezfpy.cn/submit.php',
  payment_mapi_url text NOT NULL DEFAULT 'https://www.ezfpy.cn/mapi.php',
  payment_merchant_id text NOT NULL DEFAULT '',
  payment_merchant_key text NOT NULL DEFAULT '',
  payment_software_key text NOT NULL DEFAULT '',
  payment_site_name text NOT NULL DEFAULT 'SAPI',
  payment_notify_url text NOT NULL DEFAULT '',
  payment_return_url text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_smtp_config (
  app_id text PRIMARY KEY REFERENCES sapi_app_config(id) ON DELETE CASCADE,
  host text NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 587,
  secure boolean NOT NULL DEFAULT false,
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  from_addr text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_site_emails (
  app_id text NOT NULL REFERENCES sapi_app_config(id) ON DELETE CASCADE,
  position integer NOT NULL,
  email text NOT NULL,
  PRIMARY KEY (app_id, position),
  UNIQUE (app_id, email)
);

CREATE TABLE IF NOT EXISTS sapi_site_banner (
  app_id text PRIMARY KEY REFERENCES sapi_app_config(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_payment_allowed_types (
  app_id text NOT NULL REFERENCES sapi_app_config(id) ON DELETE CASCADE,
  position integer NOT NULL,
  pay_type text NOT NULL,
  PRIMARY KEY (app_id, position)
);

CREATE TABLE IF NOT EXISTS sapi_subscription_plans (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  rpm_limit integer NOT NULL DEFAULT 0,
  price_cents integer NOT NULL DEFAULT 0,
  credit_microunits bigint NOT NULL DEFAULT 0,
  duration_days integer NOT NULL DEFAULT 30,
  model_provider_routes jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sapi_model_prices (
  model_id text PRIMARY KEY,
  display_name text NOT NULL DEFAULT '',
  provider_id text NOT NULL DEFAULT '',
  input_usd_per_million_tokens double precision NOT NULL DEFAULT 0,
  output_usd_per_million_tokens double precision NOT NULL DEFAULT 0,
  cache_read_usd_per_million_tokens double precision NOT NULL DEFAULT 0,
  cache_write_usd_per_million_tokens double precision NOT NULL DEFAULT 0,
  reasoning_usd_per_million_tokens double precision NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT '',
  manual boolean NOT NULL DEFAULT false,
  updated_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_payment_orders (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  user_id text NOT NULL DEFAULT '',
  username text NOT NULL DEFAULT '',
  subscription_tier text NOT NULL DEFAULT '',
  plan_name text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL DEFAULT 0,
  credit_microunits bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'CNY',
  provider text NOT NULL DEFAULT 'ezfpy',
  pay_type text NOT NULL DEFAULT '',
  out_trade_no text NOT NULL DEFAULT '',
  trade_no text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT '',
  paid_at text NOT NULL DEFAULT '',
  expires_at text NOT NULL DEFAULT '',
  raw_notify jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (out_trade_no)
);

CREATE TABLE IF NOT EXISTS sapi_providers (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  base_url text NOT NULL,
  api_key text NOT NULL,
  upstream_format text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  enabled boolean NOT NULL,
  failover_threshold integer NOT NULL,
  priority integer NOT NULL,
  health_status text NOT NULL,
  latency integer NOT NULL,
  ping integer NOT NULL,
  availability_7d double precision NOT NULL,
  last_health_check text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_provider_models (
  provider_id text NOT NULL REFERENCES sapi_providers(id) ON DELETE CASCADE,
  position integer NOT NULL,
  model_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  PRIMARY KEY (provider_id, position)
);

CREATE TABLE IF NOT EXISTS sapi_provider_model_cli_support (
  provider_id text NOT NULL,
  model_position integer NOT NULL,
  position integer NOT NULL,
  cli_support text NOT NULL,
  PRIMARY KEY (provider_id, model_position, position),
  FOREIGN KEY (provider_id, model_position) REFERENCES sapi_provider_models(provider_id, position) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sapi_provider_model_mappings (
  provider_id text NOT NULL REFERENCES sapi_providers(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  upstream_model text NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS sapi_provider_health_history (
  provider_id text NOT NULL REFERENCES sapi_providers(id) ON DELETE CASCADE,
  position integer NOT NULL,
  timestamp text NOT NULL,
  status text NOT NULL,
  latency integer NOT NULL,
  PRIMARY KEY (provider_id, position)
);

CREATE TABLE IF NOT EXISTS sapi_users (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  username text NOT NULL,
  email text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  password_hash text NOT NULL DEFAULT '',
  enabled boolean NOT NULL,
  receive_announcement_email boolean NOT NULL,
  source text NOT NULL DEFAULT '',
  github_id text NOT NULL DEFAULT '',
  github_login text NOT NULL DEFAULT '',
  github_avatar_url text NOT NULL DEFAULT '',
  github_linked_at text NOT NULL DEFAULT '',
  subscription_tier text NOT NULL DEFAULT '',
  subscription_expires_at text NOT NULL DEFAULT '',
  credit_balance_microunits bigint NOT NULL DEFAULT 0,
  credit_used_microunits bigint NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS sapi_users_username_unique_idx ON sapi_users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS sapi_users_email_unique_idx ON sapi_users (lower(email)) WHERE email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS sapi_users_github_id_unique_idx ON sapi_users (github_id) WHERE github_id <> '';

CREATE TABLE IF NOT EXISTS sapi_user_api_keys (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES sapi_users(id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL,
  key_value text NOT NULL,
  enabled boolean NOT NULL,
  rpm_limit integer NOT NULL DEFAULT 0,
  banned_until text NOT NULL DEFAULT '',
  ban_reason text NOT NULL DEFAULT '',
  invalid_request_count integer NOT NULL DEFAULT 0,
  last_invalid_request_at text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT '',
  last_used_at text NOT NULL DEFAULT '',
  UNIQUE (user_id, position),
  UNIQUE (key_value)
);

CREATE TABLE IF NOT EXISTS sapi_user_api_key_allowed_models (
  api_key_id text NOT NULL REFERENCES sapi_user_api_keys(id) ON DELETE CASCADE,
  position integer NOT NULL,
  model_id text NOT NULL,
  PRIMARY KEY (api_key_id, position)
);

CREATE TABLE IF NOT EXISTS sapi_admin_api_keys (
  id text PRIMARY KEY,
  position integer NOT NULL UNIQUE,
  name text NOT NULL,
  key_value text NOT NULL,
  enabled boolean NOT NULL,
  rpm_limit integer NOT NULL DEFAULT 0,
  banned_until text NOT NULL DEFAULT '',
  ban_reason text NOT NULL DEFAULT '',
  invalid_request_count integer NOT NULL DEFAULT 0,
  last_invalid_request_at text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT '',
  last_used_at text NOT NULL DEFAULT '',
  UNIQUE (key_value)
);

CREATE TABLE IF NOT EXISTS sapi_admin_api_key_allowed_models (
  api_key_id text NOT NULL REFERENCES sapi_admin_api_keys(id) ON DELETE CASCADE,
  position integer NOT NULL,
  model_id text NOT NULL,
  PRIMARY KEY (api_key_id, position)
);

CREATE TABLE IF NOT EXISTS sapi_invitation_codes (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  code text NOT NULL UNIQUE,
  note text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT '',
  expires_at text NOT NULL DEFAULT '',
  max_uses integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sapi_invitation_code_uses (
  invitation_id text NOT NULL REFERENCES sapi_invitation_codes(id) ON DELETE CASCADE,
  position integer NOT NULL,
  user_id text NOT NULL,
  used_at text NOT NULL,
  PRIMARY KEY (invitation_id, position)
);

CREATE TABLE IF NOT EXISTS sapi_verification_codes (
  position integer PRIMARY KEY,
  email text NOT NULL,
  code text NOT NULL,
  purpose text NOT NULL,
  created_at text NOT NULL,
  used boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sapi_admin_passkeys (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  credential jsonb NOT NULL,
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT '',
  last_used_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_announcements (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  content text NOT NULL,
  type text NOT NULL,
  enabled boolean NOT NULL,
  send_email boolean NOT NULL,
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_suggestions (
  id text PRIMARY KEY,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  content text NOT NULL,
  contact text NOT NULL DEFAULT '',
  user_id text NOT NULL DEFAULT '',
  user_name text NOT NULL DEFAULT '',
  reply text NOT NULL DEFAULT '',
  replied_at text NOT NULL DEFAULT '',
  replied_by text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sapi_token_usage (
  position integer PRIMARY KEY,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS sapi_documents (
  position integer PRIMARY KEY,
  payload jsonb NOT NULL
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
  cost_usd double precision NOT NULL DEFAULT 0,
  cost_cny double precision NOT NULL DEFAULT 0,
  billable_microunits bigint NOT NULL DEFAULT 0,
  error_code text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  client_ip_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_device jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sapi_request_logs ADD COLUMN IF NOT EXISTS client_ip_info jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sapi_request_logs ADD COLUMN IF NOT EXISTS client_device jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sapi_request_logs ADD COLUMN IF NOT EXISTS request_content jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sapi_request_logs ADD COLUMN IF NOT EXISTS cost_usd double precision NOT NULL DEFAULT 0;
ALTER TABLE sapi_request_logs ADD COLUMN IF NOT EXISTS cost_cny double precision NOT NULL DEFAULT 0;
ALTER TABLE sapi_request_logs ADD COLUMN IF NOT EXISTS billable_microunits bigint NOT NULL DEFAULT 0;
ALTER TABLE sapi_subscription_plans ADD COLUMN IF NOT EXISTS model_provider_routes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS registration_disabled boolean NOT NULL DEFAULT false;
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS billing_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS billing_currency text NOT NULL DEFAULT 'CNY';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS billing_usd_to_cny_rate double precision NOT NULL DEFAULT 7.2;
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS billing_markup_multiplier double precision NOT NULL DEFAULT 1;
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS billing_models_dev_url text NOT NULL DEFAULT 'https://models.dev/api.json';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS billing_last_price_sync_at text NOT NULL DEFAULT '';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'ezfpy';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_gateway_url text NOT NULL DEFAULT 'https://www.ezfpy.cn/submit.php';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_mapi_url text NOT NULL DEFAULT 'https://www.ezfpy.cn/mapi.php';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_merchant_id text NOT NULL DEFAULT '';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_merchant_key text NOT NULL DEFAULT '';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_software_key text NOT NULL DEFAULT '';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_site_name text NOT NULL DEFAULT 'SAPI';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_notify_url text NOT NULL DEFAULT '';
ALTER TABLE sapi_app_config ADD COLUMN IF NOT EXISTS payment_return_url text NOT NULL DEFAULT '';
ALTER TABLE sapi_providers ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE sapi_providers ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '';
ALTER TABLE sapi_users ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE sapi_users ADD COLUMN IF NOT EXISTS subscription_expires_at text NOT NULL DEFAULT '';
ALTER TABLE sapi_users ADD COLUMN IF NOT EXISTS credit_balance_microunits bigint NOT NULL DEFAULT 0;
ALTER TABLE sapi_users ADD COLUMN IF NOT EXISTS credit_used_microunits bigint NOT NULL DEFAULT 0;
ALTER TABLE sapi_invitation_codes ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE sapi_admin_passkeys ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE sapi_announcements ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE sapi_suggestions ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

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

	if db, ok, err := loadPostgresNormalizedState(ctx, pgPool); err != nil || ok {
		return db, ok, err
	}

	db, ok, err := loadPostgresLegacyState(ctx, pgPool)
	if err != nil || !ok {
		return db, ok, err
	}
	if err := savePostgresNormalizedState(ctx, db); err != nil {
		return nil, false, err
	}
	return db, true, nil
}

func savePostgresState(ctx context.Context, db *models.Database) error {
	if pgPool == nil {
		return nil
	}
	return savePostgresNormalizedState(ctx, db)
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
	requestContent := item.RequestContent
	if requestContent == nil {
		requestContent = map[string]interface{}{}
	}
	requestContentRaw, err := json.Marshal(requestContent)
	if err != nil {
		requestContentRaw = []byte(`{}`)
	}
	clientIPInfo := item.ClientIPInfo
	clientIPInfoRaw := []byte(`{}`)
	if clientIPInfo != nil {
		if raw, err := json.Marshal(clientIPInfo); err == nil {
			clientIPInfoRaw = raw
		}
	}
	clientDevice := item.ClientDevice
	clientDeviceRaw := []byte(`{}`)
	if clientDevice != nil {
		if raw, err := json.Marshal(clientDevice); err == nil {
			clientDeviceRaw = raw
		}
	}

	tx, err := pgPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
INSERT INTO sapi_request_logs (
  id, user_id, user_name, username, api_key_id, api_key_name, api_key_preview,
  provider_id, provider_name, model, upstream_model, endpoint, method, status,
  ok, stream, duration_ms, prompt_tokens, completion_tokens, total_tokens,
  cached_tokens, cache_creation_tokens, cache_miss_tokens, reasoning_tokens,
  cost_usd, cost_cny, billable_microunits,
  error_code, error_message, client_ip_info, client_device, request_content, timestamp
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
  $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
  $31,$32,$33
)
ON CONFLICT (id) DO NOTHING
`, item.ID, item.UserID, item.UserName, item.Username, item.APIKeyID, item.APIKeyName, item.APIKeyPreview,
		item.ProviderID, item.ProviderName, item.Model, item.UpstreamModel, item.Endpoint, item.Method, item.Status,
		item.OK, item.Stream, item.DurationMs, item.PromptTokens, item.CompletionTokens, item.TotalTokens,
		item.CachedTokens, item.CacheCreationTokens, item.CacheMissTokens, item.ReasoningTokens,
		item.CostUSD, item.CostCNY, item.BillableMicrounits,
		item.ErrorCode, item.ErrorMessage, clientIPInfoRaw, clientDeviceRaw, requestContentRaw, ts)
	if err != nil {
		return err
	}
	if item.UserID != "" && item.APIKeyID != "" {
		tsText := ts.UTC().Format("2006-01-02T15:04:05.000Z")
		if _, err := tx.Exec(ctx, `
UPDATE sapi_user_api_keys
SET last_used_at = $1, updated_at = $1
WHERE id = $2 AND user_id = $3
`, tsText, item.APIKeyID, item.UserID); err != nil {
			return err
		}
	}
	if item.OK && item.UserID != "" && item.UserID != models.AdminVirtualUserID && item.BillableMicrounits > 0 {
		if _, err := tx.Exec(ctx, `
UPDATE sapi_users
SET credit_used_microunits = credit_used_microunits + $1,
    credit_balance_microunits = GREATEST(0, credit_balance_microunits - $1),
    updated_at = $2
WHERE id = $3
`, item.BillableMicrounits, ts.UTC().Format("2006-01-02T15:04:05.000Z"), item.UserID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func prunePostgresRequestLogs(ctx context.Context, cutoff time.Time) error {
	if pgPool == nil {
		return nil
	}
	if logs, err := queryPostgresRequestLogsBefore(ctx, cutoff, 50000); err == nil && len(logs) > 0 {
		if archiveErr := writeRequestLogArchive(logs, "postgres-expired"); archiveErr != nil {
			log.Printf("[STORE] archive postgres request logs failed: %v", archiveErr)
		}
	} else if err != nil {
		log.Printf("[STORE] query expired postgres request logs failed: %v", err)
	}
	_, err := pgPool.Exec(ctx, `DELETE FROM sapi_request_logs WHERE timestamp < $1`, cutoff)
	return err
}

func queryPostgresRequestLogsBefore(ctx context.Context, cutoff time.Time, limit int) ([]models.RequestLog, error) {
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
  cost_usd, cost_cny, billable_microunits,
  error_code, error_message, client_ip_info, client_device, request_content, timestamp
FROM sapi_request_logs
WHERE timestamp < $1
ORDER BY timestamp ASC
LIMIT `
	query += fmt.Sprintf("%d", limit)

	rows, err := pgPool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]models.RequestLog, 0)
	for rows.Next() {
		var item models.RequestLog
		var ts time.Time
		var clientIPInfoRaw []byte
		var clientDeviceRaw []byte
		var requestContentRaw []byte
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.UserName, &item.Username, &item.APIKeyID, &item.APIKeyName, &item.APIKeyPreview,
			&item.ProviderID, &item.ProviderName, &item.Model, &item.UpstreamModel, &item.Endpoint, &item.Method, &item.Status,
			&item.OK, &item.Stream, &item.DurationMs, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens,
			&item.CachedTokens, &item.CacheCreationTokens, &item.CacheMissTokens, &item.ReasoningTokens,
			&item.CostUSD, &item.CostCNY, &item.BillableMicrounits,
			&item.ErrorCode, &item.ErrorMessage, &clientIPInfoRaw, &clientDeviceRaw, &requestContentRaw, &ts,
		); err != nil {
			return nil, err
		}
		if len(requestContentRaw) > 0 {
			_ = json.Unmarshal(requestContentRaw, &item.RequestContent)
		}
		if len(clientIPInfoRaw) > 0 && string(clientIPInfoRaw) != "{}" {
			_ = json.Unmarshal(clientIPInfoRaw, &item.ClientIPInfo)
		}
		if len(clientDeviceRaw) > 0 && string(clientDeviceRaw) != "{}" {
			_ = json.Unmarshal(clientDeviceRaw, &item.ClientDevice)
		}
		if requestLogHasContent(item) {
			item.HasRequestContent = true
		}
		item.Timestamp = ts.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
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
  cost_usd, cost_cny, billable_microunits,
  error_code, error_message, client_ip_info, client_device, request_content <> '{}'::jsonb AS has_request_content, timestamp
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
		var clientIPInfoRaw []byte
		var clientDeviceRaw []byte
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.UserName, &item.Username, &item.APIKeyID, &item.APIKeyName, &item.APIKeyPreview,
			&item.ProviderID, &item.ProviderName, &item.Model, &item.UpstreamModel, &item.Endpoint, &item.Method, &item.Status,
			&item.OK, &item.Stream, &item.DurationMs, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens,
			&item.CachedTokens, &item.CacheCreationTokens, &item.CacheMissTokens, &item.ReasoningTokens,
			&item.CostUSD, &item.CostCNY, &item.BillableMicrounits,
			&item.ErrorCode, &item.ErrorMessage, &clientIPInfoRaw, &clientDeviceRaw, &item.HasRequestContent, &ts,
		); err != nil {
			return nil, err
		}
		if len(clientIPInfoRaw) > 0 && string(clientIPInfoRaw) != "{}" {
			_ = json.Unmarshal(clientIPInfoRaw, &item.ClientIPInfo)
		}
		if len(clientDeviceRaw) > 0 && string(clientDeviceRaw) != "{}" {
			_ = json.Unmarshal(clientDeviceRaw, &item.ClientDevice)
		}
		item.Timestamp = ts.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryPostgresRequestLogsWithContent(ctx context.Context, since time.Time, userID string, limit int) ([]models.RequestLog, error) {
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
  cost_usd, cost_cny, billable_microunits,
  error_code, error_message, client_ip_info, client_device, request_content, timestamp
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
		var clientIPInfoRaw []byte
		var clientDeviceRaw []byte
		var requestContentRaw []byte
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.UserName, &item.Username, &item.APIKeyID, &item.APIKeyName, &item.APIKeyPreview,
			&item.ProviderID, &item.ProviderName, &item.Model, &item.UpstreamModel, &item.Endpoint, &item.Method, &item.Status,
			&item.OK, &item.Stream, &item.DurationMs, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens,
			&item.CachedTokens, &item.CacheCreationTokens, &item.CacheMissTokens, &item.ReasoningTokens,
			&item.CostUSD, &item.CostCNY, &item.BillableMicrounits,
			&item.ErrorCode, &item.ErrorMessage, &clientIPInfoRaw, &clientDeviceRaw, &requestContentRaw, &ts,
		); err != nil {
			return nil, err
		}
		if len(requestContentRaw) > 0 {
			_ = json.Unmarshal(requestContentRaw, &item.RequestContent)
		}
		if len(clientIPInfoRaw) > 0 && string(clientIPInfoRaw) != "{}" {
			_ = json.Unmarshal(clientIPInfoRaw, &item.ClientIPInfo)
		}
		if len(clientDeviceRaw) > 0 && string(clientDeviceRaw) != "{}" {
			_ = json.Unmarshal(clientDeviceRaw, &item.ClientDevice)
		}
		if requestLogHasContent(item) {
			item.HasRequestContent = true
		}
		item.Timestamp = ts.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryPostgresRequestLog(ctx context.Context, id, userID string) (*models.RequestLog, bool, error) {
	if pgPool == nil {
		return nil, false, nil
	}

	query := `
SELECT id, user_id, user_name, username, api_key_id, api_key_name, api_key_preview,
  provider_id, provider_name, model, upstream_model, endpoint, method, status,
  ok, stream, duration_ms, prompt_tokens, completion_tokens, total_tokens,
  cached_tokens, cache_creation_tokens, cache_miss_tokens, reasoning_tokens,
  cost_usd, cost_cny, billable_microunits,
  error_code, error_message, client_ip_info, client_device, request_content, timestamp
FROM sapi_request_logs
WHERE id = $1`
	args := []interface{}{id}
	if userID != "" {
		query += ` AND user_id = $2`
		args = append(args, userID)
	}
	query += ` LIMIT 1`

	var item models.RequestLog
	var ts time.Time
	var clientIPInfoRaw []byte
	var clientDeviceRaw []byte
	var requestContentRaw []byte
	err := pgPool.QueryRow(ctx, query, args...).Scan(
		&item.ID, &item.UserID, &item.UserName, &item.Username, &item.APIKeyID, &item.APIKeyName, &item.APIKeyPreview,
		&item.ProviderID, &item.ProviderName, &item.Model, &item.UpstreamModel, &item.Endpoint, &item.Method, &item.Status,
		&item.OK, &item.Stream, &item.DurationMs, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens,
		&item.CachedTokens, &item.CacheCreationTokens, &item.CacheMissTokens, &item.ReasoningTokens,
		&item.CostUSD, &item.CostCNY, &item.BillableMicrounits,
		&item.ErrorCode, &item.ErrorMessage, &clientIPInfoRaw, &clientDeviceRaw, &requestContentRaw, &ts,
	)
	if err == pgx.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if len(requestContentRaw) > 0 {
		_ = json.Unmarshal(requestContentRaw, &item.RequestContent)
	}
	if len(clientIPInfoRaw) > 0 && string(clientIPInfoRaw) != "{}" {
		_ = json.Unmarshal(clientIPInfoRaw, &item.ClientIPInfo)
	}
	if len(clientDeviceRaw) > 0 && string(clientDeviceRaw) != "{}" {
		_ = json.Unmarshal(clientDeviceRaw, &item.ClientDevice)
	}
	if requestLogHasContent(item) {
		item.HasRequestContent = true
	}
	item.Timestamp = ts.UTC().Format(time.RFC3339)
	return &item, true, nil
}

func deletePostgresUserRequestLogsTx(ctx context.Context, q postgresQuerier, userID string) error {
	if userID == "" {
		return nil
	}
	_, err := q.Exec(ctx, `DELETE FROM sapi_request_logs WHERE user_id = $1`, userID)
	return err
}
