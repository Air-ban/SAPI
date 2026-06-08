package utils

import "testing"

func TestNormalizeUsageReadsNestedAndProviderSpecificTokenFields(t *testing.T) {
	usage := map[string]interface{}{
		"prompt_tokens":     float64(0),
		"input_tokens":      float64(12),
		"completion_tokens": float64(0),
		"output_tokens":     float64(7),
		"total_tokens":      float64(0),
		"prompt_tokens_details": map[string]interface{}{
			"cached_tokens":               float64(5),
			"cache_creation_input_tokens": float64(3),
		},
		"completion_tokens_details": map[string]interface{}{
			"reasoning_tokens": float64(2),
		},
		"claude_cache_creation_5_m_tokens": float64(4),
		"claude_cache_creation_1_h_tokens": float64(6),
	}

	normalized := NormalizeUsage(usage)
	if normalized == nil {
		t.Fatal("expected usage to normalize")
	}
	if normalized.PromptTokens != 12 || normalized.CompletionTokens != 7 || normalized.TotalTokens != 19 {
		t.Fatalf("unexpected token counts: %#v", normalized)
	}
	if normalized.CachedTokens != 5 {
		t.Fatalf("cached tokens = %d, want 5", normalized.CachedTokens)
	}
	if normalized.CacheCreationTokens != 3 {
		t.Fatalf("cache creation tokens = %d, want nested value 3", normalized.CacheCreationTokens)
	}
	if normalized.ReasoningTokens != 2 {
		t.Fatalf("reasoning tokens = %d, want 2", normalized.ReasoningTokens)
	}
}

func TestNormalizeUsageReadsGeminiUsageMetadata(t *testing.T) {
	normalized := NormalizeUsage(map[string]interface{}{
		"promptTokenCount":        float64(11),
		"candidatesTokenCount":    float64(13),
		"totalTokenCount":         float64(24),
		"cachedContentTokenCount": float64(6),
		"thoughtsTokenCount":      float64(4),
	})
	if normalized == nil {
		t.Fatal("expected Gemini usage metadata to normalize")
	}
	if normalized.PromptTokens != 11 || normalized.CompletionTokens != 13 || normalized.TotalTokens != 24 {
		t.Fatalf("unexpected Gemini token counts: %#v", normalized)
	}
	if normalized.CachedTokens != 6 || normalized.ReasoningTokens != 4 {
		t.Fatalf("unexpected Gemini cache/reasoning counts: %#v", normalized)
	}
}

func TestFindUsagePayloadFindsUsageMetadata(t *testing.T) {
	payload := map[string]interface{}{
		"usageMetadata": map[string]interface{}{
			"promptTokenCount":     float64(2),
			"candidatesTokenCount": float64(3),
		},
	}
	if usage := FindUsagePayload(payload); usage == nil {
		t.Fatal("expected usageMetadata to be discovered")
	}
}
