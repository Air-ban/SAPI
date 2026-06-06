package models

import (
	"strings"

	"github.com/go-webauthn/webauthn/webauthn"
)

type Database struct {
	Version            int                `json:"version"`
	AppSecret          string             `json:"appSecret"`
	Providers          []Provider         `json:"providers"`
	Users              []User             `json:"users"`
	TokenUsage         []interface{}      `json:"tokenUsage"`
	RequestLogs        []RequestLog       `json:"requestLogs"`
	AdminAPIKeys       []APIKeyRecord     `json:"adminApiKeys"`
	InvitationCodes    []InvitationCode   `json:"invitationCodes"`
	VerificationCodes  []VerificationCode `json:"verificationCodes"`
	AdminPasskeys      []AdminPasskey     `json:"adminPasskeys"`
	Announcements      []Announcement     `json:"announcements"`
	Documents          []interface{}      `json:"documents"`
	Suggestions        []Suggestion       `json:"suggestions"`
	SMTPConfig         *SMTPConfig        `json:"smtpConfig"`
	SiteEmail          string             `json:"siteEmail"`
	DefaultRPMLimit    int                `json:"defaultRpmLimit"`
	SiteBanner         *SiteBanner        `json:"siteBanner"`
	MaintenanceMode    bool               `json:"maintenanceMode"`
	MaintenanceEndTime string             `json:"maintenanceEndTime"`
	CreatedAt          string             `json:"createdAt"`
	UpdatedAt          string             `json:"updatedAt"`
}

type Provider struct {
	ID                string               `json:"id"`
	Name              string               `json:"name"`
	BaseURL           string               `json:"baseUrl"`
	APIKey            string               `json:"apiKey"`
	UpstreamFormat    string               `json:"upstreamFormat"`
	Models            []Model              `json:"models"`
	ModelMappings     map[string]string    `json:"modelMappings"`
	Enabled           bool                 `json:"enabled"`
	FailoverThreshold int                  `json:"failoverThreshold"`
	Priority          int                  `json:"priority"`
	HealthStatus      string               `json:"healthStatus"`
	Latency           int                  `json:"latency"`
	Ping              int                  `json:"ping"`
	Availability7d    float64              `json:"availability7d"`
	HealthHistory     []HealthHistoryEntry `json:"healthHistory"`
	LastHealthCheck   string               `json:"lastHealthCheck"`
	CreatedAt         string               `json:"createdAt"`
	UpdatedAt         string               `json:"updatedAt"`
}

const (
	UpstreamFormatAuto      = "auto"
	UpstreamFormatOpenAI    = "openai"
	UpstreamFormatGemini    = "gemini"
	UpstreamFormatAnthropic = "anthropic"
)

func NormalizeUpstreamFormat(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case UpstreamFormatOpenAI, UpstreamFormatGemini, UpstreamFormatAnthropic:
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return UpstreamFormatAuto
	}
}

type Model struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	CliSupport  []string `json:"cliSupport"`
}

type HealthHistoryEntry struct {
	Timestamp string `json:"timestamp"`
	Status    string `json:"status"`
	Latency   int    `json:"latency"`
}

type User struct {
	ID                       string         `json:"id"`
	Username                 string         `json:"username"`
	Email                    string         `json:"email"`
	Name                     string         `json:"name"`
	PasswordHash             string         `json:"passwordHash"`
	APIKey                   string         `json:"apiKey"`
	APIKeys                  []APIKeyRecord `json:"apiKeys"`
	Enabled                  bool           `json:"enabled"`
	ReceiveAnnouncementEmail bool           `json:"receiveAnnouncementEmail"`
	Source                   string         `json:"source"`
	GitHubID                 string         `json:"githubId"`
	GitHubLogin              string         `json:"githubLogin"`
	GitHubAvatarURL          string         `json:"githubAvatarUrl"`
	GitHubLinkedAt           string         `json:"githubLinkedAt"`
	SubscriptionTier         string         `json:"subscriptionTier"`
	CreatedAt                string         `json:"createdAt"`
	UpdatedAt                string         `json:"updatedAt"`
}

