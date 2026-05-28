const express = require("express");
const path = require("node:path");
const { PORT, C_RESET, C_GREEN, C_RED, C_CYAN, C_DIM, C_BOLD } = require("./config");
const { sendError } = require("./utils");
const { runHealthChecks } = require("./providers");
const { mountAuthRoutes } = require("./routes/auth");
const { mountUserRoutes } = require("./routes/user");
const { mountAdminRoutes } = require("./routes/admin");
const { mountProxyRoutes } = require("./routes/proxy");
const { mountPublicRoutes } = require("./routes/public");

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
    const ts = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
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

mountAuthRoutes(app);
mountUserRoutes(app);
mountAdminRoutes(app);
mountProxyRoutes(app);
mountPublicRoutes(app);

app.use((req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/") || req.path === "/responses") {
    sendError(res, 404, "Route not found.", "not_found");
    return;
  }

  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

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
