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
