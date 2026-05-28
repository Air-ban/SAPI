const { safeEqual, signToken, verifyPassword, hashPassword } = require("../auth");
const { mutateDb, randomId, readDb, now } = require("../store");
const { sendError, getBearerToken } = require("../utils");
const { sanitizeUser, normalizeUsername, createUserApiKeyRecord, maskKey } = require("../user-utils");
const { verifyTencentCaptcha, findUserByKey } = require("../middleware/auth");
const nodemailer = require("nodemailer");
const crypto = require("node:crypto");
const {
  PUBLIC_BASE_URL,
  ADMIN_USER,
  ADMIN_PASSWORD
} = require("../config");

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

function mountAuthRoutes(app) {
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
}

module.exports = { mountAuthRoutes };
