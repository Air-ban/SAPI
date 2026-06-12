package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"sapi/auth"
	"sapi/billing"
	"sapi/config"
	"sapi/middleware"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/subscription"
)

func TestUserCreatePaymentOrderReturnsEpaySubmitParams(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")
	t.Setenv("SAPI_PUBLIC_BASE_URL", "https://sapi.example.test")

	cfg := config.Load()
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}

	store.MutateDB(func(db *models.Database) interface{} {
		db.Users = []models.User{{
			ID:               "usr_buyer",
			Username:         "buyer",
			Email:            "buyer@example.com",
			Enabled:          true,
			SubscriptionTier: subscription.TierEmail,
		}}
		db.PaymentConfig = &models.PaymentConfig{
			Enabled:      true,
			Provider:     "ezfpy",
			GatewayURL:   "https://www.ezfpy.cn/",
			MAPIURL:      "https://www.ezfpy.cn",
			MerchantID:   "3963",
			MerchantKey:  "merchant-secret",
			SiteName:     "SAPI",
			AllowedTypes: []string{"alipay"},
		}
		return nil
	})

	db := store.ReadDB()
	token := auth.SignTokenString(auth.TokenPayload{Role: "user", Sub: "usr_buyer"}, db.AppSecret)
	req := httptest.NewRequest(http.MethodPost, "/api/user/payments", strings.NewReader(`{"subscriptionTier":"base","payType":"alipay"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	middleware.RequireUserAccount(handleUserCreatePaymentOrder)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		GatewayURL string            `json:"gatewayUrl"`
		Method     string            `json:"method"`
		Params     map[string]string `json:"params"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.GatewayURL != billing.DefaultGatewayURL {
		t.Fatalf("gatewayUrl = %q, want %q", payload.GatewayURL, billing.DefaultGatewayURL)
	}
	if payload.Method != "POST" {
		t.Fatalf("method = %q, want POST", payload.Method)
	}
	if payload.Params["notify_url"] != "https://sapi.example.test/api/payments/ezfpy/notify" {
		t.Fatalf("notify_url = %q", payload.Params["notify_url"])
	}
	if payload.Params["return_url"] != "https://sapi.example.test/api/payments/ezfpy/return" {
		t.Fatalf("return_url = %q", payload.Params["return_url"])
	}
	if payload.Params["money"] != "9.90" {
		t.Fatalf("money = %q, want 9.90", payload.Params["money"])
	}
	if payload.Params["sign"] == "" || !billing.VerifyEpaySign(payload.Params, "merchant-secret") {
		t.Fatalf("invalid sign in params: %#v", payload.Params)
	}
	if len(store.ReadDB().PaymentOrders) != 1 {
		t.Fatalf("payment orders = %d, want 1", len(store.ReadDB().PaymentOrders))
	}
}
