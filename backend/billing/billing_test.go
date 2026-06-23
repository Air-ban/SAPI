package billing

import (
	"testing"

	"sapi/models"
)

func TestNormalizeSubscriptionPlansMigratesLegacyEmailRPM(t *testing.T) {
	plans := NormalizeSubscriptionPlans([]models.SubscriptionPlan{{
		ID:        "email",
		Name:      "Email",
		RPMLimit:  5,
		Enabled:   true,
		SortOrder: 10,
	}})

	plan := mustPlanByID(t, plans, "email")
	if plan.RPMLimit != 1 {
		t.Fatalf("email RPMLimit = %d, want 1", plan.RPMLimit)
	}
}

func TestNormalizeSubscriptionPlansKeepsCustomEmailRPM(t *testing.T) {
	plans := NormalizeSubscriptionPlans([]models.SubscriptionPlan{{
		ID:        "email",
		Name:      "Email",
		RPMLimit:  2,
		Enabled:   true,
		SortOrder: 10,
	}})

	plan := mustPlanByID(t, plans, "email")
	if plan.RPMLimit != 2 {
		t.Fatalf("email RPMLimit = %d, want custom 2", plan.RPMLimit)
	}
}

func TestDefaultSubscriptionPlansIncludeDayAndWeekCards(t *testing.T) {
	plans := DefaultSubscriptionPlans()
	day := mustPlanByID(t, plans, "day")
	if day.DurationDays != 1 {
		t.Fatalf("day DurationDays = %d, want 1", day.DurationDays)
	}
	week := mustPlanByID(t, plans, "week")
	if week.DurationDays != 7 {
		t.Fatalf("week DurationDays = %d, want 7", week.DurationDays)
	}
}

func TestNormalizeSubscriptionPlansKeepsCustomPlanAndRoutes(t *testing.T) {
	plans := NormalizeSubscriptionPlans([]models.SubscriptionPlan{{
		ID:                  "trial-2d",
		Name:                "Two Day Trial",
		RPMLimit:            12,
		DurationDays:        2,
		ModelProviderRoutes: map[string]string{"gpt-4o-mini": "prv_fast"},
		Enabled:             true,
		SortOrder:           15,
	}})

	plan := mustPlanByID(t, plans, "trial-2d")
	if plan.RPMLimit != 12 || plan.DurationDays != 2 {
		t.Fatalf("plan = %#v, want custom rpm/duration", plan)
	}
	if got := plan.ModelProviderRoutes["gpt-4o-mini"]; got != "prv_fast" {
		t.Fatalf("route = %q, want prv_fast", got)
	}
}

func TestNormalizePaymentConfigCanonicalizesEpayRootEndpoints(t *testing.T) {
	cfg := NormalizePaymentConfig(&models.PaymentConfig{
		GatewayURL: "https://www.ezfpy.cn/",
		MAPIURL:    DefaultGatewayURL,
	})

	if cfg.GatewayURL != DefaultGatewayURL {
		t.Fatalf("GatewayURL = %q, want %q", cfg.GatewayURL, DefaultGatewayURL)
	}
	if cfg.MAPIURL != DefaultMAPIURL {
		t.Fatalf("MAPIURL = %q, want %q", cfg.MAPIURL, DefaultMAPIURL)
	}
}

func mustPlanByID(t *testing.T, plans []models.SubscriptionPlan, id string) models.SubscriptionPlan {
	t.Helper()
	for _, plan := range plans {
		if plan.ID == id {
			return plan
		}
	}
	t.Fatalf("plan %q not found in %#v", id, plans)
	return models.SubscriptionPlan{}
}
