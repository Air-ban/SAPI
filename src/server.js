require("dotenv").config();

const crypto = require("node:crypto");
const express = require("express");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  mutateDb,
  normalizeModel,
  normalizeProviderInput,
  now,
  randomApiKey,
  randomId,
  readDb,
  redactProvider
} = require("./store");
const { hashPassword, safeEqual, signToken, verifyPassword, verifyToken } = require("./auth");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.SAPI_PORT || process.env.PORT || 3000);
const ADMIN_USER = process.env.SAPI_ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.SAPI_ADMIN_PASSWORD || "sapi-admin";
const PUBLIC_BASE_URL = process.env.SAPI_PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const TENCENT_CAPTCHA_APP_ID = process.env.SAPI_TENCENT_CAPTCHA_APP_ID || "";
const TENCENT_CAPTCHA_APP_SECRET_KEY = process.env.SAPI_TENCENT_CAPTCHA_APP_SECRET_KEY || "";
const TENCENT_SECRET_ID = process.env.SAPI_TENCENT_SECRET_ID || "";
const TENCENT_SECRET_KEY = process.env.SAPI_TENCENT_SECRET_KEY || "";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length"
]);

const C_RESET = "\x1b[0m";
const C_GREEN = "\x1b[32m";
const C_RED = "\x1b[31m";
const C_YELLOW = "\x1b[33m";
const C_CYAN = "\x1b[36m";
const C_DIM = "\x1b[2m";
const C_BOLD = "\x1b[1m";

const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "SAPI Proxy API",
    description: "SAPI OpenAI-compatible proxy endpoints. Use your SAPI API Key in the Authorization header: Bearer sk-sapi-...",
    version: "0.1.0"
  },
  servers: [{ url: PUBLIC_BASE_URL }],
  tags: [
    { name: "Models", description: "List available models" },
    { name: "Chat", description: "Chat completions" },
    { name: "Completions", description: "Text completions" },
    { name: "Embeddings", description: "Text embeddings" },
    { name: "Anthropic", description: "Anthropic-compatible endpoints" }
  ],
  paths: {
    "/v1/models": {
      get: {
        tags: ["Models"],
        summary: "List available models",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Models list" }
        }
      }
    },
    "/v1/chat/completions": {
      post: {
        tags: ["Chat"],
        summary: "Chat completions",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string", example: "gpt-4o-mini" },
                  messages: { type: "array", items: { type: "object" }, example: [{ role: "user", content: "hello" }] },
                  stream: { type: "boolean", example: false },
                  temperature: { type: "number", example: 0.7 },
                  max_tokens: { type: "integer", example: 2048 }
                },
                required: ["model", "messages"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Chat completion response" }
        }
      }
    },
    "/v1/completions": {
      post: {
        tags: ["Completions"],
        summary: "Text completions",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  prompt: { type: "string" },
                  stream: { type: "boolean" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Completion response" }
        }
      }
    },
    "/v1/embeddings": {
      post: {
        tags: ["Embeddings"],
        summary: "Create embeddings",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  input: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Embeddings response" }
        }
      }
    },
    "/v1/messages": {
      post: {
        tags: ["Anthropic"],
        summary: "Anthropic Messages API",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  messages: { type: "array", items: { type: "object" } },
                  max_tokens: { type: "integer" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Message response" }
        }
      }
    },
    "/v1/messages/count_tokens": {
      post: {
        tags: ["Anthropic"],
        summary: "Count tokens (Anthropic)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  messages: { type: "array", items: { type: "object" } }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Token count response" }
        }
      }
    },
    "/responses": {
      post: {
        tags: ["Chat"],
        summary: "OpenAI Responses API",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  input: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Response" }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    }
  }
};

const app = express();

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, anthropic-version, anthropic-beta");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  const startMs = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startMs;
    const ok = res.statusCode < 400;
    const ts = new Date().toLocaleString("zh-CN", { hour12: false });
    const statusColor = ok ? C_GREEN : C_RED;
    const statusLabel = ok ? "OK" : "FAIL";
    console.log(
      `${C_DIM}[${ts}]${C_RESET} ${C_CYAN}${req.method}${C_RESET} ${C_BOLD}${req.path}${C_RESET} ` +
      `${statusColor}${C_BOLD}${res.statusCode} ${statusLabel}${C_RESET} ${C_DIM}${duration}ms${C_RESET}`
    );
  });

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getUserApiKey(req) {
  return getBearerToken(req) || req.headers["x-api-key"] || "";
}

function sendError(res, status, message, code = "sapi_error") {
  res.status(status).json({
    error: {
      message,
      type: code,
      code
    }
  });
}

function sha256(message) {
  return crypto.createHash("sha256").update(message).digest("hex");
}

function hmacSha256(key, message) {
  return crypto.createHmac("sha256", key).update(message).digest();
}

async function tencentCloudApi3Request({ secretId, secretKey, service, version, action, region, payload }) {
  const host = `${service}.tencentcloudapi.com`;
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const httpRequestMethod = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const contentType = "application/json";
  const payloadString = JSON.stringify(payload);
  const hashedRequestPayload = sha256(payloadString);

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;

  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256(canonicalRequest);
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

  const secretDate = hmacSha256(Buffer.from(`TC3${secretKey}`, "utf8"), date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign).digest("hex");

  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Host": host,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": region || "",
      "Authorization": authorization
    },
    body: payloadString
  });

  return response.json();
}

function appendDebugLog(label, data) {
  try {
    fs.appendFileSync(
      path.join(__dirname, "..", "data", "fetch-debug.log"),
      `${new Date().toISOString()} ${label} ${JSON.stringify(data)}\n`
    );
  } catch {
    // Ignore debug logging failures.
  }
}

function appendDebugBodyLog(label, body) {
  try {
    const sanitized = JSON.parse(JSON.stringify(body || {}));
    if (sanitized.messages) {
      for (const msg of sanitized.messages) {
        if (msg.content && typeof msg.content === "string" && msg.content.length > 200) {
          msg.content = msg.content.slice(0, 200) + "...[truncated]";
        }
      }
    }
    fs.appendFileSync(
      path.join(__dirname, "..", "data", "fetch-debug.log"),
      `${new Date().toISOString()} ${label}.body ${JSON.stringify(sanitized)}\n`
    );
  } catch {
    // Ignore debug logging failures.
  }
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

function maskKey(key) {
  if (!key) return "";
  return `${key.slice(0, 12)}...${key.slice(-6)}`;
}

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

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
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

  // Check admin API keys
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

function publicConfig() {
  return {
    name: "SAPI",
    baseUrl: PUBLIC_BASE_URL,
    captcha: {
      enabled: Boolean(TENCENT_CAPTCHA_APP_ID && TENCENT_CAPTCHA_APP_SECRET_KEY),
      appId: TENCENT_CAPTCHA_APP_ID
    }
  };
}

function serviceConfig() {
  const db = readDb();
  const providers = db.providers.filter((provider) => provider.enabled);
  const modelMap = new Map();

  for (const provider of providers) {
    for (const m of (provider.models || []).map(normalizeModel)) {
      if (m.id) modelMap.set(m.id, m);
    }
    for (const [customId, upstreamId] of Object.entries(provider.modelMappings || {})) {
      if (customId && upstreamId) {
        modelMap.set(customId, { id: customId, name: customId, description: "", cliSupport: [] });
      }
    }
  }

  const models = Array.from(modelMap.values());

  return {
    name: "SAPI",
    baseUrl: PUBLIC_BASE_URL,
    endpoints: [
      {
        method: "GET",
        path: "/v1/models",
        description: "列出当前可用模型"
      },
      {
        method: "POST",
        path: "/v1/chat/completions",
        description: "OpenAI 兼容聊天补全"
      },
      {
        method: "POST",
        path: "/v1/completions",
        description: "OpenAI 兼容文本补全"
      },
      {
        method: "POST",
        path: "/v1/embeddings",
        description: "OpenAI 兼容向量接口"
      },
      {
        method: "POST",
        path: "/responses",
        description: "OpenAI 兼容 Responses API"
      },
      {
        method: "POST",
        path: "/v1/messages",
        description: "Anthropic 兼容 Messages API"
      }
    ],
    models
  };
}

async function verifyTencentCaptcha(req, res) {
  return true;
}

const providerFailureCounters = new Map();

function getProviderFailureCounter(providerId) {
  return providerFailureCounters.get(providerId) || { consecutiveFailures: 0, lastFailureAt: "" };
}

function recordProviderSuccess(providerId) {
  const counter = providerFailureCounters.get(providerId);
  if (counter && counter.consecutiveFailures > 0) {
    counter.consecutiveFailures = 0;
    counter.lastFailureAt = "";
  }
}

function recordProviderFailure(providerId) {
  const counter = providerFailureCounters.get(providerId);
  if (counter) {
    counter.consecutiveFailures += 1;
    counter.lastFailureAt = new Date().toISOString();
  } else {
    providerFailureCounters.set(providerId, {
      consecutiveFailures: 1,
      lastFailureAt: new Date().toISOString()
    });
  }
}

function isUpstreamProviderError(status) {
  return status >= 500 || status === 429;
}

function isProviderAvailableForFailover(provider) {
  const threshold = typeof provider.failoverThreshold === "number" ? provider.failoverThreshold : 3;
  if (threshold <= 0) return true;
  const counter = getProviderFailureCounter(provider.id);
  return counter.consecutiveFailures < threshold;
}

function getModelProviderMapping(provider, modelId) {
  if (!modelId) return null;
  for (const candidate of provider.models || []) {
    const id = typeof candidate === "object" ? candidate.id : candidate;
    if (id === modelId) return { provider, upstreamModel: modelId };
  }
  const mappings = provider.modelMappings || {};
  if (mappings[modelId]) return { provider, upstreamModel: mappings[modelId] };
  return null;
}

function chooseProvider(db, body = {}) {
  const candidates = chooseProviderCandidates(db, body);
  return candidates[0]?.provider || null;
}

function sortProvidersByPriority(providers) {
  return providers.slice().sort((a, b) => {
    const pa = a.priority || 0;
    const pb = b.priority || 0;
    if (pa !== pb) return pb - pa;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function chooseProviderCandidates(db, body = {}) {
  const model = body && typeof body === "object" ? body.model : "";
  const providers = sortProvidersByPriority(
    db.providers.filter(
      (provider) => provider.enabled && isProviderAvailableForFailover(provider)
    )
  );
  if (providers.length === 0) return [];

  if (model) {
    const matched = [];
    for (const provider of providers) {
      const mapping = getModelProviderMapping(provider, model);
      if (mapping) matched.push(mapping);
    }
    return matched;
  }

  return [{ provider: providers[0], upstreamModel: "" }];
}

function chooseAnthropicProviderCandidates(db, model) {
  const providers = sortProvidersByPriority(
    db.providers.filter(
      (provider) => provider.enabled && isProviderAvailableForFailover(provider)
    )
  );
  if (providers.length === 0) return [];

  if (model) {
    const matched = [];
    for (const provider of providers) {
      const mapping = getModelProviderMapping(provider, model);
      if (mapping) matched.push(mapping);
    }
    if (matched.length > 0) return matched;
  }

  const first = providers[0];
  const firstModel = first.models?.length > 0
    ? (typeof first.models[0] === "object" ? first.models[0].id : first.models[0])
    : "";
  const mappedFirst = first.modelMappings && Object.values(first.modelMappings)[0];
  return [{ provider: first, upstreamModel: mappedFirst || firstModel || model || "" }];
}

function buildUpstreamUrl(baseUrl, originalUrl) {
  const base = new URL(baseUrl);
  const incoming = new URL(originalUrl, "http://sapi.local");
  const incomingPath = incoming.pathname.replace(/^\/+/, "");
  const incomingWithoutVersion = incomingPath.replace(/^v1\/?/, "");
  const basePath = base.pathname.replace(/\/+$/, "");

  if (basePath.endsWith("/v1")) {
    base.pathname = `${basePath}/${incomingWithoutVersion}`;
  } else {
    base.pathname = `${basePath}/${incomingPath}`;
  }

  base.search = incoming.search;
  return base.toString();
}

function extractModelIds(payload) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];

  return [
    ...new Set(
      source
        .map((item) => {
          if (typeof item === "string") return item;
          return item?.id || item?.name || "";
        })
        .map((item) => String(item).trim())
        .filter(Boolean)
    )
  ];
}

function finiteTokenCount(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const promptDetails =
    usage.prompt_tokens_details ||
    usage.promptTokensDetails ||
    usage.input_tokens_details ||
    usage.inputTokensDetails ||
    {};
  const completionDetails =
    usage.completion_tokens_details ||
    usage.completionTokensDetails ||
    usage.output_tokens_details ||
    usage.outputTokensDetails ||
    {};
  const promptTokens = finiteTokenCount(
    usage.prompt_tokens,
    usage.promptTokens,
    usage.input_tokens,
    usage.inputTokens
  );
  const completionTokens = finiteTokenCount(
    usage.completion_tokens,
    usage.completionTokens,
    usage.output_tokens,
    usage.outputTokens
  );
  let totalTokens = finiteTokenCount(
    usage.total_tokens,
    usage.totalTokens
  );
  if (!totalTokens && promptTokens + completionTokens > 0) {
    totalTokens = promptTokens + completionTokens;
  }

  const cachedTokens = finiteTokenCount(
    usage.cached_tokens,
    usage.cachedTokens,
    usage.prompt_cache_hit_tokens,
    usage.promptCacheHitTokens,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens
  );
  const cacheCreationTokens = finiteTokenCount(
    usage.cache_creation_input_tokens,
    usage.cacheCreationInputTokens,
    usage.cache_write_input_tokens,
    usage.cacheWriteInputTokens,
    promptDetails.cache_creation_tokens,
    promptDetails.cacheCreationTokens
  );
  const cacheMissTokens = finiteTokenCount(
    usage.prompt_cache_miss_tokens,
    usage.promptCacheMissTokens,
    usage.cache_miss_input_tokens,
    usage.cacheMissInputTokens
  );
  const reasoningTokens = finiteTokenCount(
    usage.reasoning_tokens,
    usage.reasoningTokens,
    completionDetails.reasoning_tokens,
    completionDetails.reasoningTokens
  );

  if (
    !totalTokens &&
    !promptTokens &&
    !completionTokens &&
    !cachedTokens &&
    !cacheCreationTokens &&
    !cacheMissTokens &&
    !reasoningTokens
  ) {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    cacheCreationTokens,
    cacheMissTokens,
    reasoningTokens
  };
}

function findUsagePayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.usage,
    payload.token_usage,
    payload.tokenUsage,
    payload.response?.usage
  ];

  for (const candidate of candidates) {
    if (normalizeUsage(candidate)) return candidate;
  }

  if (Array.isArray(payload)) {
    for (let index = payload.length - 1; index >= 0; index -= 1) {
      const candidate = findUsagePayload(payload[index]);
      if (candidate) return candidate;
    }
  }

  return null;
}

function extractUsageFromResponseText(text) {
  if (!text || typeof text !== "string") return null;

  try {
    const payload = JSON.parse(text);
    const usage = findUsagePayload(payload);
    if (usage) return usage;
  } catch {
    // The response may be an SSE or NDJSON stream.
  }

  let usage = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;

    const item = trimmed.startsWith("data:")
      ? trimmed.slice(5).trim()
      : trimmed;
    if (!item || item === "[DONE]" || (!item.startsWith("{") && !item.startsWith("["))) {
      continue;
    }

    try {
      const payload = JSON.parse(item);
      const candidate = findUsagePayload(payload);
      if (candidate) usage = candidate;
    } catch {
      // Ignore malformed stream fragments.
    }
  }

  return usage;
}

