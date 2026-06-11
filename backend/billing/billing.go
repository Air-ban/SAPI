package billing

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"sapi/models"
)

const (
	DefaultModelsDevURL = "https://models.dev/api.json"
	DefaultGatewayURL   = "https://www.ezfpy.cn/submit.php"
	DefaultMAPIURL      = "https://www.ezfpy.cn/mapi.php"
	DefaultCurrency     = "CNY"
	MicrounitsPerCNY    = int64(1000000)
)

type CostBreakdown struct {
	ModelPrice         *models.ModelPrice `json:"modelPrice,omitempty"`
	CostUSD            float64            `json:"costUsd"`
	CostCNY            float64            `json:"costCny"`
	BillableMicrounits int64              `json:"billableMicrounits"`
}

func DefaultBillingConfig() *models.BillingConfig {
	return &models.BillingConfig{
		Enabled:          true,
		Currency:         DefaultCurrency,
		USDToCNYRate:     7.2,
		MarkupMultiplier: 1,
		ModelsDevURL:     DefaultModelsDevURL,
	}
}

func DefaultPaymentConfig() *models.PaymentConfig {
	return &models.PaymentConfig{
		Enabled:      false,
		Provider:     "ezfpy",
		GatewayURL:   DefaultGatewayURL,
		MAPIURL:      DefaultMAPIURL,
		SiteName:     "SAPI",
		AllowedTypes: []string{"alipay", "wxpay", "qqpay"},
	}
}

func DefaultSubscriptionPlans() []models.SubscriptionPlan {
	return []models.SubscriptionPlan{
		{ID: "email", Name: "Email", Description: "普通邮箱注册默认套餐", RPMLimit: 1, PriceCents: 0, CreditMicrounits: 0, DurationDays: 30, Enabled: true, SortOrder: 10},
		{ID: "lite", Name: "Lite", Description: "轻量体验套餐", RPMLimit: 10, PriceCents: 0, CreditMicrounits: 0, DurationDays: 30, Enabled: true, SortOrder: 20},
		{ID: "base", Name: "Base", Description: "日常使用套餐", RPMLimit: 30, PriceCents: 990, CreditMicrounits: 10 * MicrounitsPerCNY, DurationDays: 30, Enabled: true, SortOrder: 30},
		{ID: "pro", Name: "Pro", Description: "高频调用套餐", RPMLimit: 50, PriceCents: 2990, CreditMicrounits: 35 * MicrounitsPerCNY, DurationDays: 30, Enabled: true, SortOrder: 40},
		{ID: "ultra", Name: "Ultra", Description: "大额度调用套餐", RPMLimit: 100, PriceCents: 6990, CreditMicrounits: 90 * MicrounitsPerCNY, DurationDays: 30, Enabled: true, SortOrder: 50},
		{ID: "MAX", Name: "MAX", Description: "管理员或无限制套餐", RPMLimit: 0, PriceCents: 0, CreditMicrounits: 0, DurationDays: 3650, Enabled: true, SortOrder: 60},
	}
}

func NormalizeBillingConfig(cfg *models.BillingConfig) *models.BillingConfig {
	if cfg == nil {
		cfg = DefaultBillingConfig()
	}
	if strings.TrimSpace(cfg.Currency) == "" {
		cfg.Currency = DefaultCurrency
	}
	cfg.Currency = strings.ToUpper(strings.TrimSpace(cfg.Currency))
	if cfg.USDToCNYRate <= 0 {
		cfg.USDToCNYRate = 7.2
	}
	if cfg.MarkupMultiplier <= 0 {
		cfg.MarkupMultiplier = 1
	}
	if strings.TrimSpace(cfg.ModelsDevURL) == "" {
		cfg.ModelsDevURL = DefaultModelsDevURL
	}
	return cfg
}

