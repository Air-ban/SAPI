package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"sapi/auth"
	"sapi/billing"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
	"sapi/usage"
	"sapi/utils"
)

func handleAdminUpdateSubscriptionPlans(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}
	rawPlans, ok := body["subscriptionPlans"].([]interface{})
	if !ok {
		utils.SendError(w, http.StatusBadRequest, "subscriptionPlans is required.", "invalid_subscription_plans")
		return
	}
	plans := make([]models.SubscriptionPlan, 0, len(rawPlans))
	for _, raw := range rawPlans {
		item, _ := raw.(map[string]interface{})
		id := subscription.NormalizeTier(security.SafeSingleLine(toString(item["id"]), 32))
		if !subscription.IsValidTier(id) {
			utils.SendError(w, http.StatusBadRequest, "Subscription tier is invalid.", "invalid_subscription_tier")
			return
		}
		plans = append(plans, models.SubscriptionPlan{
			ID:               id,
			Name:             security.SafeSingleLine(toString(item["name"]), 80),
			Description:      security.SafeText(toString(item["description"]), 500),
			RPMLimit:         maxInt(0, int(toFloat(item["rpmLimit"]))),
			PriceCents:       maxInt(0, int(toFloat(item["priceCents"]))),
			CreditMicrounits: maxInt64(0, int64(toFloat(item["creditMicrounits"]))),
			DurationDays:     maxInt(1, int(toFloat(item["durationDays"]))),
			Enabled:          toBool(item["enabled"]),
			SortOrder:        int(toFloat(item["sortOrder"])),
		})
	}
	updated := billing.NormalizeSubscriptionPlans(plans)
	store.MutateDB(func(db *models.Database) interface{} {
		db.SubscriptionPlans = updated
		return nil
	})
	json.NewEncoder(w).Encode(map[string]interface{}{"subscriptionTiers": subscription.TiersForDB(store.ReadDB())})
}

func handleAdminUpdateBillingConfig(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}
	cfg := &models.BillingConfig{
		Enabled:          toBool(body["enabled"]),
		Currency:         security.SafeSingleLine(toString(body["currency"]), 8),
		USDToCNYRate:     toFloat(body["usdToCnyRate"]),
		MarkupMultiplier: toFloat(body["markupMultiplier"]),
		ModelsDevURL:     security.SafeSingleLine(toString(body["modelsDevUrl"]), 2048),
	}
	if existing := store.ReadDB().BillingConfig; existing != nil {
		cfg.LastPriceSyncAt = existing.LastPriceSyncAt
	}
	if cfg.ModelsDevURL != "" && !security.ValidHTTPBaseURL(cfg.ModelsDevURL) {
		utils.SendError(w, http.StatusBadRequest, "models.dev URL is invalid.", "invalid_models_dev_url")
		return
	}
	cfg = billing.NormalizeBillingConfig(cfg)
	store.MutateDB(func(db *models.Database) interface{} {
		db.BillingConfig = cfg
		return nil
	})
	json.NewEncoder(w).Encode(map[string]interface{}{"billingConfig": cfg})
}

func handleAdminSyncModelPrices(w http.ResponseWriter, r *http.Request) {
	db := store.ReadDB()
	cfg := billing.NormalizeBillingConfig(db.BillingConfig)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	prices, err := billing.SyncModelsDevPrices(ctx, cfg.ModelsDevURL)
	if err != nil {
		utils.SendError(w, http.StatusBadGateway, "Failed to sync models.dev prices: "+err.Error(), "price_sync_failed")
		return
	}
	now := store.Now()
	result := store.MutateDB(func(db *models.Database) interface{} {
		db.ModelPrices = billing.MergeModelPrices(db.ModelPrices, prices)
		db.BillingConfig = billing.NormalizeBillingConfig(db.BillingConfig)
		db.BillingConfig.LastPriceSyncAt = now
		return len(db.ModelPrices)
	})
	json.NewEncoder(w).Encode(map[string]interface{}{
		"modelPriceCount": result,
		"syncedCount":     len(prices),
		"lastPriceSyncAt": now,
	})
}

