const { readDb, mutateDb, normalizeModel, now } = require("./store");
const { buildUpstreamUrl } = require("./utils");

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

module.exports = {
  providerFailureCounters,
  getProviderFailureCounter,
  recordProviderSuccess,
  recordProviderFailure,
  isUpstreamProviderError,
  isProviderAvailableForFailover,
  getModelProviderMapping,
  chooseProvider,
  sortProvidersByPriority,
  chooseProviderCandidates,
  chooseAnthropicProviderCandidates,
  inferProviderVendor,
  computeAvailability,
  checkProviderHealth,
  runHealthChecks
};
