package handlers

import "testing"

func TestGitHubResolveDialAddress(t *testing.T) {
	mapping := map[string]string{
		"github.com":     "140.82.113.3",
		"api.github.com": "140.82.114.5",
	}

	if got := githubResolveDialAddress("github.com:443", mapping); got != "140.82.113.3:443" {
		t.Fatalf("github.com address = %q, want mapped address", got)
	}
	if got := githubResolveDialAddress("api.github.com:443", mapping); got != "140.82.114.5:443" {
		t.Fatalf("api.github.com address = %q, want mapped address", got)
	}
	if got := githubResolveDialAddress("uploads.github.com:443", mapping); got != "uploads.github.com:443" {
		t.Fatalf("unmapped address = %q, want original", got)
	}
	if got := githubResolveDialAddress("github.com", mapping); got != "github.com" {
		t.Fatalf("address without port = %q, want original", got)
	}
}
