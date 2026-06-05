package main

import "testing"

func TestIsAPIPathUsesPathSegments(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{path: "/api", want: true},
		{path: "/api/health", want: true},
		{path: "/v1", want: true},
		{path: "/v1/chat/completions", want: true},
		{path: "/responses", want: true},
		{path: "/responses/resp_123", want: true},
		{path: "/messages", want: true},
		{path: "/messages/count_tokens", want: true},
		{path: "/chat/completions", want: true},
		{path: "/models", want: true},
		{path: "/models/test-model", want: true},
		{path: "/swagger", want: true},
		{path: "/swagger/index.html", want: true},
		{path: "/apix", want: false},
		{path: "/v10/chat/completions", want: false},
		{path: "/responsesfoo", want: false},
		{path: "/messagesfoo", want: false},
		{path: "/chat/completionsx", want: false},
		{path: "/modelsv2", want: false},
		{path: "/swagger-ui", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := isAPIPath(tt.path); got != tt.want {
				t.Fatalf("isAPIPath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}
