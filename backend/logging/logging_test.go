package logging

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"sapi/config"
	"sapi/ippure"
	"sapi/security"
	"sapi/store"
)

func TestRecordRequestLogStoresTrustedRealIPInfo(t *testing.T) {
	ippure.ResetForTest()
	defer ippure.ResetForTest()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/lookup/54.92.1.1" {
			t.Fatalf("path = %q, want /lookup/54.92.1.1", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"ip":           "54.92.1.1",
				"asn":          "14618",
				"asDomain":     "amazon.com",
				"ipPureScore":  88,
				"IP2Location":  map[string]interface{}{"country": "United States", "city": "Ashburn"},
				"ipAttributes": []string{"datacenter"},
			},
		})
	}))
	defer server.Close()

	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	t.Setenv("SAPI_POSTGRES_URL", " ")
	t.Setenv("DATABASE_URL", " ")
	t.Setenv("SAPI_REDIS_URL", " ")
	t.Setenv("REDIS_URL", " ")
	t.Setenv("SAPI_IPPURE_ENABLED", "true")
	t.Setenv("SAPI_IPPURE_ENDPOINT", server.URL+"/lookup/{ip}")
	t.Setenv("SAPI_IPPURE_METHOD", "POST")

	cfg := config.Load()
	cfg.TrustProxyHeaders = true
	cfg.TrustedProxyCIDRs = []string{"127.0.0.1/32"}
	security.Configure(cfg)
	if err := store.Init(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.RemoteAddr = "127.0.0.1:39200"
	req.Header.Set("CF-Connecting-IP", "54.92.1.1")
	req.Header.Set("CF-IPCountry", "US")
	req.Header.Set("X-Vercel-IP-City", "Ashburn")

	RecordRequestLog(RequestLogParams{
		UserID:   "usr_ip",
		UserName: "IP User",
		Model:    "gpt-4o-mini",
		Endpoint: "/v1/chat/completions",
		Method:   http.MethodPost,
		Status:   http.StatusOK,
		OK:       true,
		Request:  req,
	})

	logs := store.RequestLogsSince(store.ReadDB(), time.Now().UTC().Add(-time.Hour), "usr_ip", 10)
	if len(logs) != 1 {
		t.Fatalf("logs = %#v, want one request log", logs)
	}
	info := logs[0].ClientIPInfo
	if info == nil {
		t.Fatal("expected clientIpInfo to be stored")
	}
	if info.IP != "54.92.1.1" || info.ASN != "14618" || info.ASDomain != "amazon.com" {
		t.Fatalf("clientIpInfo = %#v, want trusted real IP and IPPure ASN fields", info)
	}
	if info.LookupStatus != "ok" || info.NetworkScope != "public" {
		t.Fatalf("lookup status/scope = %q/%q, want ok/public", info.LookupStatus, info.NetworkScope)
	}
	if info.ProxyGeoSource != "trusted_proxy_header" {
		t.Fatalf("proxy geo source = %q, want trusted_proxy_header", info.ProxyGeoSource)
	}
}
