const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { HOP_BY_HOP_HEADERS } = require("./config");

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

function sendError(res, status, message, code = "sapi_error") {
  res.status(status).json({
    error: {
      message,
      type: code,
      code
    }
  });
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getUserApiKey(req) {
  return getBearerToken(req) || req.headers["x-api-key"] || "";
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

function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
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

function appendDebugLog(label, data) {
  try {
    fs.appendFileSync(
      path.join(__dirname, "..", "data", "fetch-debug.log"),
      `${new Date().toISOString()} ${label} ${JSON.stringify(data)}\n`
    );
  } catch {
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
  }
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

function isModelAllowed(apiKeyRecord, model) {
  const allowed = apiKeyRecord?.allowedModels;
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  const modelId = String(model || "").trim();
  if (!modelId) return true;
  return allowed.some((item) => String(item || "").trim() === modelId);
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

function shouldStreamResponse(req, upstreamResponse) {
  const contentType = upstreamResponse.headers.get("content-type") || "";
  return (
    req.body?.stream === true ||
    contentType.includes("text/event-stream") ||
    contentType.includes("application/x-ndjson")
  );
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

async function relayUpstreamResponse(upstreamResponse, res) {
  const text = await upstreamResponse.text();
  res.status(upstreamResponse.status);
  copyUpstreamHeaders(upstreamResponse.headers, res);
  res.send(text);
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
    }
  }

  return usage;
}

module.exports = {
  sha256,
  hmacSha256,
  tencentCloudApi3Request,
  sendError,
  getBearerToken,
  getUserApiKey,
  isHopByHopHeader,
  filterForwardHeaders,
  copyUpstreamHeaders,
  extractTextFromContent,
  generateTimestamp,
  generateId,
  parseSseDataLines,
  appendDebugLog,
  appendDebugBodyLog,
  normalizeResponseFormat,
  sanitizeToolSchema,
  convertTools,
  extractModelIds,
  isModelAllowed,
  buildUpstreamUrl,
  buildUpstreamBody,
  shouldStreamResponse,
  createUsageCollector,
  writeUpstreamStreamToResponse,
  relayUpstreamResponse,
  finiteTokenCount,
  normalizeUsage,
  findUsagePayload,
  extractUsageFromResponseText
};