function createUsageCollector() {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;

  const inspectLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;

    const item = trimmed.startsWith("data:")
      ? trimmed.slice(5).trim()
      : trimmed;
    if (!item || item === "[DONE]" || (!item.startsWith("{") && !item.startsWith("["))) {
      return;
    }

    try {
      const payload = JSON.parse(item);
      const candidate = findUsagePayload(payload);
      if (candidate) usage = candidate;
    } catch {
      // Ignore partial or malformed stream fragments.
    }
  };

  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) inspectLine(line);
    },
    finish() {
      buffer += decoder.decode();
      if (buffer) inspectLine(buffer);
      return usage;
    }
  };
}

function shouldStreamResponse(req, upstreamResponse) {
  const contentType = upstreamResponse.headers.get("content-type") || "";
  return (
    req.body?.stream === true ||
    contentType.includes("text/event-stream") ||
    contentType.includes("application/x-ndjson")
  );
}

async function writeUpstreamStreamToResponse(upstreamResponse, res) {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) return null;

  const usageCollector = createUsageCollector();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      usageCollector.push(value);

      if (!res.write(Buffer.from(value))) {
        await once(res, "drain");
      }
    }
  } finally {
    reader.releaseLock();
  }

  return usageCollector.finish();
}

function buildUpstreamBody(req, upstreamModel) {
  if (req.method === "GET" || req.method === "HEAD" || req.body === undefined) {
    return undefined;
  }

  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? { ...req.body }
      : req.body;

  if (body && typeof body === "object" && !Array.isArray(body)) {
    if (body.stream === true) {
      const streamOptions =
        body.stream_options && typeof body.stream_options === "object"
          ? body.stream_options
          : {};
      body.stream_options = {
        ...streamOptions,
        include_usage: true
      };
    }
    if (upstreamModel && body.model !== undefined) {
      body.model = upstreamModel;
    }
  }

  return JSON.stringify(body);
}

function trimStoredRecords(db, key, maxRecords = 50000) {
  if (db[key].length > maxRecords) {
    db[key] = db[key].slice(db[key].length - maxRecords);
  }
}

function logRequestToTerminal({ method, endpoint, status, ok, stream, durationMs, userName, model, providerName, errorCode, errorMessage, promptTokens, completionTokens, finishReason }) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  const statusColor = ok ? C_GREEN : C_RED;
  const statusLabel = ok ? "OK" : "FAIL";
  const methodStr = `${C_CYAN}${method || "?"}${C_RESET}`;
  const endpointStr = `${C_BOLD}${endpoint || "?"}${C_RESET}`;
  const statusStr = `${statusColor}${C_BOLD}${status || "?"} ${statusLabel}${C_RESET}`;
  const durationStr = `${C_DIM}${durationMs || 0}ms${C_RESET}`;
  const userStr = userName ? `${C_DIM}${userName}${C_RESET}` : "";
  const modelStr = model ? `${C_YELLOW}${model}${C_RESET}` : "";
  const providerStr = providerName ? `${C_DIM}via ${providerName}${C_RESET}` : "";
  const streamStr = stream ? `${C_DIM}[stream]${C_RESET}` : "";
  const tokenStr = (promptTokens || completionTokens) ? `${C_DIM}tokens=${promptTokens}+${completionTokens}${C_RESET}` : "";
  const finishStr = finishReason ? `${C_YELLOW}finish=${finishReason}${C_RESET}` : "";

  let reasonStr = "";
  if (!ok) {
    const reason = errorMessage || errorCode || `HTTP ${status}`;
    reasonStr = ` ${C_RED}reason="${reason}"${C_RESET}`;
  }

  const parts = [
    `${C_DIM}[${ts}]${C_RESET}`,
    methodStr,
    endpointStr,
    statusStr,
    durationStr,
    userStr,
    modelStr,
    providerStr,
    streamStr,
    tokenStr,
    finishStr,
    reasonStr
  ].filter(Boolean);

  console.log(parts.join(" "));
}

function recordRequestLog({
  userId,
  userName,
  username,
  apiKeyId,
  apiKeyName,
  apiKeyPreview,
  providerId,
  providerName,
  model,
  upstreamModel,
  endpoint,
  method,
  status,
  ok,
  stream,
  durationMs,
  usage,
  errorCode,
  errorMessage,
  finishReason
}) {
  const normalized = normalizeUsage(usage) || {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
    cacheMissTokens: 0,
    reasoningTokens: 0
  };

  logRequestToTerminal({
    method, endpoint, status, ok, stream, durationMs,
    userName: userName || username,
    model, providerName, errorCode, errorMessage,
    promptTokens: normalized.promptTokens,
    completionTokens: normalized.completionTokens,
    finishReason
  });

  mutateDb((db) => {
    if (!Array.isArray(db.requestLogs)) db.requestLogs = [];
    const user = db.users.find((item) => item.id === userId);
    const apiKeyRecord = user && apiKeyId
      ? getApiKeys(user).find((item) => item.id === apiKeyId)
      : null;
    const timestamp = now();
    if (apiKeyRecord) {
      apiKeyRecord.lastUsedAt = timestamp;
      apiKeyRecord.updatedAt = timestamp;
    }
    db.requestLogs.push({
      id: randomId("req"),
      userId,
      userName: String(userName || user?.name || "").trim(),
      username: String(username || user?.username || "").trim(),
      apiKeyId: String(apiKeyId || "").trim(),
      apiKeyName: String(apiKeyName || apiKeyRecord?.name || "").trim(),
      apiKeyPreview: String(apiKeyPreview || maskKey(apiKeyRecord?.key || "")).trim(),
      providerId,
      providerName: String(providerName || "").trim(),
      model: String(model || "").trim() || "unknown",
      upstreamModel: String(upstreamModel || "").trim(),
      endpoint: String(endpoint || "").trim(),
      method: String(method || "").trim().toUpperCase(),
      status: Number(status) || 0,
      ok: Boolean(ok),
      stream: Boolean(stream),
      durationMs: Number(durationMs) || 0,
      promptTokens: normalized.promptTokens,
      completionTokens: normalized.completionTokens,
      totalTokens: normalized.totalTokens,
      cachedTokens: normalized.cachedTokens,
      cacheCreationTokens: normalized.cacheCreationTokens,
      cacheMissTokens: normalized.cacheMissTokens,
      reasoningTokens: normalized.reasoningTokens,
      errorCode: String(errorCode || "").trim(),
      errorMessage: String(errorMessage || "").trim().slice(0, 500),
      timestamp
    });
    trimStoredRecords(db, "requestLogs");
  });
}

function isModelAllowed(apiKeyRecord, model) {
  const allowed = apiKeyRecord?.allowedModels;
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  const modelId = String(model || "").trim();
  if (!modelId) return true;
  return allowed.some((item) => String(item || "").trim() === modelId);
}

const rpmWindows = new Map();

function getRpmLimit(apiKeyRecord, db) {
  if (typeof apiKeyRecord?.rpmLimit === "number" && apiKeyRecord.rpmLimit > 0) {
    return apiKeyRecord.rpmLimit;
  }
  return typeof db?.defaultRpmLimit === "number" && db.defaultRpmLimit > 0 ? db.defaultRpmLimit : 30;
}

function checkMaintenanceMode(db, res) {
  if (db.maintenanceMode) {
    const endTime = db.maintenanceEndTime || "";
    const msg = endTime
      ? `站点维护中，预计 ${new Date(endTime).toLocaleString("zh-CN")} 恢复。`
      : "站点维护中，请稍后重试。";
    sendError(res, 503, msg, "maintenance_mode");
    return true;
  }
  return false;
}

function checkRpmLimit(apiKeyRecord, db) {
  const limit = getRpmLimit(apiKeyRecord, db);
  const key = apiKeyRecord?.key || "";
  if (!key || limit <= 0) return { allowed: true, limit, current: 0 };

  const now = Date.now();
  const windowStart = now - 60 * 1000;

  let timestamps = rpmWindows.get(key);
  if (!timestamps) {
    timestamps = [];
    rpmWindows.set(key, timestamps);
  }

  // Clean old entries
  const cutoffIndex = timestamps.findIndex((t) => t >= windowStart);
  if (cutoffIndex > 0) {
    timestamps.splice(0, cutoffIndex);
  } else if (cutoffIndex === -1) {
    timestamps.length = 0;
  }



  if (timestamps.length >= limit) {
    return { allowed: false, limit, current: timestamps.length };
  }

  timestamps.push(now);
  return { allowed: true, limit, current: timestamps.length };
}

function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function isHopByHopHeader(name) {
  return HOP_BY_HOP_HEADERS.has(String(name || "").toLowerCase());
}

function filterForwardHeaders(headers = {}) {
  const result = {};
  const allowedHeaders = new Set([
    "accept",
    "content-type"
  ]);

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      !allowedHeaders.has(lower) ||
      lower === "host" ||
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower === "content-length" ||
      isHopByHopHeader(lower)
    ) {
      continue;
    }
    if (value === undefined || value === null) continue;
    result[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return result;
}

function convertAnthropicMessagesToOpenAI(messages) {
  if (!Array.isArray(messages)) return [];
  const result = [];

  for (const msg of messages) {
    const role = msg.role || "user";
    const content = msg.content;

    if (role === "tool") {
      const toolContent = typeof content === "string" ? content : extractTextFromContent(content);
      result.push({
        role: "tool",
        tool_call_id: msg.tool_use_id || msg.tool_call_id || "",
        content: toolContent || ""
      });
      continue;
    }

    if (Array.isArray(content)) {
      const textParts = [];
      const reasoningParts = [];
      const toolUseBlocks = [];
      const toolResultItems = [];

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const blockType = block.type || "";

        if (blockType === "text" || blockType === "input_text") {
          if (block.text) textParts.push(block.text);
        } else if (blockType === "tool_use") {
          toolUseBlocks.push({
            id: block.id || "",
            type: "function",
            function: {
              name: block.name || "",
              arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {})
            }
          });
        } else if (blockType === "tool_result") {
          let resultText = "";
          if (typeof block.content === "string") {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter((b) => b && (b.type === "text" || b.type === "input_text"))
              .map((b) => b.text || "")
              .filter(Boolean)
              .join("\n");
          } else if (block.content && typeof block.content === "object") {
            resultText = extractTextFromContent(block.content);
          }
          toolResultItems.push({
            role: "tool",
            tool_call_id: block.tool_use_id || "",
            content: resultText || ""
          });
        } else if (blockType === "image") {
          textParts.push("[image]");
        } else if (blockType === "thinking") {
          if (block.thinking) reasoningParts.push(block.thinking);
        }
      }

      if (role === "assistant") {
        const assistantMsg = { role: "assistant" };
        const joinedText = textParts.join("\n");
        const joinedReasoning = reasoningParts.join("\n");
        if (joinedReasoning) assistantMsg.reasoning_content = joinedReasoning;
        if (toolUseBlocks.length > 0) {
          assistantMsg.tool_calls = toolUseBlocks;
          assistantMsg.content = joinedText || null;
        } else if (joinedText) {
          assistantMsg.content = joinedText;
        }
        if (assistantMsg.content !== undefined || assistantMsg.tool_calls || assistantMsg.reasoning_content) {
          result.push(assistantMsg);
        }
      } else {
        if (toolResultItems.length > 0) {
          for (const tr of toolResultItems) {
            result.push(tr);
          }
        }
        if (textParts.length > 0) {
          result.push({ role: "user", content: textParts.join("\n") });
        }
      }
    } else if (typeof content === "string") {
      result.push({ role, content });
    }
  }

  return result;
}

function sanitizeToolSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const result = {};
  const allowedRootKeys = new Set(["type", "properties", "required", "description", "enum", "items", "anyOf", "oneOf", "allOf", "default", "nullable", "title"]);
  const allowedPropertyKeys = new Set(["type", "description", "enum", "items", "anyOf", "oneOf", "allOf", "properties", "required", "default", "nullable", "title"]);

  for (const [key, value] of Object.entries(schema)) {
    if (!allowedRootKeys.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      result.properties = {};
      for (const [propKey, propValue] of Object.entries(value)) {
        if (!propValue || typeof propValue !== "object") continue;
        const cleanProp = {};
        for (const [pk, pv] of Object.entries(propValue)) {
          if (allowedPropertyKeys.has(pk)) cleanProp[pk] = pv;
        }
        if (Object.keys(cleanProp).length > 0) {
          result.properties[propKey] = cleanProp;
        }
      }
    } else if (key === "required" && Array.isArray(value)) {
      result.required = value.filter((r) => typeof r === "string");
    } else {
      result[key] = value;
    }
  }

  if (!result.type) result.type = "object";
  if (!result.properties) result.properties = {};
  return result;
}

function convertAnthropicToolsToOpenAI(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      const name = tool.name || "";
      if (!name) return null;
      const parameters = sanitizeToolSchema(tool.input_schema);
      return {
        type: "function",
        function: {
          name,
          description: tool.description || "",
          parameters
        }
      };
    })
    .filter(Boolean);
}

function anthropicToOpenAI(body = {}) {
  const messages = [];
  if (body.system) {
    if (typeof body.system === "string") {
      messages.push({ role: "system", content: body.system });
    } else if (Array.isArray(body.system)) {
      const text = body.system
        .filter((b) => b && b.type === "text")
        .map((b) => b.text || "")
        .filter(Boolean)
        .join("\n");
      if (text) messages.push({ role: "system", content: text });
    }
  }

  const converted = convertAnthropicMessagesToOpenAI(body.messages || []);
  for (const msg of converted) {
    messages.push(msg);
  }

  const payload = {
    model: body.model || "",
    messages,
    stream: body.stream === true
  };

  if (payload.stream) {
    payload.stream_options = { include_usage: true };
  }
  if (body.max_tokens !== undefined && body.max_tokens !== null) {
    payload.max_tokens = body.max_tokens;
    payload.max_completion_tokens = body.max_tokens;
  }
  if (body.temperature !== undefined && body.temperature !== null) {
    payload.temperature = body.temperature;
  }
  if (body.top_p !== undefined && body.top_p !== null) {
    payload.top_p = body.top_p;
  }
  if (body.top_k !== undefined && body.top_k !== null) {
    payload.top_k = body.top_k;
  }

  const tools = convertAnthropicToolsToOpenAI(body.tools);
  if (tools.length > 0) {
    payload.tools = tools;
    if (body.tool_choice && typeof body.tool_choice === "object") {
      const tcType = body.tool_choice.type || "auto";
      if (tcType === "any") {
        payload.tool_choice = "required";
      } else if (tcType === "tool" && body.tool_choice.name) {
        payload.tool_choice = { type: "function", function: { name: body.tool_choice.name } };
      } else {
        payload.tool_choice = "auto";
      }
    } else {
      payload.tool_choice = "auto";
    }
  }

  if (body.stop_sequences && Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
    payload.stop = body.stop_sequences;
  }

  return payload;
}

function openAIToAnthropicNonStreaming(payload, model) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] || {};
  const messageContent = choice.message?.content || "";
  const text = extractTextFromContent(messageContent);
  const reasoningContent = choice.message?.reasoning_content || choice.message?.reasoningContent || "";
  const finishReason = String(choice.finish_reason || choice.finishReason || "end_turn").trim();
  const usage = findUsagePayload(payload);

  const content = [];
  if (reasoningContent) {
    content.push({
      type: "thinking",
      thinking: typeof reasoningContent === "string" ? reasoningContent : extractTextFromContent(reasoningContent)
    });
  }
  if (text) {
    content.push({ type: "text", text });
  }

  const toolCalls = choice.message?.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const func = tc?.function;
      if (!func?.name) continue;
      let inputObj = {};
      try {
        inputObj = typeof func.arguments === "string" ? JSON.parse(func.arguments) : (func.arguments || {});
      } catch { inputObj = {}; }
      content.push({
        type: "tool_use",
        id: tc.id || generateId("toolu"),
        name: func.name,
        input: inputObj
      });
    }
  }

  const stopReason = finishReason === "tool_calls" ? "tool_use"
    : finishReason === "length" ? "max_tokens"
    : finishReason === "content_filter" ? "end_turn"
    : "end_turn";

  return {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    model: String(model || payload.model || ""),
    stop_reason: stopReason,
    stop_sequence: null,
    usage: buildAnthropicUsage(usage)
  };
}

