package proxy

import "testing"

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
