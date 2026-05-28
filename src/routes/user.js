const { readDb, mutateDb, randomApiKey, now } = require("../store");
const { sendError } = require("../utils");
const { sanitizeUser, getApiKeys, getPrimaryApiKey, createUserApiKeyRecord } = require("../user-utils");
const { requireUserAccount } = require("../middleware/auth");
const { getUsageStats } = require("../usage");
const { serviceConfig } = require("../config-utils");

function mountUserRoutes(app) {
  app.get("/api/user/me", requireUserAccount, (req, res) => {
    res.json({ user: sanitizeUser(req.user), config: serviceConfig() });
  });

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

  app.get("/api/user/usage", requireUserAccount, (req, res) => {
    const db = readDb();
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    res.json(getUsageStats(db, { userId: req.user.id, days }));
  });
}

module.exports = { mountUserRoutes };