function buildAnthropicUsage(usage) {
  const normalized = normalizeUsage(usage);
  const source = usage && typeof usage === "object" ? usage : {};
  return {
    input_tokens: normalized?.promptTokens || finiteTokenCount(source.input_tokens, source.prompt_tokens) || 0,
    output_tokens: normalized?.completionTokens || finiteTokenCount(source.output_tokens, source.completion_tokens) || 0,
    cache_creation_input_tokens: normalized?.cacheCreationTokens || finiteTokenCount(source.cache_creation_input_tokens) || 0,
    cache_read_input_tokens: normalized?.cachedTokens || finiteTokenCount(source.cache_read_input_tokens, source.cached_tokens) || 0
  };
}

function openAIToAnthropicDeltaStreaming(payload) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] || {};
  const delta = choice.delta || {};
  const events = [];

  if (delta.reasoning_content || delta.reasoningContent) {
    const reasoningText = typeof (delta.reasoning_content || delta.reasoningContent) === "string"
      ? (delta.reasoning_content || delta.reasoningContent)
      : extractTextFromContent(delta.reasoning_content || delta.reasoningContent);
    if (reasoningText) {
      events.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: reasoningText }
      });
    }
  }

  if (delta.content) {
    const text = typeof delta.content === "string" ? delta.content : extractTextFromContent(delta.content);
    if (text) {
      events.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text }
      });
    }
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const upstreamIndex = tc.index || 0;
      if (tc.function?.name) {
        events.push({
          _toolStart: true,
          _upstreamIndex: upstreamIndex,
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: tc.id || generateId("toolu"),
            name: tc.function.name,
            input: {}
          }
        });
      }
      if (tc.function?.arguments) {
        events.push({
          _upstreamIndex: upstreamIndex,
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: tc.function.arguments
          }
        });
      }
    }
  }

  return events;
}

function copyUpstreamHeaders(sourceHeaders, res, overrides = {}) {
  if (!sourceHeaders || typeof sourceHeaders.forEach !== "function") return;

  sourceHeaders.forEach((value, key) => {
    const lower = String(key).toLowerCase();
    if (isHopByHopHeader(lower)) return;
    res.setHeader(key, value);
  });

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    res.setHeader(key, value);
  }
}

function extractTextFromContent(content) {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (Array.isArray(content)) {
    return content.map((item) => extractTextFromContent(item)).join("");
  }
  if (typeof content !== "object") return String(content);

  const type = String(content.type || "").toLowerCase();
  if ((type === "input_text" || type === "output_text") && content.text !== undefined) {
    return extractTextFromContent(content.text);
  }
  if (content.text !== undefined && typeof content.text !== "object") {
    return extractTextFromContent(content.text);
  }
  if (content.content !== undefined) {
    return extractTextFromContent(content.content);
  }
  if (content.parts !== undefined) {
    return extractTextFromContent(content.parts);
  }
  if (content.value !== undefined) {
    return extractTextFromContent(content.value);
  }
  return "";
}

function normalizeResponseFormat(format) {
  if (!format || typeof format !== "object") return null;

  const type = String(format.type || "").trim();
  if (type === "json_object") {
    return { type: "json_object" };
  }

  if (type === "json_schema") {
    const jsonSchema =
      format.json_schema && typeof format.json_schema === "object"
        ? format.json_schema
        : {
            name: format.name || "response",
            schema: format.schema || {},
            strict: format.strict !== false
          };

    return {
      type: "json_schema",
      json_schema: {
        name: String(jsonSchema.name || format.name || "response"),
        schema: jsonSchema.schema || format.schema || {},
        strict: jsonSchema.strict !== false
      }
    };
  }

  return null;
}

function convertTools(tools) {
  if (!Array.isArray(tools)) return [];

  return tools
    .map((tool) => {
      const source = tool?.function && typeof tool.function === "object" ? tool.function : tool;
      if (!source || String(tool?.type || source.type || "").trim() !== "function") return null;

      const name = String(source.name || "").trim();
      if (!name) return null;

      return {
        type: "function",
        function: {
          name,
          description: String(source.description || "").trim(),
          parameters:
            source.parameters && typeof source.parameters === "object"
              ? source.parameters
              : { type: "object", properties: {} }
        }
      };
    })
    .filter(Boolean);
}

function appendMessage(messages, role, content) {
  const text = extractTextFromContent(content).trim();
  if (!text) return;
  messages.push({
    role: role === "developer" ? "system" : String(role || "user").trim() || "user",
    content: text
  });
}

function convertInputToMessages(input, instructions) {
  const messages = [];

  if (String(instructions || "").trim()) {
    messages.push({ role: "system", content: String(instructions).trim() });
  }

  const visit = (item) => {
    if (item === null || item === undefined) return;
    if (typeof item === "string") {
      appendMessage(messages, "user", item);
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry);
      return;
    }
    if (typeof item !== "object") {
      appendMessage(messages, "user", String(item));
      return;
    }

    const role = item.role === "developer" ? "system" : item.role || "user";
    const content =
      item.content !== undefined
        ? item.content
        : item.text !== undefined
          ? item.text
          : item.value !== undefined
            ? item.value
            : item;
    appendMessage(messages, role, content);
  };

  visit(input);
  return messages;
}

function convertResponseInputItems(messages) {
  return messages
    .map((message) => {
      const text = extractTextFromContent(message.content).trim();
      if (!text) return null;
      return {
        id: generateId("msg"),
        type: "message",
        role: message.role === "developer" ? "system" : message.role || "user",
        content: [{ type: "input_text", text }]
      };
    })
    .filter(Boolean);
}

function buildResponseFormat(body = {}) {
  return normalizeResponseFormat(body.text?.format) || normalizeResponseFormat(body.response_format);
}

function convertToChatCompletionsPayload(body = {}) {
  const messages = convertInputToMessages(body.input ?? body.messages ?? "", body.instructions);
  const stream = body.stream !== false;
  const responseFormat = buildResponseFormat(body);
  const payload = {
    model: String(body.model || "gpt-4o").trim() || "gpt-4o",
    messages,
    stream,
    tool_choice: body.tool_choice ?? "auto"
  };

  if (stream) {
    payload.stream_options = { include_usage: true };
  }

  const tools = convertTools(body.tools);
  if (tools.length > 0) payload.tools = tools;

  const maxTokens = body.max_output_tokens ?? body.max_tokens;
  if (maxTokens !== undefined && maxTokens !== null && maxTokens !== "") {
    payload.max_tokens = maxTokens;
  }

  for (const key of [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty"
  ]) {
    if (body[key] !== undefined) {
      payload[key] = body[key];
    }
  }

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  return {
    payload,
    messages,
    input: convertResponseInputItems(messages),
    responseFormat,
    stream,
    reasoningEffort: String(body.reasoning?.effort || "").trim(),
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {}
  };
}

function extractChatCompletionText(payload) {
  if (!payload || typeof payload !== "object") {
    return { text: "", finishReason: "", usage: null };
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] || {};
  const messageContent = choice.message?.content;
  const messageReasoning = choice.message?.reasoning_content || choice.message?.reasoningContent;
  const deltaContent = choice.delta?.content;
  const deltaReasoning = choice.delta?.reasoning_content || choice.delta?.reasoningContent;
  const text = extractTextFromContent(messageContent || deltaContent || choice.text || "");
  const fallbackText = extractTextFromContent(messageReasoning || deltaReasoning || "");
  const finishReason = String(choice.finish_reason || choice.finishReason || "").trim();
  const usage = findUsagePayload(payload);
  return { text: text || fallbackText, finishReason, usage };
}

function buildResponseUsage(usage, outputText = "") {
  const normalized = normalizeUsage(usage);
  const source = usage && typeof usage === "object" ? usage : {};
  const promptDetails =
    source.prompt_tokens_details ||
    source.promptTokensDetails ||
    source.input_tokens_details ||
    source.inputTokensDetails ||
    {};
  const completionDetails =
    source.completion_tokens_details ||
    source.completionTokensDetails ||
    source.output_tokens_details ||
    source.outputTokensDetails ||
    {};
  const inputTokens = finiteTokenCount(
    source.prompt_tokens,
    source.promptTokens,
    source.input_tokens,
    source.inputTokens,
    normalized?.promptTokens,
    normalized?.inputTokens
  );
  let outputTokens = finiteTokenCount(
    source.completion_tokens,
    source.completionTokens,
    source.output_tokens,
    source.outputTokens,
    normalized?.completionTokens,
    normalized?.outputTokens
  );
  if (!outputTokens && String(outputText || "").trim()) {
    outputTokens = String(outputText)
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }
  let totalTokens = finiteTokenCount(
    source.total_tokens,
    source.totalTokens,
    normalized?.totalTokens
  );
  if (!totalTokens && (inputTokens + outputTokens > 0)) {
    totalTokens = inputTokens + outputTokens;
  }

  const cachedTokens = finiteTokenCount(
    source.cached_tokens,
    source.cachedTokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens,
    normalized?.cachedTokens
  );
  const reasoningTokens = finiteTokenCount(
    source.reasoning_tokens,
    source.reasoningTokens,
    completionDetails.reasoning_tokens,
    completionDetails.reasoningTokens,
    normalized?.reasoningTokens
  );

  return {
    input_tokens: inputTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens
    },
    output_tokens: outputTokens,
    output_tokens_details: {
      reasoning_tokens: reasoningTokens
    },
    total_tokens: totalTokens
  };
}

function buildIncompleteDetails(finishReason) {
  const reason = String(finishReason || "").trim();
  if (!reason) return null;
  if (reason === "length") return { reason: "max_output_tokens" };
  if (reason === "content_filter") return { reason: "content_filter" };
  return { reason };
}

function createReasoningItem(effort) {
  return {
    id: generateId("rs"),
    type: "reasoning",
    encrypted_content: `gAAAAAB${crypto.randomBytes(100).toString("hex")}`,
    summary: [],
    effort: String(effort || "").trim() || "low"
  };
}

function createAssistantMessageItem(text) {
  return {
    id: generateId("msg"),
    type: "message",
    status: "completed",
    content: [
      {
        type: "output_text",
        annotations: [],
        logprobs: [],
        text: String(text || "")
      }
    ],
    phase: "final_answer",
    role: "assistant"
  };
}

function buildResponseObject({
  status = "completed",
  model = "gpt-4o",
  input = [],
  instructions = "",
  output = [],
  outputText = "",
  usage = null,
  reasoningEffort = "",
  toolChoice = "auto",
  tools = [],
  temperature = 1,
  topP = 0.98,
  frequencyPenalty = 0,
  presencePenalty = 0,
  maxOutputTokens = null,
  responseFormat = null,
  finishReason = "",
  metadata = {},
  previousResponseId = null,
  store = false
} = {}) {
  const createdAt = generateTimestamp();
  const responseUsage = buildResponseUsage(usage, outputText);

  return {
    id: generateId("resp"),
    object: "response",
    created_at: createdAt,
    status,
    background: false,
    completed_at: status === "completed" ? createdAt : null,
    error: null,
    frequency_penalty: Number(frequencyPenalty || 0),
    incomplete_details: buildIncompleteDetails(finishReason),
    input,
    instructions: String(instructions || ""),
    max_output_tokens: maxOutputTokens === undefined ? null : maxOutputTokens,
    max_tool_calls: null,
    model: String(model || "gpt-4o"),
    moderation: null,
    output,
    output_text: String(outputText || ""),
    parallel_tool_calls: true,
    presence_penalty: Number(presencePenalty || 0),
    previous_response_id: previousResponseId,
    prompt_cache_key: null,
    prompt_cache_retention: "24h",
    reasoning: {
      context: "current_turn",
      effort: reasoningEffort || null,
      summary: null
    },
    safety_identifier: `user-${crypto.randomBytes(8).toString("hex")}`,
    service_tier: "auto",
    store: Boolean(store),
    temperature: Number(temperature ?? 1),
    text: responseFormat ? { format: responseFormat } : {},
    tool_choice: toolChoice || "auto",
    tool_usage: {
      image_gen: null,
      web_search: { num_requests: 0 }
    },
    tools,
    top_logprobs: 0,
    top_p: Number(topP ?? 0.98),
    truncation: "disabled",
    usage: responseUsage,
    user: null,
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };
}