func NormalizePaymentConfig(cfg *models.PaymentConfig) *models.PaymentConfig {
	if cfg == nil {
		cfg = DefaultPaymentConfig()
	}
	if strings.TrimSpace(cfg.Provider) == "" {
		cfg.Provider = "ezfpy"
	}
	if strings.TrimSpace(cfg.GatewayURL) == "" || sameURL(cfg.GatewayURL, DefaultMAPIURL) {
		cfg.GatewayURL = DefaultGatewayURL
	}
	cfg.GatewayURL = strings.TrimRight(strings.TrimSpace(cfg.GatewayURL), "/")
	if strings.TrimSpace(cfg.MAPIURL) == "" {
		cfg.MAPIURL = DefaultMAPIURL
	}
	cfg.MAPIURL = strings.TrimRight(strings.TrimSpace(cfg.MAPIURL), "/")
	if strings.TrimSpace(cfg.SiteName) == "" {
		cfg.SiteName = "SAPI"
	}
	if len(cfg.AllowedTypes) == 0 {
		cfg.AllowedTypes = []string{"alipay", "wxpay", "qqpay"}
	}
	seen := map[string]bool{}
	cleaned := make([]string, 0, len(cfg.AllowedTypes))
	for _, item := range cfg.AllowedTypes {
		value := strings.ToLower(strings.TrimSpace(item))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		cleaned = append(cleaned, value)
	}
	cfg.AllowedTypes = cleaned
	return cfg
}

func NormalizeSubscriptionPlans(plans []models.SubscriptionPlan) []models.SubscriptionPlan {
	defaults := DefaultSubscriptionPlans()
	byID := map[string]models.SubscriptionPlan{}
	for _, plan := range defaults {
		byID[plan.ID] = plan
	}
	for _, plan := range plans {
		id := NormalizePlanID(plan.ID)
		if id == "" {
			continue
		}
		base, ok := byID[id]
		if !ok {
			base = models.SubscriptionPlan{ID: id, Name: id, Enabled: true, DurationDays: 30}
		}
		if strings.TrimSpace(plan.Name) != "" {
			base.Name = strings.TrimSpace(plan.Name)
		}
		if strings.TrimSpace(plan.Description) != "" {
			base.Description = strings.TrimSpace(plan.Description)
		}
		if id == "email" && plan.RPMLimit == 5 {
			base.RPMLimit = 1
		} else if plan.RPMLimit >= 0 {
			base.RPMLimit = plan.RPMLimit
		}
		if plan.PriceCents >= 0 {
			base.PriceCents = plan.PriceCents
		}
		if plan.CreditMicrounits >= 0 {
			base.CreditMicrounits = plan.CreditMicrounits
		}
		if plan.DurationDays > 0 {
			base.DurationDays = plan.DurationDays
		}
		base.Enabled = plan.Enabled
		if plan.SortOrder > 0 {
			base.SortOrder = plan.SortOrder
		}
		byID[id] = base
	}
	result := make([]models.SubscriptionPlan, 0, len(byID))
	for _, plan := range byID {
		result = append(result, plan)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].SortOrder == result[j].SortOrder {
			return result[i].ID < result[j].ID
		}
		return result[i].SortOrder < result[j].SortOrder
	})
	return result
}

func NormalizePlanID(value string) string {
	trimmed := strings.TrimSpace(value)
	if strings.EqualFold(trimmed, "max") {
		return "MAX"
	}
	return strings.ToLower(trimmed)
}

func PlanByID(plans []models.SubscriptionPlan, id string) (models.SubscriptionPlan, bool) {
	id = NormalizePlanID(id)
	for _, plan := range NormalizeSubscriptionPlans(plans) {
		if plan.ID == id {
			return plan, true
		}
	}
	return models.SubscriptionPlan{}, false
}

func PublicPaymentConfig(cfg *models.PaymentConfig) map[string]interface{} {
	cfg = NormalizePaymentConfig(cfg)
	return map[string]interface{}{
		"enabled":        cfg.Enabled,
		"provider":       cfg.Provider,
		"gatewayUrl":     cfg.GatewayURL,
		"mapiUrl":        cfg.MAPIURL,
		"merchantId":     cfg.MerchantID,
		"hasKey":         strings.TrimSpace(cfg.MerchantKey) != "",
		"hasSoftwareKey": strings.TrimSpace(cfg.SoftwareKey) != "",
		"siteName":       cfg.SiteName,
		"notifyUrl":      cfg.NotifyURL,
		"returnUrl":      cfg.ReturnURL,
		"allowedTypes":   cfg.AllowedTypes,
	}
}

