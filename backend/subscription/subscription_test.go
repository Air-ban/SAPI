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
		{tier: TierEmail, want: 5},
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

func TestGitHubUserRPMLimit(t *testing.T) {
	user := &models.User{SubscriptionTier: TierLite, GitHubID: "42", GitHubLogin: "octo"}

	if got := RPMLimitForUser(user); got != GitHubUserRPMLimit {
		t.Fatalf("RPMLimitForUser(github) = %d, want %d", got, GitHubUserRPMLimit)
	}

	tests := []struct {
		name   string
		keyRPM int
		want   int
	}{
		{name: "empty follows github cap", keyRPM: 0, want: GitHubUserRPMLimit},
		{name: "lower key override still uses github cap", keyRPM: 20, want: GitHubUserRPMLimit},
		{name: "higher key override still uses github cap", keyRPM: 100, want: GitHubUserRPMLimit},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := &models.APIKeyRecord{RPMLimit: tt.keyRPM}
			if got := EffectiveAPIKeyRPMLimit(user, key); got != tt.want {
				t.Fatalf("EffectiveAPIKeyRPMLimit(github) = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestEduUserRPMLimit(t *testing.T) {
	users := []*models.User{
		{SubscriptionTier: TierLite, Source: "edu"},
		{SubscriptionTier: TierLite, Email: "student@example.edu.cn"},
	}

	for _, user := range users {
		if got := RPMLimitForUser(user); got != EduUserRPMLimit {
			t.Fatalf("RPMLimitForUser(edu) = %d, want %d", got, EduUserRPMLimit)
		}

		tests := []struct {
			name   string
			keyRPM int
			want   int
		}{
			{name: "empty follows edu cap", keyRPM: 0, want: EduUserRPMLimit},
			{name: "lower key override still uses edu cap", keyRPM: 20, want: EduUserRPMLimit},
			{name: "higher key override still uses edu cap", keyRPM: 100, want: EduUserRPMLimit},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				key := &models.APIKeyRecord{RPMLimit: tt.keyRPM}
				if got := EffectiveAPIKeyRPMLimit(user, key); got != tt.want {
					t.Fatalf("EffectiveAPIKeyRPMLimit(edu) = %d, want %d", got, tt.want)
				}
			})
		}
	}
}

func TestGitHubUserRPMLimitWinsOverEdu(t *testing.T) {
	user := &models.User{
		SubscriptionTier: TierLite,
		Source:           "edu",
		Email:            "octo@example.edu.cn",
		GitHubLogin:      "octo",
	}

	if got := RPMLimitForUser(user); got != GitHubUserRPMLimit {
		t.Fatalf("RPMLimitForUser(github+edu) = %d, want %d", got, GitHubUserRPMLimit)
	}
	if got := EffectiveAPIKeyRPMLimit(user, &models.APIKeyRecord{RPMLimit: 20}); got != GitHubUserRPMLimit {
		t.Fatalf("EffectiveAPIKeyRPMLimit(github+edu) = %d, want %d", got, GitHubUserRPMLimit)
	}
}

func TestClampAPIKeyRPMLimit(t *testing.T) {
	pro := &models.User{SubscriptionTier: TierPro}
	maxUser := &models.User{SubscriptionTier: TierMax}
	githubUser := &models.User{SubscriptionTier: TierLite, GitHubLogin: "octo"}
	eduUser := &models.User{SubscriptionTier: TierLite, Source: "edu"}

	tests := []struct {
		name   string
		user   *models.User
		keyRPM int
		want   int
	}{
		{name: "empty follows subscription", user: pro, keyRPM: 0, want: 0},
		{name: "pro clamps above tier", user: pro, keyRPM: 100, want: 50},
		{name: "pro keeps lower override", user: pro, keyRPM: 20, want: 20},
		{name: "github clamps above cap", user: githubUser, keyRPM: 100, want: GitHubUserRPMLimit},
		{name: "github raises lower override to cap", user: githubUser, keyRPM: 20, want: GitHubUserRPMLimit},
		{name: "edu clamps above cap", user: eduUser, keyRPM: 100, want: EduUserRPMLimit},
		{name: "edu raises lower override to cap", user: eduUser, keyRPM: 20, want: EduUserRPMLimit},
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
