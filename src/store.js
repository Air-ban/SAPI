const fs = require("node:fs");
const path = require("node:path");
const { randomApiKey, randomId, randomSecret } = require("./auth");

const DATA_FILE =
  process.env.SAPI_DATA_FILE || path.join(__dirname, "..", "data", "sapi.json");

function now() {
  return new Date().toISOString();
}

function ensureDb() {
  if (fs.existsSync(DATA_FILE)) return;

  const createdAt = now();
  const db = {
    version: 1,
    appSecret: randomSecret(),
    providers: [],
    users: [],
    tokenUsage: [],
    requestLogs: [],
    createdAt,
    updatedAt: createdAt
  };

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  let changed = false;

  if (!db.appSecret) {
    db.appSecret = randomSecret();
    changed = true;
  }
  if (!Array.isArray(db.providers)) {
    db.providers = [];
    changed = true;
  }
  if (!Array.isArray(db.users)) {
    db.users = [];
    changed = true;
  }
  if (!Array.isArray(db.tokenUsage)) {
    db.tokenUsage = [];
    changed = true;
  }
  if (!Array.isArray(db.requestLogs)) {
    db.requestLogs = [];
    changed = true;
  }
  if (!Array.isArray(db.adminApiKeys)) {
    db.adminApiKeys = [];
    changed = true;
  }
  if (!Array.isArray(db.invitationCodes)) {
    db.invitationCodes = [];
    changed = true;
  }
  if (!db.smtpConfig || typeof db.smtpConfig !== "object") {
    db.smtpConfig = {};
    changed = true;
  }
  if (!Array.isArray(db.verificationCodes)) {
    db.verificationCodes = [];
    changed = true;
  }
  if (!Array.isArray(db.announcements)) {
    db.announcements = [];
    changed = true;
  }
  if (!Array.isArray(db.documents)) {
    db.documents = [];
    changed = true;
  }
  if (!Array.isArray(db.suggestions)) {
    db.suggestions = [];
    changed = true;
  }
  if (db.siteEmail === undefined) {
    db.siteEmail = "";
    changed = true;
  }
  if (typeof db.defaultRpmLimit !== "number") {
    db.defaultRpmLimit = 30;
    changed = true;
  }
  if (db.siteBanner === undefined) {
    db.siteBanner = { content: "", updatedAt: "" };
    changed = true;
  }
  if (db.maintenanceMode === undefined) {
    db.maintenanceMode = false;
    changed = true;
  }
  if (db.maintenanceEndTime === undefined) {
    db.maintenanceEndTime = "";
    changed = true;
  }
  for (const provider of db.providers) {
    if (!provider.healthStatus) {
      provider.healthStatus = "unknown";
      changed = true;
    }
    if (typeof provider.latency !== "number") {
      provider.latency = 0;
      changed = true;
    }
    if (typeof provider.ping !== "number") {
      provider.ping = 0;
      changed = true;
    }
    if (typeof provider.availability7d !== "number") {
      provider.availability7d = 100;
      changed = true;
    }
    if (!Array.isArray(provider.healthHistory)) {
      provider.healthHistory = [];
      changed = true;
    }
    if (!provider.lastHealthCheck) {
      provider.lastHealthCheck = "";
      changed = true;
    }
    if (typeof provider.failoverThreshold !== "number" || provider.failoverThreshold < 0) {
      provider.failoverThreshold = 3;
      changed = true;
    }
    if (!provider.modelMappings || typeof provider.modelMappings !== "object" || Array.isArray(provider.modelMappings)) {
      provider.modelMappings = {};
      changed = true;
    }
    if (typeof provider.priority !== "number") {
      provider.priority = 0;
      changed = true;
    }
  }

  for (const user of db.users) {
    if (!user.username) {
      user.username = String(user.name || user.id || "").trim().toLowerCase();
      changed = true;
    }
    if (user.email === undefined) {
      user.email = "";
      changed = true;
    }
    if (user.receiveAnnouncementEmail === undefined) {
      user.receiveAnnouncementEmail = true;
      changed = true;
    }
    if (user.apiKey === undefined || user.apiKey === null) {
      user.apiKey = "";
      changed = true;
    }
    if (!Array.isArray(user.apiKeys)) {
      user.apiKeys = [];
      changed = true;
    }
    if (user.apiKey && !user.apiKeys.some((item) => item && item.key === user.apiKey)) {
      const createdAt = user.createdAt || now();
      user.apiKeys.unshift({
        id: randomId("key"),
        name: "默认 Key",
        key: user.apiKey,
        enabled: true,
        createdAt,
        updatedAt: user.updatedAt || createdAt,
        lastUsedAt: ""
      });
      changed = true;
    }
    user.apiKeys = user.apiKeys
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const key = String(item.key || "").trim();
        if (!key) return null;
        let itemChanged = false;
        const normalized = { ...item, key };
        if (!normalized.id) {
          normalized.id = randomId("key");
          itemChanged = true;
        }
        if (!normalized.name) {
          normalized.name = index === 0 ? "默认 Key" : `API Key ${index + 1}`;
          itemChanged = true;
        }
        if (normalized.enabled === undefined) {
          normalized.enabled = true;
          itemChanged = true;
        }
        if (!normalized.createdAt) {
          normalized.createdAt = user.createdAt || now();
          itemChanged = true;
        }
        if (!normalized.updatedAt) {
          normalized.updatedAt = user.updatedAt || normalized.createdAt;
          itemChanged = true;
        }
        if (normalized.lastUsedAt === undefined) {
          normalized.lastUsedAt = "";
          itemChanged = true;
        }
        if (!Array.isArray(normalized.allowedModels)) {
          normalized.allowedModels = [];
          itemChanged = true;
        }
        if (typeof normalized.rpmLimit !== "number") {
          normalized.rpmLimit = 0;
          itemChanged = true;
        }
        if (itemChanged) changed = true;
        return normalized;
      })
      .filter(Boolean);
    const primaryKey = user.apiKeys.find((item) => item.enabled !== false)?.key || user.apiKeys[0]?.key || "";
    if (user.apiKey !== primaryKey) {
      user.apiKey = primaryKey;
      changed = true;
    }
  }

  if (changed) writeDb(db);
  return db;
}