function createSseWriter(res) {
  let sequence = 0;
  return {
    write(type, payload) {
      sequence += 1;
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify({ type, ...payload, sequence_number: sequence })}\n\n`);
      return sequence;
    },
    nextSequence() {
      sequence += 1;
      return sequence;
    },
    current() {
      return sequence;
    }
  };
}

function parseSseDataLines(text, onData) {
  const lines = String(text || "").split(/\r?\n/);
  let current = [];

  const flush = () => {
    if (current.length === 0) return;
    onData(current.join("\n"));
    current = [];
  };

  for (const line of lines) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      current.push(line.slice(5).replace(/^ /, ""));
      continue;
    }
    if (line.startsWith("event:")) {
      continue;
    }
  }

  flush();
}

async function relayUpstreamResponse(upstreamResponse, res) {
  const text = await upstreamResponse.text();
  res.status(upstreamResponse.status);
  copyUpstreamHeaders(upstreamResponse.headers, res);
  res.send(text);
}

async function handleResponsesProxy(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendError(res, 401, "SAPI API key is required.", "missing_api_key");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const responseRequest = convertToChatCompletionsPayload(req.body || {});
  const model = responseRequest.payload.model;

  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendError(res, 403, `Model "${model}" is not allowed for this API key.`, "model_not_allowed");
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendError(res, 429, `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`, "rate_limit_exceeded");
    return;
  }

  const candidates = chooseProviderCandidates(db, responseRequest.payload);
  if (candidates.length === 0) {
    sendError(res, 503, "No enabled upstream provider is configured.", "no_provider");
    return;
  }

  const operator = {
    id: user.id,
    name: user.name,
    username: user.username || user.name
  };

  let selectedProvider = null;
  let selectedUpstreamModel = null;
  let upstreamResponse = null;
  let startedAt = null;
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const { provider, upstreamModel } = candidates[i];
    startedAt = Date.now();

    try {
      const upstreamUrl = buildUpstreamUrl(provider.baseUrl, "/v1/chat/completions");
      const headers = filterForwardHeaders(req.headers);
      headers.authorization = `Bearer ${provider.apiKey}`;
      headers["content-type"] = "application/json";
      headers["accept-encoding"] = "identity";
      if (req.headers.accept) headers.accept = req.headers.accept;

      appendDebugLog("responses.request", {
        url: upstreamUrl,
        method: "POST",
        bodyLength: Buffer.byteLength(JSON.stringify(responseRequest.payload), "utf8")
      });
      appendDebugBodyLog("responses", responseRequest.payload);
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(responseRequest.payload)
      });

      if (!upstreamResponse.ok) {
        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: model || "",
          upstreamModel: upstreamModel || "",
          endpoint: "/responses",
          method: "POST",
          status: upstreamResponse.status,
          ok: false,
          stream: responseRequest.stream === true,
          durationMs: Date.now() - startedAt,
          usage: null
        });
        if (isUpstreamProviderError(upstreamResponse.status)) {
          recordProviderFailure(provider.id);
          lastError = new Error(`Upstream provider responded with HTTP ${upstreamResponse.status}`);
          continue;
        } else {
          await relayUpstreamResponse(upstreamResponse, res);
          return;
        }
      }

      selectedProvider = provider;
      selectedUpstreamModel = upstreamModel;
      break;

    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }
      recordProviderFailure(provider.id);
      lastError = error;
    }
  }

  if (!selectedProvider) {
    if (lastError) {
      sendError(res, 502, `All upstream providers failed. Last error: ${lastError.message}`, "upstream_request_failed");
    } else {
      sendError(res, 502, "All upstream providers failed.", "all_providers_failed");
    }
    return;
  }

  const provider = selectedProvider;

  try {
    if (!responseRequest.stream) {
      const text = await upstreamResponse.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        sendError(res, 502, "Upstream chat completion response was not valid JSON.", "upstream_response_invalid");
        return;
      }

      const { text: outputText, finishReason, usage } = extractChatCompletionText(payload);
      const reasoningItem = responseRequest.reasoningEffort
        ? createReasoningItem(responseRequest.reasoningEffort)
        : null;
      const outputItems = reasoningItem ? [reasoningItem] : [];
      const assistantItem = createAssistantMessageItem(outputText);
      outputItems.push(assistantItem);

      res.status(200);
      res.json(
        buildResponseObject({
          status: "completed",
          model,
          input: responseRequest.input,
          instructions: String(req.body?.instructions || ""),
          output: outputItems,
          outputText,
          usage,
          reasoningEffort: responseRequest.reasoningEffort,
          toolChoice: responseRequest.payload.tool_choice,
          tools: responseRequest.payload.tools || [],
          temperature: responseRequest.payload.temperature,
          topP: responseRequest.payload.top_p,
          frequencyPenalty: responseRequest.payload.frequency_penalty,
          presencePenalty: responseRequest.payload.presence_penalty,
          maxOutputTokens: responseRequest.payload.max_tokens ?? null,
          responseFormat: responseRequest.responseFormat,
          finishReason,
          metadata: responseRequest.metadata
        })
      );
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: model || "",
        upstreamModel: selectedUpstreamModel || "",
        endpoint: "/responses",
        method: "POST",
        status: 200,
        ok: true,
        stream: false,
        durationMs: Date.now() - startedAt,
        usage
      });
      recordProviderSuccess(provider.id);
      return;
    }

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    const writer = createSseWriter(res);
    const responseId = generateId("resp");
    const messageId = generateId("msg");
    const reasoningItem = responseRequest.reasoningEffort
      ? createReasoningItem(responseRequest.reasoningEffort)
      : null;
    const outputItems = [];
    if (reasoningItem) outputItems.push(reasoningItem);
    const assistantItem = {
      id: messageId,
      type: "message",
      status: "in_progress",
      content: [],
      phase: "final_answer",
      role: "assistant"
    };
    outputItems.push(assistantItem);
    const baseResponse = buildResponseObject({
      status: "in_progress",
      model,
      input: responseRequest.input,
      instructions: String(req.body?.instructions || ""),
      output: outputItems,
      outputText: "",
      usage: null,
      reasoningEffort: responseRequest.reasoningEffort,
      toolChoice: responseRequest.payload.tool_choice,
      tools: responseRequest.payload.tools || [],
      temperature: responseRequest.payload.temperature,
      topP: responseRequest.payload.top_p,
      frequencyPenalty: responseRequest.payload.frequency_penalty,
      presencePenalty: responseRequest.payload.presence_penalty,
      maxOutputTokens: responseRequest.payload.max_tokens ?? null,
      responseFormat: responseRequest.responseFormat,
      metadata: responseRequest.metadata
    });
    baseResponse.id = responseId;
    baseResponse.status = "in_progress";
    baseResponse.completed_at = null;
    baseResponse.output = outputItems;

    writer.write("response.created", { response: baseResponse });
    writer.write("response.in_progress", { response: baseResponse });

    if (reasoningItem) {
      writer.write("response.output_item.added", {
        item: reasoningItem,
        output_index: 0
      });
      writer.write("response.output_item.done", {
        item: reasoningItem,
        output_index: 0
      });
    }

    writer.write("response.output_item.added", {
      item: assistantItem,
      output_index: reasoningItem ? 1 : 0
    });

    const contentPart = {
      type: "output_text",
      annotations: [],
      logprobs: [],
      text: ""
    };
    writer.write("response.content_part.added", {
      content_index: 0,
      item_id: messageId,
      output_index: reasoningItem ? 1 : 0,
      part: contentPart
    });

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      const finalResponse = {
        ...baseResponse,
        status: "completed",
        completed_at: generateTimestamp(),
        output: [
          ...(reasoningItem ? [reasoningItem] : []),
          {
            ...assistantItem,
            status: "completed",
            content: [
              {
                type: "output_text",
                annotations: [],
                logprobs: [],
                text: ""
              }
            ]
          }
        ],
        output_text: "",
        usage: buildResponseUsage(null, "")
      };
      writer.write("response.output_text.done", {
        content_index: 0,
        item_id: messageId,
        output_index: reasoningItem ? 1 : 0,
        logprobs: [],
        text: ""
      });
      writer.write("response.content_part.done", {
        content_index: 0,
        item_id: messageId,
        output_index: reasoningItem ? 1 : 0,
        part: { ...contentPart, text: "" }
      });
      writer.write("response.output_item.done", {
        item: finalResponse.output[finalResponse.output.length - 1],
        output_index: reasoningItem ? 1 : 0
      });
      writer.write("response.completed", { response: finalResponse });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let outputText = "";
    let finishReason = "";
    let usagePayload = null;

    const processData = (data) => {
      const trimmed = String(data || "").trim();
      if (!trimmed || trimmed === "[DONE]") return;

      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        return;
      }

      const extracted = extractChatCompletionText(payload);
      if (extracted.finishReason) finishReason = extracted.finishReason;
      if (extracted.usage) usagePayload = extracted.usage;

      const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
      const delta =
        choice?.delta?.content ||
        choice?.delta?.reasoning_content ||
        choice?.delta?.reasoningContent;
      const deltaText = extractTextFromContent(delta);
      if (!deltaText) return;

      outputText += deltaText;
      writer.write("response.output_text.delta", {
        content_index: 0,
        delta: deltaText,
        item_id: messageId,
        output_index: reasoningItem ? 1 : 0
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        let current = [];

        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };

        for (const line of lines) {
          if (line === "") {
            flush();
            continue;
          }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) {
            current.push(line.slice(5).replace(/^ /, ""));
          }
        }
        flush();
      }

      buffer += decoder.decode();
      if (buffer) {
        const lines = buffer.split(/\r?\n/);
        let current = [];
        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };
        for (const line of lines) {
          if (line === "") {
            flush();
            continue;
          }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) {
            current.push(line.slice(5).replace(/^ /, ""));
          }
        }
        flush();
      }
    } finally {
      reader.releaseLock();
    }

    const assistantDoneItem = {
      ...assistantItem,
      status: "completed",
      content: [
        {
          type: "output_text",
          annotations: [],
          logprobs: [],
          text: outputText
        }
      ]
    };

    writer.write("response.output_text.done", {
      content_index: 0,
      item_id: messageId,
      output_index: reasoningItem ? 1 : 0,
      logprobs: [],
      text: outputText
    });
    writer.write("response.content_part.done", {
      content_index: 0,
      item_id: messageId,
      output_index: reasoningItem ? 1 : 0,
      part: {
        type: "output_text",
        annotations: [],
        logprobs: [],
        text: outputText
      }
    });
    writer.write("response.output_item.done", {
      item: assistantDoneItem,
      output_index: reasoningItem ? 1 : 0
    });

    const finalResponse = {
      ...baseResponse,
      id: responseId,
      status: "completed",
      completed_at: generateTimestamp(),
      output: [...(reasoningItem ? [reasoningItem] : []), assistantDoneItem],
      output_text: outputText,
      incomplete_details: buildIncompleteDetails(finishReason),
      usage: buildResponseUsage(usagePayload, outputText)
    };

    writer.write("response.completed", { response: finalResponse });
    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: selectedUpstreamModel || "",
      endpoint: "/responses",
      method: "POST",
      status: 200,
      ok: true,
      stream: true,
      durationMs: Date.now() - startedAt,
      usage: buildResponseUsage(usagePayload, outputText)
    });
    recordProviderSuccess(provider.id);
    res.end();
  } catch (error) {
    appendDebugLog("responses.error", {
      message: error.message,
      name: error.name,
      code: error.code,
      causeCode: error.cause?.code,
      causeMessage: error.cause?.message
    });
    console.error("[responses] upstream fetch failed", {
      message: error.message,
      name: error.name,
      code: error.code,
      causeCode: error.cause?.code,
      causeMessage: error.cause?.message
    });
    if (res.headersSent) {
      if (!res.destroyed) res.destroy(error);
      return;
    }
    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: selectedUpstreamModel || "",
      endpoint: "/responses",
      method: "POST",
      status: 502,
      ok: false,
      stream: responseRequest.stream === true,
      durationMs: Date.now() - startedAt,
      usage: null,
      errorCode: "upstream_request_failed",
      errorMessage: error.message
    });
    recordProviderFailure(provider.id);
    sendError(res, 502, `Upstream provider request failed: ${error.message}`, "upstream_request_failed");
  }
}

function estimateAnthropicInputTokens(body) {
  let text = "";

  const append = (value) => {
    if (value === null || value === undefined) return;
    text += String(value);
  };

  if (body.system) {
    if (typeof body.system === "string") {
      append(body.system);
    } else if (Array.isArray(body.system)) {
      for (const item of body.system) {
        if (item?.type === "text") append(item.text);
      }
    }
  }

  for (const msg of body.messages || []) {
    append(msg.role);
    if (typeof msg.content === "string") {
      append(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "text" || block?.type === "input_text") {
          append(block.text);
        }
      }
    }
  }

  let tokens = 0;
  for (const char of text) {
    tokens += char.charCodeAt(0) < 128 ? 0.25 : 0.6;
  }

  tokens += (body.messages?.length || 0) * 3;
  if (body.system) tokens += 3;

  return Math.max(1, Math.ceil(tokens));
}

async function handleAnthropicCountTokens(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendAnthropicError(res, 401, "authentication_error", "SAPI API key is required.");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendAnthropicError(res, 401, "authentication_error", "Invalid or disabled SAPI API key.");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const model = req.body?.model || "";
  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendAnthropicError(res, 403, "permission_error", `Model "${model}" is not allowed for this API key.`);
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendAnthropicError(res, 429, "rate_limit_error", `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`);
    return;
  }

  const inputTokens = estimateAnthropicInputTokens(req.body || {});
  res.json({ input_tokens: inputTokens });
}

async function handleAnthropicMessagesProxy(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendAnthropicError(res, 401, "invalid_request_error", "SAPI API key is required.");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendAnthropicError(res, 401, "authentication_error", "Invalid or disabled SAPI API key.");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const model = req.body?.model || "";
  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendAnthropicError(res, 403, "permission_error", `Model "${model}" is not allowed for this API key.`);
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendAnthropicError(res, 429, "rate_limit_error", `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`);
    return;
  }

  const openAIBody = anthropicToOpenAI(req.body || {});
  openAIBody.model = model || openAIBody.model;
  const wantStream = openAIBody.stream === true;

  const candidates = chooseAnthropicProviderCandidates(db, model);
  if (candidates.length === 0) {
    sendAnthropicError(res, 503, "api_error", "No enabled upstream provider is configured.");
    return;
  }

  let selectedProvider = null;
  let upstreamResponse = null;
  let startedAt = null;
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const { provider, upstreamModel } = candidates[i];
    startedAt = Date.now();

    try {
      if (upstreamModel && openAIBody.model) openAIBody.model = upstreamModel;
      const upstreamUrl = buildUpstreamUrl(provider.baseUrl, "/v1/chat/completions");
      const headers = filterForwardHeaders(req.headers);
      headers.authorization = `Bearer ${provider.apiKey}`;
      headers["content-type"] = "application/json";
      headers["accept-encoding"] = "identity";

      appendDebugLog("anthropic.request", {
        url: upstreamUrl,
        method: "POST",
        bodyLength: Buffer.byteLength(JSON.stringify(openAIBody), "utf8"),
        tools: openAIBody.tools?.length || 0,
        toolChoice: openAIBody.tool_choice,
        hasThinking: openAIBody.messages?.some((m) => m.reasoning_content) || false
      });
      appendDebugBodyLog("anthropic", openAIBody);
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(openAIBody)
      });

      if (!upstreamResponse.ok) {
        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: model || "",
          upstreamModel: openAIBody.model || "",
          endpoint: "/v1/messages",
          method: "POST",
          status: upstreamResponse.status,
          ok: false,
          stream: wantStream,
          durationMs: Date.now() - startedAt,
          usage: null
        });
        if (isUpstreamProviderError(upstreamResponse.status)) {
          recordProviderFailure(provider.id);
          lastError = new Error(`Upstream provider responded with HTTP ${upstreamResponse.status}`);
          continue;
        } else {
          const text = await upstreamResponse.text();
          let errMessage = "Upstream provider error.";
          try {
            const parsed = JSON.parse(text);
            errMessage = parsed.error?.message || errMessage;
          } catch {}
          sendAnthropicError(res, upstreamResponse.status, "api_error", errMessage);
          return;
        }
      }

      selectedProvider = provider;
      break;
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }
      recordProviderFailure(provider.id);
      lastError = error;
    }
  }

  if (!selectedProvider) {
    const msg = lastError
      ? `All upstream providers failed. Last error: ${lastError.message}`
      : "All upstream providers failed.";
    sendAnthropicError(res, 502, "api_error", msg);
    return;
  }

  const provider = selectedProvider;

  try {
    if (!wantStream) {
      const text = await upstreamResponse.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {
        sendAnthropicError(res, 502, "api_error", "Upstream response was not valid JSON.");
        return;
      }

      const anthropicResp = openAIToAnthropicNonStreaming(payload, model);
      const usage = findUsagePayload(payload);
      res.status(200);
      res.setHeader("anthropic-version", "2023-06-01");
      res.json(anthropicResp);
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: model || "",
        upstreamModel: openAIBody.model || "",
        endpoint: "/v1/messages",
        method: "POST",
        status: 200,
        ok: true,
        stream: false,
        durationMs: Date.now() - startedAt,
        usage
      });
      recordProviderSuccess(provider.id);
      return;
    }

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.setHeader("anthropic-version", "2023-06-01");
    res.flushHeaders?.();

    const writeEvent = (eventType, data) => {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const responseId = generateId("msg");
    const inputTokens = 0;
    writeEvent("message_start", {
      type: "message_start",
      message: {
        id: responseId,
        type: "message",
        role: "assistant",
        content: [],
        model: model || openAIBody.model || "",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    });

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      writeEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" }
      });
      writeEvent("content_block_stop", { type: "content_block_stop", index: 0 });
      writeEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 }
      });
      writeEvent("message_stop", { type: "message_stop" });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let outputText = "";
    let finishReason = "";
    let usagePayload = null;
    let nextContentIndex = 0;
    let thinkingBlockIndex = -1;
    let textBlockIndex = -1;
    const toolIndexMap = {};
    const toolArgBuffers = {};

    const processData = (data) => {
      const trimmed = String(data || "").trim();
      if (!trimmed || trimmed === "[DONE]") return;

      let payload;
      try { payload = JSON.parse(trimmed); } catch { return; }

      const extracted = extractChatCompletionText(payload);
      if (extracted.finishReason) {
        const choice = (Array.isArray(payload.choices) ? payload.choices : [])[0] || {};
        const delta = choice.delta || {};
        const hasContentDelta =
          (delta.content !== undefined && delta.content !== null && delta.content !== "") ||
          (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) ||
          (delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== "");
        if (!hasContentDelta) {
          finishReason = extracted.finishReason;
        }
      }
      if (extracted.usage) usagePayload = extracted.usage;

      const events = openAIToAnthropicDeltaStreaming(payload);
      if (events.length > 0) {
        appendDebugLog("anthropic.stream.events", { count: events.length, types: events.map((e) => e._toolStart ? "toolStart" : e.delta?.type || "unknown") });
      }
      for (const ev of events) {
        if (ev._toolStart) {
          const upIdx = ev._upstreamIndex;
          if (toolIndexMap[upIdx] === undefined) {
            const outIdx = nextContentIndex++;
            toolIndexMap[upIdx] = outIdx;
            toolArgBuffers[upIdx] = "";
            writeEvent("content_block_start", {
              type: "content_block_start",
              index: outIdx,
              content_block: ev.content_block
            });
          }
        } else if (ev.delta?.type === "input_json_delta") {
          const upIdx = ev._upstreamIndex ?? 0;
          if (toolIndexMap[upIdx] !== undefined) {
            if (!toolArgBuffers[upIdx]) toolArgBuffers[upIdx] = "";
            toolArgBuffers[upIdx] += ev.delta.partial_json || "";
            writeEvent("content_block_delta", {
              type: "content_block_delta",
              index: toolIndexMap[upIdx],
              delta: { type: "input_json_delta", partial_json: ev.delta.partial_json }
            });
          }
        } else if (ev.delta?.type === "thinking_delta") {
          if (thinkingBlockIndex < 0) {
            thinkingBlockIndex = nextContentIndex++;
            writeEvent("content_block_start", {
              type: "content_block_start",
              index: thinkingBlockIndex,
              content_block: { type: "thinking", thinking: "" }
            });
          }
          writeEvent("content_block_delta", {
            type: "content_block_delta",
            index: thinkingBlockIndex,
            delta: { type: "thinking_delta", thinking: ev.delta.thinking }
          });
        } else if (ev.delta?.type === "text_delta") {
          if (thinkingBlockIndex >= 0) {
            writeEvent("content_block_stop", { type: "content_block_stop", index: thinkingBlockIndex });
            thinkingBlockIndex = -1;
          }
          if (textBlockIndex < 0) {
            textBlockIndex = nextContentIndex++;
            writeEvent("content_block_start", {
              type: "content_block_start",
              index: textBlockIndex,
              content_block: { type: "text", text: "" }
            });
          }
          outputText += ev.delta.text;
          writeEvent("content_block_delta", {
            type: "content_block_delta",
            index: textBlockIndex,
            delta: { type: "text_delta", text: ev.delta.text }
          });
        }
      }
    };

    let chunkCount = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          appendDebugLog("anthropic.stream.done", { chunks: chunkCount, finishReason, outputTextLength: outputText.length });
          break;
        }
        if (!value || value.length === 0) continue;
        chunkCount += 1;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        let current = [];
        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };
        for (const line of lines) {
          if (line === "") { flush(); continue; }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) current.push(line.slice(5).replace(/^ /, ""));
        }
        flush();
      }

      buffer += decoder.decode();
      if (buffer) {
        const lines = buffer.split(/\r?\n/);
        let current = [];
        const flush = () => {
          if (current.length === 0) return;
          processData(current.join("\n"));
          current = [];
        };
        for (const line of lines) {
          if (line === "") { flush(); continue; }
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) current.push(line.slice(5).replace(/^ /, ""));
        }
        flush();
      }
    } finally {
      reader.releaseLock();
    }

    appendDebugLog("anthropic.stream.cleanup", {
      toolBlocks: Object.keys(toolIndexMap).length,
      textBlockOpen: textBlockIndex >= 0,
      thinkingBlockOpen: thinkingBlockIndex >= 0,
      finishReason,
      outputTextLength: outputText.length
    });

    for (const [upIdx, outIdx] of Object.entries(toolIndexMap)) {
      writeEvent("content_block_stop", { type: "content_block_stop", index: outIdx });
    }

    if (textBlockIndex >= 0) {
      writeEvent("content_block_stop", { type: "content_block_stop", index: textBlockIndex });
    } else {
      if (thinkingBlockIndex >= 0) {
        writeEvent("content_block_stop", { type: "content_block_stop", index: thinkingBlockIndex });
        thinkingBlockIndex = -1;
      }
      const textIdx = nextContentIndex++;
      writeEvent("content_block_start", {
        type: "content_block_start",
        index: textIdx,
        content_block: { type: "text", text: "" }
      });
      writeEvent("content_block_stop", { type: "content_block_stop", index: textIdx });
    }

    const stopReason = finishReason === "tool_calls" ? "tool_use"
      : finishReason === "length" ? "max_tokens"
      : "end_turn";

    if (outputText.length < 100 && stopReason === "end_turn" && !finishReason) {
      appendDebugLog("anthropic.stream.short", {
        outputTextLength: outputText.length,
        outputText: outputText.slice(0, 200),
        chunks: chunkCount,
        finishReason,
        stopReason
      });
    }

    const normalized = normalizeUsage(usagePayload);
    writeEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: normalized?.completionTokens || 0 }
    });
    writeEvent("message_stop", { type: "message_stop" });

    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: openAIBody.model || "",
      endpoint: "/v1/messages",
      method: "POST",
      status: 200,
      ok: true,
      stream: true,
      durationMs: Date.now() - startedAt,
      usage: usagePayload,
      finishReason
    });
    recordProviderSuccess(provider.id);
    res.end();
  } catch (error) {
    appendDebugLog("anthropic.error", {
      message: error.message,
      name: error.name,
      code: error.code,
      causeCode: error.cause?.code,
      causeMessage: error.cause?.message,
      streamState: {
        chunksReceived: chunkCount,
        outputTextLength: outputText.length,
        finishReason,
        textBlockOpen: textBlockIndex >= 0,
        thinkingBlockOpen: thinkingBlockIndex >= 0,
        toolBlocksOpen: Object.keys(toolIndexMap).length
      }
    });
    console.error("[anthropic] upstream fetch failed", {
      message: error.message,
      name: error.name,
      code: error.code
    });
    if (res.headersSent) {
      if (!res.destroyed) res.destroy(error);
      return;
    }
    recordRequestLog({
      userId: user.id,
      userName: user.name,
      username: user.username,
      apiKeyId: apiKeyRecord?.id || "",
      apiKeyName: apiKeyRecord?.name || "",
      apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
      providerId: provider.id,
      providerName: provider.name,
      model: model || "",
      upstreamModel: openAIBody.model || "",
      endpoint: "/v1/messages",
      method: "POST",
      status: 502,
      ok: false,
      stream: true,
      durationMs: Date.now() - startedAt,
      usage: null,
      errorCode: "upstream_request_failed",
      errorMessage: error.message,
      finishReason
    });
    recordProviderFailure(provider.id);
    sendAnthropicError(res, 502, "api_error", `Upstream provider request failed: ${error.message}`);
  }
}

function sendAnthropicError(res, status, errorType, message) {
  res.status(status).json({
    type: "error",
    error: {
      type: errorType,
      message
    }
  });
}

async function proxyToProvider(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendError(res, 401, "SAPI API key is required.", "missing_api_key");
    return;
  }

  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const model = req.body?.model || "";
  if (model && !isModelAllowed(apiKeyRecord, model)) {
    sendError(res, 403, `Model "${model}" is not allowed for this API key.`, "model_not_allowed");
    return;
  }

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendError(res, 429, `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`, "rate_limit_exceeded");
    return;
  }

  const candidates = chooseProviderCandidates(db, req.body);
  if (candidates.length === 0) {
    sendError(res, 503, "No enabled upstream provider is configured.", "no_provider");
    return;
  }

  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const { provider, upstreamModel } = candidates[i];
    const startedAt = Date.now();

    try {
      const upstreamUrl = buildUpstreamUrl(provider.baseUrl, req.originalUrl);
      const headers = filterForwardHeaders(req.headers);
      headers.authorization = `Bearer ${provider.apiKey}`;
      if (req.body !== undefined && !headers["content-type"]) {
        headers["content-type"] = "application/json";
      }
      headers["accept-encoding"] = "identity";

      appendDebugLog("proxy.request", {
        url: upstreamUrl,
        method: req.method,
        bodyLength: Buffer.byteLength(buildUpstreamBody(req, upstreamModel) || "", "utf8")
      });
      const upstreamBody = buildUpstreamBody(req, upstreamModel);
      if (upstreamBody) appendDebugBodyLog("proxy", JSON.parse(upstreamBody));
      const upstreamResponse = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: upstreamBody
      });

      if (!upstreamResponse.ok) {
        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: req.body?.model || "",
          upstreamModel: upstreamModel || "",
          endpoint: req.originalUrl || "",
          method: req.method,
          status: upstreamResponse.status,
          ok: false,
          stream: req.body?.stream === true,
          durationMs: Date.now() - startedAt,
          usage: null
        });

        if (isUpstreamProviderError(upstreamResponse.status)) {
          recordProviderFailure(provider.id);
          lastError = new Error(`Upstream provider responded with HTTP ${upstreamResponse.status}`);
          continue;
        } else {
          const text = await upstreamResponse.text();
          res.status(upstreamResponse.status);
          copyUpstreamHeaders(upstreamResponse.headers, res);
          res.send(text);
          return;
        }
      }

      if (shouldStreamResponse(req, upstreamResponse)) {
        res.status(upstreamResponse.status);
        copyUpstreamHeaders(upstreamResponse.headers, res, {
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no"
        });
        res.flushHeaders?.();

        let usage = null;
        try {
          usage = await writeUpstreamStreamToResponse(upstreamResponse, res);
          res.end();
        } catch (streamError) {
          if (!res.headersSent) {
            throw streamError;
          }
          res.destroy(streamError);
          throw streamError;
        }

        recordRequestLog({
          userId: user.id,
          userName: user.name,
          username: user.username,
          apiKeyId: apiKeyRecord?.id || "",
          apiKeyName: apiKeyRecord?.name || "",
          apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
          providerId: provider.id,
          providerName: provider.name,
          model: req.body?.model || "",
          upstreamModel: upstreamModel || "",
          endpoint: req.originalUrl || "",
          method: req.method,
          status: upstreamResponse.status,
          ok: upstreamResponse.ok,
          stream: true,
          durationMs: Date.now() - startedAt,
          usage
        });
        recordProviderSuccess(provider.id);

        return;
      }

      const text = await upstreamResponse.text();
      const usage = extractUsageFromResponseText(text);

      res.status(upstreamResponse.status);
      copyUpstreamHeaders(upstreamResponse.headers, res);
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: req.body?.model || "",
        upstreamModel: upstreamModel || "",
        endpoint: req.originalUrl || "",
        method: req.method,
        status: upstreamResponse.status,
        ok: upstreamResponse.ok,
        stream: req.body?.stream === true,
        durationMs: Date.now() - startedAt,
        usage
      });
      recordProviderSuccess(provider.id);

      res.send(text);
      return;
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }

      appendDebugLog("proxy.error", {
        message: error.message,
        name: error.name,
        code: error.code,
        causeCode: error.cause?.code,
        causeMessage: error.cause?.message
      });
      console.error("[proxy] upstream fetch failed", {
        message: error.message,
        name: error.name,
        code: error.code,
        causeCode: error.cause?.code,
        causeMessage: error.cause?.message
      });
      recordRequestLog({
        userId: user.id,
        userName: user.name,
        username: user.username,
        apiKeyId: apiKeyRecord?.id || "",
        apiKeyName: apiKeyRecord?.name || "",
        apiKeyPreview: maskKey(apiKeyRecord?.key || apiKey),
        providerId: provider.id,
        providerName: provider.name,
        model: req.body?.model || "",
        upstreamModel: upstreamModel || "",
        endpoint: req.originalUrl || "",
        method: req.method,
        status: 502,
        ok: false,
        stream: req.body?.stream === true,
        durationMs: Date.now() - startedAt,
        usage: null,
        errorCode: "upstream_request_failed",
        errorMessage: error.message
      });
      recordProviderFailure(provider.id);
      lastError = error;
    }
  }

  if (lastError) {
    sendError(
      res,
      502,
      `All upstream providers failed. Last error: ${lastError.message}`,
      "upstream_request_failed"
    );
  } else {
    sendError(res, 502, "All upstream providers failed.", "all_providers_failed");
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, name: "SAPI", time: now() });
});

app.post("/api/admin/login", async (req, res) => {
  if (!(await verifyTencentCaptcha(req, res))) return;

  const { username, password } = req.body || {};
  if (!safeEqual(username || "", ADMIN_USER) || !safeEqual(password || "", ADMIN_PASSWORD)) {
    sendError(res, 401, "Invalid admin username or password.", "invalid_login");
    return;
  }

  const db = readDb();
  const token = signToken({ role: "admin", sub: ADMIN_USER }, db.appSecret);
  res.json({ token, username: ADMIN_USER });
});

app.post("/api/auth/login", async (req, res) => {
  if (!(await verifyTencentCaptcha(req, res))) return;

  const identifier = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (safeEqual(identifier, normalizeUsername(ADMIN_USER)) && safeEqual(password, ADMIN_PASSWORD)) {
    const db = readDb();
    const token = signToken({ role: "admin", sub: ADMIN_USER }, db.appSecret);
    res.json({ role: "admin", token, username: ADMIN_USER });
    return;
  }

  const db = readDb();
  const normalizedIdentifier = normalizeUsername(identifier);
  const user = db.users.find((candidate) => {
    const matchUsername = normalizeUsername(candidate.username || candidate.name) === normalizedIdentifier;
    const matchEmail = candidate.email === identifier;
    return matchUsername || matchEmail;
  });

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    sendError(res, 401, "Invalid username, email or password.", "invalid_login");
    return;
  }

  if (!user.enabled) {
    sendError(res, 403, "User account is disabled.", "user_disabled");
    return;
  }

  const token = signToken({ role: "user", sub: user.id }, db.appSecret);
  res.json({ role: "user", token, user: sanitizeUser(user) });
});

function getSmtpConfig(db) {
  const envConfig = {
    host: process.env.SAPI_SMTP_HOST || "",
    port: Number(process.env.SAPI_SMTP_PORT) || 587,
    secure: process.env.SAPI_SMTP_SECURE === "true",
    user: process.env.SAPI_SMTP_USER || "",
    pass: process.env.SAPI_SMTP_PASS || "",
    from: process.env.SAPI_SMTP_FROM || ""
  };
  const dbConfig = db.smtpConfig || {};
  return {
    host: dbConfig.host || envConfig.host,
    port: Number(dbConfig.port) || envConfig.port,
    secure: dbConfig.secure !== undefined ? Boolean(dbConfig.secure) : envConfig.secure,
    user: dbConfig.user || envConfig.user,
    pass: dbConfig.pass || envConfig.pass,
    from: dbConfig.from || envConfig.from
  };
}

function createSmtpTransport(config) {
  if (!config.host || !config.user || !config.pass) return null;
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

app.get("/api/admin/smtp-config", requireAdmin, (req, res) => {
  const db = readDb();
  const config = getSmtpConfig(db);
  res.json({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    from: config.from,
    hasPass: Boolean(config.pass)
  });
});

app.put("/api/admin/smtp-config", requireAdmin, (req, res) => {
  const updated = mutateDb((db) => {
    db.smtpConfig = {
      host: String(req.body?.host || "").trim(),
      port: Number(req.body?.port) || 587,
      secure: Boolean(req.body?.secure),
      user: String(req.body?.user || "").trim(),
      pass: String(req.body?.pass || "").trim(),
      from: String(req.body?.from || "").trim()
    };
    return db.smtpConfig;
  });
  res.json({
    host: updated.host,
    port: updated.port,
    secure: updated.secure,
    user: updated.user,
    from: updated.from,
    hasPass: Boolean(updated.pass)
  });
});

app.post("/api/admin/smtp-config/test", requireAdmin, async (req, res) => {
  const db = readDb();
  const config = getSmtpConfig(db);
  const to = String(req.body?.to || "").trim();
  if (!to) {
    sendError(res, 400, "Recipient email is required.", "invalid_email");
    return;
  }
  const transport = createSmtpTransport(config);
  if (!transport) {
    sendError(res, 400, "SMTP is not configured.", "smtp_not_configured");
    return;
  }
  try {
    await transport.sendMail({
      from: config.from || config.user,
      to,
      subject: "SAPI SMTP Test",
      text: "This is a test email from SAPI. If you received this, your SMTP configuration is working."
    });
    res.json({ success: true });
  } catch (error) {
    sendError(res, 502, `Failed to send test email: ${error.message}`, "smtp_send_failed");
  }
});

app.get("/api/admin/invitation-codes", requireAdmin, (req, res) => {
  const db = readDb();
  res.json(db.invitationCodes || []);
});

app.post("/api/admin/invitation-codes", requireAdmin, (req, res) => {
  const code = String(req.body?.code || "").trim();
  const note = String(req.body?.note || "").trim();
  const expiresAt = req.body?.expiresAt ? String(req.body.expiresAt).trim() : "";
  const maxUses = Number(req.body?.maxUses) || 0;

  const finalCode = code || crypto.randomBytes(12).toString("base64url");

  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(finalCode)) {
    sendError(res, 400, "Invitation code must be 4-64 characters and contain only letters, numbers, underscore, or dash.", "invalid_code");
    return;
  }

  const created = mutateDb((db) => {
    const exists = (db.invitationCodes || []).some((c) => safeEqual(c.code, finalCode));
    if (exists) return null;

    const record = {
      id: randomId("inv"),
      code: finalCode,
      note: note || "",
      createdAt: now(),
      expiresAt: expiresAt || "",
      maxUses: maxUses > 0 ? maxUses : 0,
      usedCount: 0,
      usedBy: []
    };
    if (!db.invitationCodes) db.invitationCodes = [];
    db.invitationCodes.push(record);
    return record;
  });

  if (!created) {
    sendError(res, 409, "Invitation code already exists.", "code_exists");
    return;
  }

  res.status(201).json(created);
});

app.delete("/api/admin/invitation-codes/:id", requireAdmin, (req, res) => {
  const removed = mutateDb((db) => {
    if (!db.invitationCodes) db.invitationCodes = [];
    const before = db.invitationCodes.length;
    db.invitationCodes = db.invitationCodes.filter((c) => c.id !== req.params.id);
    return before !== db.invitationCodes.length;
  });

  if (!removed) {
    sendError(res, 404, "Invitation code not found.", "not_found");
    return;
  }

  res.status(204).end();
});

app.post("/api/admin/invitation-codes/send", requireAdmin, async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const codeId = String(req.body?.codeId || "").trim();
  const customCode = String(req.body?.code || "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, 400, "Valid email address is required.", "invalid_email");
    return;
  }

  const db = readDb();
  const config = getSmtpConfig(db);
  const transport = createSmtpTransport(config);
  if (!transport) {
    sendError(res, 400, "SMTP is not configured.", "smtp_not_configured");
    return;
  }

  let inviteCode = customCode;
  if (codeId) {
    const record = (db.invitationCodes || []).find((c) => c.id === codeId);
    if (!record) {
      sendError(res, 404, "Invitation code not found.", "not_found");
      return;
    }
    inviteCode = record.code;
  } else if (!inviteCode) {
    sendError(res, 400, "Invitation code or code ID is required.", "invalid_code");
    return;
  }

  try {
    await transport.sendMail({
      from: config.from || config.user,
      to: email,
      subject: "You have been invited to join SAPI",
      text: `You are invited to register on SAPI.\n\nInvitation code: ${inviteCode}\n\nRegister at: ${PUBLIC_BASE_URL}/#register\n\nIf you did not expect this invitation, you can safely ignore it.`
    });
    res.json({ success: true });
  } catch (error) {
    sendError(res, 502, `Failed to send invitation email: ${error.message}`, "smtp_send_failed");
  }
});

