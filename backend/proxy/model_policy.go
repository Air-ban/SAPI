package proxy

import "strings"

func IsGPTModelID(modelID string) bool {
	modelID = strings.ToLower(strings.TrimSpace(modelID))
	if modelID == "" {
		return false
	}

	for i := 0; i < len(modelID); i++ {
		if strings.HasPrefix(modelID[i:], "chatgpt") &&
			hasModelTokenBoundaryBefore(modelID, i) &&
			hasGPTModelTokenBoundaryAfter(modelID, i+len("chatgpt")) {
			return true
		}
		if strings.HasPrefix(modelID[i:], "gpt") &&
			hasModelTokenBoundaryBefore(modelID, i) &&
			hasGPTModelTokenBoundaryAfter(modelID, i+len("gpt")) {
			return true
		}
	}

	return false
}

func hasModelTokenBoundaryBefore(value string, index int) bool {
	return index == 0 || isModelTokenBoundary(value[index-1])
}

func hasGPTModelTokenBoundaryAfter(value string, index int) bool {
	return index == len(value) || isModelTokenBoundary(value[index]) || isASCIIDigit(value[index])
}

func isModelTokenBoundary(b byte) bool {
	switch b {
	case '/', '\\', ':', '.', '-', '_', ' ', '\t', '\r', '\n':
		return true
	default:
		return false
	}
}

func isASCIIDigit(b byte) bool {
	return b >= '0' && b <= '9'
}
