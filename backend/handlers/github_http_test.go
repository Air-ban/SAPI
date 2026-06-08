package handlers

import (
	"net/http"
	"net/url"
	"testing"
)

func TestGitHubClientWithNetworkOptionsUsesProxy(t *testing.T) {
	client := githubClientWithNetworkOptions(&http.Client{}, "socks5://127.0.0.1:7898", nil)
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport = %T, want *http.Transport", client.Transport)
	}
	reqURL, err := url.Parse("https://api.github.com/user")
	if err != nil {
		t.Fatal(err)
	}
	req := &http.Request{URL: reqURL}
	proxy, err := transport.Proxy(req)
	if err != nil {
		t.Fatal(err)
	}
	if proxy == nil || proxy.String() != "socks5://127.0.0.1:7898" {
		t.Fatalf("proxy = %v, want configured GitHub proxy", proxy)
	}
	if client.Timeout == 0 {
		t.Fatal("client timeout should be set for GitHub OAuth calls")
	}
}

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