function validateInvitationCode(code) {
  const db = readDb();
  const record = (db.invitationCodes || []).find((c) => safeEqual(c.code, code));
  if (!record) return { valid: false, reason: "invalid_code" };
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    return { valid: false, reason: "expired_code" };
  }
  if (record.maxUses > 0 && record.usedCount >= record.maxUses) {
    return { valid: false, reason: "max_uses_reached" };
  }
  return { valid: true, record };
}

function consumeInvitationCode(code, userId) {
  mutateDb((db) => {
    const record = (db.invitationCodes || []).find((c) => safeEqual(c.code, code));
    if (!record) return;
    record.usedCount = (record.usedCount || 0) + 1;
    if (!record.usedBy) record.usedBy = [];
    record.usedBy.push({ userId, usedAt: now() });
  });
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cleanupExpiredVerificationCodes(db) {
  if (!db.verificationCodes) db.verificationCodes = [];
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.verificationCodes = db.verificationCodes.filter((c) => c.createdAt > cutoff);
}

app.post("/api/auth/send-verification-code", async (req, res) => {
  if (!(await verifyTencentCaptcha(req, res))) return;

  const email = String(req.body?.email || "").trim().toLowerCase();
  const purpose = String(req.body?.purpose || "register").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, 400, "Valid email address is required.", "invalid_email");
    return;
  }

  const db = readDb();
  const config = getSmtpConfig(db);
  const transport = createSmtpTransport(config);
  if (!transport) {
    sendError(res, 400, "SMTP is not configured.", "smtp_not_configured");
    return;
  }

  if (purpose === "register") {
    const emailExists = db.users.some((u) => u.email === email);
    if (emailExists) {
      sendError(res, 409, "Email is already registered.", "email_exists");
      return;
    }
  }

  cleanupExpiredVerificationCodes(db);

  const recentAttempts = (db.verificationCodes || []).filter(
    (c) => c.email === email && c.createdAt > new Date(Date.now() - 60 * 1000).toISOString()
  );
  if (recentAttempts.length >= 1) {
    sendError(res, 429, "Please wait before requesting another code.", "rate_limited");
    return;
  }

  const code = generateVerificationCode();
  mutateDb((db) => {
    if (!db.verificationCodes) db.verificationCodes = [];
    db.verificationCodes.push({
      email,
      code,
      purpose,
      createdAt: now(),
      used: false
    });
  });

  try {
    await transport.sendMail({
      from: config.from || config.user,
      to: email,
      subject: "SAPI 验证码",
      text: `您的验证码是：${code}\n\n验证码 10 分钟内有效。如未收到，请检查垃圾邮件文件夹。如非本人操作，请忽略此邮件。`
    });
    res.json({ success: true });
  } catch (error) {
    sendError(res, 502, `Failed to send verification email: ${error.message}`, "smtp_send_failed");
  }
});

