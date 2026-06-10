package subscription

import (
	"strings"

	"sapi/models"
)

const (
	TierEmail = "email"
	TierLite  = "lite"
	TierBase  = "base"
	TierPro   = "pro"
	TierUltra = "ultra"
	TierMax   = "MAX"

	GitHubUserRPMLimit = 52
	EduUserRPMLimit    = 50
)

type TierInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	RPMLimit int    `json:"rpmLimit"`
}

var Tiers = []TierInfo{
	{ID: TierEmail, Name: "Email", RPMLimit: 5},
	{ID: TierLite, Name: "Lite", RPMLimit: 10},
	{ID: TierBase, Name: "Base", RPMLimit: 30},
	{ID: TierPro, Name: "Pro", RPMLimit: 50},
	{ID: TierUltra, Name: "Ultra", RPMLimit: 100},
	{ID: TierMax, Name: "MAX", RPMLimit: 0},
}

func NormalizeTier(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case TierEmail:
		return TierEmail
	case TierLite:
		return TierLite
	case TierBase:
		return TierBase
	case TierPro:
		return TierPro
	case TierUltra:
		return TierUltra
	case strings.ToLower(TierMax):
		return TierMax
	default:
		return TierLite
	}
}

func IsValidTier(value string) bool {
	trimmed := strings.TrimSpace(value)
	return trimmed != "" && strings.EqualFold(NormalizeTier(trimmed), trimmed)
}

func TierForUser(user *models.User) string {
	if user == nil {
		return TierLite
	}
	return NormalizeTier(user.SubscriptionTier)
}

func RPMLimitForTier(tier string) int {
	normalized := NormalizeTier(tier)
	for _, item := range Tiers {
		if item.ID == normalized {
			return item.RPMLimit
		}
	}
	return 10
}

func RPMLimitForUser(user *models.User) int {
	if user != nil && user.ID == models.AdminVirtualUserID {
		return 0
	}
	if IsGitHubUser(user) {
		return GitHubUserRPMLimit
	}
	if IsEduUser(user) {
		return EduUserRPMLimit
	}
	return RPMLimitForTier(TierForUser(user))
}

func IsGitHubUser(user *models.User) bool {
	if user == nil {
		return false
	}
	return strings.TrimSpace(user.GitHubID) != "" ||
		strings.TrimSpace(user.GitHubLogin) != "" ||
		strings.EqualFold(strings.TrimSpace(user.Source), "github")
}

func IsEduUser(user *models.User) bool {
	if user == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(user.Source), "edu") ||
		strings.HasSuffix(strings.ToLower(strings.TrimSpace(user.Email)), ".edu.cn")
}

func EffectiveAPIKeyRPMLimit(user *models.User, apiKeyRecord *models.APIKeyRecord) int {
	if user != nil && user.ID == models.AdminVirtualUserID {
		return 0
	}
	if IsGitHubUser(user) {
		return GitHubUserRPMLimit
	}
	if IsEduUser(user) {
		return EduUserRPMLimit
	}
	planLimit := RPMLimitForUser(user)
	if apiKeyRecord == nil || apiKeyRecord.RPMLimit <= 0 {
		return planLimit
	}
	if planLimit <= 0 {
		return apiKeyRecord.RPMLimit
	}
	if apiKeyRecord.RPMLimit < planLimit {
		return apiKeyRecord.RPMLimit
	}
	return planLimit
}

func ClampAPIKeyRPMLimit(user *models.User, rpmLimit int) int {
	if rpmLimit <= 0 {
		return 0
	}
	if IsGitHubUser(user) {
		return GitHubUserRPMLimit
	}
	if IsEduUser(user) {
		return EduUserRPMLimit
	}
	planLimit := RPMLimitForUser(user)
	if planLimit <= 0 {
		return rpmLimit
	}
	if rpmLimit > planLimit {
		return planLimit
	}
	return rpmLimit
}