func handleAdminUpsertModelPrice(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}
	price := modelPriceFromBody(body)
	if price.ModelID == "" {
		utils.SendError(w, http.StatusBadRequest, "modelId is required.", "invalid_model_price")
		return
	}
	price.Manual = true
	price.Source = "admin"
	price.UpdatedAt = store.Now()
	result := store.MutateDB(func(db *models.Database) interface{} {
		replaced := false
		for i := range db.ModelPrices {
			if strings.EqualFold(db.ModelPrices[i].ModelID, price.ModelID) {
				db.ModelPrices[i] = price
				replaced = true
				break
			}
		}
		if !replaced {
			db.ModelPrices = append(db.ModelPrices, price)
		}
		return price
	})
	json.NewEncoder(w).Encode(map[string]interface{}{"modelPrice": result})
}

func handleAdminDeleteModelPrice(w http.ResponseWriter, r *http.Request) {
	modelID := strings.TrimSpace(r.URL.Query().Get("modelId"))
	if modelID == "" {
		utils.SendError(w, http.StatusBadRequest, "modelId is required.", "invalid_model_price")
		return
	}
	removed := store.MutateDB(func(db *models.Database) interface{} {
		next := make([]models.ModelPrice, 0, len(db.ModelPrices))
		for _, price := range db.ModelPrices {
			if !strings.EqualFold(price.ModelID, modelID) {
				next = append(next, price)
			}
		}
		changed := len(next) != len(db.ModelPrices)
		db.ModelPrices = next
		return changed
	}).(bool)
	if !removed {
		utils.SendError(w, http.StatusNotFound, "Model price not found.", "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleAdminUpdatePaymentConfig(w http.ResponseWriter, r *http.Request) {
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}
	existing := billing.NormalizePaymentConfig(store.ReadDB().PaymentConfig)
	cfg := &models.PaymentConfig{
		Enabled:      toBool(body["enabled"]),
		Provider:     "ezfpy",
		GatewayURL:   security.SafeSingleLine(toString(body["gatewayUrl"]), 2048),
		MerchantID:   security.SafeSingleLine(toString(body["merchantId"]), 128),
		MerchantKey:  security.SafeSingleLine(toString(body["merchantKey"]), 512),
		SiteName:     security.SafeSingleLine(toString(body["siteName"]), 120),
		NotifyURL:    security.SafeSingleLine(toString(body["notifyUrl"]), 2048),
		ReturnURL:    security.SafeSingleLine(toString(body["returnUrl"]), 2048),
		AllowedTypes: []string{},
	}
	if cfg.MerchantKey == "" {
		cfg.MerchantKey = existing.MerchantKey
	}
	if cfg.GatewayURL != "" && !security.ValidHTTPBaseURL(cfg.GatewayURL) {
		utils.SendError(w, http.StatusBadRequest, "Payment gateway URL is invalid.", "invalid_payment_gateway")
		return
	}
	if items, ok := body["allowedTypes"].([]interface{}); ok {
		for _, item := range items {
			cfg.AllowedTypes = append(cfg.AllowedTypes, security.SafeSingleLine(toString(item), 32))
		}
	}
	cfg = billing.NormalizePaymentConfig(cfg)
	store.MutateDB(func(db *models.Database) interface{} {
		db.PaymentConfig = cfg
		return nil
	})
	json.NewEncoder(w).Encode(map[string]interface{}{"paymentConfig": billing.PublicPaymentConfig(cfg)})
}

func handleUserBilling(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	db := store.ReadDB()
	days := queryInt(r, "days", 30, 1, 365)
	stats := usage.GetUsageStats(db, user.ID, days)
	stats.Recent = store.RequestLogsForUserView(stats.Recent)
	stats.RecentRequests = store.RequestLogsForUserView(stats.RecentRequests)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":          sanitizeUserWithDB(user, db),
		"usage":         stats,
		"plans":         publicSubscriptionPlans(db),
		"paymentConfig": billing.PublicPaymentConfig(db.PaymentConfig),
		"orders":        sanitizePaymentOrders(filterPaymentOrdersForUser(db.PaymentOrders, user.ID), false),
	})
}

func handleUserListPaymentOrders(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	db := store.ReadDB()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"orders": sanitizePaymentOrders(filterPaymentOrdersForUser(db.PaymentOrders, user.ID), false),
	})
}