func CalculateRequestCost(db *models.Database, item models.RequestLog) CostBreakdown {
	if db == nil {
		return CostBreakdown{}
	}
	cfg := NormalizeBillingConfig(db.BillingConfig)
	if !cfg.Enabled {
		return CostBreakdown{}
	}
	price, ok := FindModelPrice(db, item.Model, item.UpstreamModel)
	if !ok {
		return CostBreakdown{}
	}
	inputTokens := item.PromptTokens - item.CachedTokens - item.CacheCreationTokens
	if inputTokens < 0 {
		inputTokens = item.PromptTokens
	}
	cacheReadRate := price.CacheReadUSDPerMillionTokens
	if cacheReadRate <= 0 {
		cacheReadRate = price.InputUSDPerMillionTokens
	}
	cacheWriteRate := price.CacheWriteUSDPerMillionTokens
	if cacheWriteRate <= 0 {
		cacheWriteRate = price.InputUSDPerMillionTokens
	}
	outputRate := price.OutputUSDPerMillionTokens
	reasoningRate := price.ReasoningUSDPerMillionTokens
	if reasoningRate <= 0 {
		reasoningRate = 0
	}
	costUSD := perMillion(inputTokens, price.InputUSDPerMillionTokens) +
		perMillion(item.CachedTokens, cacheReadRate) +
		perMillion(item.CacheCreationTokens, cacheWriteRate) +
		perMillion(item.CompletionTokens, outputRate) +
		perMillion(item.ReasoningTokens, reasoningRate)
	costCNY := costUSD * cfg.USDToCNYRate * cfg.MarkupMultiplier
	microunits := int64(math.Round(costCNY * float64(MicrounitsPerCNY)))
	if microunits < 0 {
		microunits = 0
	}
	return CostBreakdown{ModelPrice: &price, CostUSD: costUSD, CostCNY: costCNY, BillableMicrounits: microunits}
}

func FindModelPrice(db *models.Database, modelID, upstreamModel string) (models.ModelPrice, bool) {
	if db == nil {
		return models.ModelPrice{}, false
	}
	candidates := []string{modelID, upstreamModel}
	for _, raw := range []string{modelID, upstreamModel} {
		if strings.Contains(raw, "/") {
			parts := strings.Split(raw, "/")
			candidates = append(candidates, parts[len(parts)-1])
		}
	}
	for _, wanted := range candidates {
		wanted = normalizeModelKey(wanted)
		if wanted == "" {
			continue
		}
		for _, price := range db.ModelPrices {
			if normalizeModelKey(price.ModelID) == wanted {
				return price, true
			}
		}
	}
	return models.ModelPrice{}, false
}

func perMillion(tokens int, rate float64) float64 {
	if tokens <= 0 || rate <= 0 {
		return 0
	}
	return float64(tokens) * rate / 1000000
}

func SyncModelsDevPrices(ctx context.Context, sourceURL string) ([]models.ModelPrice, error) {
	if strings.TrimSpace(sourceURL) == "" {
		sourceURL = DefaultModelsDevURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("models.dev returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
	if err != nil {
		return nil, err
	}

	var providers map[string]struct {
		Name   string                          `json:"name"`
		Models map[string]modelsDevModelRecord `json:"models"`
	}
	if err := json.Unmarshal(body, &providers); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	merged := map[string]models.ModelPrice{}
	for providerID, provider := range providers {
		for id, record := range provider.Models {
			price, ok := record.toModelPrice(id, providerID, now)
			if !ok {
				continue
			}
			key := normalizeModelKey(price.ModelID)
			if existing, exists := merged[key]; exists {
				if existing.ProviderID != "" && providerID != "openai" {
					continue
				}
			}
			merged[key] = price
		}
	}
	result := make([]models.ModelPrice, 0, len(merged))
	for _, price := range merged {
		result = append(result, price)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].ModelID < result[j].ModelID
	})
	return result, nil
}

