package proxy

import (
	"testing"

	"sapi/models"
)

func TestIsGPTModelID(t *testing.T) {
	tests := []struct {
		name  string
		model string
		want  bool
	}{
		{name: "openai gpt", model: "gpt-4o-mini", want: true},
		{name: "provider prefixed gpt", model: "openai/gpt-4.1", want: true},
		{name: "chatgpt latest", model: "chatgpt-4o-latest", want: true},
		{name: "uppercase", model: "GPT-4o", want: true},
		{name: "gpt digit suffix", model: "gpt4", want: true},
		{name: "non gpt", model: "claude-3-5-sonnet-latest", want: false},
		{name: "embedded letters", model: "notgpt-model", want: false},
		{name: "substring only", model: "gemini-gpteam", want: false},
		{name: "empty", model: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsGPTModelID(tt.model); got != tt.want {
				t.Fatalf("IsGPTModelID(%q) = %v, want %v", tt.model, got, tt.want)
			}
		})
	}
}

func TestIsModelAllowedByRuleMatchesPrefixedAndInnerIDs(t *testing.T) {
	tests := []struct {
		name      string
		allowed   string
		requested string
		want      bool
	}{
		{name: "exact prefixed", allowed: "openai/gpt-image-2", requested: "openai/gpt-image-2", want: true},
		{name: "inner allowed prefixed requested", allowed: "gpt-image-2", requested: "openai/gpt-image-2", want: true},
		{name: "prefixed allowed inner requested", allowed: "openai/gpt-image-2", requested: "gpt-image-2", want: true},
		{name: "different model", allowed: "openai/gpt-image-2", requested: "flux-image", want: false},
		{name: "empty requested", allowed: "openai/gpt-image-2", requested: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsModelAllowedByRule(tt.allowed, tt.requested); got != tt.want {
				t.Fatalf("IsModelAllowedByRule(%q, %q) = %v, want %v", tt.allowed, tt.requested, got, tt.want)
			}
		})
	}
}

func TestChooseProviderCandidatesRoutesPrefixedModelToChannel(t *testing.T) {
	db := &models.Database{
		Providers: []models.Provider{
			{
				ID:            "prv_a",
				Name:          "Alpha",
				Models:        []models.Model{{ID: "chat-main", Name: "Chat Main"}},
				ModelMappings: map[string]string{},
				Enabled:       true,
				CreatedAt:     "2026-06-01T00:00:00.000Z",
			},
			{
				ID:            "prv_b",
				Name:          "Beta",
				Models:        []models.Model{{ID: "chat-main", Name: "Chat Main"}},
				ModelMappings: map[string]string{},
				Enabled:       true,
				CreatedAt:     "2026-06-02T00:00:00.000Z",
			},
		},
	}

	candidates := ChooseProviderCandidates(db, map[string]interface{}{"model": "alpha/chat-main"})
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want one", candidates)
	}
	if candidates[0].Provider.ID != "prv_a" || candidates[0].UpstreamModel != "chat-main" {
		t.Fatalf("candidate = %#v, want alpha/chat-main", candidates[0])
	}
}

func TestChooseProviderCandidatesKeepsLegacyProviderIDPrefix(t *testing.T) {
	db := &models.Database{
		Providers: []models.Provider{{
			ID:            "prv_a",
			Name:          "Alpha",
			Models:        []models.Model{{ID: "chat-main", Name: "Chat Main"}},
			ModelMappings: map[string]string{},
			Enabled:       true,
		}},
	}

	candidates := ChooseProviderCandidates(db, map[string]interface{}{"model": "prv_a/chat-main"})
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want one", candidates)
	}
	if candidates[0].Provider.ID != "prv_a" || candidates[0].UpstreamModel != "chat-main" {
		t.Fatalf("candidate = %#v, want legacy prv_a/chat-main", candidates[0])
	}
}

func TestPrefixedModelIDUsesPublicChannelName(t *testing.T) {
	id := PrefixedModelID(models.Provider{
		ID:      "prv_openrouter",
		Name:    "OpenRouter",
		BaseURL: "https://openrouter.ai/api/v1",
	}, "gpt-4o-mini")
	if id != "openrouter/gpt-4o-mini" {
		t.Fatalf("PrefixedModelID = %q, want openrouter/gpt-4o-mini", id)
	}
}

func TestChooseProviderCandidatesKeepsLegacySlashMappings(t *testing.T) {
	db := &models.Database{
		Providers: []models.Provider{{
			ID:            "prv_openrouter",
			Name:          "OpenRouter",
			Models:        []models.Model{{ID: "real-model", Name: "Real Model"}},
			ModelMappings: map[string]string{"openrouter/test-model": "real-model"},
			Enabled:       true,
		}},
	}

	candidates := ChooseProviderCandidates(db, map[string]interface{}{"model": "openrouter/test-model"})
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want one", candidates)
	}
	if candidates[0].Provider.ID != "prv_openrouter" || candidates[0].UpstreamModel != "real-model" {
		t.Fatalf("candidate = %#v, want mapped legacy slash model", candidates[0])
	}
}
