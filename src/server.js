require("dotenv").config();

const express = require("express");
const path = require("node:path");
const {
  mutateDb,
  normalizeProviderInput,
  now,
  randomApiKey,
  randomId,
  readDb,
  redactProvider
} = require("./store");
const { hashPassword, safeEqual, signToken, verifyPassword, verifyToken } = require("./auth");

const PORT = Number(process.env.SAPI_PORT || process.env.PORT || 3000);
const ADMIN_USER = process.env.SAPI_ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.SAPI_ADMIN_PASSWORD || "sapi-admin";
const PUBLIC_BASE_URL = process.env.SAPI_PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const app = express();

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

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
  return getBearerToken(req) || req.headers["x-api-key"] || req.query.api_key || "";
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

function sanitizeUser(user, includeKey = true) {
  return {
    id: user.id,
    name: user.name,
    username: user.username || "",
    apiKey: includeKey ? user.apiKey || "" : maskKey(user.apiKey),
    hasApiKey: Boolean(user.apiKey),
    enabled: Boolean(user.enabled),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
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
  const user = db.users.find(
    (candidate) => candidate.enabled && candidate.apiKey && safeEqual(candidate.apiKey, apiKey)
  );

  return { db, user };
}

function publicConfig() {
  return {
    name: "SAPI",
    baseUrl: PUBLIC_BASE_URL
  };
}

function serviceConfig() {
  const db = readDb();
  const providers = db.providers.filter((provider) => provider.enabled);
  const models = [...new Set(providers.flatMap((provider) => provider.models || []))];

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
      }
    ],
    models
  };
}

function chooseProvider(db, body = {}) {
  const model = body && typeof body === "object" ? body.model : "";
  const providers = db.providers.filter((provider) => provider.enabled);
  if (providers.length === 0) return null;

  if (model) {
    const exactMatch = providers.find((provider) =>
      (provider.models || []).some((candidate) => candidate === model)
    );
    if (exactMatch) return exactMatch;
  }

  return providers[0];
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

async function proxyToProvider(req, res) {
  const apiKey = getUserApiKey(req);
  if (!apiKey) {
    sendError(res, 401, "SAPI API key is required.", "missing_api_key");
    return;
  }

  const { db, user } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  const provider = chooseProvider(db, req.body);
  if (!provider) {
    sendError(res, 503, "No enabled upstream provider is configured.", "no_provider");
    return;
  }

  const upstreamUrl = buildUpstreamUrl(provider.baseUrl, req.originalUrl);
  const headers = {
    authorization: `Bearer ${provider.apiKey}`,
    "content-type": req.headers["content-type"] || "application/json"
  };

  if (req.headers.accept) headers.accept = req.headers.accept;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body)
    });

    res.status(upstreamResponse.status);
    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);

    const text = await upstreamResponse.text();
    res.send(text);
  } catch (error) {
    sendError(
      res,
      502,
      `Upstream provider request failed: ${error.message}`,
      "upstream_request_failed"
    );
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, name: "SAPI", time: now() });
});

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!safeEqual(username || "", ADMIN_USER) || !safeEqual(password || "", ADMIN_PASSWORD)) {
    sendError(res, 401, "Invalid admin username or password.", "invalid_login");
    return;
  }

  const db = readDb();
  const token = signToken({ role: "admin", sub: ADMIN_USER }, db.appSecret);
  res.json({ token, username: ADMIN_USER });
});

app.post("/api/auth/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");

  if (safeEqual(username, normalizeUsername(ADMIN_USER)) && safeEqual(password, ADMIN_PASSWORD)) {
    const db = readDb();
    const token = signToken({ role: "admin", sub: ADMIN_USER }, db.appSecret);
    res.json({ role: "admin", token, username: ADMIN_USER });
    return;
  }

  const db = readDb();
  const user = db.users.find(
    (candidate) => normalizeUsername(candidate.username || candidate.name) === username
  );

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    sendError(res, 401, "Invalid username or password.", "invalid_login");
    return;
  }

  if (!user.enabled) {
    sendError(res, 403, "User account is disabled.", "user_disabled");
    return;
  }

  const token = signToken({ role: "user", sub: user.id }, db.appSecret);
  res.json({ role: "user", token, user: sanitizeUser(user) });
});

app.post("/api/auth/register", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.name || username).trim();

  if (!/^[a-z0-9._@-]{3,64}$/.test(username)) {
    sendError(
      res,
      400,
      "Username must be 3-64 characters and may contain letters, numbers, dot, underscore, @, or dash.",
      "invalid_username"
    );
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

  try {
    const user = mutateDb((db) => {
      const exists = db.users.some(
        (candidate) => normalizeUsername(candidate.username || candidate.name) === username
      );
      if (exists) return null;

      const createdAt = now();
      const record = {
        id: randomId("usr"),
        username,
        name: displayName || username,
        passwordHash: hashPassword(password),
        apiKey: "",
        enabled: true,
        createdAt,
        updatedAt: createdAt
      };
      db.users.push(record);
      return record;
    });

    if (!user) {
      sendError(res, 409, "Username is already registered.", "username_exists");
      return;
    }

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

app.post("/api/user/api-key", requireUserAccount, (req, res) => {
  let created = false;
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;
    if (!user.apiKey) {
      user.apiKey = randomApiKey();
      user.updatedAt = now();
      created = true;
    }
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.status(created ? 201 : 200).json({ user: sanitizeUser(updated) });
});

app.post("/api/user/api-key/rotate", requireUserAccount, (req, res) => {
  const updated = mutateDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;
    user.apiKey = randomApiKey();
    user.updatedAt = now();
    return user;
  });

  if (!updated) {
    sendError(res, 404, "User not found.", "not_found");
    return;
  }

  res.json({ user: sanitizeUser(updated) });
});

app.get("/api/admin/state", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({
    providers: db.providers.map(redactProvider),
    users: db.users.map((user) => sanitizeUser(user)),
    publicConfig: serviceConfig()
  });
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

app.get("/api/public/config", (req, res) => {
  res.json(publicConfig());
});

app.get("/api/public/key/:apiKey", (req, res) => {
  const { user } = findUserByKey(req.params.apiKey);
  if (!user) {
    sendError(res, 404, "API key was not found or is disabled.", "key_not_found");
    return;
  }

  res.json({
    user: sanitizeUser(user, false),
    config: serviceConfig()
  });
});

app.get("/v1/models", (req, res) => {
  const apiKey = getUserApiKey(req);
  const { db, user } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  const models = [
    ...new Set(
      db.providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models || [])
    )
  ];

  res.json({
    object: "list",
    data: models.map((model) => ({
      id: model,
      object: "model",
      created: 0,
      owned_by: "sapi"
    }))
  });
});

app.all("/v1/*", proxyToProvider);

app.use((req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
    sendError(res, 404, "Route not found.", "not_found");
    return;
  }

  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`SAPI is running at http://localhost:${PORT}`);
  console.log(`Admin console: http://localhost:${PORT}/#admin`);
});
