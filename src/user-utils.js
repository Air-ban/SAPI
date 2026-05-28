const { randomApiKey, randomId, now } = require("./store");

function maskKey(key) {
  if (!key) return "";
  return `${key.slice(0, 12)}...${key.slice(-6)}`;
}

function sanitizeApiKeyRecord(record, includeKey = true) {
  const key = record?.key || "";
  return {
    id: record?.id || "",
    name: record?.name || "API Key",
    key: includeKey ? key : maskKey(key),
    preview: maskKey(key),
    enabled: record?.enabled !== false,
    allowedModels: Array.isArray(record?.allowedModels) ? record.allowedModels : [],
    rpmLimit: typeof record?.rpmLimit === "number" ? record.rpmLimit : 0,
    createdAt: record?.createdAt || "",
    updatedAt: record?.updatedAt || "",
    lastUsedAt: record?.lastUsedAt || ""
  };
}

function sanitizeUser(user, includeKey = true) {
  const apiKeys = getApiKeys(user);
  const primaryKey = getPrimaryApiKey(user);
  return {
    id: user.id,
    name: user.name,
    username: user.username || "",
    email: user.email || "",
    apiKey: includeKey ? primaryKey : maskKey(primaryKey),
    apiKeys: apiKeys.map((item) => sanitizeApiKeyRecord(item, includeKey)),
    hasApiKey: apiKeys.length > 0 || Boolean(primaryKey),
    enabled: Boolean(user.enabled),
    receiveAnnouncementEmail: user.receiveAnnouncementEmail !== false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function getApiKeys(user) {
  return Array.isArray(user?.apiKeys) ? user.apiKeys.filter((item) => item?.key) : [];
}

function getPrimaryApiKey(user) {
  const apiKeys = getApiKeys(user);
  return apiKeys.find((item) => item.enabled !== false)?.key || apiKeys[0]?.key || user?.apiKey || "";
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function createUserApiKeyRecord(user, name = "", allowedModels = [], rpmLimit = 0) {
  const createdAt = now();
  const apiKeys = getApiKeys(user);
  const record = {
    id: randomId("key"),
    name: String(name || "").trim() || `API Key ${apiKeys.length + 1}`,
    key: randomApiKey(),
    enabled: true,
    allowedModels: Array.isArray(allowedModels) ? allowedModels : [],
    rpmLimit: Number.isFinite(rpmLimit) && rpmLimit > 0 ? Math.floor(rpmLimit) : 0,
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: ""
  };

  if (!Array.isArray(user.apiKeys)) user.apiKeys = [];
  user.apiKeys.push(record);
  if (!user.apiKey) user.apiKey = record.key;
  user.updatedAt = createdAt;
  return record;
}

function createAdminApiKeyRecord(db, name = "") {
  const createdAt = now();
  if (!Array.isArray(db.adminApiKeys)) db.adminApiKeys = [];
  const record = {
    id: randomId("key"),
    name: String(name || "").trim() || `Admin Key ${db.adminApiKeys.length + 1}`,
    key: randomApiKey(),
    enabled: true,
    allowedModels: [],
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: ""
  };
  db.adminApiKeys.push(record);
  return record;
}

module.exports = {
  maskKey,
  sanitizeApiKeyRecord,
  sanitizeUser,
  getApiKeys,
  getPrimaryApiKey,
  normalizeUsername,
  createUserApiKeyRecord,
  createAdminApiKeyRecord
};
