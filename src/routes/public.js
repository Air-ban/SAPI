const nodemailer = require("nodemailer");
const { readDb, mutateDb, randomId, normalizeModel, now } = require("../store");
const { sendError, getBearerToken, getUserApiKey } = require("../utils");
const { verifyToken } = require("../auth");
const { findUserByKey } = require("../middleware/auth");
const { getProviderFailureCounter } = require("../providers");
const { publicConfig, serviceConfig } = require("../config-utils");
const { swaggerSpec, PUBLIC_BASE_URL } = require("../config");

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

function handleModelsList(req, res) {
  const apiKey = getUserApiKey(req);
  const { db, user, apiKeyRecord } = findUserByKey(apiKey);
  if (!user) {
    sendError(res, 401, "Invalid or disabled SAPI API key.", "invalid_api_key");
    return;
  }

  if (db.maintenanceMode) {
    const endTime = db.maintenanceEndTime || "";
    const msg = endTime
      ? `站点维护中，预计 ${new Date(endTime).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })} 恢复。`
      : "站点维护中，请稍后重试。";
    sendError(res, 503, msg, "maintenance_mode");
    return;
  }

  // Check RPM

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

function mountPublicRoutes(app) {
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, name: "SAPI", time: now() });
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

  app.get("/v1/models", handleModelsList);
  app.get("/models", handleModelsList);

  app.get("/api/announcements", (req, res) => {
    const db = readDb();
    const announcements = (db.announcements || [])
      .filter((item) => item.enabled !== false)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.json({ announcements });
  });

  app.get("/api/banner", (req, res) => {
    const db = readDb();
    res.json(db.siteBanner || { content: "", updatedAt: "" });
  });

  app.get("/api/maintenance", (req, res) => {
    const db = readDb();
    res.json({
      maintenanceMode: Boolean(db.maintenanceMode),
      maintenanceEndTime: db.maintenanceEndTime || ""
    });
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
        }
      }
    }

    res.json({ success: true, suggestion });
  });

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
}

module.exports = { mountPublicRoutes };
