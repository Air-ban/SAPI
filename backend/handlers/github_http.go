package handlers

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"sapi/config"
)

func githubClientForConfig(cfg *config.Config) *http.Client {
	if cfg == nil || len(cfg.GitHubHostResolve) == 0 {
		return githubHTTPClient
	}
	return githubClientWithHostResolve(githubHTTPClient, cfg.GitHubHostResolve)
}

func githubClientWithHostResolve(base *http.Client, hostResolve map[string]string) *http.Client {
	if len(hostResolve) == 0 {
		return base
	}
	if base == nil {
		base = http.DefaultClient
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	if base.Transport != nil {
		if source, ok := base.Transport.(*http.Transport); ok {
			transport = source.Clone()
		}
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	baseDialContext := transport.DialContext
	if baseDialContext == nil {
		baseDialContext = dialer.DialContext
	}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return baseDialContext(ctx, network, githubResolveDialAddress(address, hostResolve))
	}

	client := *base
	client.Transport = transport
	return &client
}

func githubResolveDialAddress(address string, hostResolve map[string]string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	if ip := strings.TrimSpace(hostResolve[host]); ip != "" {
		return net.JoinHostPort(ip, port)
	}
	return address
}
