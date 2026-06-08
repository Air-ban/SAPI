package handlers

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"sapi/config"
)

func githubClientForConfig(cfg *config.Config) *http.Client {
	if cfg == nil {
		return githubHTTPClient
	}
	return githubClientWithNetworkOptions(githubHTTPClient, cfg.GitHubProxyURL, cfg.GitHubHostResolve)
}

func githubClientWithHostResolve(base *http.Client, hostResolve map[string]string) *http.Client {
	return githubClientWithNetworkOptions(base, "", hostResolve)
}

func githubClientWithNetworkOptions(base *http.Client, proxyURL string, hostResolve map[string]string) *http.Client {
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" && len(hostResolve) == 0 {
		return base
	}
	if len(hostResolve) == 0 {
		hostResolve = nil
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
	if proxyURL != "" {
		if parsed, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(parsed)
		}
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	baseDialContext := transport.DialContext
	if baseDialContext == nil {
		baseDialContext = dialer.DialContext
	}
	if len(hostResolve) > 0 {
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			return baseDialContext(ctx, network, githubResolveDialAddress(address, hostResolve))
		}
	}

	client := *base
	client.Transport = transport
	if client.Timeout == 0 {
		client.Timeout = 8 * time.Second
	}
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
