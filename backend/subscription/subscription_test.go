package subscription

import (
	"testing"

	"sapi/models"
)

func TestRPMLimitForTier(t *testing.T) {
	tests := []struct {
		tier string
		want int
	}{
		{tier: TierLite, want: 10},
		{tier: TierBase, want: 30},
		{tier: TierPro, want: 50},
		{tier: TierUltra, want: 100},
		{tier: TierMax, want: 0},
		{tier: "", want: 10},
	}

	for _, tt := range tests {
		t.Run(tt.tier, func(t *testing.T) {
			if got := RPMLimitForTier(tt.tier); got != tt.want {
				t.Fatalf("RPMLimitForTier(%q) = %d, want %d", tt.tier, got, tt.want)
			}
		})
	}
}

func TestEffectiveAPIKeyRPMLimit(t *testing.T) {
	user := &models.User{SubscriptionTier: TierPro}

	tests := []struct {
		name   string
		keyRPM int
		want   int
	}{
		{name: "follows subscription", keyRPM: 0, want: 50},
		{name: "key can tighten limit", keyRPM: 20, want: 20},
		{name: "key cannot exceed subscription", keyRPM: 100, want: 50},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := &models.APIKeyRecord{RPMLimit: tt.keyRPM}
			if got := EffectiveAPIKeyRPMLimit(user, key); got != tt.want {
				t.Fatalf("EffectiveAPIKeyRPMLimit() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestClampAPIKeyRPMLimit(t *testing.T) {
	pro := &models.User{SubscriptionTier: TierPro}
	maxUser := &models.User{SubscriptionTier: TierMax}

	tests := []struct {
		name   string
		user   *models.User
		keyRPM int
		want   int
	}{
		{name: "empty follows subscription", user: pro, keyRPM: 0, want: 0},
		{name: "pro clamps above tier", user: pro, keyRPM: 100, want: 50},
		{name: "pro keeps lower override", user: pro, keyRPM: 20, want: 20},
		{name: "max accepts explicit key cap", user: maxUser, keyRPM: 200, want: 200},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClampAPIKeyRPMLimit(tt.user, tt.keyRPM); got != tt.want {
				t.Fatalf("ClampAPIKeyRPMLimit() = %d, want %d", got, tt.want)
			}
		})
	}
}
