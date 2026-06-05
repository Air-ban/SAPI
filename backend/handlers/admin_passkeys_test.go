package handlers

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"

	"sapi/config"
	"sapi/models"
	"sapi/store"
)

func TestPublicConfigReportsAdminPasskeyAvailability(t *testing.T) {
	t.Setenv("SAPI_DATA_FILE", filepath.Join(t.TempDir(), "sapi.json"))
	store.EnsureDB()

	cfg := publicConfig()
	passkey, ok := cfg["adminPasskey"].(map[string]interface{})
	if !ok || passkey["enabled"] != false {
		t.Fatalf("adminPasskey before registration = %#v", cfg["adminPasskey"])
	}

	store.MutateDB(func(db *models.Database) interface{} {
		db.AdminPasskeys = []models.AdminPasskey{{
			ID:   "apk_test",
			Name: "Test Passkey",
			Credential: webauthn.Credential{
				ID:        []byte("credential-id"),
				PublicKey: []byte("public-key"),
			},
		}}
		return nil
	})

	cfg = publicConfig()
	passkey, ok = cfg["adminPasskey"].(map[string]interface{})
	if !ok || passkey["enabled"] != true {
		t.Fatalf("adminPasskey after registration = %#v", cfg["adminPasskey"])
	}
}

func TestAdminPasskeySessionIsSignedAndSingleUse(t *testing.T) {
	session := &webauthn.SessionData{Challenge: "challenge"}
	token, err := signAdminPasskeySession("login", session, "secret")
	if err != nil {
		t.Fatalf("signAdminPasskeySession returned error: %v", err)
	}

	envelope, ok := verifyAdminPasskeySession(token, "secret", "login")
	if !ok {
		t.Fatal("expected signed passkey session to verify")
	}
	if _, ok := verifyAdminPasskeySession(token, "other-secret", "login"); ok {
		t.Fatal("expected passkey session with wrong secret to fail")
	}
	if _, ok := verifyAdminPasskeySession(token, "secret", "register"); ok {
		t.Fatal("expected passkey session with wrong kind to fail")
	}

	req := httptest.NewRequest("POST", "/api/admin/passkeys/login/finish", nil)
	req = req.WithContext(context.Background())
	if !consumeAdminPasskeyNonce(req, envelope.Nonce) {
		t.Fatal("expected first nonce consume to succeed")
	}
	if consumeAdminPasskeyNonce(req, envelope.Nonce) {
		t.Fatal("expected second nonce consume to fail")
	}
}

func TestAdminPasskeyRelyingPartyUsesPublicBaseURL(t *testing.T) {
	rpID, origins, err := adminPasskeyRP(&config.Config{PublicBaseURL: "https://sapi.eterultimate.asia/app"})
	if err != nil {
		t.Fatalf("adminPasskeyRP returned error: %v", err)
	}
	if rpID != "sapi.eterultimate.asia" {
		t.Fatalf("rpID = %q", rpID)
	}
	if len(origins) != 1 || origins[0] != "https://sapi.eterultimate.asia" {
		t.Fatalf("origins = %#v", origins)
	}
}
