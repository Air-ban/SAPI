package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash"
	"math/big"
	"strconv"
	"strings"
	"time"
)

func base64urlEncode(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

func base64urlDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

type TokenPayload struct {
	Role string `json:"role"`
	Sub  string `json:"sub"`
	Exp  int64  `json:"exp"`
}

const DefaultTokenTTL = 12 * time.Hour

func SignToken(payload TokenPayload, secret string) []byte {
	return SignTokenWithTTL(payload, secret, DefaultTokenTTL)
}

func SignTokenWithTTL(payload TokenPayload, secret string, ttl time.Duration) []byte {
	header := map[string]string{"alg": "HS256", "typ": "JWT"}

	if ttl <= 0 {
		ttl = DefaultTokenTTL
	}
	payload.Exp = time.Now().Add(ttl).Unix()

	headerJSON, _ := json.Marshal(header)
	bodyJSON, _ := json.Marshal(payload)

	encodedHeader := base64urlEncode(headerJSON)
	encodedBody := base64urlEncode(bodyJSON)

	data := encodedHeader + "." + encodedBody

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	signature := base64urlEncode(mac.Sum(nil))

	return []byte(data + "." + signature)
}

func SignTokenString(payload TokenPayload, secret string) string {
	return string(SignToken(payload, secret))
}

func SignTokenStringWithTTL(payload TokenPayload, secret string, ttl time.Duration) string {
	return string(SignTokenWithTTL(payload, secret, ttl))
}

func VerifyToken(token string, secret string) *TokenPayload {
	if token == "" {
		return nil
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}

	encodedHeader := parts[0]
	encodedBody := parts[1]
	signature := parts[2]
	data := encodedHeader + "." + encodedBody

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	expected := base64urlEncode(mac.Sum(nil))

	if !SafeEqual(signature, expected) {
		return nil
	}

	bodyJSON, err := base64urlDecode(encodedBody)
	if err != nil {
		return nil
	}

	var payload TokenPayload
	if err := json.Unmarshal(bodyJSON, &payload); err != nil {
		return nil
	}

	if payload.Exp == 0 || payload.Exp < time.Now().Unix() {
		return nil
	}

	return &payload
}

func SafeEqual(a, b string) bool {
	left := sha256.Sum256([]byte(a))
	right := sha256.Sum256([]byte(b))
	return hmac.Equal(left[:], right[:])
}

func RandomID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + "_" + fmt.Sprintf("%x", b)
}

func RandomAPIKey() string {
	b := make([]byte, 24)
	rand.Read(b)
	return "sk-sapi-" + base64urlEncode(b)
}

func RandomSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64urlEncode(b)
}

func HashPassword(password string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	saltStr := base64urlEncode(salt)

	iterations := 120000
	hash := pbkdf2([]byte(password), salt, iterations, 32, sha256.New)
	hashStr := base64urlEncode(hash)

	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", iterations, saltStr, hashStr)
}

func VerifyPassword(password, storedHash string) bool {
	if storedHash == "" {
		return false
	}

	parts := strings.SplitN(storedHash, "$", 4)
	if len(parts) != 4 {
		return false
	}

	algorithm, iterationsText, salt, expectedHash := parts[0], parts[1], parts[2], parts[3]

	iterations, err := strconv.Atoi(iterationsText)
	if err != nil || algorithm != "pbkdf2_sha256" || salt == "" || expectedHash == "" {
		return false
	}

	if saltBytes, err := base64urlDecode(salt); err == nil {
		hash := pbkdf2([]byte(password), saltBytes, iterations, 32, sha256.New)
		if SafeEqual(base64urlEncode(hash), expectedHash) {
			return true
		}
	}

	// Compatibility for hashes produced by callers that used the stored salt text directly.
	hash := pbkdf2([]byte(password), []byte(salt), iterations, 32, sha256.New)
	return SafeEqual(base64urlEncode(hash), expectedHash)
}

func pbkdf2(password, salt []byte, iter, keyLen int, h func() hash.Hash) []byte {
	prf := hmac.New(h, password)
	hashLen := prf.Size()
	numBlocks := (keyLen + hashLen - 1) / hashLen

	dk := make([]byte, 0, numBlocks*hashLen)
	buf := make([]byte, 4)

	for block := 1; block <= numBlocks; block++ {
		prf.Reset()
		prf.Write(salt)
		buf[0] = byte(block >> 24)
		buf[1] = byte(block >> 16)
		buf[2] = byte(block >> 8)
		buf[3] = byte(block)
		prf.Write(buf)
		T := prf.Sum(nil)
		U := make([]byte, len(T))
		copy(U, T)

		for i := 1; i < iter; i++ {
			prf.Reset()
			prf.Write(U)
			U = prf.Sum(nil)
			for j := range T {
				T[j] ^= U[j]
			}
		}
		dk = append(dk, T...)
	}
	return dk[:keyLen]
}

func GenerateVerificationCode() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(900000))
	return fmt.Sprintf("%06d", n.Int64()+100000)
}
