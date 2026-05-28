const { readDb, normalizeModel } = require("./store");
const { PUBLIC_BASE_URL } = require("./config");

function publicConfig() {
  const { TENCENT_CAPTCHA_APP_ID, TENCENT_CAPTCHA_APP_SECRET_KEY } = require("./config");
  return {
    name: "SAPI",
    baseUrl: PUBLIC_BASE_URL,
    captcha: {
      enabled: Boolean(TENCENT_CAPTCHA_APP_ID && TENCENT_CAPTCHA_APP_SECRET_KEY),
      appId: TENCENT_CAPTCHA_APP_ID
    }
  };
}

function serviceConfig() {
  const db = readDb();
  const providers = db.providers.filter((provider) => provider.enabled);
  const modelMap = new Map();

  for (const provider of providers) {
    for (const m of (provider.models || []).map(normalizeModel)) {
      if (m.id) modelMap.set(m.id, m);
    }
    for (const [customId, upstreamId] of Object.entries(provider.modelMappings || {})) {
      if (customId && upstreamId) {
        modelMap.set(customId, { id: customId, name: customId, description: "", cliSupport: [] });
      }
    }
  }

  const models = Array.from(modelMap.values());

  return {
    name: "SAPI",
    baseUrl: PUBLIC_BASE_URL,
    endpoints: [
      {
        method: "GET",
        path: "/v1/models",
        description: "列出当前可用模型"
      },
      {
        method: "POST",
        path: "/v1/chat/completions",
        description: "OpenAI 兼容聊天补全"
      },
      {
        method: "POST",
        path: "/v1/completions",
        description: "OpenAI 兼容文本补全"
      },
      {
        method: "POST",
        path: "/v1/embeddings",
        description: "OpenAI 兼容向量接口"
      },
      {
        method: "POST",
        path: "/responses",
        description: "OpenAI 兼容 Responses API"
      },
      {
        method: "POST",
        path: "/v1/messages",
        description: "Anthropic 兼容 Messages API"
      }
    ],
    models
  };
}

module.exports = {
  publicConfig,
  serviceConfig
};
