package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"sapi/billing"
	"sapi/models"
)

const postgresStateAppID = "main"

type postgresQuerier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type apiKeyPosition struct {
	UserIndex int
	KeyIndex  int
}

func mutatePostgresState(ctx context.Context, mutator func(*models.Database) interface{}) (*models.Database, interface{}, error) {
	if pgPool == nil {
		return nil, nil, nil
	}

	tx, err := pgPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	if err := lockPostgresState(ctx, tx); err != nil {
		return nil, nil, err
	}

	db, ok, err := loadPostgresNormalizedState(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		db, ok, err = loadPostgresLegacyState(ctx, tx)
		if err != nil {
			return nil, nil, err
		}
	}
	if !ok {
		if cachedDB != nil {
			db = cloneDatabase(cachedDB)
		} else {
			db = readFileDB(true)
		}
		if db == nil {
			db = newDefaultDB()
		}
	}

	next := cloneDatabase(db)
	result := mutator(next)
	normalizeDB(next)
	next.UpdatedAt = Now()

	if err := savePostgresNormalizedStateTx(ctx, tx, next); err != nil {
		return nil, result, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, result, err
	}
	return next, result, nil
}

func deletePostgresUserAccountState(ctx context.Context, userID string) (*models.Database, bool, error) {
	if pgPool == nil {
		return nil, false, nil
	}

	tx, err := pgPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)

	if err := lockPostgresState(ctx, tx); err != nil {
		return nil, false, err
	}

	db, ok, err := loadPostgresNormalizedState(ctx, tx)
	if err != nil {
		return nil, false, err
	}
	if !ok {
		db, ok, err = loadPostgresLegacyState(ctx, tx)
		if err != nil {
			return nil, false, err
		}
	}
	if !ok {
		if cachedDB != nil {
			db = cloneDatabase(cachedDB)
		} else {
			db = readFileDB(true)
		}
		if db == nil {
			db = newDefaultDB()
		}
	}

	next := cloneDatabase(db)
	deleted := removeUserAccountFromDB(next, userID)
	if !deleted {
		if err := tx.Commit(ctx); err != nil {
			return nil, false, err
		}
		return next, false, nil
	}
	normalizeDB(next)
	next.UpdatedAt = Now()

	if err := savePostgresNormalizedStateTx(ctx, tx, next); err != nil {
		return nil, false, err
	}
	if err := deletePostgresUserRequestLogsTx(ctx, tx, userID); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return next, true, nil
}

func lockPostgresState(ctx context.Context, q postgresQuerier) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('sapi:state'))`)
	return err
}

func loadPostgresLegacyState(ctx context.Context, q postgresQuerier) (*models.Database, bool, error) {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT payload FROM sapi_state WHERE id = 'main'`).Scan(&raw)
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
	normalizeDB(&db)
	return &db, true, nil
}