type APIKeyRecord struct {
	ID                   string   `json:"id"`
	Name                 string   `json:"name"`
	Key                  string   `json:"key"`
	Enabled              bool     `json:"enabled"`
	AllowedModels        []string `json:"allowedModels"`
	RPMLimit             int      `json:"rpmLimit"`
	BannedUntil          string   `json:"bannedUntil"`
	BanReason            string   `json:"banReason"`
	InvalidRequestCount  int      `json:"invalidRequestCount"`
	LastInvalidRequestAt string   `json:"lastInvalidRequestAt"`
	CreatedAt            string   `json:"createdAt"`
	UpdatedAt            string   `json:"updatedAt"`
	LastUsedAt           string   `json:"lastUsedAt"`
}

type RequestLog struct {
	ID                  string                 `json:"id"`
	UserID              string                 `json:"userId"`
	UserName            string                 `json:"userName"`
	Username            string                 `json:"username"`
	APIKeyID            string                 `json:"apiKeyId"`
	APIKeyName          string                 `json:"apiKeyName"`
	APIKeyPreview       string                 `json:"apiKeyPreview"`
	ProviderID          string                 `json:"providerId"`
	ProviderName        string                 `json:"providerName"`
	Model               string                 `json:"model"`
	UpstreamModel       string                 `json:"upstreamModel"`
	Endpoint            string                 `json:"endpoint"`
	Method              string                 `json:"method"`
	Status              int                    `json:"status"`
	OK                  bool                   `json:"ok"`
	Stream              bool                   `json:"stream"`
	DurationMs          int                    `json:"durationMs"`
	PromptTokens        int                    `json:"promptTokens"`
	CompletionTokens    int                    `json:"completionTokens"`
	TotalTokens         int                    `json:"totalTokens"`
	CachedTokens        int                    `json:"cachedTokens"`
	CacheCreationTokens int                    `json:"cacheCreationTokens"`
	CacheMissTokens     int                    `json:"cacheMissTokens"`
	ReasoningTokens     int                    `json:"reasoningTokens"`
	ErrorCode           string                 `json:"errorCode"`
	ErrorMessage        string                 `json:"errorMessage"`
	RequestContent      map[string]interface{} `json:"requestContent,omitempty"`
	HasRequestContent   bool                   `json:"hasRequestContent,omitempty"`
	Timestamp           string                 `json:"timestamp"`
}

type InvitationCode struct {
	ID        string              `json:"id"`
	Code      string              `json:"code"`
	Note      string              `json:"note"`
	CreatedAt string              `json:"createdAt"`
	ExpiresAt string              `json:"expiresAt"`
	MaxUses   int                 `json:"maxUses"`
	UsedCount int                 `json:"usedCount"`
	UsedBy    []InvitationCodeUse `json:"usedBy"`
}

type InvitationCodeUse struct {
	UserID string `json:"userId"`
	UsedAt string `json:"usedAt"`
}

type VerificationCode struct {
	Email     string `json:"email"`
	Code      string `json:"code"`
	Purpose   string `json:"purpose"`
	CreatedAt string `json:"createdAt"`
	Used      bool   `json:"used"`
}

type AdminPasskey struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	Credential webauthn.Credential `json:"credential"`
	CreatedAt  string              `json:"createdAt"`
	UpdatedAt  string              `json:"updatedAt"`
	LastUsedAt string              `json:"lastUsedAt"`
}

type Announcement struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Type      string `json:"type"`
	Enabled   bool   `json:"enabled"`
	SendEmail bool   `json:"sendEmail"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Suggestion struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Contact   string `json:"contact"`
	UserID    string `json:"userId"`
	UserName  string `json:"userName"`
	Reply     string `json:"reply"`
	RepliedAt string `json:"repliedAt"`
	RepliedBy string `json:"repliedBy"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type SMTPConfig struct {
	Host   string `json:"host"`
	Port   int    `json:"port"`
	Secure bool   `json:"secure"`
	User   string `json:"user"`
	Pass   string `json:"pass"`
	From   string `json:"from"`
}

type SiteBanner struct {
	Content   string `json:"content"`
	UpdatedAt string `json:"updatedAt"`
}
