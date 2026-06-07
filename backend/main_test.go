package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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

func TestDynamicNoStoreResponseWriterOverridesCacheableHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	wrapped := newDynamicNoStoreResponseWriter(rec)

	wrapped.Header().Set("Cache-Control", "public, max-age=300")
	wrapped.WriteHeader(http.StatusOK)

	cacheControl := rec.Header().Get("Cache-Control")
	if !strings.Contains(cacheControl, "no-store") || strings.Contains(cacheControl, "public") {
		t.Fatalf("Cache-Control = %q, want no-store without public cache directive", cacheControl)
	}
	if got := rec.Header().Get("CDN-Cache-Control"); got != "no-store" {
		t.Fatalf("CDN-Cache-Control = %q, want no-store", got)
	}
	for _, want := range []string{"Authorization", "X-API-Key", "Cookie"} {
		if !headerHasVaryValue(rec.Header(), want) {
			t.Fatalf("Vary = %q, missing %s", rec.Header().Values("Vary"), want)
		}
	}
}

func headerHasVaryValue(header http.Header, want string) bool {
	for _, value := range header.Values("Vary") {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), want) {
				return true
			}
		}
	}
	return false
}
