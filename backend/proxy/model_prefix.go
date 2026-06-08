package proxy

import (
	"net/url"
	"strings"

	"sapi/models"
)

const ModelChannelSeparator = "/"

func PrefixedModelID(provider models.Provider, modelID string) string {
	channel := PublicModelChannel(provider)
	modelID = strings.TrimSpace(modelID)
	if channel == "" || modelID == "" {
		return modelID
	}
	if strings.HasPrefix(strings.ToLower(modelID), strings.ToLower(channel+ModelChannelSeparator)) {
		return modelID
	}
	return channel + ModelChannelSeparator + modelID
}

func PublicModelChannel(provider models.Provider) string {
	candidates := []string{
		provider.Name,
		hostChannelName(provider.BaseURL),
		provider.UpstreamFormat,
	}
	for _, candidate := range candidates {
		channel := normalizeModelChannel(candidate)
		if channel != "" && !strings.HasPrefix(channel, "prv") {
			return channel
		}
	}
	return normalizeModelChannel(provider.ID)
}

func SplitPrefixedModelID(modelID string) (string, string, bool) {
	modelID = strings.TrimSpace(modelID)
	channelID, innerID, ok := strings.Cut(modelID, ModelChannelSeparator)
	channelID = strings.TrimSpace(channelID)
	innerID = strings.TrimSpace(innerID)
	return channelID, innerID, ok && channelID != "" && innerID != ""
}

func RequestedModelForProvider(provider models.Provider, modelID string) (string, bool) {
	channelID, innerID, ok := SplitPrefixedModelID(modelID)
	if !ok {
		return strings.TrimSpace(modelID), true
	}
	if !ModelChannelMatchesProvider(provider, channelID) {
		return "", false
	}
	return innerID, true
}

func ModelChannelMatchesProvider(provider models.Provider, channelID string) bool {
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return false
	}
	if strings.EqualFold(channelID, PublicModelChannel(provider)) {
		return true
	}
	return strings.EqualFold(channelID, strings.TrimSpace(provider.ID))
}

func IsModelAllowedByRule(allowedModel, requestedModel string) bool {
	allowedModel = strings.TrimSpace(allowedModel)
	requestedModel = strings.TrimSpace(requestedModel)
	if allowedModel == "" || requestedModel == "" {
		return false
	}
	if allowedModel == requestedModel {
		return true
	}
	_, requestedInner, requestedPrefixed := SplitPrefixedModelID(requestedModel)
	return requestedPrefixed && allowedModel == requestedInner
}

func hostChannelName(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		return rawURL
	}
	host := strings.ToLower(parsed.Hostname())
	host = strings.TrimPrefix(host, "www.")
	host = strings.TrimPrefix(host, "api.")
	parts := strings.Split(host, ".")
	if len(parts) >= 2 {
		return parts[len(parts)-2]
	}
	return host
}

func normalizeModelChannel(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}

	var b strings.Builder
	lastDash := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '.' || r == '_':
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == ' ' || r == '\t' || r == '\r' || r == '\n':
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-._")
}