func handleUserCreatePaymentOrder(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil || user.ID == models.AdminVirtualUserID {
		utils.SendError(w, http.StatusForbidden, "Admin virtual account does not need payment.", "admin_payment_not_required")
		return
	}
	body, ok := readJSONBody(w, r)
	if !ok {
		return
	}
	tierID := subscription.NormalizeTier(security.SafeSingleLine(toString(body["subscriptionTier"]), 32))
	payType := strings.ToLower(security.SafeSingleLine(toString(body["payType"]), 32))
	baseURL := publicBaseURLForRequest(r, config.Load())
	if baseURL == "" {
		baseURL = strings.TrimRight(config.Load().PublicBaseURL, "/")
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		cfg := billing.NormalizePaymentConfig(db.PaymentConfig)
		if !cfg.Enabled || cfg.MerchantID == "" || cfg.MerchantKey == "" {
			return "payment_not_configured"
		}
		if !stringInSlice(payType, cfg.AllowedTypes) {
			return "invalid_pay_type"
		}
		plan, ok := billing.PlanByID(db.SubscriptionPlans, tierID)
		if !ok || !plan.Enabled || plan.PriceCents <= 0 {
			return "invalid_plan"
		}
		userIndex := -1
		for i := range db.Users {
			if db.Users[i].ID == user.ID {
				userIndex = i
				break
			}
		}
		if userIndex < 0 {
			return "not_found"
		}
		now := store.Now()
		orderID := auth.RandomID("pay")
		outTradeNo := "sapi_" + strings.TrimPrefix(orderID, "pay_")
		notifyURL := cfg.NotifyURL
		returnURL := cfg.ReturnURL
		if notifyURL == "" && baseURL != "" {
			notifyURL = strings.TrimRight(baseURL, "/") + "/api/payments/ezfpy/notify"
		}
		if returnURL == "" && baseURL != "" {
			returnURL = strings.TrimRight(baseURL, "/") + "/api/payments/ezfpy/return"
		}
		order := models.PaymentOrder{
			ID:               orderID,
			UserID:           db.Users[userIndex].ID,
			Username:         db.Users[userIndex].Username,
			SubscriptionTier: plan.ID,
			PlanName:         plan.Name,
			AmountCents:      plan.PriceCents,
			CreditMicrounits: plan.CreditMicrounits,
			Currency:         billing.DefaultCurrency,
			Provider:         "ezfpy",
			PayType:          payType,
			OutTradeNo:       outTradeNo,
			Status:           "pending",
			CreatedAt:        now,
			ExpiresAt:        time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339),
		}
		db.PaymentOrders = append(db.PaymentOrders, order)
		params := map[string]string{
			"pid":          cfg.MerchantID,
			"type":         payType,
			"out_trade_no": outTradeNo,
			"notify_url":   notifyURL,
			"return_url":   returnURL,
			"name":         plan.Name,
			"money":        billing.AmountString(plan.PriceCents),
			"sitename":     cfg.SiteName,
			"sign_type":    "MD5",
		}
		params["sign"] = billing.SignEpayParams(params, cfg.MerchantKey)
		return map[string]interface{}{
			"order":      order,
			"gatewayUrl": cfg.GatewayURL,
			"method":     "POST",
			"params":     params,
		}
	})

	if errCode, ok := result.(string); ok {
		switch errCode {
		case "payment_not_configured":
			utils.SendError(w, http.StatusBadRequest, "Payment is not configured.", errCode)
		case "invalid_pay_type":
			utils.SendError(w, http.StatusBadRequest, "Payment type is invalid.", errCode)
		case "invalid_plan":
			utils.SendError(w, http.StatusBadRequest, "Subscription plan is invalid or free.", errCode)
		default:
			utils.SendError(w, http.StatusNotFound, "User not found.", errCode)
		}
		return
	}
	json.NewEncoder(w).Encode(result)
}

func handleEpayNotify(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("fail"))
		return
	}
	if ok := settleEpayOrder(r.Form); !ok {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("fail"))
		return
	}
	w.Write([]byte("success"))
}

func handleEpayReturn(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	settleEpayOrder(r.Form)
	http.Redirect(w, r, "/#portal", http.StatusSeeOther)
}

