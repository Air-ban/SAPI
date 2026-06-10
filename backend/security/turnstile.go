package security

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"sapi/config"
)

type turnstileResponse struct {
	Success    bool     `json:"success"`
	ErrorCodes []string `json:"error-codes"`
}

func VerifyTurnstile(ctx context.Context, token string, clientIP string) bool {
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}

	cfg := config.Load()
	if cfg.TurnstileSecretKey == "" {
		return true
	}

	form := url.Values{}
	form.Set("secret", cfg.TurnstileSecretKey)
	form.Set("response", token)
	if clientIP != "" {
		form.Set("remoteip", clientIP)
	}

	httpCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(httpCtx, "POST", "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
	if err != nil {
		log.Printf("[turnstile] request creation failed: %v", err)
		return false
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := http.DefaultClient
	if cfg.TurnstileProxy != "" {
		proxyURL, err := url.Parse(cfg.TurnstileProxy)
		if err != nil {
			log.Printf("[turnstile] invalid proxy URL %q: %v", cfg.TurnstileProxy, err)
		} else {
			client = &http.Client{
				Transport: &http.Transport{
					Proxy: http.ProxyURL(proxyURL),
				},
				Timeout: 10 * time.Second,
			}
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[turnstile] siteverify request failed: %v", err)
		return false
	}
	defer resp.Body.Close()

	var result turnstileResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[turnstile] siteverify decode failed: %v", err)
		return false
	}

	if !result.Success {
		log.Printf("[turnstile] siteverify rejected: error-codes=%v client_ip=%q", result.ErrorCodes, clientIP)
	}

	return result.Success
}
