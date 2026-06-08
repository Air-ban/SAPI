package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
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

func TestOpenAICompatibleMultipartRewritesModel(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", "public-audio"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", "sample.mp3")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("audio-bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req, err := BuildOpenAICompatibleUpstreamRequestDetailed(models.Provider{
		Name:    "OpenAI",
		BaseURL: "https://api.openai.com/v1",
		APIKey:  "sk-upstream",
	}, "/v1/audio/transcriptions", "", body.Bytes(), writer.FormDataContentType(), "whisper-real")
	if err != nil {
		t.Fatal(err)
	}
	if req.URL != "https://api.openai.com/v1/audio/transcriptions" {
		t.Fatalf("unexpected URL: %s", req.URL)
	}
	if req.Headers.Get("Authorization") != "Bearer sk-upstream" {
		t.Fatalf("missing upstream bearer auth: %#v", req.Headers)
	}

	_, params, err := mime.ParseMediaType(req.Headers.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(bytes.NewReader(req.Body), params["boundary"])
	fields := map[string]string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(part)
		fields[part.FormName()] = string(raw)
	}
	if fields["model"] != "whisper-real" {
		t.Fatalf("expected rewritten model, got fields=%#v", fields)
	}
	if fields["file"] != "audio-bytes" {
		t.Fatalf("expected file content to be preserved, got fields=%#v", fields)
	}
}

func TestForcedGeminiFormatOverridesProviderDetection(t *testing.T) {
	body := map[string]interface{}{
		"model":    "gemini-force",
		"messages": []interface{}{map[string]interface{}{"role": "user", "content": "hello"}},
	}

	req, err := BuildChatCompletionsUpstreamRequestDetailed(models.Provider{
		Name:           "OpenAI-compatible gateway",
		BaseURL:        "https://gateway.example.com/v1",
		APIKey:         "google-key",
		UpstreamFormat: models.UpstreamFormatGemini,
	}, "/v1/chat/completions", "", body, "")
	if err != nil {
		t.Fatal(err)
	}
	if req.Kind != UpstreamGemini || !req.NeedsChatResponseConversion {
		t.Fatalf("expected forced Gemini conversion, got kind=%s converts=%v", req.Kind, req.NeedsChatResponseConversion)
	}
	if !strings.Contains(req.URL, "/models/gemini-force:generateContent?key=google-key") {
		t.Fatalf("unexpected forced Gemini URL: %s", req.URL)
	}
	if req.Headers.Get("Authorization") != "" {
		t.Fatalf("did not expect bearer auth for Gemini request: %#v", req.Headers)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(req.Body, &payload); err != nil {
		t.Fatal(err)
	}
	if _, ok := payload["contents"].([]interface{}); !ok {
		t.Fatalf("expected Gemini contents payload, got %#v", payload)
	}
}

func TestForcedAnthropicFormatOverridesProviderDetection(t *testing.T) {
	body := map[string]interface{}{
		"model":      "claude-force",
		"messages":   []interface{}{map[string]interface{}{"role": "user", "content": "hello"}},
		"max_tokens": float64(24),
	}

	req, err := BuildChatCompletionsUpstreamRequestDetailed(models.Provider{
		Name:           "Generic gateway",
		BaseURL:        "https://gateway.example.com",
		APIKey:         "sk-ant",
		UpstreamFormat: models.UpstreamFormatAnthropic,
	}, "/v1/chat/completions", "", body, "")
	if err != nil {
		t.Fatal(err)
	}
	if req.Kind != UpstreamAnthropic || !req.NeedsChatResponseConversion {
		t.Fatalf("expected forced Anthropic conversion, got kind=%s converts=%v", req.Kind, req.NeedsChatResponseConversion)
	}
	if req.URL != "https://gateway.example.com/v1/messages" {
		t.Fatalf("unexpected forced Anthropic URL: %s", req.URL)
	}
	if req.Headers.Get("x-api-key") != "sk-ant" || req.Headers.Get("anthropic-version") == "" {
		t.Fatalf("missing Anthropic headers: %#v", req.Headers)
	}
}

func TestForcedOpenAIFormatOverridesProviderDetection(t *testing.T) {
	body := map[string]interface{}{
		"model":    "public-model",
		"messages": []interface{}{map[string]interface{}{"role": "user", "content": "hello"}},
	}

	req, err := BuildChatCompletionsUpstreamRequestDetailed(models.Provider{
		Name:           "Gemini",
		BaseURL:        "https://generativelanguage.googleapis.com/v1beta",
		APIKey:         "openai-key",
		UpstreamFormat: models.UpstreamFormatOpenAI,
	}, "/v1/chat/completions", "foo=bar", body, "real-model")
	if err != nil {
		t.Fatal(err)
	}
	if req.Kind != UpstreamOpenAI || req.NeedsChatResponseConversion {
		t.Fatalf("expected forced OpenAI passthrough, got kind=%s converts=%v", req.Kind, req.NeedsChatResponseConversion)
	}
	if req.URL != "https://generativelanguage.googleapis.com/v1beta/v1/chat/completions?foo=bar" {
		t.Fatalf("unexpected forced OpenAI URL: %s", req.URL)
	}
	if req.Headers.Get("Authorization") != "Bearer openai-key" {
		t.Fatalf("expected bearer auth, got %#v", req.Headers)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(req.Body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "real-model" {
		t.Fatalf("expected mapped model, got %#v", payload["model"])
	}
}

func TestBuildAnthropicMessagesNativeUpstreamRequest(t *testing.T) {
	body := map[string]interface{}{
		"model":      "public-claude",
		"stream":     true,
		"max_tokens": float64(32),
		"messages":   []interface{}{map[string]interface{}{"role": "user", "content": "hello"}},
	}

	req, err := BuildAnthropicMessagesUpstreamRequestDetailed(models.Provider{
		BaseURL: "https://api.anthropic.com",
		APIKey:  "sk-ant",
	}, body, "claude-real")
	if err != nil {
		t.Fatal(err)
	}
	if req.Kind != UpstreamAnthropic || req.NeedsChatResponseConversion {
		t.Fatalf("expected native Anthropic request, got kind=%s converts=%v", req.Kind, req.NeedsChatResponseConversion)
	}
	if req.URL != "https://api.anthropic.com/v1/messages" {
		t.Fatalf("unexpected native Anthropic URL: %s", req.URL)
	}
	if req.Headers.Get("Accept") != "text/event-stream" {
		t.Fatalf("expected event-stream accept header, got %q", req.Headers.Get("Accept"))
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(req.Body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "claude-real" {
		t.Fatalf("expected upstream model override, got %#v", payload["model"])
	}
}
