package ippure

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"sapi/config"
	"sapi/security"
)

func TestLookupRequestUsesTrustedRealClientIPAndParsesIPPureFields(t *testing.T) {
	ResetForTest()
	defer ResetForTest()

	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"ip":            "54.92.1.1",
				"asn":           "14618",
				"asDomain":      "amazon.com",
				"asName":        "Amazon.com, Inc.",
				"ipRange":       "54.92.0.0 - 54.92.127.255",
				"humanBotRatio": "human:18 bot:82",
				"ipSource":      "hosting",
				"ipAttributes":  []string{"datacenter", "aws"},
				"ipPureScore":   91.25,
				"ipPureLevel":   "high_risk",
				"IP2Location":   map[string]interface{}{"country": "United States", "region": "Virginia", "city": "Ashburn"},
				"DB-IP":         map[string]interface{}{"country": "United States", "region": "Virginia"},
				"MaxMind":       map[string]interface{}{"country": "United States", "city": "Ashburn"},
				"IPInfo.io":     map[string]interface{}{"country": "US", "city": "Ashburn"},
				"IPIP":          map[string]interface{}{"country": "美国", "region": "弗吉尼亚"},
				"Bilibili":      map[string]interface{}{"country": "美国", "city": "阿什本"},
			},
		})
	}))
	defer server.Close()

	t.Setenv("SAPI_IPPURE_ENABLED", "true")
	t.Setenv("SAPI_IPPURE_ENDPOINT", server.URL+"/lookup/{ip}")
	t.Setenv("SAPI_IPPURE_METHOD", "POST")
	t.Setenv("SAPI_IPPURE_TIMEOUT_MS", "1000")
	security.Configure(&config.Config{
		TrustProxyHeaders: true,
		TrustedProxyCIDRs: []string{"10.0.0.0/8"},
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.RemoteAddr = "10.0.0.10:12345"
	req.Header.Set("CF-Connecting-IP", "54.92.1.1")
	req.Header.Set("CF-IPCountry", "US")
	req.Header.Set("X-Vercel-IP-City", "Ashburn")

	info := LookupRequest(req)
	if info == nil {
		t.Fatal("expected IP info")
	}
	if requestedPath != "/lookup/54.92.1.1" {
		t.Fatalf("IPPure path = %q, want /lookup/54.92.1.1", requestedPath)
	}
	if info.IP != "54.92.1.1" || info.ASN != "14618" || info.ASDomain != "amazon.com" || info.IPRange == "" {
		t.Fatalf("unexpected normalized info: %#v", info)
	}
	if info.IPPureScore == nil || *info.IPPureScore != 91.25 {
		t.Fatalf("ipPureScore = %#v, want 91.25", info.IPPureScore)
	}
	if len(info.Locations) < 6 {
		t.Fatalf("locations = %#v, want multiple IPPure sources", info.Locations)
	}
	if !strings.Contains(strings.Join(info.IPAttributes, ","), "datacenter") {
		t.Fatalf("attributes = %#v, want datacenter", info.IPAttributes)
	}
}

func TestLookupRequestIgnoresSpoofedForwardedHeaderWithoutTrustedProxy(t *testing.T) {
	ResetForTest()
	defer ResetForTest()

	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		json.NewEncoder(w).Encode(map[string]interface{}{"data": map[string]interface{}{"asn": "14618"}})
	}))
	defer server.Close()

	t.Setenv("SAPI_IPPURE_ENABLED", "true")
	t.Setenv("SAPI_IPPURE_ENDPOINT", server.URL+"/lookup/{ip}")
	security.Configure(&config.Config{TrustProxyHeaders: false})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.RemoteAddr = "10.0.0.10:12345"
	req.Header.Set("CF-Connecting-IP", "54.92.1.1")

	info := LookupRequest(req)
	if info == nil || info.IP != "10.0.0.10" || info.LookupStatus != "skipped_private" {
		t.Fatalf("expected private remote address to be used, got %#v", info)
	}
	if called {
		t.Fatal("IPPure should not be called for spoofed forwarded header when proxy is untrusted")
	}
}

func TestLookupIPSkipsReservedDocumentationRanges(t *testing.T) {
	ResetForTest()
	defer ResetForTest()

	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		json.NewEncoder(w).Encode(map[string]interface{}{"data": map[string]interface{}{"asn": "14618"}})
	}))
	defer server.Close()

	t.Setenv("SAPI_IPPURE_ENABLED", "true")
	t.Setenv("SAPI_IPPURE_ENDPOINT", server.URL+"/lookup/{ip}")

	info := LookupIP(nil, "192.0.2.1")
	if info == nil || info.IP != "192.0.2.1" || info.NetworkScope != "reserved" || info.LookupStatus != "skipped_reserved" {
		t.Fatalf("expected reserved address to be skipped, got %#v", info)
	}
	if called {
		t.Fatal("IPPure should not be called for reserved documentation IP ranges")
	}
}
