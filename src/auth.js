const crypto = require("node:crypto");

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const data = `${encodedHeader}.${encodedBody}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");

  return `${data}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedBody, signature] = parts;
  const data = `${encodedHeader}.${encodedBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");

  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedBody, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function randomApiKey() {
  return `sk-sapi-${crypto.randomBytes(24).toString("base64url")}`;
}

function randomSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const iterations = 120000;
  const hash = crypto
    .pbkdf2Sync(String(password), salt, iterations, 32, "sha256")
    .toString("base64url");

  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;

  const [algorithm, iterationsText, salt, expectedHash] = storedHash.split("$");
  const iterations = Number(iterationsText);

  if (algorithm !== "pbkdf2_sha256" || !iterations || !salt || !expectedHash) {
    return false;
  }

  const hash = crypto
    .pbkdf2Sync(String(password), salt, iterations, 32, "sha256")
    .toString("base64url");

  return safeEqual(hash, expectedHash);
}

module.exports = {
  hashPassword,
  randomApiKey,
  randomId,
  randomSecret,
  safeEqual,
  signToken,
  verifyPassword,
  verifyToken
};
