const { mutateDb, now } = require("./store");

function getUsageStats(db, { userId = null, days = 30 } = {}) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const inRange = (item) => {
    if (userId && item.userId !== userId) return false;
    return item.timestamp >= sinceIso;
  };
  const usersById = new Map((db.users || []).map((user) => [user.id, user]));
  if (!usersById.has("__admin__")) {
    usersById.set("__admin__", { id: "__admin__", name: "Administrator", username: "admin" });
  }
  const normalizeRecord = (item, legacy = false) => {
    const owner = usersById.get(item.userId) || {};
    const promptTokens = Number(item.promptTokens || 0);
    const completionTokens = Number(item.completionTokens || 0);
    const totalTokens = Number(item.totalTokens || promptTokens + completionTokens || 0);

    return {
      id: item.id,
      userId: item.userId,
      userName: item.userName || owner.name || "",
      username: item.username || owner.username || "",
      apiKeyId: item.apiKeyId || "",
      apiKeyName: item.apiKeyName || "",
      apiKeyPreview: item.apiKeyPreview || "",
      providerId: item.providerId || "",
      providerName: item.providerName || "",
      model: item.model || "unknown",
      upstreamModel: item.upstreamModel || "",
      endpoint: item.endpoint || "",
      method: item.method || "",
      status: Number(item.status || (legacy ? 200 : 0)),
      ok: legacy ? true : Boolean(item.ok),
      stream: Boolean(item.stream),
      durationMs: Number(item.durationMs || 0),
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: Number(item.cachedTokens || 0),
      cacheCreationTokens: Number(item.cacheCreationTokens || 0),
      cacheMissTokens: Number(item.cacheMissTokens || 0),
      reasoningTokens: Number(item.reasoningTokens || 0),
      errorCode: item.errorCode || "",
      errorMessage: item.errorMessage || "",
      timestamp: item.timestamp
    };
  };
  const requestRecords = (db.requestLogs || []).filter(inRange).map((item) => normalizeRecord(item));
  const legacyRecords = (db.tokenUsage || []).filter(inRange).map((item) => normalizeRecord(item, true));
  const records = [...legacyRecords, ...requestRecords].sort((a, b) =>
    String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
  );

  const totalPrompt = records.reduce((sum, item) => sum + (item.promptTokens || 0), 0);
  const totalCompletion = records.reduce((sum, item) => sum + (item.completionTokens || 0), 0);
  const totalTokens = records.reduce((sum, item) => sum + (item.totalTokens || 0), 0);
  const totalCachedTokens = records.reduce((sum, item) => sum + (item.cachedTokens || 0), 0);
  const totalCacheCreationTokens = records.reduce((sum, item) => sum + (item.cacheCreationTokens || 0), 0);
  const totalCacheMissTokens = records.reduce((sum, item) => sum + (item.cacheMissTokens || 0), 0);
  const totalReasoningTokens = records.reduce((sum, item) => sum + (item.reasoningTokens || 0), 0);
  const failedRequests = records.filter((item) => !item.ok).length;

  const byUser = {};
  const byModel = {};
  const byDay = {};
  const byApiKey = {};

  for (const item of records) {
    if (!byUser[item.userId]) {
      byUser[item.userId] = {
        userId: item.userId,
        userName: item.userName,
        username: item.username,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byUser[item.userId].promptTokens += item.promptTokens || 0;
    byUser[item.userId].completionTokens += item.completionTokens || 0;
    byUser[item.userId].totalTokens += item.totalTokens || 0;
    byUser[item.userId].cachedTokens += item.cachedTokens || 0;
    byUser[item.userId].cacheCreationTokens += item.cacheCreationTokens || 0;
    byUser[item.userId].cacheMissTokens += item.cacheMissTokens || 0;
    byUser[item.userId].reasoningTokens += item.reasoningTokens || 0;
    byUser[item.userId].requests += 1;
    if (!item.ok) byUser[item.userId].failedRequests += 1;

    const apiKeyKey = `${item.userId}:${item.apiKeyId || item.apiKeyPreview || "unknown"}`;
    if (!byApiKey[apiKeyKey]) {
      byApiKey[apiKeyKey] = {
        userId: item.userId,
        userName: item.userName,
        username: item.username,
        apiKeyId: item.apiKeyId,
        apiKeyName: item.apiKeyName || "未知 Key",
        apiKeyPreview: item.apiKeyPreview || "",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byApiKey[apiKeyKey].promptTokens += item.promptTokens || 0;
    byApiKey[apiKeyKey].completionTokens += item.completionTokens || 0;
    byApiKey[apiKeyKey].totalTokens += item.totalTokens || 0;
    byApiKey[apiKeyKey].cachedTokens += item.cachedTokens || 0;
    byApiKey[apiKeyKey].cacheCreationTokens += item.cacheCreationTokens || 0;
    byApiKey[apiKeyKey].cacheMissTokens += item.cacheMissTokens || 0;
    byApiKey[apiKeyKey].reasoningTokens += item.reasoningTokens || 0;
    byApiKey[apiKeyKey].requests += 1;
    if (!item.ok) byApiKey[apiKeyKey].failedRequests += 1;

    const modelKey = item.model || "unknown";
    if (!byModel[modelKey]) {
      byModel[modelKey] = {
        model: modelKey,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byModel[modelKey].promptTokens += item.promptTokens || 0;
    byModel[modelKey].completionTokens += item.completionTokens || 0;
    byModel[modelKey].totalTokens += item.totalTokens || 0;
    byModel[modelKey].cachedTokens += item.cachedTokens || 0;
    byModel[modelKey].cacheCreationTokens += item.cacheCreationTokens || 0;
    byModel[modelKey].cacheMissTokens += item.cacheMissTokens || 0;
    byModel[modelKey].reasoningTokens += item.reasoningTokens || 0;
    byModel[modelKey].requests += 1;
    if (!item.ok) byModel[modelKey].failedRequests += 1;

    const day = item.timestamp.slice(0, 10);
    if (!byDay[day]) {
      byDay[day] = {
        day,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        failedRequests: 0
      };
    }
    byDay[day].promptTokens += item.promptTokens || 0;
    byDay[day].completionTokens += item.completionTokens || 0;
    byDay[day].totalTokens += item.totalTokens || 0;
    byDay[day].cachedTokens += item.cachedTokens || 0;
    byDay[day].cacheCreationTokens += item.cacheCreationTokens || 0;
    byDay[day].cacheMissTokens += item.cacheMissTokens || 0;
    byDay[day].reasoningTokens += item.reasoningTokens || 0;
    byDay[day].requests += 1;
    if (!item.ok) byDay[day].failedRequests += 1;
  }

  const recentRequests = records.slice(-100).reverse();

  const hourSince = new Date();
  hourSince.setHours(hourSince.getHours() - 24);
  const hourSinceIso = hourSince.toISOString();
  const byHour = {};
  for (const item of records) {
    if (item.timestamp < hourSinceIso) continue;
    const hour = item.timestamp.slice(0, 13) + ":00";
    if (!byHour[hour]) {
      byHour[hour] = {
        hour,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requests: 0
      };
    }
    byHour[hour].promptTokens += item.promptTokens || 0;
    byHour[hour].completionTokens += item.completionTokens || 0;
    byHour[hour].totalTokens += item.totalTokens || 0;
    byHour[hour].requests += 1;
  }

  return {
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    totalTokens,
    totalCachedTokens,
    totalCacheCreationTokens,
    totalCacheMissTokens,
    totalReasoningTokens,
    requests: records.length,
    failedRequests,
    byUser: Object.values(byUser).sort((a, b) => b.totalTokens - a.totalTokens),
    byApiKey: Object.values(byApiKey).sort((a, b) => b.totalTokens - a.totalTokens),
    byModel: Object.values(byModel).sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    byHour: Object.values(byHour).sort((a, b) => a.hour.localeCompare(b.hour)),
    recent: recentRequests,
    recentRequests
  };
}

module.exports = {
  getUsageStats
};