function verifyEmailCode(email, code, purpose = "register") {
  const db = readDb();
  cleanupExpiredVerificationCodes(db);
  const record = (db.verificationCodes || []).find(
    (c) => c.email === email && c.code === code && c.purpose === purpose && !c.used
  );
  if (!record) return false;
  mutateDb((db) => {
    const r = (db.verificationCodes || []).find(
      (c) => c.email === email && c.code === code && c.purpose === purpose
    );
    if (r) r.used = true;
  });
  return true;
}

app.post("/api/auth/register", async (req, res) => {
  if (!(await verifyTencentCaptcha(req, res))) return;

  const username = normalizeUsername(req.body?.username);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const verificationCode = String(req.body?.verificationCode || "").trim();
  const invitationCode = String(req.body?.invitationCode || "").trim();
  const isEduEmail = email.endsWith(".edu.cn");

  if (!isEduEmail && !invitationCode) {
    sendError(res, 400, "Invitation code is required for non-edu emails.", "invitation_code_required");
    return;
  }

  if (invitationCode) {
    const validation = validateInvitationCode(invitationCode);
    if (!validation.valid) {
      const message =
        validation.reason === "expired_code"
          ? "Invitation code has expired."
          : validation.reason === "max_uses_reached"
            ? "Invitation code has reached its maximum usage limit."
            : "Invalid invitation code.";
      sendError(res, 400, message, validation.reason);
      return;
    }
  }

  if (!/^[a-z0-9._@-]{3,64}$/.test(username)) {
    sendError(
      res,
      400,
      "Username must be 3-64 characters and may contain letters, numbers, dot, underscore, @, or dash.",
      "invalid_username"
    );
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, 400, "Valid email address is required.", "invalid_email");
    return;
  }

  if (password.length < 8) {
    sendError(res, 400, "Password must be at least 8 characters.", "invalid_password");
    return;
  }

  if (safeEqual(username, normalizeUsername(ADMIN_USER))) {
    sendError(res, 409, "Username is reserved.", "username_reserved");
    return;
  }

  if (!/^\d{6}$/.test(verificationCode)) {
    sendError(res, 400, "Verification code must be 6 digits.", "invalid_verification_code");
    return;
  }

  if (!verifyEmailCode(email, verificationCode, "register")) {
    sendError(res, 400, "Invalid or expired verification code.", "invalid_verification_code");
    return;
  }

  try {
    const user = mutateDb((db) => {
      const usernameExists = db.users.some(
        (candidate) => normalizeUsername(candidate.username || candidate.name) === username
      );
      if (usernameExists) return null;

      const emailExists = db.users.some((candidate) => candidate.email === email);
      if (emailExists) return null;

      const createdAt = now();
      const record = {
        id: randomId("usr"),
        username,
        email,
        name: username,
        passwordHash: hashPassword(password),
        apiKey: "",
        apiKeys: [],
        enabled: true,
        createdAt,
        updatedAt: createdAt
      };
      db.users.push(record);
      return record;
    });

    if (!user) {
      sendError(res, 409, "Username or email is already registered.", "username_exists");
      return;
    }

    if (invitationCode) consumeInvitationCode(invitationCode, user.id);

    const db = readDb();
    const token = signToken({ role: "user", sub: user.id }, db.appSecret);
    res.status(201).json({ role: "user", token, user: sanitizeUser(user) });
  } catch (error) {
    sendError(res, 400, error.message, "register_failed");
  }
});

app.get("/api/user/me", requireUserAccount, (req, res) => {
  res.json({ user: sanitizeUser(req.user), config: serviceConfig() });
});

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

app.post("/api/user/api-key", requireUserAccount, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const allowedModels = Array.isArray(req.body?.allowedModels) ? req.body.allowedModels : [];
  const rpmLimit = Number(req.body?.rpmLimit) || 0;
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;
    createUserApiKeyRecord(user, name, allowedModels, rpmLimit);
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.status(201).json({ user: sanitizeUser(updated) });
});

app.post("/api/user/api-key/rotate", requireUserAccount, (req, res) => {
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;
    const apiKeys = getApiKeys(user);
    const target = apiKeys.find((item) => item.id === req.body?.id) || apiKeys.find((item) => item.enabled !== false);
    if (!target) {
      createUserApiKeyRecord(user, req.body?.name);
      return user;
    }
    const updatedAt = now();
    target.key = randomApiKey();
    target.updatedAt = updatedAt;
    user.apiKey = getPrimaryApiKey(user);
    user.updatedAt = updatedAt;
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json({ user: sanitizeUser(updated) });
});

app.post("/api/user/api-keys/:id/rotate", requireUserAccount, (req, res) => {
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;
    const target = getApiKeys(user).find((item) => item.id === req.params.id);
    if (!target) return false;
    const updatedAt = now();
    target.key = randomApiKey();
    target.updatedAt = updatedAt;
    user.apiKey = getPrimaryApiKey(user);
    user.updatedAt = updatedAt;
    return user;
  });

  if (updated === false) {
    sendError(res, 404, "API key not found.", "not_found");
    return;
  }
  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json({ user: sanitizeUser(updated) });
});

app.put("/api/user/api-keys/:id", requireUserAccount, (req, res) => {
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;
    const target = getApiKeys(user).find((item) => item.id === req.params.id);
    if (!target) return false;

    if (req.body?.name !== undefined) {
      target.name = String(req.body.name || "").trim() || target.name;
    }
    if (req.body?.enabled !== undefined) {
      target.enabled = Boolean(req.body.enabled);
    }
    if (req.body?.allowedModels !== undefined) {
      target.allowedModels = Array.isArray(req.body.allowedModels) ? req.body.allowedModels : [];
    }
    if (req.body?.rpmLimit !== undefined) {
      const rpmLimit = Number(req.body.rpmLimit);
      target.rpmLimit = Number.isFinite(rpmLimit) && rpmLimit > 0 ? Math.floor(rpmLimit) : 0;
    }
    const updatedAt = now();
    target.updatedAt = updatedAt;
    user.apiKey = getPrimaryApiKey(user);
    user.updatedAt = updatedAt;
    return user;
  });

  if (updated === false) {
    sendError(res, 404, "API key not found.", "not_found");
    return;
  }
  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json({ user: sanitizeUser(updated) });
});

app.delete("/api/user/api-keys/:id", requireUserAccount, (req, res) => {
  const removed = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;
    if (!Array.isArray(user.apiKeys)) user.apiKeys = [];
    const before = user.apiKeys.length;
    user.apiKeys = user.apiKeys.filter((item) => item.id !== req.params.id);
    const removed = before !== user.apiKeys.length;
    if (removed) {
      user.apiKey = getPrimaryApiKey(user);
      user.updatedAt = now();
    }
    return removed;
  });

  if (removed === null) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }
  if (!removed) {
    sendError(res, 404, "API key not found.", "not_found");
    return;
  }

  res.json({ ok: true });
});

app.put("/api/user/settings", requireUserAccount, (req, res) => {
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;

    if (req.body?.receiveAnnouncementEmail !== undefined) {
      user.receiveAnnouncementEmail = Boolean(req.body.receiveAnnouncementEmail);
    }
    user.updatedAt = now();
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json({ user: sanitizeUser(updated) });
});

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

app.get("/api/admin/api-keys", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({
    apiKeys: (db.adminApiKeys || []).map((item) => sanitizeApiKeyRecord(item, true))
  });
});

app.post("/api/admin/api-keys", requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const record = mutateDb((db) => createAdminApiKeyRecord(db, name));
  res.status(201).json({ apiKey: sanitizeApiKeyRecord(record, true) });
});

app.post("/api/admin/api-keys/:id/rotate", requireAdmin, (req, res) => {
  const updated = mutateDb((db) => {
    if (!Array.isArray(db.adminApiKeys)) db.adminApiKeys = [];
    const target = db.adminApiKeys.find((item) => item.id === req.params.id);
    if (!target) return false;
    target.key = randomApiKey();
    target.updatedAt = now();
    return target;
  });

  if (updated === false) {
    sendError(res, 404, "API key not found.", "not_found");
    return;
  }

  res.json({ apiKey: sanitizeApiKeyRecord(updated, true) });
});

app.put("/api/admin/api-keys/:id", requireAdmin, (req, res) => {
  const updated = mutateDb((db) => {
    if (!Array.isArray(db.adminApiKeys)) db.adminApiKeys = [];
    const target = db.adminApiKeys.find((item) => item.id === req.params.id);
    if (!target) return false;

    if (req.body?.name !== undefined) {
      target.name = String(req.body.name || "").trim() || target.name;
    }
    if (req.body?.enabled !== undefined) {
      target.enabled = Boolean(req.body.enabled);
    }
    target.updatedAt = now();
    return target;
  });

  if (updated === false) {
    sendError(res, 404, "API key not found.", "not_found");
    return;
  }

  res.json({ apiKey: sanitizeApiKeyRecord(updated, true) });
});

app.delete("/api/admin/api-keys/:id", requireAdmin, (req, res) => {
  const removed = mutateDb((db) => {
    if (!Array.isArray(db.adminApiKeys)) db.adminApiKeys = [];
    const before = db.adminApiKeys.length;
    db.adminApiKeys = db.adminApiKeys.filter((item) => item.id !== req.params.id);
    return before !== db.adminApiKeys.length;
  });

  if (!removed) {
    sendError(res, 404, "API key not found.", "not_found");
    return;
  }

  res.json({ ok: true });
});

