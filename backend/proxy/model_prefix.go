package proxy

import (
	"strings"

	"sapi/models"
)

const ModelChannelSeparator = "/"

func PrefixedModelID(provider models.Provider, modelID string) string {
	providerID := strings.TrimSpace(provider.ID)
	modelID = strings.TrimSpace(modelID)
	if providerID == "" || modelID == "" {
		return modelID
	}
	if strings.HasPrefix(modelID, providerID+ModelChannelSeparator) {
		return modelID
	}
	return providerID + ModelChannelSeparator + modelID
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
	if channelID != strings.TrimSpace(provider.ID) {
		return "", false
	}
	return innerID, true
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
