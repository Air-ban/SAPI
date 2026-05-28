const { verifyToken, safeEqual } = require("../auth");
const { readDb } = require("../store");
const { sendError, getBearerToken } = require("../utils");
const { getApiKeys, normalizeUsername } = require("../user-utils");

function requireAdmin(req, res, next) {
  const token = getBearerToken(req);
  const db = readDb();
  const payload = verifyToken(token, db.appSecret);

  if (!payload || payload.role !== "admin") {
    sendError(res, 401, "Admin authentication is required.", "unauthorized");
    return;
  }

  next();
}

function requireAnyAuth(req, res, next) {
  const token = getBearerToken(req);
  const db = readDb();
  const payload = verifyToken(token, db.appSecret);

  if (!payload || !payload.sub) {
    sendError(res, 401, "Authentication is required.", "unauthorized");
    return;
  }

  if (payload.role === "admin") {
    next();
    return;
  }

  if (payload.role === "user") {
    const user = db.users.find((candidate) => candidate.id === payload.sub);
    if (!user) {
      sendError(res, 401, "User account was not found.", "unauthorized");
      return;
    }
    if (!user.enabled) {
      sendError(res, 403, "User account is disabled.", "user_disabled");
      return;
    }
    req.user = user;
    next();
    return;
  }

  sendError(res, 401, "Authentication is required.", "unauthorized");
}

function requireUserAccount(req, res, next) {
  const token = getBearerToken(req);
  const db = readDb();
  const payload = verifyToken(token, db.appSecret);

  if (!payload || payload.role !== "user" || !payload.sub) {
    sendError(res, 401, "User authentication is required.", "unauthorized");
    return;
  }

  const user = db.users.find((candidate) => candidate.id === payload.sub);
  if (!user) {
    sendError(res, 401, "User account was not found.", "unauthorized");
    return;
  }

  if (!user.enabled) {
    sendError(res, 403, "User account is disabled.", "user_disabled");
    return;
  }

  req.user = user;
  next();
}

function findUserByKey(apiKey) {
  const db = readDb();
  let matchedKey = null;
  const user = db.users.find((candidate) => {
    if (!candidate.enabled) return false;

    const apiKeys = getApiKeys(candidate);
    for (const keyRecord of apiKeys) {
      if (keyRecord.enabled !== false && safeEqual(keyRecord.key, apiKey)) {
        matchedKey = keyRecord;
        return true;
      }
    }

    if (!apiKeys.length && candidate.apiKey && safeEqual(candidate.apiKey, apiKey)) {
      matchedKey = {
        id: "legacy",
        name: "默认 Key",
        key: candidate.apiKey,
        enabled: true
      };
      return true;
    }

    return false;
  });

  if (user) {
    return { db, user, apiKeyRecord: matchedKey };
  }

  const adminKeys = db.adminApiKeys || [];
  for (const keyRecord of adminKeys) {
    if (keyRecord.enabled !== false && safeEqual(keyRecord.key, apiKey)) {
      return {
        db,
        user: {
          id: "__admin__",
          name: "Administrator",
          username: "admin",
          enabled: true
        },
        apiKeyRecord: keyRecord
      };
    }
  }

  return { db, user: null, apiKeyRecord: null };
}

async function verifyTencentCaptcha(req, res) {
  return true;
}

module.exports = {
  requireAdmin,
  requireAnyAuth,
  requireUserAccount,
  findUserByKey,
  verifyTencentCaptcha,
  normalizeUsername
};
