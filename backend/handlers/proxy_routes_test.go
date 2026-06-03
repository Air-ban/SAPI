package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProxyRoutesMatchSupportedEndpointVariants(t *testing.T) {
	mux := http.NewServeMux()
	MountProxyRoutes(mux)

	tests := []struct {
		name   string
		method string
		path   string
		status int
	}{
		{name: "root chat completions", method: http.MethodPost, path: "/chat/completions", status: http.StatusUnauthorized},
		{name: "v1 chat completions", method: http.MethodPost, path: "/v1/chat/completions", status: http.StatusUnauthorized},
		{name: "root responses", method: http.MethodPost, path: "/responses", status: http.StatusUnauthorized},
		{name: "v1 responses", method: http.MethodPost, path: "/v1/responses", status: http.StatusUnauthorized},
		{name: "root messages", method: http.MethodPost, path: "/messages", status: http.StatusUnauthorized},
		{name: "v1 messages", method: http.MethodPost, path: "/v1/messages", status: http.StatusUnauthorized},
		{name: "root count tokens", method: http.MethodPost, path: "/messages/count_tokens", status: http.StatusUnauthorized},
		{name: "v1 count tokens", method: http.MethodPost, path: "/v1/messages/count_tokens", status: http.StatusUnauthorized},
		{name: "generic v1 post", method: http.MethodPost, path: "/v1/embeddings", status: http.StatusUnauthorized},
		{name: "unsupported v1 get", method: http.MethodGet, path: "/v1/embeddings", status: http.StatusMethodNotAllowed},
		{name: "unsupported responses get", method: http.MethodGet, path: "/responses", status: http.StatusMethodNotAllowed},
		{name: "unsupported messages get", method: http.MethodGet, path: "/v1/messages", status: http.StatusMethodNotAllowed},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(`{"model":"test"}`))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()

			mux.ServeHTTP(rec, req)

			if rec.Code != tt.status {
				t.Fatalf("%s %s returned %d, want %d", tt.method, tt.path, rec.Code, tt.status)
			}
		})
	}
}
