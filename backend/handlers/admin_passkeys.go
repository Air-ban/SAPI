package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"sapi/auth"
	"sapi/config"
	"sapi/models"
	"sapi/security"
	"sapi/store"
	"sapi/utils"
)

const (
	adminPasskeySessionTTL = 5 * time.Minute
	adminPasskeyUserID     = "sapi-admin"
)

type adminPasskeyUser struct {
	username    string
	credentials []webauthn.Credential
}

func (u adminPasskeyUser) WebAuthnID() []byte {
	return []byte(adminPasskeyUserID)
}

func (u adminPasskeyUser) WebAuthnName() string {
	if u.username != "" {
		return u.username
	}
	return "admin"
}

func (u adminPasskeyUser) WebAuthnDisplayName() string {
	return "SAPI Admin"
}

func (u adminPasskeyUser) WebAuthnCredentials() []webauthn.Credential {
	return u.credentials
}

func (u adminPasskeyUser) WebAuthnIcon() string {
	return ""
}

type passkeySessionEnvelope struct {
	Kind    string               `json:"kind"`
	Session webauthn.SessionData `json:"session"`
	Nonce   string               `json:"nonce"`
	Exp     int64                `json:"exp"`
}

var localPasskeyNonces = struct {
	sync.Mutex
	items map[string]int64
}{items: map[string]int64{}}

func handleAdminPasskeyRegisterOptions(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	db := store.ReadDB()
	wa, err := newAdminWebAuthn(cfg)
	if err != nil {
		utils.SendError(w, 500, "Passkey is not available: "+err.Error(), "passkey_not_available")
		return
	}

	user := adminPasskeyUser{username: cfg.AdminUser, credentials: adminWebAuthnCredentials(db.AdminPasskeys)}
	exclusions := make([]protocol.CredentialDescriptor, 0, len(user.credentials))
	for _, credential := range user.credentials {
		exclusions = append(exclusions, credential.Descriptor())
	}

	creation, session, err := wa.BeginRegistration(
		user,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			RequireResidentKey: protocol.ResidentKeyNotRequired(),
			ResidentKey:        protocol.ResidentKeyRequirementPreferred,
			UserVerification:   protocol.VerificationRequired,
		}),
		webauthn.WithExclusions(exclusions),
		webauthn.WithConveyancePreference(protocol.PreferNoAttestation),
	)
	if err != nil {
		utils.SendError(w, 500, "Failed to start passkey registration.", "passkey_start_failed")
		return
	}

	sessionToken, err := signAdminPasskeySession("register", session, db.AppSecret)
	if err != nil {
		utils.SendError(w, 500, "Failed to create passkey session.", "passkey_session_failed")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"options":      creation,
		"sessionToken": sessionToken,
	})
}

func handleAdminPasskeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	body, ok := readFlexibleJSONBody(w, r)
	if !ok {
		return
	}

	sessionToken := security.SafeSingleLine(toString(body["sessionToken"]), 10000)
	credentialPayload, ok := body["credential"].(map[string]interface{})
	if !ok {
		utils.SendError(w, 400, "Passkey credential response is required.", "invalid_passkey_response")
		return
	}

	db := store.ReadDB()
	envelope, ok := verifyAdminPasskeySession(sessionToken, db.AppSecret, "register")
	if !ok {
		utils.SendError(w, 400, "Passkey registration session is invalid or expired.", "invalid_passkey_session")
		return
	}
	if !consumeAdminPasskeyNonce(r, envelope.Nonce) {
		utils.SendError(w, 400, "Passkey registration session has already been used.", "passkey_session_reused")
		return
	}

	cfg := config.Load()
	wa, err := newAdminWebAuthn(cfg)
	if err != nil {
		utils.SendError(w, 500, "Passkey is not available: "+err.Error(), "passkey_not_available")
		return
	}

	payload, err := json.Marshal(credentialPayload)
	if err != nil {
		utils.SendError(w, 400, "Passkey credential response is invalid.", "invalid_passkey_response")
		return
	}
	req, err := http.NewRequest(http.MethodPost, r.URL.Path, bytes.NewReader(payload))
	if err != nil {
		utils.SendError(w, 400, "Passkey credential response is invalid.", "invalid_passkey_response")
		return
	}

	user := adminPasskeyUser{username: cfg.AdminUser, credentials: adminWebAuthnCredentials(db.AdminPasskeys)}
	credential, err := wa.FinishRegistration(user, envelope.Session, req)
	if err != nil {
		utils.SendError(w, 400, "Passkey registration failed.", "passkey_registration_failed")
		return
	}

	name := security.SafeSingleLine(toString(body["name"]), 120)
	if name == "" {
		name = "Admin Passkey " + fmt.Sprintf("%d", len(db.AdminPasskeys)+1)
	}

	result := store.MutateDB(func(db *models.Database) interface{} {
		for _, item := range db.AdminPasskeys {
			if bytes.Equal(item.Credential.ID, credential.ID) {
				return "exists"
			}
		}
		now := store.Now()
		record := models.AdminPasskey{
			ID:         auth.RandomID("apk"),
			Name:       name,
			Credential: *credential,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		db.AdminPasskeys = append(db.AdminPasskeys, record)
		return record
	})
	if result == "exists" {
		utils.SendError(w, 409, "This passkey is already registered.", "passkey_exists")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"passkey": sanitizeAdminPasskey(result.(models.AdminPasskey)),
	})
}

func handleAdminPasskeyLoginOptions(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	db := store.ReadDB()
	user := adminPasskeyUser{username: cfg.AdminUser, credentials: adminWebAuthnCredentials(db.AdminPasskeys)}
	if len(user.credentials) == 0 {
		utils.SendError(w, 404, "No admin passkey has been registered.", "passkey_not_registered")
		return
	}

	if !checkLoginRateLimit(w, r, normalizeUsername(cfg.AdminUser)+":passkey") {
		return
	}

	wa, err := newAdminWebAuthn(cfg)
	if err != nil {
		utils.SendError(w, 500, "Passkey is not available: "+err.Error(), "passkey_not_available")
		return
	}

	assertion, session, err := wa.BeginLogin(user, webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		utils.SendError(w, 500, "Failed to start passkey login.", "passkey_start_failed")
		return
	}

	sessionToken, err := signAdminPasskeySession("login", session, db.AppSecret)
	if err != nil {
		utils.SendError(w, 500, "Failed to create passkey session.", "passkey_session_failed")
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"options":      assertion,
		"sessionToken": sessionToken,
	})
}

func handleAdminPasskeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	body, ok := readFlexibleJSONBody(w, r)
	if !ok {
		return
	}

	sessionToken := security.SafeSingleLine(toString(body["sessionToken"]), 10000)
	credentialPayload, ok := body["credential"].(map[string]interface{})
	if !ok {
		recordLoginFailure(r, normalizeUsername(config.Load().AdminUser)+":passkey")
		utils.SendError(w, 400, "Passkey credential response is required.", "invalid_passkey_response")
		return
	}

	db := store.ReadDB()
	envelope, ok := verifyAdminPasskeySession(sessionToken, db.AppSecret, "login")
	if !ok {
		recordLoginFailure(r, normalizeUsername(config.Load().AdminUser)+":passkey")
		utils.SendError(w, 400, "Passkey login session is invalid or expired.", "invalid_passkey_session")
		return
	}
	if !consumeAdminPasskeyNonce(r, envelope.Nonce) {
		recordLoginFailure(r, normalizeUsername(config.Load().AdminUser)+":passkey")
		utils.SendError(w, 400, "Passkey login session has already been used.", "passkey_session_reused")
		return
	}

	cfg := config.Load()
	wa, err := newAdminWebAuthn(cfg)
	if err != nil {
		recordLoginFailure(r, normalizeUsername(cfg.AdminUser)+":passkey")
		utils.SendError(w, 500, "Passkey is not available: "+err.Error(), "passkey_not_available")
		return
	}

	payload, err := json.Marshal(credentialPayload)
	if err != nil {
		recordLoginFailure(r, normalizeUsername(cfg.AdminUser)+":passkey")
		utils.SendError(w, 400, "Passkey credential response is invalid.", "invalid_passkey_response")
		return
	}
	req, err := http.NewRequest(http.MethodPost, r.URL.Path, bytes.NewReader(payload))
	if err != nil {
		recordLoginFailure(r, normalizeUsername(cfg.AdminUser)+":passkey")
		utils.SendError(w, 400, "Passkey credential response is invalid.", "invalid_passkey_response")
		return
	}

	user := adminPasskeyUser{username: cfg.AdminUser, credentials: adminWebAuthnCredentials(db.AdminPasskeys)}
	credential, err := wa.FinishLogin(user, envelope.Session, req)
	if err != nil {
		recordLoginFailure(r, normalizeUsername(cfg.AdminUser)+":passkey")
		utils.SendError(w, 401, "Passkey login failed.", "passkey_login_failed")
		return
	}

	store.MutateDB(func(db *models.Database) interface{} {
		now := store.Now()
		for i := range db.AdminPasskeys {
			if bytes.Equal(db.AdminPasskeys[i].Credential.ID, credential.ID) {
				db.AdminPasskeys[i].Credential = *credential
				db.AdminPasskeys[i].LastUsedAt = now
				db.AdminPasskeys[i].UpdatedAt = now
				return nil
			}
		}
		return nil
	})

	clearLoginFailures(normalizeUsername(cfg.AdminUser) + ":passkey")
	fresh := store.ReadDB()
	token := signAdminLoginToken(cfg, fresh.AppSecret)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"role":     "admin",
		"token":    token,
		"username": cfg.AdminUser,
	})
}

func handleAdminPasskeyDelete(w http.ResponseWriter, r *http.Request) {
	id := security.SafeSingleLine(r.PathValue("id"), 128)
	if id == "" {
		utils.SendError(w, 400, "Passkey ID is required.", "invalid_passkey")
		return
	}

	removed := store.MutateDB(func(db *models.Database) interface{} {
		before := len(db.AdminPasskeys)
		filtered := make([]models.AdminPasskey, 0, len(db.AdminPasskeys))
		for _, item := range db.AdminPasskeys {
			if item.ID != id {
				filtered = append(filtered, item)
			}
		}
		db.AdminPasskeys = filtered
		return before != len(filtered)
	})
	if !removed.(bool) {
		utils.SendError(w, 404, "Passkey not found.", "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func adminWebAuthnCredentials(passkeys []models.AdminPasskey) []webauthn.Credential {
	result := make([]webauthn.Credential, 0, len(passkeys))
	for _, item := range passkeys {
		if len(item.Credential.ID) > 0 && len(item.Credential.PublicKey) > 0 {
			result = append(result, item.Credential)
		}
	}
	return result
}

func newAdminWebAuthn(cfg *config.Config) (*webauthn.WebAuthn, error) {
	rpID, origins, err := adminPasskeyRP(cfg)
	if err != nil {
		return nil, err
	}
	return webauthn.New(&webauthn.Config{
		RPID:                  rpID,
		RPDisplayName:         "SAPI",
		RPOrigins:             origins,
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			RequireResidentKey: protocol.ResidentKeyNotRequired(),
			ResidentKey:        protocol.ResidentKeyRequirementPreferred,
			UserVerification:   protocol.VerificationRequired,
		},
		Timeouts: webauthn.TimeoutsConfig{
			Login:        webauthn.TimeoutConfig{Enforce: true, Timeout: adminPasskeySessionTTL, TimeoutUVD: adminPasskeySessionTTL},
			Registration: webauthn.TimeoutConfig{Enforce: true, Timeout: adminPasskeySessionTTL, TimeoutUVD: adminPasskeySessionTTL},
		},
	})
}

func adminPasskeyRP(cfg *config.Config) (string, []string, error) {
	base := strings.TrimSpace(cfg.PublicBaseURL)
	if base == "" {
		base = "http://localhost:3000"
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", nil, fmt.Errorf("invalid public base URL")
	}
	origin := parsed.Scheme + "://" + parsed.Host
	host := strings.Split(parsed.Host, ":")[0]
	if host == "" {
		return "", nil, fmt.Errorf("invalid passkey relying party host")
	}
	return host, []string{origin}, nil
}

func signAdminPasskeySession(kind string, session *webauthn.SessionData, secret string) (string, error) {
	if session == nil {
		return "", fmt.Errorf("missing passkey session")
	}
	nonce := auth.RandomSecret()
	envelope := passkeySessionEnvelope{
		Kind:    kind,
		Session: *session,
		Nonce:   nonce,
		Exp:     time.Now().Add(adminPasskeySessionTTL).Unix(),
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		return "", err
	}
	signed := signPasskeyBytes(raw, secret)
	rememberAdminPasskeyNonce(nonce)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(signed), nil
}

func verifyAdminPasskeySession(token, secret, kind string) (*passkeySessionEnvelope, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	got, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	expected := signPasskeyBytes(raw, secret)
	if !hmac.Equal(got, expected) {
		return nil, false
	}
	var envelope passkeySessionEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, false
	}
	if envelope.Kind != kind || envelope.Nonce == "" || envelope.Exp < time.Now().Unix() {
		return nil, false
	}
	return &envelope, true
}

