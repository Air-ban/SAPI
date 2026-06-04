package security

import (
	"net/http/httptest"
	"testing"

	"sapi/config"
)

func TestClientIPIgnoresForwardedHeadersUnlessProxyTrusted(t *testing.T) {
	Configure(&config.Config{TrustProxyHeaders: false})
	req := httptest.NewRequest("GET", "/api/health", nil)
	req.RemoteAddr = "10.0.0.10:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	req.Header.Set("CF-Connecting-IP", "203.0.113.11")

	if got := ClientIP(req); got != "10.0.0.10" {
		t.Fatalf("expected remote addr when proxy headers are not trusted, got %q", got)
	}
}

func TestClientIPUsesTrustedProxyHeader(t *testing.T) {
	Configure(&config.Config{
		TrustProxyHeaders: true,
		TrustedProxyCIDRs: []string{"10.0.0.0/8"},
	})
	req := httptest.NewRequest("GET", "/api/health", nil)
	req.RemoteAddr = "10.0.0.10:1234"
	req.Header.Set("CF-Connecting-IP", "203.0.113.11")

	if got := ClientIP(req); got != "203.0.113.11" {
		t.Fatalf("expected trusted CF-Connecting-IP, got %q", got)
	}
}

func TestSafeSingleLineRemovesHeaderInjectionCharacters(t *testing.T) {
	got := SafeSingleLine(" hello\r\nInjected: yes\x00 ", 100)
	if got != "hello  Injected: yes" {
		t.Fatalf("unexpected sanitized value %q", got)
	}
}

func TestValidHTTPBaseURLRejectsUnsafeValues(t *testing.T) {
	for _, value := range []string{"javascript:alert(1)", "https://example.com\r\nHost: bad", "https://user@example.com"} {
		if ValidHTTPBaseURL(value) {
			t.Fatalf("expected URL to be rejected: %q", value)
		}
	}
	if !ValidHTTPBaseURL("https://api.example.com/v1") {
		t.Fatal("expected normal https URL to be allowed")
	}
}
