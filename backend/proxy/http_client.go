package proxy

import (
	"net"
	"net/http"
	"time"
)

var upstreamTransport = &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	ForceAttemptHTTP2:     true,
	MaxIdleConns:          2048,
	MaxIdleConnsPerHost:   256,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
	DisableCompression:    true,
}

var upstreamClient = &http.Client{
	Transport: upstreamTransport,
	Timeout:   10 * time.Minute,
}

func DoUpstream(req *http.Request) (*http.Response, error) {
	return upstreamClient.Do(req)
}

func CloseIdleUpstreamConnections() {
	upstreamTransport.CloseIdleConnections()
}
