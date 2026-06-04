package proxy

import (
	"encoding/json"
	"strings"
	"testing"

	"sapi/models"
)

func TestBuildAnthropicChatCompletionsUpstreamRequest(t *testing.T) {
	body := map[string]interface{}{
		"model":      "claude-3-5-sonnet-latest",
		"messages":   []interface{}{map[string]interface{}{"role": "user", "content": "hello"}},
		"max_tokens": float64(12),
	}

	url, reqBody, headers, converts, err := BuildChatCompletionsUpstreamRequest(models.Provider{
		Name:    "Claude",
		BaseURL: "https://api.anthropic.com",
		APIKey:  "sk-ant",
	}, "/v1/chat/completions", "", body, "")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://api.anthropic.com/v1/messages" {
		t.Fatalf("unexpected Anthropic URL: %s", url)
	}
	if headers.Get("x-api-key") != "sk-ant" || headers.Get("anthropic-version") == "" {
		t.Fatalf("missing Anthropic auth/version headers: %#v", headers)
	}
	if !converts {
		t.Fatal("expected Anthropic response conversion")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(reqBody, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["max_tokens"].(float64) != 12 {
		t.Fatalf("expected max_tokens 12, got %#v", payload["max_tokens"])
	}
	if len(payload["messages"].([]interface{})) != 1 {
		t.Fatalf("expected one Anthropic message, got %#v", payload["messages"])
	}
}

func TestBuildGeminiChatCompletionsUpstreamRequest(t *testing.T) {
	body := map[string]interface{}{
		"model":    "gemini-2.5-flash",
		"stream":   true,
		"messages": []interface{}{map[string]interface{}{"role": "user", "content": "hello"}},
	}

	url, reqBody, headers, converts, err := BuildChatCompletionsUpstreamRequest(models.Provider{
		Name:    "Gemini",
		BaseURL: "https://generativelanguage.googleapis.com/v1beta",
		APIKey:  "google-key",
	}, "/v1/chat/completions", "", body, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(url, "/models/gemini-2.5-flash:streamGenerateContent?key=google-key") {
		t.Fatalf("unexpected Gemini URL: %s", url)
	}
	if headers.Get("Accept") != "text/event-stream" {
		t.Fatalf("expected event-stream accept header, got %q", headers.Get("Accept"))
	}
	if !converts {
		t.Fatal("expected Gemini response conversion")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(reqBody, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload["contents"].([]interface{})) != 1 {
		t.Fatalf("expected one Gemini content, got %#v", payload["contents"])
	}
}

func TestNonChatPathKeepsOpenAICompatibleForwarding(t *testing.T) {
	url, reqBody, headers, converts, err := BuildChatCompletionsUpstreamRequest(models.Provider{
		Name:    "Gemini",
		BaseURL: "https://generativelanguage.googleapis.com/v1beta",
		APIKey:  "google-key",
	}, "/v1/embeddings", "encoding_format=float", map[string]interface{}{"model": "embedding-model"}, "mapped-model")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://generativelanguage.googleapis.com/v1beta/v1/embeddings?encoding_format=float" {
		t.Fatalf("expected OpenAI-compatible URL, got %s", url)
	}
	if headers.Get("Authorization") != "Bearer google-key" {
		t.Fatalf("expected bearer auth for compatible passthrough, got %#v", headers)
	}
	if converts {
		t.Fatal("did not expect response conversion for non-chat path")
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(reqBody, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "mapped-model" {
		t.Fatalf("expected mapped model, got %#v", payload["model"])
	}
}