type modelsDevModelRecord struct {
	ID   string                 `json:"id"`
	Name string                 `json:"name"`
	Cost map[string]interface{} `json:"cost"`
}

func (r modelsDevModelRecord) toModelPrice(fallbackID, providerID, now string) (models.ModelPrice, bool) {
	id := strings.TrimSpace(r.ID)
	if id == "" {
		id = fallbackID
	}
	if id == "" || len(r.Cost) == 0 {
		return models.ModelPrice{}, false
	}
	price := models.ModelPrice{
		ModelID:     id,
		DisplayName: r.Name,
		ProviderID:  providerID,
		Source:      "models.dev",
		UpdatedAt:   now,
	}
	price.InputUSDPerMillionTokens = numberFromCost(r.Cost, "input")
	price.OutputUSDPerMillionTokens = numberFromCost(r.Cost, "output")
	price.CacheReadUSDPerMillionTokens = numberFromCost(r.Cost, "cache_read")
	price.CacheWriteUSDPerMillionTokens = numberFromCost(r.Cost, "cache_write")
	price.ReasoningUSDPerMillionTokens = numberFromCost(r.Cost, "reasoning")
	if price.InputUSDPerMillionTokens == 0 && price.OutputUSDPerMillionTokens == 0 &&
		price.CacheReadUSDPerMillionTokens == 0 && price.CacheWriteUSDPerMillionTokens == 0 {
		return models.ModelPrice{}, false
	}
	return price, true
}

func numberFromCost(cost map[string]interface{}, key string) float64 {
	switch v := cost[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case string:
		n, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return n
	default:
		return 0
	}
}

func MergeModelPrices(existing, incoming []models.ModelPrice) []models.ModelPrice {
	byID := map[string]models.ModelPrice{}
	for _, price := range incoming {
		if strings.TrimSpace(price.ModelID) == "" {
			continue
		}
		byID[normalizeModelKey(price.ModelID)] = price
	}
	for _, price := range existing {
		if strings.TrimSpace(price.ModelID) == "" {
			continue
		}
		if price.Manual {
			byID[normalizeModelKey(price.ModelID)] = price
			continue
		}
		if _, ok := byID[normalizeModelKey(price.ModelID)]; !ok {
			byID[normalizeModelKey(price.ModelID)] = price
		}
	}
	result := make([]models.ModelPrice, 0, len(byID))
	for _, price := range byID {
		result = append(result, price)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].ModelID < result[j].ModelID
	})
	return result
}

func SignEpayParams(params map[string]string, merchantKey string) string {
	keys := make([]string, 0, len(params))
	for key, value := range params {
		if key == "sign" || key == "sign_type" || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+params[key])
	}
	base := strings.Join(parts, "&") + strings.TrimSpace(merchantKey)
	sum := md5.Sum([]byte(base))
	return hex.EncodeToString(sum[:])
}

func VerifyEpaySign(params map[string]string, merchantKey string) bool {
	got := strings.ToLower(strings.TrimSpace(params["sign"]))
	if got == "" || strings.TrimSpace(merchantKey) == "" {
		return false
	}
	return got == SignEpayParams(params, merchantKey)
}

func ValuesToStringMap(values url.Values) map[string]string {
	result := map[string]string{}
	for key, items := range values {
		if len(items) > 0 {
			result[key] = items[0]
		}
	}
	return result
}

func AmountString(cents int) string {
	if cents < 0 {
		cents = 0
	}
	return fmt.Sprintf("%.2f", float64(cents)/100)
}

func MicrounitsFromCents(cents int) int64 {
	if cents <= 0 {
		return 0
	}
	return int64(cents) * (MicrounitsPerCNY / 100)
}

func normalizeModelKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func sameURL(a, b string) bool {
	return strings.EqualFold(strings.TrimRight(strings.TrimSpace(a), "/"), strings.TrimRight(strings.TrimSpace(b), "/"))
}