func loadPostgresNormalizedState(ctx context.Context, q postgresQuerier) (*models.Database, bool, error) {
	db := &models.Database{
		Providers:         []models.Provider{},
		Users:             []models.User{},
		TokenUsage:        []interface{}{},
		RequestLogs:       []models.RequestLog{},
		AdminAPIKeys:      []models.APIKeyRecord{},
		InvitationCodes:   []models.InvitationCode{},
		VerificationCodes: []models.VerificationCode{},
		AdminPasskeys:     []models.AdminPasskey{},
		Announcements:     []models.Announcement{},
		Documents:         []interface{}{},
		Suggestions:       []models.Suggestion{},
		SMTPConfig:        &models.SMTPConfig{},
		SiteEmails:        []string{},
		SiteBanner:        &models.SiteBanner{},
		SubscriptionPlans: []models.SubscriptionPlan{},
		ModelPrices:       []models.ModelPrice{},
		BillingConfig:     &models.BillingConfig{},
		PaymentConfig:     &models.PaymentConfig{},
		PaymentOrders:     []models.PaymentOrder{},
	}

	err := q.QueryRow(ctx, `
SELECT version, app_secret, site_email, default_rpm_limit, registration_disabled,
  maintenance_mode, maintenance_end_time, show_only_available_models,
  billing_enabled, billing_currency, billing_usd_to_cny_rate, billing_markup_multiplier,
  billing_models_dev_url, billing_last_price_sync_at,
  payment_enabled, payment_provider, payment_gateway_url, payment_mapi_url, payment_merchant_id,
  payment_merchant_key, payment_software_key, payment_site_name, payment_notify_url, payment_return_url,
  created_at, updated_at
FROM sapi_app_config
WHERE id = $1
`, postgresStateAppID).Scan(
		&db.Version,
		&db.AppSecret,
		&db.SiteEmail,
		&db.DefaultRPMLimit,
		&db.RegistrationDisabled,
		&db.MaintenanceMode,
		&db.MaintenanceEndTime,
		&db.ShowOnlyAvailableModels,
		&db.BillingConfig.Enabled,
		&db.BillingConfig.Currency,
		&db.BillingConfig.USDToCNYRate,
		&db.BillingConfig.MarkupMultiplier,
		&db.BillingConfig.ModelsDevURL,
		&db.BillingConfig.LastPriceSyncAt,
		&db.PaymentConfig.Enabled,
		&db.PaymentConfig.Provider,
		&db.PaymentConfig.GatewayURL,
		&db.PaymentConfig.MAPIURL,
		&db.PaymentConfig.MerchantID,
		&db.PaymentConfig.MerchantKey,
		&db.PaymentConfig.SoftwareKey,
		&db.PaymentConfig.SiteName,
		&db.PaymentConfig.NotifyURL,
		&db.PaymentConfig.ReturnURL,
		&db.CreatedAt,
		&db.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	if err := loadPostgresSMTPConfig(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresSiteEmails(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresSiteBanner(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresPaymentAllowedTypes(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresSubscriptionPlans(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresModelPrices(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresPaymentOrders(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresProviders(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresUsers(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresAdminAPIKeys(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresInvitationCodes(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresVerificationCodes(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresAdminPasskeys(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresAnnouncements(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresSuggestions(ctx, q, db); err != nil {
		return nil, false, err
	}
	if err := loadPostgresOpaquePayloads(ctx, q, `SELECT payload FROM sapi_token_usage ORDER BY position ASC`, &db.TokenUsage); err != nil {
		return nil, false, err
	}
	if err := loadPostgresOpaquePayloads(ctx, q, `SELECT payload FROM sapi_documents ORDER BY position ASC`, &db.Documents); err != nil {
		return nil, false, err
	}

	normalizeDB(db)
	return db, true, nil
}

func loadPostgresSMTPConfig(ctx context.Context, q postgresQuerier, db *models.Database) error {
	err := q.QueryRow(ctx, `
SELECT host, port, secure, username, password, from_addr
FROM sapi_smtp_config
WHERE app_id = $1
`, postgresStateAppID).Scan(
		&db.SMTPConfig.Host,
		&db.SMTPConfig.Port,
		&db.SMTPConfig.Secure,
		&db.SMTPConfig.User,
		&db.SMTPConfig.Pass,
		&db.SMTPConfig.From,
	)
	if err == pgx.ErrNoRows {
		return nil
	}
	return err
}

func loadPostgresSiteEmails(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT email
FROM sapi_site_emails
WHERE app_id = $1
ORDER BY position ASC
`, postgresStateAppID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			return err
		}
		db.SiteEmails = append(db.SiteEmails, email)
	}
	return rows.Err()
}

func loadPostgresSiteBanner(ctx context.Context, q postgresQuerier, db *models.Database) error {
	err := q.QueryRow(ctx, `
SELECT content, updated_at
FROM sapi_site_banner
WHERE app_id = $1
`, postgresStateAppID).Scan(&db.SiteBanner.Content, &db.SiteBanner.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil
	}
	return err
}

func loadPostgresPaymentAllowedTypes(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT pay_type
FROM sapi_payment_allowed_types
WHERE app_id = $1
ORDER BY position ASC
`, postgresStateAppID)
	if err != nil {
		return err
	}
	defer rows.Close()
	db.PaymentConfig.AllowedTypes = []string{}
	for rows.Next() {
		var payType string
		if err := rows.Scan(&payType); err != nil {
			return err
		}
		db.PaymentConfig.AllowedTypes = append(db.PaymentConfig.AllowedTypes, payType)
	}
	return rows.Err()
}

func loadPostgresSubscriptionPlans(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, name, description, rpm_limit, price_cents, credit_microunits,
  duration_days, model_provider_routes, enabled, sort_order
FROM sapi_subscription_plans
ORDER BY position ASC, sort_order ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var plan models.SubscriptionPlan
		var modelProviderRoutesRaw []byte
		if err := rows.Scan(&plan.ID, &plan.Name, &plan.Description, &plan.RPMLimit, &plan.PriceCents,
			&plan.CreditMicrounits, &plan.DurationDays, &modelProviderRoutesRaw, &plan.Enabled, &plan.SortOrder); err != nil {
			return err
		}
		if len(modelProviderRoutesRaw) > 0 {
			_ = json.Unmarshal(modelProviderRoutesRaw, &plan.ModelProviderRoutes)
		}
		db.SubscriptionPlans = append(db.SubscriptionPlans, plan)
	}
	return rows.Err()
}

func loadPostgresModelPrices(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT model_id, display_name, provider_id, input_usd_per_million_tokens,
  output_usd_per_million_tokens, cache_read_usd_per_million_tokens,
  cache_write_usd_per_million_tokens, reasoning_usd_per_million_tokens,
  source, manual, updated_at
FROM sapi_model_prices
ORDER BY model_id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var price models.ModelPrice
		if err := rows.Scan(&price.ModelID, &price.DisplayName, &price.ProviderID,
			&price.InputUSDPerMillionTokens, &price.OutputUSDPerMillionTokens,
			&price.CacheReadUSDPerMillionTokens, &price.CacheWriteUSDPerMillionTokens,
			&price.ReasoningUSDPerMillionTokens, &price.Source, &price.Manual, &price.UpdatedAt); err != nil {
			return err
		}
		db.ModelPrices = append(db.ModelPrices, price)
	}
	return rows.Err()
}

func loadPostgresPaymentOrders(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, user_id, username, subscription_tier, plan_name, amount_cents,
  credit_microunits, currency, provider, pay_type, out_trade_no, trade_no,
  status, created_at, paid_at, expires_at, raw_notify
FROM sapi_payment_orders
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var order models.PaymentOrder
		var raw []byte
		if err := rows.Scan(&order.ID, &order.UserID, &order.Username, &order.SubscriptionTier,
			&order.PlanName, &order.AmountCents, &order.CreditMicrounits, &order.Currency,
			&order.Provider, &order.PayType, &order.OutTradeNo, &order.TradeNo, &order.Status,
			&order.CreatedAt, &order.PaidAt, &order.ExpiresAt, &raw); err != nil {
			return err
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &order.RawNotify)
		}
		db.PaymentOrders = append(db.PaymentOrders, order)
	}
	return rows.Err()
}

func loadPostgresProviders(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, name, base_url, api_key, upstream_format, enabled, failover_threshold,
  user_agent, priority, health_status, latency, ping, availability_7d, last_health_check,
  created_at, updated_at
FROM sapi_providers
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	providerIndex := map[string]int{}
	for rows.Next() {
		var p models.Provider
		if err := rows.Scan(
			&p.ID,
			&p.Name,
			&p.BaseURL,
			&p.APIKey,
			&p.UpstreamFormat,
			&p.Enabled,
			&p.FailoverThreshold,
			&p.UserAgent,
			&p.Priority,
			&p.HealthStatus,
			&p.Latency,
			&p.Ping,
			&p.Availability7d,
			&p.LastHealthCheck,
			&p.CreatedAt,
			&p.UpdatedAt,
		); err != nil {
			return err
		}
		p.Models = []models.Model{}
		p.ModelMappings = map[string]string{}
		p.HealthHistory = []models.HealthHistoryEntry{}
		providerIndex[p.ID] = len(db.Providers)
		db.Providers = append(db.Providers, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	modelPositions, err := loadPostgresProviderModels(ctx, q, db, providerIndex)
	if err != nil {
		return err
	}
	if err := loadPostgresProviderModelCLISupport(ctx, q, db, providerIndex, modelPositions); err != nil {
		return err
	}
	if err := loadPostgresProviderModelMappings(ctx, q, db, providerIndex); err != nil {
		return err
	}
	return loadPostgresProviderHealthHistory(ctx, q, db, providerIndex)
}

func loadPostgresProviderModels(ctx context.Context, q postgresQuerier, db *models.Database, providerIndex map[string]int) (map[string]map[int]int, error) {
	rows, err := q.Query(ctx, `
SELECT provider_id, position, model_id, name, description
FROM sapi_provider_models
ORDER BY provider_id ASC, position ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	modelPositions := map[string]map[int]int{}
	for rows.Next() {
		var providerID string
		var position int
		var model models.Model
		if err := rows.Scan(&providerID, &position, &model.ID, &model.Name, &model.Description); err != nil {
			return nil, err
		}
		idx, ok := providerIndex[providerID]
		if !ok {
			continue
		}
		model.CliSupport = []string{}
		p := &db.Providers[idx]
		if modelPositions[providerID] == nil {
			modelPositions[providerID] = map[int]int{}
		}
		modelPositions[providerID][position] = len(p.Models)
		p.Models = append(p.Models, model)
	}
	return modelPositions, rows.Err()
}

func loadPostgresProviderModelCLISupport(ctx context.Context, q postgresQuerier, db *models.Database, providerIndex map[string]int, modelPositions map[string]map[int]int) error {
	rows, err := q.Query(ctx, `
SELECT provider_id, model_position, cli_support
FROM sapi_provider_model_cli_support
ORDER BY provider_id ASC, model_position ASC, position ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var providerID, cliSupport string
		var modelPosition int
		if err := rows.Scan(&providerID, &modelPosition, &cliSupport); err != nil {
			return err
		}
		providerIdx, ok := providerIndex[providerID]
		if !ok {
			continue
		}
		modelIdx, ok := modelPositions[providerID][modelPosition]
		if !ok {
			continue
		}
		db.Providers[providerIdx].Models[modelIdx].CliSupport = append(db.Providers[providerIdx].Models[modelIdx].CliSupport, cliSupport)
	}
	return rows.Err()
}

func loadPostgresProviderModelMappings(ctx context.Context, q postgresQuerier, db *models.Database, providerIndex map[string]int) error {
	rows, err := q.Query(ctx, `
SELECT provider_id, model_id, upstream_model
FROM sapi_provider_model_mappings
ORDER BY provider_id ASC, model_id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var providerID, modelID, upstreamModel string
		if err := rows.Scan(&providerID, &modelID, &upstreamModel); err != nil {
			return err
		}
		if idx, ok := providerIndex[providerID]; ok {
			db.Providers[idx].ModelMappings[modelID] = upstreamModel
		}
	}
	return rows.Err()
}

func loadPostgresProviderHealthHistory(ctx context.Context, q postgresQuerier, db *models.Database, providerIndex map[string]int) error {
	rows, err := q.Query(ctx, `
SELECT provider_id, timestamp, status, latency
FROM sapi_provider_health_history
ORDER BY provider_id ASC, position ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var providerID string
		var entry models.HealthHistoryEntry
		if err := rows.Scan(&providerID, &entry.Timestamp, &entry.Status, &entry.Latency); err != nil {
			return err
		}
		if idx, ok := providerIndex[providerID]; ok {
			db.Providers[idx].HealthHistory = append(db.Providers[idx].HealthHistory, entry)
		}
	}
	return rows.Err()
}

func loadPostgresUsers(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, username, email, name, password_hash, enabled, receive_announcement_email,
  source, github_id, github_login, github_avatar_url, github_linked_at,
  subscription_tier, subscription_expires_at, credit_balance_microunits,
  credit_used_microunits, created_at, updated_at
FROM sapi_users
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	userIndex := map[string]int{}
	for rows.Next() {
		var user models.User
		if err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.Email,
			&user.Name,
			&user.PasswordHash,
			&user.Enabled,
			&user.ReceiveAnnouncementEmail,
			&user.Source,
			&user.GitHubID,
			&user.GitHubLogin,
			&user.GitHubAvatarURL,
			&user.GitHubLinkedAt,
			&user.SubscriptionTier,
			&user.SubscriptionExpiresAt,
			&user.CreditBalanceMicrounits,
			&user.CreditUsedMicrounits,
			&user.CreatedAt,
			&user.UpdatedAt,
		); err != nil {
			return err
		}
		user.APIKeys = []models.APIKeyRecord{}
		userIndex[user.ID] = len(db.Users)
		db.Users = append(db.Users, user)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	keyPositions, err := loadPostgresUserAPIKeys(ctx, q, db, userIndex)
	if err != nil {
		return err
	}
	return loadPostgresAPIKeyAllowedModels(ctx, q, `SELECT api_key_id, model_id FROM sapi_user_api_key_allowed_models ORDER BY api_key_id ASC, position ASC`, func(keyID, modelID string) {
		if pos, ok := keyPositions[keyID]; ok {
			db.Users[pos.UserIndex].APIKeys[pos.KeyIndex].AllowedModels = append(db.Users[pos.UserIndex].APIKeys[pos.KeyIndex].AllowedModels, modelID)
		}
	})
}

func loadPostgresUserAPIKeys(ctx context.Context, q postgresQuerier, db *models.Database, userIndex map[string]int) (map[string]apiKeyPosition, error) {
	rows, err := q.Query(ctx, `
SELECT id, user_id, name, key_value, enabled, rpm_limit, banned_until, ban_reason,
  invalid_request_count, last_invalid_request_at, created_at, updated_at, last_used_at
FROM sapi_user_api_keys
ORDER BY user_id ASC, position ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keyPositions := map[string]apiKeyPosition{}
	for rows.Next() {
		var userID string
		var key models.APIKeyRecord
		if err := rows.Scan(
			&key.ID,
			&userID,
			&key.Name,
			&key.Key,
			&key.Enabled,
			&key.RPMLimit,
			&key.BannedUntil,
			&key.BanReason,
			&key.InvalidRequestCount,
			&key.LastInvalidRequestAt,
			&key.CreatedAt,
			&key.UpdatedAt,
			&key.LastUsedAt,
		); err != nil {
			return nil, err
		}
		userIdx, ok := userIndex[userID]
		if !ok {
			continue
		}
		key.AllowedModels = []string{}
		user := &db.Users[userIdx]
		keyPositions[key.ID] = apiKeyPosition{UserIndex: userIdx, KeyIndex: len(user.APIKeys)}
		user.APIKeys = append(user.APIKeys, key)
	}
	return keyPositions, rows.Err()
}

func loadPostgresAdminAPIKeys(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, name, key_value, enabled, rpm_limit, banned_until, ban_reason,
  invalid_request_count, last_invalid_request_at, created_at, updated_at, last_used_at
FROM sapi_admin_api_keys
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	keyIndex := map[string]int{}
	for rows.Next() {
		var key models.APIKeyRecord
		if err := rows.Scan(
			&key.ID,
			&key.Name,
			&key.Key,
			&key.Enabled,
			&key.RPMLimit,
			&key.BannedUntil,
			&key.BanReason,
			&key.InvalidRequestCount,
			&key.LastInvalidRequestAt,
			&key.CreatedAt,
			&key.UpdatedAt,
			&key.LastUsedAt,
		); err != nil {
			return err
		}
		key.AllowedModels = []string{}
		keyIndex[key.ID] = len(db.AdminAPIKeys)
		db.AdminAPIKeys = append(db.AdminAPIKeys, key)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	return loadPostgresAPIKeyAllowedModels(ctx, q, `SELECT api_key_id, model_id FROM sapi_admin_api_key_allowed_models ORDER BY api_key_id ASC, position ASC`, func(keyID, modelID string) {
		if idx, ok := keyIndex[keyID]; ok {
			db.AdminAPIKeys[idx].AllowedModels = append(db.AdminAPIKeys[idx].AllowedModels, modelID)
		}
	})
}

func loadPostgresAPIKeyAllowedModels(ctx context.Context, q postgresQuerier, query string, add func(keyID, modelID string)) error {
	rows, err := q.Query(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var keyID, modelID string
		if err := rows.Scan(&keyID, &modelID); err != nil {
			return err
		}
		add(keyID, modelID)
	}
	return rows.Err()
}

func loadPostgresInvitationCodes(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, code, note, created_at, expires_at, max_uses
FROM sapi_invitation_codes
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	inviteIndex := map[string]int{}
	for rows.Next() {
		var code models.InvitationCode
		if err := rows.Scan(&code.ID, &code.Code, &code.Note, &code.CreatedAt, &code.ExpiresAt, &code.MaxUses); err != nil {
			return err
		}
		code.UsedBy = []models.InvitationCodeUse{}
		inviteIndex[code.ID] = len(db.InvitationCodes)
		db.InvitationCodes = append(db.InvitationCodes, code)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	uses, err := q.Query(ctx, `
SELECT invitation_id, user_id, used_at
FROM sapi_invitation_code_uses
ORDER BY invitation_id ASC, position ASC
`)
	if err != nil {
		return err
	}
	defer uses.Close()

	for uses.Next() {
		var invitationID string
		var use models.InvitationCodeUse
		if err := uses.Scan(&invitationID, &use.UserID, &use.UsedAt); err != nil {
			return err
		}
		if idx, ok := inviteIndex[invitationID]; ok {
			db.InvitationCodes[idx].UsedBy = append(db.InvitationCodes[idx].UsedBy, use)
			db.InvitationCodes[idx].UsedCount = len(db.InvitationCodes[idx].UsedBy)
		}
	}
	return uses.Err()
}

func loadPostgresVerificationCodes(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT email, code, purpose, created_at, used
FROM sapi_verification_codes
ORDER BY position ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var code models.VerificationCode
		if err := rows.Scan(&code.Email, &code.Code, &code.Purpose, &code.CreatedAt, &code.Used); err != nil {
			return err
		}
		db.VerificationCodes = append(db.VerificationCodes, code)
	}
	return rows.Err()
}

func loadPostgresAdminPasskeys(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, name, credential, created_at, updated_at, last_used_at
FROM sapi_admin_passkeys
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var item models.AdminPasskey
		var raw []byte
		if err := rows.Scan(&item.ID, &item.Name, &raw, &item.CreatedAt, &item.UpdatedAt, &item.LastUsedAt); err != nil {
			return err
		}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &item.Credential); err != nil {
				return err
			}
		}
		db.AdminPasskeys = append(db.AdminPasskeys, item)
	}
	return rows.Err()
}

func loadPostgresAnnouncements(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, title, content, type, enabled, send_email, created_at, updated_at
FROM sapi_announcements
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var item models.Announcement
		if err := rows.Scan(&item.ID, &item.Title, &item.Content, &item.Type, &item.Enabled, &item.SendEmail, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return err
		}
		db.Announcements = append(db.Announcements, item)
	}
	return rows.Err()
}

func loadPostgresSuggestions(ctx context.Context, q postgresQuerier, db *models.Database) error {
	rows, err := q.Query(ctx, `
SELECT id, title, content, contact, user_id, user_name, reply, replied_at, replied_by, created_at, updated_at
FROM sapi_suggestions
ORDER BY position ASC, created_at ASC, id ASC
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var item models.Suggestion
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Content,
			&item.Contact,
			&item.UserID,
			&item.UserName,
			&item.Reply,
			&item.RepliedAt,
			&item.RepliedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return err
		}
		db.Suggestions = append(db.Suggestions, item)
	}
	return rows.Err()
}

func loadPostgresOpaquePayloads(ctx context.Context, q postgresQuerier, query string, target *[]interface{}) error {
	rows, err := q.Query(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		var payload interface{}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &payload); err != nil {
				return err
			}
		}
		*target = append(*target, payload)
	}
	return rows.Err()
}

func savePostgresNormalizedState(ctx context.Context, db *models.Database) error {
	if pgPool == nil {
		return nil
	}
	tx, err := pgPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := lockPostgresState(ctx, tx); err != nil {
		return err
	}
	if err := savePostgresNormalizedStateTx(ctx, tx, db); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func savePostgresNormalizedStateTx(ctx context.Context, tx postgresQuerier, db *models.Database) error {
	state := stateForPersist(db)
	if state == nil {
		state = newDefaultDB()
	}
	normalizeDB(state)

	if err := clearPostgresNormalizedState(ctx, tx); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO sapi_app_config (
  id, version, app_secret, site_email, default_rpm_limit, registration_disabled,
  maintenance_mode, maintenance_end_time, show_only_available_models,
  billing_enabled, billing_currency, billing_usd_to_cny_rate, billing_markup_multiplier,
  billing_models_dev_url, billing_last_price_sync_at,
  payment_enabled, payment_provider, payment_gateway_url, payment_mapi_url, payment_merchant_id,
  payment_merchant_key, payment_software_key, payment_site_name, payment_notify_url, payment_return_url,
  created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
`, postgresStateAppID, state.Version, state.AppSecret, state.SiteEmail, state.DefaultRPMLimit, state.RegistrationDisabled,
		state.MaintenanceMode, state.MaintenanceEndTime, state.ShowOnlyAvailableModels,
		state.BillingConfig.Enabled, state.BillingConfig.Currency, state.BillingConfig.USDToCNYRate, state.BillingConfig.MarkupMultiplier,
		state.BillingConfig.ModelsDevURL, state.BillingConfig.LastPriceSyncAt,
		state.PaymentConfig.Enabled, state.PaymentConfig.Provider, state.PaymentConfig.GatewayURL, state.PaymentConfig.MAPIURL, state.PaymentConfig.MerchantID,
		state.PaymentConfig.MerchantKey, state.PaymentConfig.SoftwareKey, state.PaymentConfig.SiteName, state.PaymentConfig.NotifyURL, state.PaymentConfig.ReturnURL,
		state.CreatedAt, state.UpdatedAt); err != nil {
		return err
	}

	if err := savePostgresSMTPConfig(ctx, tx, state.SMTPConfig); err != nil {
		return err
	}
	if err := savePostgresSiteEmails(ctx, tx, state); err != nil {
		return err
	}
	if err := savePostgresSiteBanner(ctx, tx, state.SiteBanner); err != nil {
		return err
	}
	if err := savePostgresPaymentAllowedTypes(ctx, tx, state.PaymentConfig); err != nil {
		return err
	}
	if err := savePostgresSubscriptionPlans(ctx, tx, state.SubscriptionPlans); err != nil {
		return err
	}
	if err := savePostgresModelPrices(ctx, tx, state.ModelPrices); err != nil {
		return err
	}
	if err := savePostgresPaymentOrders(ctx, tx, state.PaymentOrders); err != nil {
		return err
	}
	if err := savePostgresProviders(ctx, tx, state.Providers); err != nil {
		return err
	}
	if err := savePostgresUsers(ctx, tx, state.Users); err != nil {
		return err
	}
	if err := savePostgresAdminAPIKeys(ctx, tx, state.AdminAPIKeys); err != nil {
		return err
	}
	if err := savePostgresInvitationCodes(ctx, tx, state.InvitationCodes); err != nil {
		return err
	}
	if err := savePostgresVerificationCodes(ctx, tx, state.VerificationCodes); err != nil {
		return err
	}
	if err := savePostgresAdminPasskeys(ctx, tx, state.AdminPasskeys); err != nil {
		return err
	}
	if err := savePostgresAnnouncements(ctx, tx, state.Announcements); err != nil {
		return err
	}
	if err := savePostgresSuggestions(ctx, tx, state.Suggestions); err != nil {
		return err
	}
	if err := savePostgresOpaquePayloads(ctx, tx, `INSERT INTO sapi_token_usage (position, payload) VALUES ($1,$2)`, state.TokenUsage); err != nil {
		return err
	}
	return savePostgresOpaquePayloads(ctx, tx, `INSERT INTO sapi_documents (position, payload) VALUES ($1,$2)`, state.Documents)
}

func clearPostgresNormalizedState(ctx context.Context, q postgresQuerier) error {
	tables := []string{
		"sapi_provider_model_cli_support",
		"sapi_provider_models",
		"sapi_provider_model_mappings",
		"sapi_provider_health_history",
		"sapi_user_api_key_allowed_models",
		"sapi_user_api_keys",
		"sapi_admin_api_key_allowed_models",
		"sapi_admin_api_keys",
		"sapi_invitation_code_uses",
		"sapi_invitation_codes",
		"sapi_verification_codes",
		"sapi_admin_passkeys",
		"sapi_announcements",
		"sapi_suggestions",
		"sapi_token_usage",
		"sapi_documents",
		"sapi_payment_orders",
		"sapi_model_prices",
		"sapi_subscription_plans",
		"sapi_payment_allowed_types",
		"sapi_site_emails",
		"sapi_site_banner",
		"sapi_smtp_config",
		"sapi_users",
		"sapi_providers",
		"sapi_app_config",
	}
	for _, table := range tables {
		if _, err := q.Exec(ctx, fmt.Sprintf("DELETE FROM %s", table)); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresSMTPConfig(ctx context.Context, q postgresQuerier, cfg *models.SMTPConfig) error {
	if cfg == nil {
		cfg = &models.SMTPConfig{}
	}
	_, err := q.Exec(ctx, `
INSERT INTO sapi_smtp_config (app_id, host, port, secure, username, password, from_addr)
VALUES ($1,$2,$3,$4,$5,$6,$7)
`, postgresStateAppID, cfg.Host, cfg.Port, cfg.Secure, cfg.User, cfg.Pass, cfg.From)
	return err
}

func savePostgresSiteEmails(ctx context.Context, q postgresQuerier, db *models.Database) error {
	emails := db.SiteEmails
	if len(emails) == 0 && db.SiteEmail != "" {
		emails = []string{db.SiteEmail}
	}
	for i, email := range emails {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_site_emails (app_id, position, email)
VALUES ($1,$2,$3)
`, postgresStateAppID, i, email); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresSiteBanner(ctx context.Context, q postgresQuerier, banner *models.SiteBanner) error {
	if banner == nil {
		banner = &models.SiteBanner{}
	}
	_, err := q.Exec(ctx, `
INSERT INTO sapi_site_banner (app_id, content, updated_at)
VALUES ($1,$2,$3)
`, postgresStateAppID, banner.Content, banner.UpdatedAt)
	return err
}

func savePostgresPaymentAllowedTypes(ctx context.Context, q postgresQuerier, cfg *models.PaymentConfig) error {
	cfg = billing.NormalizePaymentConfig(cfg)
	for i, payType := range cfg.AllowedTypes {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_payment_allowed_types (app_id, position, pay_type)
VALUES ($1,$2,$3)
`, postgresStateAppID, i, payType); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresSubscriptionPlans(ctx context.Context, q postgresQuerier, plans []models.SubscriptionPlan) error {
	for i, plan := range billing.NormalizeSubscriptionPlans(plans) {
		routesRaw, err := json.Marshal(plan.ModelProviderRoutes)
		if err != nil {
			routesRaw = []byte(`{}`)
		}
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_subscription_plans (
  id, position, name, description, rpm_limit, price_cents, credit_microunits,
  duration_days, model_provider_routes, enabled, sort_order
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
`, plan.ID, i, plan.Name, plan.Description, plan.RPMLimit, plan.PriceCents, plan.CreditMicrounits,
			plan.DurationDays, routesRaw, plan.Enabled, plan.SortOrder); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresModelPrices(ctx context.Context, q postgresQuerier, prices []models.ModelPrice) error {
	for _, price := range prices {
		if price.ModelID == "" {
			continue
		}
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_model_prices (
  model_id, display_name, provider_id, input_usd_per_million_tokens,
  output_usd_per_million_tokens, cache_read_usd_per_million_tokens,
  cache_write_usd_per_million_tokens, reasoning_usd_per_million_tokens,
  source, manual, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
`, price.ModelID, price.DisplayName, price.ProviderID, price.InputUSDPerMillionTokens,
			price.OutputUSDPerMillionTokens, price.CacheReadUSDPerMillionTokens,
			price.CacheWriteUSDPerMillionTokens, price.ReasoningUSDPerMillionTokens,
			price.Source, price.Manual, price.UpdatedAt); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresPaymentOrders(ctx context.Context, q postgresQuerier, orders []models.PaymentOrder) error {
	for i, order := range orders {
		raw, err := json.Marshal(order.RawNotify)
		if err != nil || len(raw) == 0 {
			raw = []byte(`{}`)
		}
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_payment_orders (
  id, position, user_id, username, subscription_tier, plan_name, amount_cents,
  credit_microunits, currency, provider, pay_type, out_trade_no, trade_no,
  status, created_at, paid_at, expires_at, raw_notify
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
`, order.ID, i, order.UserID, order.Username, order.SubscriptionTier, order.PlanName,
			order.AmountCents, order.CreditMicrounits, order.Currency, order.Provider,
			order.PayType, order.OutTradeNo, order.TradeNo, order.Status,
			order.CreatedAt, order.PaidAt, order.ExpiresAt, raw); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresProviders(ctx context.Context, q postgresQuerier, providers []models.Provider) error {
	for i, p := range providers {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_providers (
  id, position, name, base_url, api_key, upstream_format, user_agent, enabled, failover_threshold,
  priority, health_status, latency, ping, availability_7d, last_health_check,
  created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
`, p.ID, i, p.Name, p.BaseURL, p.APIKey, p.UpstreamFormat, p.UserAgent, p.Enabled, p.FailoverThreshold,
			p.Priority, p.HealthStatus, p.Latency, p.Ping, p.Availability7d, p.LastHealthCheck,
			p.CreatedAt, p.UpdatedAt); err != nil {
			return err
		}

		for j, model := range p.Models {
			if _, err := q.Exec(ctx, `
INSERT INTO sapi_provider_models (provider_id, position, model_id, name, description)
VALUES ($1,$2,$3,$4,$5)
`, p.ID, j, model.ID, model.Name, model.Description); err != nil {
				return err
			}
			for k, cliSupport := range model.CliSupport {
				if _, err := q.Exec(ctx, `
INSERT INTO sapi_provider_model_cli_support (provider_id, model_position, position, cli_support)
VALUES ($1,$2,$3,$4)
`, p.ID, j, k, cliSupport); err != nil {
					return err
				}
			}
		}

		mappingKeys := sortedMapKeys(p.ModelMappings)
		for _, modelID := range mappingKeys {
			if _, err := q.Exec(ctx, `
INSERT INTO sapi_provider_model_mappings (provider_id, model_id, upstream_model)
VALUES ($1,$2,$3)
`, p.ID, modelID, p.ModelMappings[modelID]); err != nil {
				return err
			}
		}

		for j, entry := range p.HealthHistory {
			if _, err := q.Exec(ctx, `
INSERT INTO sapi_provider_health_history (provider_id, position, timestamp, status, latency)
VALUES ($1,$2,$3,$4,$5)
`, p.ID, j, entry.Timestamp, entry.Status, entry.Latency); err != nil {
				return err
			}
		}
	}
	return nil
}

func savePostgresUsers(ctx context.Context, q postgresQuerier, users []models.User) error {
	for i, user := range users {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_users (
  id, position, username, email, name, password_hash, enabled, receive_announcement_email,
  source, github_id, github_login, github_avatar_url, github_linked_at,
  subscription_tier, subscription_expires_at, credit_balance_microunits,
  credit_used_microunits, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
`, user.ID, i, user.Username, user.Email, user.Name, user.PasswordHash, user.Enabled, user.ReceiveAnnouncementEmail,
			user.Source, user.GitHubID, user.GitHubLogin, user.GitHubAvatarURL, user.GitHubLinkedAt,
			user.SubscriptionTier, user.SubscriptionExpiresAt, user.CreditBalanceMicrounits,
			user.CreditUsedMicrounits, user.CreatedAt, user.UpdatedAt); err != nil {
			return err
		}
		for j, key := range user.APIKeys {
			if err := savePostgresAPIKey(ctx, q, "sapi_user_api_keys", key, user.ID, j); err != nil {
				return err
			}
			if err := savePostgresAllowedModels(ctx, q, "sapi_user_api_key_allowed_models", key.ID, key.AllowedModels); err != nil {
				return err
			}
		}
	}
	return nil
}

func savePostgresAdminAPIKeys(ctx context.Context, q postgresQuerier, keys []models.APIKeyRecord) error {
	for i, key := range keys {
		if err := savePostgresAPIKey(ctx, q, "sapi_admin_api_keys", key, "", i); err != nil {
			return err
		}
		if err := savePostgresAllowedModels(ctx, q, "sapi_admin_api_key_allowed_models", key.ID, key.AllowedModels); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresAPIKey(ctx context.Context, q postgresQuerier, table string, key models.APIKeyRecord, userID string, position int) error {
	if table == "sapi_user_api_keys" {
		_, err := q.Exec(ctx, `
INSERT INTO sapi_user_api_keys (
  id, user_id, position, name, key_value, enabled, rpm_limit, banned_until, ban_reason,
  invalid_request_count, last_invalid_request_at, created_at, updated_at, last_used_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
`, key.ID, userID, position, key.Name, key.Key, key.Enabled, key.RPMLimit, key.BannedUntil, key.BanReason,
			key.InvalidRequestCount, key.LastInvalidRequestAt, key.CreatedAt, key.UpdatedAt, key.LastUsedAt)
		return err
	}

	_, err := q.Exec(ctx, `
INSERT INTO sapi_admin_api_keys (
  id, position, name, key_value, enabled, rpm_limit, banned_until, ban_reason,
  invalid_request_count, last_invalid_request_at, created_at, updated_at, last_used_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
`, key.ID, position, key.Name, key.Key, key.Enabled, key.RPMLimit, key.BannedUntil, key.BanReason,
		key.InvalidRequestCount, key.LastInvalidRequestAt, key.CreatedAt, key.UpdatedAt, key.LastUsedAt)
	return err
}

func savePostgresAllowedModels(ctx context.Context, q postgresQuerier, table, keyID string, allowedModels []string) error {
	if table != "sapi_user_api_key_allowed_models" && table != "sapi_admin_api_key_allowed_models" {
		return fmt.Errorf("invalid allowed models table %q", table)
	}
	for i, modelID := range allowedModels {
		if _, err := q.Exec(ctx, fmt.Sprintf(`
INSERT INTO %s (api_key_id, position, model_id)
VALUES ($1,$2,$3)
`, table), keyID, i, modelID); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresInvitationCodes(ctx context.Context, q postgresQuerier, codes []models.InvitationCode) error {
	for i, code := range codes {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_invitation_codes (id, position, code, note, created_at, expires_at, max_uses)
VALUES ($1,$2,$3,$4,$5,$6,$7)
`, code.ID, i, code.Code, code.Note, code.CreatedAt, code.ExpiresAt, code.MaxUses); err != nil {
			return err
		}
		for j, use := range code.UsedBy {
			if _, err := q.Exec(ctx, `
INSERT INTO sapi_invitation_code_uses (invitation_id, position, user_id, used_at)
VALUES ($1,$2,$3,$4)
`, code.ID, j, use.UserID, use.UsedAt); err != nil {
				return err
			}
		}
	}
	return nil
}

func savePostgresVerificationCodes(ctx context.Context, q postgresQuerier, codes []models.VerificationCode) error {
	for i, code := range codes {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_verification_codes (position, email, code, purpose, created_at, used)
VALUES ($1,$2,$3,$4,$5,$6)
`, i, code.Email, code.Code, code.Purpose, code.CreatedAt, code.Used); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresAdminPasskeys(ctx context.Context, q postgresQuerier, passkeys []models.AdminPasskey) error {
	for i, passkey := range passkeys {
		raw, err := json.Marshal(passkey.Credential)
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_admin_passkeys (id, position, name, credential, created_at, updated_at, last_used_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)
`, passkey.ID, i, passkey.Name, raw, passkey.CreatedAt, passkey.UpdatedAt, passkey.LastUsedAt); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresAnnouncements(ctx context.Context, q postgresQuerier, announcements []models.Announcement) error {
	for i, item := range announcements {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_announcements (id, position, title, content, type, enabled, send_email, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
`, item.ID, i, item.Title, item.Content, item.Type, item.Enabled, item.SendEmail, item.CreatedAt, item.UpdatedAt); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresSuggestions(ctx context.Context, q postgresQuerier, suggestions []models.Suggestion) error {
	for i, item := range suggestions {
		if _, err := q.Exec(ctx, `
INSERT INTO sapi_suggestions (
  id, position, title, content, contact, user_id, user_name, reply,
  replied_at, replied_by, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
`, item.ID, i, item.Title, item.Content, item.Contact, item.UserID, item.UserName, item.Reply,
			item.RepliedAt, item.RepliedBy, item.CreatedAt, item.UpdatedAt); err != nil {
			return err
		}
	}
	return nil
}

func savePostgresOpaquePayloads(ctx context.Context, q postgresQuerier, query string, values []interface{}) error {
	for i, value := range values {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, query, i, raw); err != nil {
			return err
		}
	}
	return nil
}

func sortedMapKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