function getUsageStats(db, { userId = null, days = 30 } = {}) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const inRange = (item) => {
    if (userId && item.userId !== userId) return false;
    return item.timestamp >= sinceIso;
  };
  const usersById = new Map((db.users || []).map((user) => [user.id, user]));
  if (!usersById.has("__admin__")) {
    usersById.set("__admin__", { id: "__admin__", name: "Administrator", username: "admin" });
  }
  const normalizeRecord = (item, legacy = false) => {
    const owner = usersById.get(item.userId) || {};
    const promptTokens = Number(item.promptTokens || 0);
    const completionTokens = Number(item.completionTokens || 0);
    const totalTokens = Number(item.totalTokens || promptTokens + completionTokens || 0);

    return {
      id: item.id,
      userId: item.userId,
      userName: item.userName || owner.name || "",
      username: item.username || owner.username || "",
      apiKeyId: item.apiKeyId || "",
      apiKeyName: item.apiKeyName || "",
      apiKeyPreview: item.apiKeyPreview || "",
      providerId: item.providerId || "",
      providerName: item.providerName || "",
      model: item.model || "unknown",
      upstreamModel: item.upstreamModel || "",
      endpoint: item.endpoint || "",
      method: item.method || "",
      status: Number(item.status || (legacy ? 200 : 0)),
      ok: legacy ? true : Boolean(item.ok),
      stream: Boolean(item.stream),
      durationMs: Number(item.durationMs || 0),
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: Number(item.cachedTokens || 0),
      cacheCreationTokens: Number(item.cacheCreationTokens || 0),
      cacheMissTokens: Number(item.cacheMissTokens || 0),
      reasoningTokens: Number(item.reasoningTokens || 0),
      errorCode: item.errorCode || "",
      errorMessage: item.errorMessage || "",
      timestamp: item.timestamp
    };
  };
  const requestRecords = (db.requestLogs || []).filter(inRange).map((item) => normalizeRecord(item));
  const legacyRecords = (db.tokenUsage || []).filter(inRange).map((item) => normalizeRecord(item, true));
  const records = [...legacyRecords, ...requestRecords].sort((a, b) =>
    String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
  );

  const totalPrompt = records.reduce((sum, item) => sum + (item.promptTokens || 0), 0);
  const totalCompletion = records.reduce((sum, item) => sum + (item.completionTokens || 0), 0);
  const totalTokens = records.reduce((sum, item) => sum + (item.totalTokens || 0), 0);
  const totalCachedTokens = records.reduce((sum, item) => sum + (item.cachedTokens || 0), 0);
  const totalCacheCreationTokens = records.reduce((sum, item) => sum + (item.cacheCreationTokens || 0), 0);
  const totalCacheMissTokens = records.reduce((sum, item) => sum + (item.cacheMissTokens || 0), 0);
  const totalReasoningTokens = records.reduce((sum, item) => sum + (item.reasoningTokens || 0), 0);
  const failedRequests = records.filter((item) => !item.ok).length;

  const byUser = {};
  const byModel = {};
  const byDay = {};
  const byApiKey = {};

  for (const item of records) {
    if (!byUser[item.userId]) {
      byUser[item.userId] = {
        userId: item.userId,
        userName: item.userName,
        username: item.username,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byUser[item.userId].promptTokens += item.promptTokens || 0;
    byUser[item.userId].completionTokens += item.completionTokens || 0;
    byUser[item.userId].totalTokens += item.totalTokens || 0;
    byUser[item.userId].cachedTokens += item.cachedTokens || 0;
    byUser[item.userId].cacheCreationTokens += item.cacheCreationTokens || 0;
    byUser[item.userId].cacheMissTokens += item.cacheMissTokens || 0;
    byUser[item.userId].reasoningTokens += item.reasoningTokens || 0;
    byUser[item.userId].requests += 1;
    if (!item.ok) byUser[item.userId].failedRequests += 1;

    const apiKeyKey = `${item.userId}:${item.apiKeyId || item.apiKeyPreview || "unknown"}`;
    if (!byApiKey[apiKeyKey]) {
      byApiKey[apiKeyKey] = {
        userId: item.userId,
        userName: item.userName,
        username: item.username,
        apiKeyId: item.apiKeyId,
        apiKeyName: item.apiKeyName || "未知 Key",
        apiKeyPreview: item.apiKeyPreview || "",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byApiKey[apiKeyKey].promptTokens += item.promptTokens || 0;
    byApiKey[apiKeyKey].completionTokens += item.completionTokens || 0;
    byApiKey[apiKeyKey].totalTokens += item.totalTokens || 0;
    byApiKey[apiKeyKey].cachedTokens += item.cachedTokens || 0;
    byApiKey[apiKeyKey].cacheCreationTokens += item.cacheCreationTokens || 0;
    byApiKey[apiKeyKey].cacheMissTokens += item.cacheMissTokens || 0;
    byApiKey[apiKeyKey].reasoningTokens += item.reasoningTokens || 0;
    byApiKey[apiKeyKey].requests += 1;
    if (!item.ok) byApiKey[apiKeyKey].failedRequests += 1;

    const modelKey = item.model || "unknown";
    if (!byModel[modelKey]) {
      byModel[modelKey] = {
        model: modelKey,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byModel[modelKey].promptTokens += item.promptTokens || 0;
    byModel[modelKey].completionTokens += item.completionTokens || 0;
    byModel[modelKey].totalTokens += item.totalTokens || 0;
    byModel[modelKey].cachedTokens += item.cachedTokens || 0;
    byModel[modelKey].cacheCreationTokens += item.cacheCreationTokens || 0;
    byModel[modelKey].cacheMissTokens += item.cacheMissTokens || 0;
    byModel[modelKey].reasoningTokens += item.reasoningTokens || 0;
    byModel[modelKey].requests += 1;
    if (!item.ok) byModel[modelKey].failedRequests += 1;

    const day = item.timestamp.slice(0, 10);
    if (!byDay[day]) {
      byDay[day] = {
        day,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byDay[day].promptTokens += item.promptTokens || 0;
    byDay[day].completionTokens += item.completionTokens || 0;
    byDay[day].totalTokens += item.totalTokens || 0;
    byDay[day].cachedTokens += item.cachedTokens || 0;
    byDay[day].cacheCreationTokens += item.cacheCreationTokens || 0;
    byDay[day].cacheMissTokens += item.cacheMissTokens || 0;
    byDay[day].reasoningTokens += item.reasoningTokens || 0;
    byDay[day].requests += 1;
    if (!item.ok) byDay[day].failedRequests += 1;
  }

  const recentRequests = records.slice(-100).reverse();

  const hourSince = new Date();
  hourSince.setHours(hourSince.getHours() - 24);
  const hourSinceIso = hourSince.toISOString();
  const byHour = {};
  for (const item of records) {
    if (item.timestamp < hourSinceIso) continue;
    const hour = item.timestamp.slice(0, 13) + ":00";
    if (!byHour[hour]) {
      byHour[hour] = {
        hour,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requests: 0
      };
    }
    byHour[hour].promptTokens += item.promptTokens || 0;
    byHour[hour].completionTokens += item.completionTokens || 0;
    byHour[hour].totalTokens += item.totalTokens || 0;
    byHour[hour].requests += 1;
  }

  return {
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    totalTokens,
    totalCachedTokens,
    totalCacheCreationTokens,
    totalCacheMissTokens,
    totalReasoningTokens,
    requests: records.length,
    failedRequests,
    byUser: Object.values(byUser).sort((a, b) => b.totalTokens - a.totalTokens),
    byApiKey: Object.values(byApiKey).sort((a, b) => b.totalTokens - a.totalTokens),
    byModel: Object.values(byModel).sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    byHour: Object.values(byHour).sort((a, b) => a.hour.localeCompare(b.hour)),
    recent: recentRequests,
    recentRequests
  };
}

app.get("/api/announcements", (req, res) => {
  const db = readDb();
  const announcements = (db.announcements || [])
    .filter((item) => item.enabled !== false)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  res.json({ announcements });
});

app.get("/api/admin/announcements", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ announcements: db.announcements || [] });
});

async function sendAnnouncementEmail(db, announcement) {
  const config = getSmtpConfig(db);
  const transport = createSmtpTransport(config);
  if (!transport) return;

  const recipients = (db.users || []).filter(
    (u) => u.email && u.enabled !== false && u.receiveAnnouncementEmail !== false
  );
  if (!recipients.length) return;

  const baseUrl = PUBLIC_BASE_URL;
  const html = `
<div style="font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 600px; margin: 0 auto; color: #17202a;">
  <div style="background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); padding: 28px; text-align: center; border-radius: 8px 8px 0 0;">
    <h2 style="color: #fff; margin: 0; font-weight: 780;">HanGuan's SuperAPI 公告</h2>
  </div>
  <div style="background: #fff; padding: 28px; border: 1px solid #dce3ea; border-top: 0; border-radius: 0 0 8px 8px;">
    <h3 style="margin-top: 0; color: #0f766e; font-weight: 760;">${announcement.title}</h3>
    <div style="line-height: 1.8; white-space: pre-wrap; color: #334155;">${announcement.content.replace(/\n/g, '<br>')}</div>
    <hr style="border: 0; border-top: 1px solid #dce3ea; margin: 24px 0;">
    <p style="color: #64748b; font-size: 13px; line-height: 1.7; margin: 0;">
      此邮件由系统自动发送。如果您觉得邮件比较打扰，可以前往
      <a href="${baseUrl}/#portal" style="color: #0f766e; text-decoration: none; font-weight: 700;">用户控制台</a>
      关闭"接收公告邮件通知"。
    </p>
  </div>
</div>
`;

  for (const user of recipients) {
    try {
      await transport.sendMail({
        from: config.from || config.user,
        to: user.email,
        subject: `【公告】${announcement.title}`,
        text: `${announcement.title}\n\n${announcement.content}\n\n---\n此邮件由系统自动发送。如未收到，请检查垃圾邮件文件夹。如果您觉得邮件比较打扰，可以前往 ${baseUrl}/#portal 关闭"接收公告邮件通知"。`,
        html
      });
    } catch {
      // Ignore individual email failures
    }
  }
}

app.post("/api/admin/announcements", requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const content = String(req.body?.content || "").trim();
  const type = ["info", "warning", "success", "error"].includes(req.body?.type) ? req.body.type : "info";
  const sendEmail = Boolean(req.body?.sendEmail);

  if (!title) {
    sendError(res, 400, "Title is required.", "invalid_title");
    return;
  }
  if (!content) {
    sendError(res, 400, "Content is required.", "invalid_content");
    return;
  }

  const record = mutateDb((db) => {
    if (!Array.isArray(db.announcements)) db.announcements = [];
    const createdAt = now();
    const item = {
      id: randomId("ann"),
      title,
      content,
      type,
      enabled: true,
      sendEmail,
      createdAt,
      updatedAt: createdAt
    };
    db.announcements.push(item);
    return item;
  });

  if (sendEmail) {
    const db = readDb();
    sendAnnouncementEmail(db, record).catch(() => {});
  }

  res.status(201).json(record);
});

app.put("/api/admin/announcements/:id", requireAdmin, (req, res) => {
  const updated = mutateDb((db) => {
    if (!Array.isArray(db.announcements)) db.announcements = [];
    const item = db.announcements.find((a) => a.id === req.params.id);
    if (!item) return null;

    if (req.body?.title !== undefined) {
      item.title = String(req.body.title || "").trim() || item.title;
    }
    if (req.body?.content !== undefined) {
      item.content = String(req.body.content || "").trim() || item.content;
    }
    if (req.body?.type !== undefined) {
      item.type = ["info", "warning", "success", "error"].includes(req.body.type) ? req.body.type : item.type;
    }
    if (req.body?.enabled !== undefined) {
      item.enabled = Boolean(req.body.enabled);
    }
    if (req.body?.sendEmail !== undefined) {
      item.sendEmail = Boolean(req.body.sendEmail);
    }
    item.updatedAt = now();
    return item;
  });

  if (!updated) {
    sendError(res, 404, "Announcement not found.", "not_found");
    return;
  }

  res.json(updated);
});

app.delete("/api/admin/announcements/:id", requireAdmin, (req, res) => {
  const removed = mutateDb((db) => {
    if (!Array.isArray(db.announcements)) db.announcements = [];
    const before = db.announcements.length;
    db.announcements = db.announcements.filter((a) => a.id !== req.params.id);
    return before !== db.announcements.length;
  });

  if (!removed) {
    sendError(res, 404, "Announcement not found.", "not_found");
    return;
  }

  res.status(204).end();
});

app.get("/api/admin/state", requireAdmin, (req, res) => {
  const db = readDb();
  const smtp = getSmtpConfig(db);
  res.json({
    providers: db.providers.map(redactProvider),
    users: db.users.map((user) => sanitizeUser(user)),
    adminApiKeys: (db.adminApiKeys || []).map((item) => sanitizeApiKeyRecord(item, true)),
    publicConfig: serviceConfig(),
    usage: getUsageStats(db),
    invitationCodes: db.invitationCodes || [],
    announcements: db.announcements || [],
    suggestions: db.suggestions || [],
    siteBanner: db.siteBanner || { content: "", updatedAt: "" },
    maintenanceMode: Boolean(db.maintenanceMode),
    maintenanceEndTime: db.maintenanceEndTime || "",
    siteEmail: db.siteEmail || "",
    defaultRpmLimit: typeof db.defaultRpmLimit === "number" ? db.defaultRpmLimit : 30,
    smtpConfig: {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user,
      from: smtp.from,
      hasPass: Boolean(smtp.pass)
    }
  });
});

app.put("/api/admin/rpm-limit", requireAdmin, (req, res) => {
  const limit = Number(req.body?.defaultRpmLimit);
  if (!Number.isFinite(limit) || limit < 1) {
    sendError(res, 400, "RPM limit must be a positive number.", "invalid_rpm_limit");
    return;
  }
  mutateDb((db) => {
    db.defaultRpmLimit = Math.floor(limit);
  });
  res.json({ defaultRpmLimit: Math.floor(limit) });
});

app.get("/api/banner", (req, res) => {
  const db = readDb();
  res.json(db.siteBanner || { content: "", updatedAt: "" });
});

app.put("/api/admin/banner", requireAdmin, (req, res) => {
  const content = String(req.body?.content || "").trim();
  const updatedAt = now();
  mutateDb((db) => {
    db.siteBanner = { content, updatedAt };
  });
  res.json({ content, updatedAt });
});

app.get("/api/maintenance", (req, res) => {
  const db = readDb();
  res.json({
    maintenanceMode: Boolean(db.maintenanceMode),
    maintenanceEndTime: db.maintenanceEndTime || ""
  });
});

app.put("/api/admin/maintenance", requireAdmin, (req, res) => {
  const enabled = Boolean(req.body?.maintenanceMode);
  const endTime = String(req.body?.maintenanceEndTime || "").trim();
  mutateDb((db) => {
    db.maintenanceMode = enabled;
    if (endTime) db.maintenanceEndTime = endTime;
    if (!enabled) db.maintenanceEndTime = "";
  });
  res.json({
    maintenanceMode: enabled,
    maintenanceEndTime: endTime || ""
  });
});

app.get("/api/admin/usage", requireAdmin, (req, res) => {
  const db = readDb();
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json(getUsageStats(db, { days }));
});

app.get("/api/user/usage", requireUserAccount, (req, res) => {
  const db = readDb();
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json(getUsageStats(db, { userId: req.user.id, days }));
});

app.post("/api/admin/providers/models", requireAdmin, async (req, res) => {
  const baseUrl = String(req.body?.baseUrl || "").trim();
  const apiKey = String(req.body?.apiKey || "").trim();

  if (!baseUrl || !apiKey) {
    sendError(res, 400, "Provider base URL and API key are required.", "invalid_provider");
    return;
  }

  try {
    new URL(baseUrl);
  } catch {
    sendError(res, 400, "Provider base URL must be a valid URL.", "invalid_provider");
    return;
  }

  try {
    const upstreamResponse = await fetch(buildUpstreamUrl(baseUrl, "/v1/models"), {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json"
      }
    });
    const text = await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      sendError(
        res,
        502,
        `Failed to fetch upstream models. Upstream responded with HTTP ${upstreamResponse.status}.`,
        "models_fetch_failed"
      );
      return;
    }

    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      sendError(res, 502, "Upstream models response was not valid JSON.", "models_fetch_failed");
      return;
    }

    const models = extractModelIds(payload);
    res.json({ models, count: models.length });
  } catch (error) {
    sendError(
      res,
      502,
      `Failed to fetch upstream models: ${error.message}`,
      "models_fetch_failed"
    );
  }
});

