package models

import (
	"strings"

	"github.com/go-webauthn/webauthn/webauthn"
)

const AdminVirtualUserID = "__admin__"

type Database struct {
	Version                 int                `json:"version"`
	AppSecret               string             `json:"appSecret"`
	Providers               []Provider         `json:"providers"`
	Users                   []User             `json:"users"`
	TokenUsage              []interface{}      `json:"tokenUsage"`
	RequestLogs             []RequestLog       `json:"requestLogs"`
	AdminAPIKeys            []APIKeyRecord     `json:"adminApiKeys"`
	InvitationCodes         []InvitationCode   `json:"invitationCodes"`
	VerificationCodes       []VerificationCode `json:"verificationCodes"`
	AdminPasskeys           []AdminPasskey     `json:"adminPasskeys"`
	Announcements           []Announcement     `json:"announcements"`
	Documents               []interface{}      `json:"documents"`
	Suggestions             []Suggestion       `json:"suggestions"`
	SMTPConfig              *SMTPConfig        `json:"smtpConfig"`
	SiteEmail               string             `json:"siteEmail"`
	SiteEmails              []string           `json:"siteEmails"`
	DefaultRPMLimit         int                `json:"defaultRpmLimit"`
	SiteBanner              *SiteBanner        `json:"siteBanner"`
	RegistrationDisabled    bool               `json:"registrationDisabled"`
	MaintenanceMode         bool               `json:"maintenanceMode"`
	MaintenanceEndTime      string             `json:"maintenanceEndTime"`
	ShowOnlyAvailableModels bool               `json:"showOnlyAvailableModels"`
	AdminCollapseModelProviders bool           `json:"adminCollapseModelProviders"`
	CreatedAt               string             `json:"createdAt"`
	UpdatedAt               string             `json:"updatedAt"`
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
	CollapseModelProviders   bool           `json:"collapseModelProviders"`
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
	ClientGeo           *RequestClientGeo      `json:"clientGeo,omitempty"`
	ClientIPInfo        *RequestClientIPInfo   `json:"clientIpInfo,omitempty"`
	ClientDevice        *RequestClientDevice   `json:"clientDevice,omitempty"`
	RequestContent      map[string]interface{} `json:"requestContent,omitempty"`
	HasRequestContent   bool                   `json:"hasRequestContent,omitempty"`
	Timestamp           string                 `json:"timestamp"`
}

type RequestClientGeo struct {
	Country      string `json:"country,omitempty"`
	Region       string `json:"region,omitempty"`
	City         string `json:"city,omitempty"`
	Source       string `json:"source,omitempty"`
	NetworkHash  string `json:"networkHash,omitempty"`
	NetworkScope string `json:"networkScope,omitempty"`
}

type RequestClientDevice struct {
	UserAgent      string            `json:"userAgent,omitempty"`
	BrowserName    string            `json:"browserName,omitempty"`
	BrowserVersion string            `json:"browserVersion,omitempty"`
	OSName         string            `json:"osName,omitempty"`
	OSVersion      string            `json:"osVersion,omitempty"`
	DeviceType     string            `json:"deviceType,omitempty"`
	DeviceModel    string            `json:"deviceModel,omitempty"`
	Platform       string            `json:"platform,omitempty"`
	Architecture   string            `json:"architecture,omitempty"`
	Bitness        string            `json:"bitness,omitempty"`
	Mobile         bool              `json:"mobile,omitempty"`
	Bot            bool              `json:"bot,omitempty"`
	Languages      []string          `json:"languages,omitempty"`
	Origin         string            `json:"origin,omitempty"`
	Referrer       string            `json:"referrer,omitempty"`
	Headers        map[string]string `json:"headers,omitempty"`
}

type RequestClientIPInfo struct {
	IP             string              `json:"ip,omitempty"`
	LookupIP       string              `json:"lookupIp,omitempty"`
	IPVersion      string              `json:"ipVersion,omitempty"`
	IPHash         string              `json:"ipHash,omitempty"`
	ASN            string              `json:"asn,omitempty"`
	ASDomain       string              `json:"asDomain,omitempty"`
	ASName         string              `json:"asName,omitempty"`
	IPRange        string              `json:"ipRange,omitempty"`
	HumanBotRatio  string              `json:"humanBotRatio,omitempty"`
	Locations      []RequestIPLocation `json:"locations,omitempty"`
	IPSource       string              `json:"ipSource,omitempty"`
	IPAttributes   []string            `json:"ipAttributes,omitempty"`
	IPPureScore    *float64            `json:"ipPureScore,omitempty"`
	IPPureLevel    string              `json:"ipPureLevel,omitempty"`
	Provider       string              `json:"provider,omitempty"`
	LookupStatus   string              `json:"lookupStatus,omitempty"`
	LookupError    string              `json:"lookupError,omitempty"`
	FetchedAt      string              `json:"fetchedAt,omitempty"`
	NetworkHash    string              `json:"networkHash,omitempty"`
	NetworkScope   string              `json:"networkScope,omitempty"`
	ProxyGeoSource string              `json:"proxyGeoSource,omitempty"`
}

type RequestIPLocation struct {
	Provider  string `json:"provider,omitempty"`
	Country   string `json:"country,omitempty"`
	Region    string `json:"region,omitempty"`
	City      string `json:"city,omitempty"`
	District  string `json:"district,omitempty"`
	ISP       string `json:"isp,omitempty"`
	Latitude  string `json:"latitude,omitempty"`
	Longitude string `json:"longitude,omitempty"`
	Text      string `json:"text,omitempty"`
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
