export function inferVendor(name = "", baseUrl = "") {
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

export function statusColor(status) {
  if (status === "healthy") return "#34d399";
  if (status === "degraded") return "#fbbf24";
  return "#f87171";
}

export function statusLabel(status) {
  if (status === "healthy") return "正常";
  if (status === "degraded") return "降级";
  return "不可用";
}

export function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

export function formatMoneyFromCents(cents, currency = "CNY") {
  const amount = Number(cents || 0) / 100;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: amount >= 100 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function formatMoneyFromMicrounits(value, currency = "CNY") {
  const amount = Number(value || 0) / 1000000;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: amount >= 100 ? 2 : 4,
    maximumFractionDigits: 4
  }).format(amount);
}

export function formatRpmLimit(value) {
  return Number(value || 0) > 0 ? `${Number(value).toLocaleString()} RPM` : "不限 RPM";
}

export function subscriptionTierLabel(tier, tiers = []) {
  const item = tiers.find((entry) => entry.id === tier);
  if (item) return item.name || item.id;
  if (tier === "MAX") return "MAX";
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Lite";
}

export function formatDuration(value) {
  const ms = Number(value || 0);
  if (!ms) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatUserName(item) {
  const name = item?.userName || item?.name || "";
  const username = item?.username || "";
  if (name && username && name !== username) return `${name} (${username})`;
  return name || username || item?.userId || "-";
}

export function cacheHitText(request) {
  const cachedTokens = Number(request?.cachedTokens || 0);
  return formatNumber(cachedTokens);
}

export function requestStatusColor(request) {
  const status = Number(request?.status || 0);
  if (request?.ok || (status >= 200 && status < 300)) return "success";
  if (status >= 400 && status < 500) return "warning";
  return "error";
}

export function getInitialRoute() {
  const route = window.location.hash.replace("#", "");
  const name = route.split("?")[0];
  return ["home", "admin", "login", "register", "portal", "github-auth"].includes(name) ? name : "home";
}

export function getUserApiKeys(user) {
  if (Array.isArray(user?.apiKeys) && user.apiKeys.length) return user.apiKeys;
  if (!user?.apiKey) return [];
  return [
    {
      id: "primary",
      name: "默认 Key",
      key: user.apiKey,
      preview: user.apiKey,
      enabled: true,
      effectiveRpmLimit: user.subscriptionRpmLimit ?? user.defaultRpmLimit ?? 0,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastUsedAt: ""
    }
  ];
}

export function normalizeModelFrontend(item) {
  if (item && typeof item === "object") {
    return {
      id: item.id || "",
      name: item.name || item.id || "",
      description: item.description || "",
      cliSupport: Array.isArray(item.cliSupport) ? item.cliSupport : []
    };
  }
  return { id: String(item || ""), name: String(item || ""), description: "", cliSupport: [] };
}

export function splitModelChannel(id = "") {
  const value = String(id || "").trim();
  const index = value.indexOf("/");
  if (index <= 0 || index === value.length - 1) return { channel: "", model: value };
  return {
    channel: value.slice(0, index),
    model: value.slice(index + 1)
  };
}

export function modelDisplayParts(item) {
  const normalized = normalizeModelFrontend(item);
  const { channel, model } = splitModelChannel(normalized.id);
  const name = normalized.name || normalized.id;
  const displayName = channel ? normalized.id : name;
  return {
    ...normalized,
    channel,
    model: model || normalized.id,
    displayName,
    secondary: channel && name && name !== normalized.id ? name : normalized.id && displayName !== normalized.id ? normalized.id : ""
  };
}

export function groupModelsByChannel(models = []) {
  const groups = new Map();
  for (const item of models) {
    const parts = modelDisplayParts(item);
    const key = parts.channel || "默认渠道";
    if (!groups.has(key)) {
      groups.set(key, { id: key, label: key, models: [] });
    }
    groups.get(key).models.push(parts);
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export const inlineCodeSx = {
  display: "inline",
  px: 0.5,
  py: 0.15,
  mx: 0.25,
  borderRadius: 0.75,
  bgcolor: "app.paperAlt",
  color: "text.primary",
  fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
  fontSize: "0.92em",
  overflowWrap: "anywhere"
};