app.post("/api/admin/providers", requireAdmin, (req, res) => {
  try {
    const provider = mutateDb((db) => {
      const createdAt = now();
      const normalized = normalizeProviderInput(req.body);
      const record = {
        id: randomId("prv"),
        ...normalized,
        createdAt,
        updatedAt: createdAt
      };
      db.providers.push(record);
      return record;
    });
    res.status(201).json(redactProvider(provider));
  } catch (error) {
    sendError(res, 400, error.message, "invalid_provider");
  }
});

app.put("/api/admin/providers/:id", requireAdmin, (req, res) => {
  try {
    const updated = mutateDb((db) => {
      const provider = db.providers.find((item) => item.id === req.params.id);
      if (!provider) return null;

      const normalized = normalizeProviderInput(req.body, provider);
      Object.assign(provider, normalized, { updatedAt: now() });
      return provider;
    });

    if (!updated) {
      sendError(res, 404, "Provider not found.", "not_found");
      return;
    }

    res.json(redactProvider(updated));
  } catch (error) {
    sendError(res, 400, error.message, "invalid_provider");
  }
});

app.delete("/api/admin/providers/:id", requireAdmin, (req, res) => {
  const removed = mutateDb((db) => {
    const before = db.providers.length;
    db.providers = db.providers.filter((provider) => provider.id !== req.params.id);
    return before !== db.providers.length;
  });

  if (!removed) {
    sendError(res, 404, "Provider not found.", "not_found");
    return;
  }

  res.status(204).end();
});

app.put("/api/admin/users/:id", requireAdmin, (req, res) => {
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user) return null;

    if (req.body?.name !== undefined) {
      user.name = String(req.body.name || "").trim() || user.name;
    }
    if (req.body?.enabled !== undefined) {
      user.enabled = Boolean(req.body.enabled);
    }
    user.updatedAt = now();
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json(sanitizeUser(updated));
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const removed = mutateDb((db) => {
    const before = db.users.length;
    db.users = db.users.filter((user) => user.id !== req.params.id);
    return before !== db.users.length;
  });

  if (!removed) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.status(204).end();
});

app.put("/api/admin/users/:userId/api-keys/:keyId", requireAdmin, (req, res) => {
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.params.userId);
    if (!user) return null;
    const target = getApiKeys(user).find((item) => item.id === req.params.keyId);
    if (!target) return false;

    if (req.body?.rpmLimit !== undefined) {
      const rpmLimit = Number(req.body.rpmLimit);
      target.rpmLimit = Number.isFinite(rpmLimit) && rpmLimit > 0 ? Math.floor(rpmLimit) : 0;
    }
    target.updatedAt = now();
    return user;
  });

  if (updated === false) {
    sendError(res, 404, "API key not found.", "not_found");
    return;
  }
  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json(sanitizeUser(updated));
});

app.put("/api/admin/users/:id/password", requireAdmin, (req, res) => {
  const newPassword = String(req.body?.password || "");
  if (newPassword.length < 8) {
    sendError(res, 400, "Password must be at least 8 characters.", "invalid_password");
    return;
  }

  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user) return null;
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = now();
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json(sanitizeUser(updated));
});

app.post("/api/auth/forgot-password/send-code", async (req, res) => {
  if (!(await verifyTencentCaptcha(req, res))) return;

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, 400, "Valid email address is required.", "invalid_email");
    return;
  }

  const db = readDb();
  const user = db.users.find((u) => u.email === email);
  if (!user) {
    sendError(res, 404, "No account found with this email.", "user_not_found");
    return;
  }

  const config = getSmtpConfig(db);
  const transport = createSmtpTransport(config);
  if (!transport) {
    sendError(res, 400, "SMTP is not configured.", "smtp_not_configured");
    return;
  }

  cleanupExpiredVerificationCodes(db);

  const recentAttempts = (db.verificationCodes || []).filter(
    (c) => c.email === email && c.purpose === "reset_password" && c.createdAt > new Date(Date.now() - 60 * 1000).toISOString()
  );
  if (recentAttempts.length >= 1) {
    sendError(res, 429, "Please wait before requesting another code.", "rate_limited");
    return;
  }

  const code = generateVerificationCode();
  mutateDb((db) => {
    if (!db.verificationCodes) db.verificationCodes = [];
    db.verificationCodes.push({
      email,
      code,
      purpose: "reset_password",
      createdAt: now(),
      used: false
    });
  });

  try {
    await transport.sendMail({
      from: config.from || config.user,
      to: email,
      subject: "SAPI 密码重置验证码",
      text: `您的密码重置验证码是：${code}\n\n验证码 10 分钟内有效。如未收到，请检查垃圾邮件文件夹。如非本人操作，请忽略此邮件。`
    });
    res.json({ success: true });
  } catch (error) {
    sendError(res, 502, `Failed to send verification email: ${error.message}`, "smtp_send_failed");
  }
});

app.post("/api/auth/forgot-password/reset", async (req, res) => {
  if (!(await verifyTencentCaptcha(req, res))) return;

  const email = String(req.body?.email || "").trim().toLowerCase();
  const verificationCode = String(req.body?.verificationCode || "").trim();
  const newPassword = String(req.body?.password || "");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, 400, "Valid email address is required.", "invalid_email");
    return;
  }

  if (!/^\d{6}$/.test(verificationCode)) {
    sendError(res, 400, "Verification code must be 6 digits.", "invalid_verification_code");
    return;
  }

  if (newPassword.length < 8) {
    sendError(res, 400, "Password must be at least 8 characters.", "invalid_password");
    return;
  }

  if (!verifyEmailCode(email, verificationCode, "reset_password")) {
    sendError(res, 400, "Invalid or expired verification code.", "invalid_verification_code");
    return;
  }

  const updated = mutateDb((db) => {
    const user = db.users.find((u) => u.email === email);
    if (!user) return null;
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = now();
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json({ success: true });
});

app.get("/api/public/config", (req, res) => {
  res.json(publicConfig());
});

app.get("/api/public/key", (req, res) => {
  const apiKey = getUserApiKey(req);
  const { user } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 404, "API key was not found or is disabled.", "key_not_found");
    return;
  }

  res.json({
    valid: true,
    config: serviceConfig()
  });
});

function handleModelsList(req, res) {
  const apiKey = getUserApiKey(req);
  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  if (checkMaintenanceMode(db, res)) return;

  const rpmCheck = checkRpmLimit(apiKeyRecord, db);
  if (!rpmCheck.allowed) {
    sendError(res, 429, `Rate limit exceeded: ${rpmCheck.current}/${rpmCheck.limit} RPM.`, "rate_limit_exceeded");
    return;
  }

  const modelMap = new Map();
  for (const provider of db.providers.filter((p) => p.enabled)) {
    for (const m of (provider.models || []).map(normalizeModel)) {
      if (m.id) modelMap.set(m.id, m);
    }
    for (const [customId, upstreamId] of Object.entries(provider.modelMappings || {})) {
      if (customId && upstreamId) {
        modelMap.set(customId, { id: customId, name: customId, cliSupport: [] });
      }
    }
  }
  let models = Array.from(modelMap.values());

  const allowed = apiKeyRecord?.allowedModels;
  if (Array.isArray(allowed) && allowed.length > 0) {
    const allowedSet = new Set(allowed.map((item) => String(item || "").trim()));
    models = models.filter((model) => allowedSet.has(model.id));
  }

  res.json({
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: "sapi",
      name: model.name || model.id,
      cli_support: model.cliSupport || []
    }))
  });
}

app.get("/v1/models", handleModelsList);
app.get("/models", handleModelsList);

app.post("/api/suggestions", async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const content = String(req.body?.content || "").trim();
  const contact = String(req.body?.contact || "").trim();

  if (!title) {
    sendError(res, 400, "Title is required.", "invalid_title");
    return;
  }
  if (!content) {
    sendError(res, 400, "Content is required.", "invalid_content");
    return;
  }

  const token = getBearerToken(req);
  const db = readDb();
  const payload = verifyToken(token, db.appSecret);
  let userId = "";
  let userName = "";
  if (payload && payload.sub && payload.role === "user") {
    const user = db.users.find((u) => u.id === payload.sub);
    if (user) {
      userId = user.id;
      userName = user.name || user.username || "";
    }
  }

  const suggestion = {
    id: randomId("sg"),
    title,
    content,
    contact,
    userId,
    userName,
    createdAt: now(),
    updatedAt: now()
  };

  mutateDb((db) => {
    if (!Array.isArray(db.suggestions)) db.suggestions = [];
    db.suggestions.unshift(suggestion);
  });

  const siteEmail = db.siteEmail || "";
  if (siteEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(siteEmail)) {
    const smtp = getSmtpConfig(db);
    const transport = createSmtpTransport(smtp);
    if (transport) {
      try {
        await transport.sendMail({
          from: smtp.from || smtp.user,
          to: siteEmail,
          subject: `[SAPI 建议反馈] ${title}`,
          text: `用户提交了新的建议反馈。\n\n标题：${title}\n内容：${content}\n${contact ? `联系方式：${contact}\n` : ""}${userName ? `提交用户：${userName}\n` : ""}提交时间：${suggestion.createdAt}\n\n请在管理后台查看详情。如未收到此邮件，请检查垃圾邮件文件夹。`
        });
      } catch {
        // Ignore email sending failures.
      }
    }
  }

  res.json({ success: true, suggestion });
});

app.get("/api/admin/suggestions", requireAdmin, (req, res) => {
  const db = readDb();
  const suggestions = (db.suggestions || []).sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  res.json({ suggestions });
});

app.delete("/api/admin/suggestions/:id", requireAdmin, (req, res) => {
  const removed = mutateDb((db) => {
    if (!Array.isArray(db.suggestions)) db.suggestions = [];
    const before = db.suggestions.length;
    db.suggestions = db.suggestions.filter((s) => s.id !== req.params.id);
    return before !== db.suggestions.length;
  });

  if (!removed) {
    sendError(res, 404, "Suggestion not found.", "not_found");
    return;
  }

  res.status(204).end();
});

app.get("/api/admin/site-email", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ siteEmail: db.siteEmail || "" });
});

app.put("/api/admin/site-email", requireAdmin, (req, res) => {
  const email = String(req.body?.siteEmail || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, 400, "Valid email address is required.", "invalid_email");
    return;
  }
  mutateDb((db) => {
    db.siteEmail = email;
  });
  res.json({ siteEmail: email });
});

app.get("/api/health/providers", (req, res) => {
  const db = readDb();
  const providers = db.providers
    .filter((p) => p.enabled)
    .map((p) => {
      const counter = getProviderFailureCounter(p.id);
      const threshold = p.failoverThreshold ?? 3;
      return {
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        models: (p.models || []).map(normalizeModel),
        modelMappings: p.modelMappings || {},
        healthStatus: p.healthStatus || "unknown",
        latency: p.latency || 0,
        ping: p.ping || 0,
        availability7d: p.availability7d ?? 100,
        lastHealthCheck: p.lastHealthCheck || "",
        healthHistory: (p.healthHistory || []).slice(-60),
        consecutiveFailures: counter.consecutiveFailures,
        failoverThreshold: threshold,
        isAvailableForFailover: threshold <= 0 || counter.consecutiveFailures < threshold
      };
    });
  res.json({ providers });
});

app.post("/responses", handleResponsesProxy);
app.post("/v1/messages/count_tokens", handleAnthropicCountTokens);
app.post("/v1/messages", handleAnthropicMessagesProxy);
app.all("/v1/*", proxyToProvider);

app.get("/api/swagger.json", (req, res) => {
  res.json(swaggerSpec);
});

app.get("/swagger", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SAPI API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>html,body{margin:0;padding:0;height:100%}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    (function() {
      var token = localStorage.getItem("sapiUserToken") || localStorage.getItem("sapiAdminToken") || "";
      SwaggerUIBundle({
        url: '/api/swagger.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.presets.standalone],
        requestInterceptor: function(req) {
          if (token) {
            req.headers = req.headers || {};
            req.headers.Authorization = "Bearer " + token;
          }
          return req;
        }
      });
    })();
  </script>
</body>
</html>`);
});

app.use((req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/") || req.path === "/responses") {
    sendError(res, 404, "Route not found.", "not_found");
    return;
  }

  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

function inferProviderVendor(name = "", baseUrl = "") {
  const text = `${name} ${baseUrl}`.toLowerCase();
  if (text.includes("openai")) return "OpenAI";
  if (text.includes("anthropic")) return "Anthropic";
  if (text.includes("deepseek")) return "DeepSeek";
  if (text.includes("gemini") || text.includes("google")) return "Google";
  if (text.includes("azure")) return "Azure";
  if (text.includes("cohere")) return "Cohere";
  if (text.includes("mistral")) return "Mistral";
  if (text.includes("x.ai") || text.includes("grok")) return "xAI";
  return "";
}

function computeAvailability(history) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent = history.filter((h) => h.timestamp >= since);
  if (recent.length === 0) return 100;
  const okCount = recent.filter((h) => h.status === "ok").length;
  return Math.round((okCount / recent.length) * 10000) / 100;
}

async function checkProviderHealth(provider) {
  const url = buildUpstreamUrl(provider.baseUrl, "/v1/models");
  const startedAt = Date.now();
  let status = "fail";
  let latency = 0;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        accept: "application/json"
      }
    });
    latency = Date.now() - startedAt;
    if (response.ok) {
      status = latency > 5000 ? "slow" : "ok";
      recordProviderSuccess(provider.id);
    } else {
      status = "fail";
    }
  } catch {
    latency = Date.now() - startedAt;
    status = "fail";
  }

  const healthStatus = status === "ok" ? "healthy" : status === "slow" ? "degraded" : "down";
  const historyEntry = {
    timestamp: now(),
    status,
    latency
  };

  mutateDb((db) => {
    const p = db.providers.find((item) => item.id === provider.id);
    if (!p) return;
    p.healthStatus = healthStatus;
    p.latency = latency;
    p.ping = latency;
    p.lastHealthCheck = historyEntry.timestamp;
    if (!Array.isArray(p.healthHistory)) p.healthHistory = [];
    p.healthHistory.push(historyEntry);
    if (p.healthHistory.length > 120) {
      p.healthHistory = p.healthHistory.slice(-120);
    }
    p.availability7d = computeAvailability(p.healthHistory);
    p.updatedAt = now();
  });
}

function runHealthChecks() {
  const db = readDb();
  const enabledProviders = db.providers.filter((p) => p.enabled);
  for (const provider of enabledProviders) {
    checkProviderHealth(provider).catch(() => {});
  }
}

app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/") || req.path === "/responses") {
    console.error(`[API Error] ${req.method} ${req.path}:`, err);
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: "Internal server error.",
          type: "internal_error",
          code: "internal_error"
        }
      });
    }
    return;
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`SAPI is running at http://localhost:${PORT}`);
  console.log(`Admin console: http://localhost:${PORT}/#admin`);
  runHealthChecks();
  setInterval(runHealthChecks, 60000);
});
