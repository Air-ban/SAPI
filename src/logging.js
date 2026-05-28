const { C_RESET, C_GREEN, C_RED, C_YELLOW, C_CYAN, C_DIM, C_BOLD } = require("./config");
const { mutateDb, randomId, now } = require("./store");
const { maskKey, getApiKeys } = require("./user-utils");
const { normalizeUsage } = require("./utils");

function trimStoredRecords(db, key, maxRecords = 50000) {
  if (db[key].length > maxRecords) {
    db[key] = db[key].slice(db[key].length - maxRecords);
  }
}

function logRequestToTerminal({ method, endpoint, status, ok, stream, durationMs, userName, model, providerName, errorCode, errorMessage, promptTokens, completionTokens, finishReason }) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
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

module.exports = {
  logRequestToTerminal,
  recordRequestLog,
  trimStoredRecords
};
