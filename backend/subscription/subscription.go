package subscription

import (
	"strings"

	"sapi/models"
)

const (
	TierEmail = "email"
	TierLite  = "lite"
	TierDay   = "day"
	TierWeek  = "week"
	TierBase  = "base"
	TierPro   = "pro"
	TierUltra = "ultra"
	TierMax   = "MAX"

	GitHubUserRPMLimit = 10
	EduUserRPMLimit    = 30
)

type TierInfo struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Description         string            `json:"description,omitempty"`
	RPMLimit            int               `json:"rpmLimit"`
	PriceCents          int               `json:"priceCents"`
	CreditMicrounits    int64             `json:"creditMicrounits"`
	DurationDays        int               `json:"durationDays"`
	ModelProviderRoutes map[string]string `json:"modelProviderRoutes"`
	Enabled             bool              `json:"enabled"`
	SortOrder           int               `json:"sortOrder"`
}

var Tiers = []TierInfo{
	{ID: TierEmail, Name: "Email", RPMLimit: 1, DurationDays: 30, Enabled: true, SortOrder: 10},
	{ID: TierLite, Name: "Lite", RPMLimit: 10, DurationDays: 30, Enabled: true, SortOrder: 20},
	{ID: TierDay, Name: "日卡", RPMLimit: 30, PriceCents: 199, CreditMicrounits: 2000000, DurationDays: 1, Enabled: true, SortOrder: 30},
	{ID: TierWeek, Name: "周卡", RPMLimit: 50, PriceCents: 999, CreditMicrounits: 12000000, DurationDays: 7, Enabled: true, SortOrder: 40},
	{ID: TierBase, Name: "Base", RPMLimit: 30, PriceCents: 990, CreditMicrounits: 10000000, DurationDays: 30, Enabled: true, SortOrder: 50},
	{ID: TierPro, Name: "Pro", RPMLimit: 50, PriceCents: 2990, CreditMicrounits: 35000000, DurationDays: 30, Enabled: true, SortOrder: 60},
	{ID: TierUltra, Name: "Ultra", RPMLimit: 100, PriceCents: 6990, CreditMicrounits: 90000000, DurationDays: 30, Enabled: true, SortOrder: 70},
	{ID: TierMax, Name: "MAX", RPMLimit: 0, DurationDays: 3650, Enabled: true, SortOrder: 80},
}

func NormalizeTier(value string) string {
	trimmed := strings.TrimSpace(value)
	if strings.EqualFold(trimmed, TierMax) {
		return TierMax
	}
	if trimmed == "" {
		return TierLite
	}
	return strings.ToLower(trimmed)
}

func IsValidTier(value string) bool {
	normalized := NormalizeTier(value)
	if normalized == "" || len(normalized) > 64 {
		return false
	}
	if normalized == TierMax {
		return true
	}
	for _, r := range normalized {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func TierForUser(user *models.User) string {
	if user == nil {
		return TierLite
	}
	return NormalizeTier(user.SubscriptionTier)
}

func DefaultTierForUser(user *models.User) string {
	if IsGitHubUser(user) {
		return TierLite
	}
	if IsEduUser(user) {
		return TierBase
	}
	if user != nil && strings.EqualFold(strings.TrimSpace(user.Source), "email") {
		return TierEmail
	}
	return TierLite
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

func TiersForDB(db *models.Database) []TierInfo {
	if db == nil || len(db.SubscriptionPlans) == 0 {
		return append([]TierInfo{}, Tiers...)
	}
	result := make([]TierInfo, 0, len(db.SubscriptionPlans))
	for _, plan := range db.SubscriptionPlans {
		result = append(result, TierInfo{
			ID:                  NormalizeTier(plan.ID),
			Name:                plan.Name,
			Description:         plan.Description,
			RPMLimit:            plan.RPMLimit,
			PriceCents:          plan.PriceCents,
			CreditMicrounits:    plan.CreditMicrounits,
			DurationDays:        plan.DurationDays,
			ModelProviderRoutes: plan.ModelProviderRoutes,
			Enabled:             plan.Enabled,
			SortOrder:           plan.SortOrder,
		})
	}
	return result
}

func RPMLimitForTierInDB(db *models.Database, tier string) int {
	normalized := NormalizeTier(tier)
	for _, item := range TiersForDB(db) {
		if item.ID == normalized {
			return item.RPMLimit
		}
	}
	return RPMLimitForTier(normalized)
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

func RPMLimitForUserInDB(user *models.User, db *models.Database) int {
	if user != nil && user.ID == models.AdminVirtualUserID {
		return 0
	}
	if IsGitHubUser(user) {
		return GitHubUserRPMLimit
	}
	if IsEduUser(user) {
		return EduUserRPMLimit
	}
	return RPMLimitForTierInDB(db, TierForUser(user))
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

func EffectiveAPIKeyRPMLimitInDB(user *models.User, apiKeyRecord *models.APIKeyRecord, db *models.Database) int {
	if user != nil && user.ID == models.AdminVirtualUserID {
		return 0
	}
	if IsGitHubUser(user) {
		return GitHubUserRPMLimit
	}
	if IsEduUser(user) {
		return EduUserRPMLimit
	}
	planLimit := RPMLimitForUserInDB(user, db)
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

func ClampAPIKeyRPMLimitInDB(user *models.User, rpmLimit int, db *models.Database) int {
	if rpmLimit <= 0 {
		return 0
	}
	if IsGitHubUser(user) {
		return GitHubUserRPMLimit
	}
	if IsEduUser(user) {
		return EduUserRPMLimit
	}
	planLimit := RPMLimitForUserInDB(user, db)
	if planLimit <= 0 {
		return rpmLimit
	}
	if rpmLimit > planLimit {
		return planLimit
	}
	return rpmLimit
}
