const crypto = require("node:crypto");
const nodemailer = require("nodemailer");
const { safeEqual, hashPassword } = require("../auth");
const { mutateDb, randomApiKey, randomId, readDb, now, normalizeProviderInput, redactProvider, normalizeModel } = require("../store");
const { sendError, buildUpstreamUrl, extractModelIds } = require("../utils");
const { sanitizeUser, sanitizeApiKeyRecord, getApiKeys, createAdminApiKeyRecord, maskKey } = require("../user-utils");
const { requireAdmin } = require("../middleware/auth");
const { getUsageStats } = require("../usage");
const { serviceConfig } = require("../config-utils");
const { PUBLIC_BASE_URL } = require("../config");

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
    }
  }
}

function mountAdminRoutes(app) {
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

  app.put("/api/admin/banner", requireAdmin, (req, res) => {
    const content = String(req.body?.content || "").trim();
    const updatedAt = now();
    mutateDb((db) => {
      db.siteBanner = { content, updatedAt };
    });
    res.json({ content, updatedAt });
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

  app.get("/api/admin/announcements", requireAdmin, (req, res) => {
    const db = readDb();
    res.json({ announcements: db.announcements || [] });
  });

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
}

module.exports = { mountAdminRoutes };
