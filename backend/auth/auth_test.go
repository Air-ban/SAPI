package auth

import (
	"crypto/sha256"
	"fmt"
	"hash"
	"testing"
	"time"
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

func TestSignTokenStringWithTTLUsesRequestedExpiry(t *testing.T) {
	before := time.Now()
	token := SignTokenStringWithTTL(TokenPayload{Role: "admin", Sub: "admin"}, "test-secret", 30*24*time.Hour)
	verified := VerifyToken(token, "test-secret")
	if verified == nil {
		t.Fatal("expected signed token to verify")
	}

	minExp := before.Add(30*24*time.Hour - time.Minute).Unix()
	maxExp := time.Now().Add(30*24*time.Hour + time.Minute).Unix()
	if verified.Exp < minExp || verified.Exp > maxExp {
		t.Fatalf("exp = %d, want between %d and %d", verified.Exp, minExp, maxExp)
	}
}

func sha256New() hash.Hash {
	return sha256.New()
}
