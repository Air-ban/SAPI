package auth

import (
	"crypto/sha256"
	"fmt"
	"hash"
	"testing"
)

func TestHashPasswordVerifiesGeneratedHash(t *testing.T) {
	hash := HashPassword("new-secret-123")

	if !VerifyPassword("new-secret-123", hash) {
		t.Fatal("expected generated password hash to verify")
	}
	if VerifyPassword("wrong-secret", hash) {
		t.Fatal("expected wrong password to be rejected")
	}
}

func TestVerifyPasswordKeepsLegacySaltTextCompatibility(t *testing.T) {
	const password = "legacy-secret-123"
	const iterations = 120000
	const salt = "legacy-salt-text"

	hash := pbkdf2([]byte(password), []byte(salt), iterations, 32, sha256New)
	stored := fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", iterations, salt, base64urlEncode(hash))

	if !VerifyPassword(password, stored) {
		t.Fatal("expected legacy salt-text password hash to verify")
	}
}

func sha256New() hash.Hash {
	return sha256.New()
}
