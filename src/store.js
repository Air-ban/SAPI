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
  for (const user of db.users) {
    if (!user.username) {
      user.username = String(user.name || user.id || "").trim().toLowerCase();
      changed = true;
    }
    if (user.apiKey === undefined || user.apiKey === null) {
      user.apiKey = "";
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

function parseModels(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

  return {
    name,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    models: parseModels(input.models ?? existing?.models ?? ""),
    enabled: Boolean(input.enabled ?? existing?.enabled ?? true)
  };
}

module.exports = {
  DATA_FILE,
  mutateDb,
  normalizeProviderInput,
  now,
  parseModels,
  randomApiKey,
  randomId,
  readDb,
  redactProvider
};
