import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWindows = process.platform === "win32";
const defaultBinary = join(repoRoot, "bin", isWindows ? "sapi-smoke.exe" : "sapi-smoke");
const binaryPath = resolve(process.env.SAPI_SMOKE_BINARY || defaultBinary);

if (!existsSync(binaryPath)) {
  throw new Error(`SAPI smoke binary not found: ${binaryPath}`);
}

const tempDir = mkdtempSync(join(tmpdir(), "sapi-smoke-"));
const dataFile = join(tempDir, "sapi.json");
const apiKey = "sk-sapi-smoke-key";
const upstreamKey = "sk-upstream-smoke";

const upstream = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models" && req.method === "GET") {
    res.end(JSON.stringify({ object: "list", data: [{ id: "test-model", object: "model" }] }));
    return;
  }

  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${upstreamKey}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: "missing upstream auth" } }));
      return;
    }
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}");
    if (parsed.model !== "test-model") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: `unexpected model ${parsed.model}` } }));
      return;
    }
    res.end(JSON.stringify({
      id: "chatcmpl_smoke",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "smoke-ok" },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "not found" } }));
});

let sapi = null;

try {
  const upstreamPort = await listen(upstream);
  const sapiPort = await reservePort();
  writeFileSync(dataFile, JSON.stringify(makeDatabase(`http://127.0.0.1:${upstreamPort}/v1`), null, 2));

  sapi = spawn(binaryPath, [], {
    cwd: tempDir,
    env: {
      ...process.env,
      SAPI_PORT: String(sapiPort),
      PORT: String(sapiPort),
      SAPI_DATA_FILE: dataFile,
      SAPI_PUBLIC_BASE_URL: `http://127.0.0.1:${sapiPort}`,
      SAPI_PUBLIC_BASE_URLS: `http://127.0.0.1:${sapiPort}`,
      SAPI_POSTGRES_URL: " ",
      DATABASE_URL: " ",
      SAPI_REDIS_URL: " ",
      REDIS_URL: " ",
      SAPI_IPPURE_ENABLED: "false",
      SAPI_ADMIN_USER: "smoke-admin",
      SAPI_ADMIN_PASSWORD: "smoke-password"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = collectOutput(sapi);
  await waitForHealth(`http://127.0.0.1:${sapiPort}/api/health`, output);

  const models = await requestJSON(`http://127.0.0.1:${sapiPort}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  assert(models.data?.some((item) => item.id === "mock/test-model"), "model list did not include mock/test-model");

  const chat = await requestJSON(`http://127.0.0.1:${sapiPort}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mock/test-model",
      messages: [{ role: "user", content: "hello" }]
    })
  });
  assert(chat.choices?.[0]?.message?.content === "smoke-ok", "chat completion did not return smoke-ok");

  console.log("SAPI smoke passed: health, models, and chat proxy chain are OK.");
} finally {
  if (sapi && !sapi.killed) {
    sapi.kill();
    await waitForExit(sapi);
  }
  await closeServer(upstream);
  rmSync(tempDir, { recursive: true, force: true });
}

function makeDatabase(baseUrl) {
  const now = new Date().toISOString();
  return {
    version: 1,
    appSecret: "smoke-secret",
    providers: [{
      id: "prv_smoke",
      name: "Mock",
      baseUrl,
      apiKey: upstreamKey,
      upstreamFormat: "openai",
      models: [{ id: "test-model", name: "test-model" }],
      modelMappings: {},
      enabled: true,
      failoverThreshold: 3,
      healthStatus: "healthy",
      availability7d: 100,
      healthHistory: [],
      createdAt: now,
      updatedAt: now
    }],
    users: [{
      id: "usr_smoke",
      username: "smoke",
      email: "smoke@example.com",
      name: "Smoke User",
      passwordHash: "",
      apiKey,
      apiKeys: [{
        id: "key_smoke",
        name: "Smoke Key",
        key: apiKey,
        enabled: true,
        allowedModels: [],
        rpmLimit: 50,
        createdAt: now,
        updatedAt: now
      }],
      enabled: true,
      receiveAnnouncementEmail: true,
      source: "email",
      subscriptionTier: "pro",
      createdAt: now,
      updatedAt: now
    }],
    tokenUsage: [],
    requestLogs: [],
    adminApiKeys: [],
    invitationCodes: [],
    verificationCodes: [],
    adminPasskeys: [],
    announcements: [],
    documents: [],
    suggestions: [],
    smtpConfig: {},
    siteEmails: [],
    defaultRpmLimit: 30,
    siteBanner: {},
    registrationDisabled: false,
    maintenanceMode: false,
    maintenanceEndTime: "",
    showOnlyAvailableModels: false,
    createdAt: now,
    updatedAt: now
  };
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

function reservePort() {
  const server = createServer();
  return listen(server).then((port) => closeServer(server).then(() => port));
}

function closeServer(server) {
  return new Promise((resolveClose) => {
    if (!server.listening) {
      resolveClose();
      return;
    }
    server.close(() => resolveClose());
  });
}

function collectOutput(child) {
  const lines = [];
  child.stdout.on("data", (chunk) => lines.push(chunk.toString()));
  child.stderr.on("data", (chunk) => lines.push(chunk.toString()));
  return () => lines.join("");
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit();
      return;
    }
    const timer = setTimeout(() => resolveExit(), 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

async function waitForHealth(url, output) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const health = await requestJSON(url);
      if (health?.ok === true) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`SAPI health check timed out.\n${output()}`);
}

async function requestJSON(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 300)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