function writeDb(db) {
  db.updatedAt = now();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function mutateDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

function redactProvider(provider) {
  return {
    ...provider,
    apiKey: provider.apiKey ? `••••${provider.apiKey.slice(-4)}` : "",
    hasApiKey: Boolean(provider.apiKey)
  };
}

function normalizeModel(item) {
  if (item && typeof item === "object") {
    const id = String(item.id || item.name || "").trim();
    const cliSupport = Array.isArray(item.cliSupport)
      ? item.cliSupport.map((c) => String(c || "").trim()).filter(Boolean)
      : [];
    return {
      id,
      name: String(item.name || id || "").trim(),
      description: String(item.description || "").trim(),
      cliSupport
    };
  }
  const id = String(item || "").trim();
  return { id, name: id, description: "", cliSupport: [] };
}

function normalizeModels(value) {
  if (!value) return [];
  const arr = Array.isArray(value)
    ? value
    : String(value)
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
  return arr.map(normalizeModel).filter((m) => m.id);
}

function normalizeModelMappings(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const customId = String(item.customId || item.alias || item.key || "").trim();
      const upstreamId = String(item.upstreamId || item.target || item.value || "").trim();
      if (customId && upstreamId) result[customId] = upstreamId;
    }
  } else {
    for (const [key, val] of Object.entries(value)) {
      const customId = String(key || "").trim();
      const upstreamId = String(val || "").trim();
      if (customId && upstreamId) result[customId] = upstreamId;
    }
  }
  return result;
}

function normalizeProviderInput(input, existing = null) {
  const name = String(input.name || existing?.name || "").trim();
  const baseUrl = String(input.baseUrl || existing?.baseUrl || "").trim();
  const rawApiKey = input.apiKey === undefined ? undefined : String(input.apiKey).trim();

  if (!name) throw new Error("Provider name is required.");
  if (!baseUrl) throw new Error("Provider base URL is required.");

  try {
    new URL(baseUrl);
  } catch {
    throw new Error("Provider base URL must be a valid URL.");
  }

  const apiKey = rawApiKey || existing?.apiKey || "";
  if (!apiKey) throw new Error("Provider API key is required.");

  const failoverThresholdRaw = input.failoverThreshold === undefined
    ? (existing?.failoverThreshold ?? 3)
    : Number(input.failoverThreshold);
  const failoverThreshold = Number.isFinite(failoverThresholdRaw) && failoverThresholdRaw >= 0
    ? Math.floor(failoverThresholdRaw)
    : 3;

  const priorityRaw = input.priority === undefined
    ? (existing?.priority ?? 0)
    : Number(input.priority);
  const priority = Number.isFinite(priorityRaw) && priorityRaw >= 0
    ? Math.floor(priorityRaw)
    : 0;

  return {
    name,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    models: normalizeModels(input.models ?? existing?.models ?? ""),
    modelMappings: normalizeModelMappings(input.modelMappings ?? existing?.modelMappings ?? {}),
    enabled: Boolean(input.enabled ?? existing?.enabled ?? true),
    failoverThreshold,
    priority
  };
}

module.exports = {
  DATA_FILE,
  mutateDb,
  normalizeModel,
  normalizeModels,
  normalizeProviderInput,
  now,
  randomApiKey,
  randomId,
  readDb,
  redactProvider
};
