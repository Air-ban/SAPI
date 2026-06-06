package subscription

import (
	"strings"

	"sapi/models"
)

const (
	TierLite  = "lite"
	TierBase  = "base"
	TierPro   = "pro"
	TierUltra = "ultra"
	TierMax   = "MAX"
)

type TierInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	RPMLimit int    `json:"rpmLimit"`
}

var Tiers = []TierInfo{
	{ID: TierLite, Name: "Lite", RPMLimit: 10},
	{ID: TierBase, Name: "Base", RPMLimit: 30},
	{ID: TierPro, Name: "Pro", RPMLimit: 50},
	{ID: TierUltra, Name: "Ultra", RPMLimit: 100},
	{ID: TierMax, Name: "MAX", RPMLimit: 0},
}

func NormalizeTier(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
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
	return RPMLimitForTier(TierForUser(user))
}

func EffectiveAPIKeyRPMLimit(user *models.User, apiKeyRecord *models.APIKeyRecord) int {
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
	planLimit := RPMLimitForUser(user)
	if planLimit <= 0 {
		return rpmLimit
	}
	if rpmLimit > planLimit {
		return planLimit
	}
	return rpmLimit
}