func signPasskeyBytes(raw []byte, secret string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("admin-passkey-session:"))
	mac.Write(raw)
	return mac.Sum(nil)
}

func rememberAdminPasskeyNonce(nonce string) {
	if nonce == "" {
		return
	}
	_ = security.RedisRememberOnce(context.Background(), "passkey:"+security.SensitiveKey(nonce), adminPasskeySessionTTL)
	localPasskeyNonces.Lock()
	defer localPasskeyNonces.Unlock()
	pruneLocalPasskeyNoncesLocked()
	localPasskeyNonces.items[nonce] = time.Now().Add(adminPasskeySessionTTL).Unix()
}

func consumeAdminPasskeyNonce(r *http.Request, nonce string) bool {
	if nonce == "" {
		return false
	}
	if ok, err := security.RedisConsumeOnce(r.Context(), "passkey:"+security.SensitiveKey(nonce)); err == nil {
		forgetLocalPasskeyNonce(nonce)
		return ok
	}
	localPasskeyNonces.Lock()
	defer localPasskeyNonces.Unlock()
	pruneLocalPasskeyNoncesLocked()
	exp, ok := localPasskeyNonces.items[nonce]
	if !ok || exp < time.Now().Unix() {
		delete(localPasskeyNonces.items, nonce)
		return false
	}
	delete(localPasskeyNonces.items, nonce)
	return true
}

func forgetLocalPasskeyNonce(nonce string) {
	localPasskeyNonces.Lock()
	defer localPasskeyNonces.Unlock()
	delete(localPasskeyNonces.items, nonce)
}

func pruneLocalPasskeyNoncesLocked() {
	now := time.Now().Unix()
	for nonce, exp := range localPasskeyNonces.items {
		if exp < now {
			delete(localPasskeyNonces.items, nonce)
		}
	}
}

func sanitizeAdminPasskeys(passkeys []models.AdminPasskey) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(passkeys))
	for _, item := range passkeys {
		result = append(result, sanitizeAdminPasskey(item))
	}
	return result
}

func sanitizeAdminPasskey(item models.AdminPasskey) map[string]interface{} {
	credentialID := base64.RawURLEncoding.EncodeToString(item.Credential.ID)
	preview := credentialID
	if len(preview) > 16 {
		preview = preview[:10] + "..." + preview[len(preview)-6:]
	}
	return map[string]interface{}{
		"id":         item.ID,
		"name":       item.Name,
		"preview":    preview,
		"createdAt":  item.CreatedAt,
		"updatedAt":  item.UpdatedAt,
		"lastUsedAt": item.LastUsedAt,
	}
}