func settleEpayOrder(values url.Values) bool {
	params := billing.ValuesToStringMap(values)
	outTradeNo := strings.TrimSpace(params["out_trade_no"])
	if outTradeNo == "" {
		return false
	}
	db := store.ReadDB()
	cfg := billing.NormalizePaymentConfig(db.PaymentConfig)
	if !billing.VerifyEpaySign(params, cfg.MerchantKey) {
		return false
	}
	status := strings.ToUpper(strings.TrimSpace(params["trade_status"]))
	if status != "" && status != "TRADE_SUCCESS" && status != "SUCCESS" {
		return false
	}
	paid := store.MutateDB(func(db *models.Database) interface{} {
		now := store.Now()
		for i := range db.PaymentOrders {
			order := &db.PaymentOrders[i]
			if order.OutTradeNo != outTradeNo {
				continue
			}
			if order.Status == "paid" {
				return true
			}
			if order.Status != "pending" {
				return false
			}
			if !moneyMatchesOrder(params["money"], order.AmountCents) {
				order.Status = "amount_mismatch"
				order.RawNotify = params
				return false
			}
			order.Status = "paid"
			order.TradeNo = security.SafeSingleLine(params["trade_no"], 128)
			order.PaidAt = now
			order.RawNotify = params
			for j := range db.Users {
				if db.Users[j].ID != order.UserID {
					continue
				}
				plan, _ := billing.PlanByID(db.SubscriptionPlans, order.SubscriptionTier)
				db.Users[j].SubscriptionTier = order.SubscriptionTier
				db.Users[j].CreditBalanceMicrounits += order.CreditMicrounits
				expiresAt := time.Now().UTC().Add(time.Duration(maxInt(1, plan.DurationDays)) * 24 * time.Hour)
				db.Users[j].SubscriptionExpiresAt = expiresAt.Format(time.RFC3339)
				db.Users[j].UpdatedAt = now
				break
			}
			return true
		}
		return false
	})
	ok, _ := paid.(bool)
	return ok
}

func modelPriceFromBody(body map[string]interface{}) models.ModelPrice {
	return models.ModelPrice{
		ModelID:                       security.SafeSingleLine(toString(body["modelId"]), 200),
		DisplayName:                   security.SafeSingleLine(toString(body["displayName"]), 160),
		ProviderID:                    security.SafeSingleLine(toString(body["providerId"]), 120),
		InputUSDPerMillionTokens:      maxFloat(0, toFloat(body["inputUsdPerMillionTokens"])),
		OutputUSDPerMillionTokens:     maxFloat(0, toFloat(body["outputUsdPerMillionTokens"])),
		CacheReadUSDPerMillionTokens:  maxFloat(0, toFloat(body["cacheReadUsdPerMillionTokens"])),
		CacheWriteUSDPerMillionTokens: maxFloat(0, toFloat(body["cacheWriteUsdPerMillionTokens"])),
		ReasoningUSDPerMillionTokens:  maxFloat(0, toFloat(body["reasoningUsdPerMillionTokens"])),
	}
}

func publicSubscriptionPlans(db *models.Database) []models.SubscriptionPlan {
	plans := billing.NormalizeSubscriptionPlans(db.SubscriptionPlans)
	result := make([]models.SubscriptionPlan, 0, len(plans))
	for _, plan := range plans {
		if plan.Enabled && plan.ID != subscription.TierMax {
			result = append(result, plan)
		}
	}
	return result
}

func filterPaymentOrdersForUser(orders []models.PaymentOrder, userID string) []models.PaymentOrder {
	result := make([]models.PaymentOrder, 0)
	for _, order := range orders {
		if order.UserID == userID {
			result = append(result, order)
		}
	}
	return result
}

func sanitizePaymentOrders(orders []models.PaymentOrder, includeRaw bool) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(orders))
	for _, order := range orders {
		item := map[string]interface{}{
			"id":               order.ID,
			"userId":           order.UserID,
			"username":         order.Username,
			"subscriptionTier": order.SubscriptionTier,
			"planName":         order.PlanName,
			"amountCents":      order.AmountCents,
			"creditMicrounits": order.CreditMicrounits,
			"currency":         order.Currency,
			"provider":         order.Provider,
			"payType":          order.PayType,
			"outTradeNo":       order.OutTradeNo,
			"tradeNo":          order.TradeNo,
			"status":           order.Status,
			"createdAt":        order.CreatedAt,
			"paidAt":           order.PaidAt,
			"expiresAt":        order.ExpiresAt,
		}
		if includeRaw {
			item["rawNotify"] = order.RawNotify
		}
		result = append(result, item)
	}
	return result
}

func moneyMatchesOrder(value string, amountCents int) bool {
	paid, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return false
	}
	return int(paid*100+0.5) == amountCents
}

func stringInSlice(value string, items []string) bool {
	for _, item := range items {
		if strings.EqualFold(value, item) {
			return true
		}
	}
	return false
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
