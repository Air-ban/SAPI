import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeModelFrontend } from "./helpers";
import { wsProxyRequest } from "./wsProxy";

const DEFAULT_LOCAL_BASE_URL = typeof window !== "undefined" ? window.location.origin : "";

export function normalizeOpenAIBaseURL(value, fallback = DEFAULT_LOCAL_BASE_URL) {
  const raw = String(value || fallback || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, DEFAULT_LOCAL_BASE_URL || undefined);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    if (parsed.pathname.endsWith("/v1")) {
      parsed.pathname = parsed.pathname.slice(0, -3) || "/";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/v1$/i, "");
  }
}

export function openAICompatURL(baseURL, endpoint) {
  const base = normalizeOpenAIBaseURL(baseURL);
  const path = String(endpoint || "").startsWith("/") ? endpoint : `/${endpoint || ""}`;
  if (!base) return path;
  return `${base}${path}`;
}

export function modelsFromOpenAIList(payload) {
  const source = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];
  const seen = new Set();
  const models = [];
  for (const item of source) {
    const model = normalizeModelFrontend(item);
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function fallbackModels(config) {
  return (config?.models || []).map(normalizeModelFrontend).filter((item) => item.id);
}

function keyEnabled(keyRecord) {
  return keyRecord && keyRecord.enabled !== false && keyRecord.key;
}

export function useOpenAIModelCatalog({ config, sourceType, localKeyRecord, customBaseURL, customAPIKey }) {
  const [models, setModels] = useState(() => fallbackModels(config));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const normalizedBaseURL = useMemo(
    () => normalizeOpenAIBaseURL(sourceType === "custom" ? customBaseURL : config?.baseUrl || DEFAULT_LOCAL_BASE_URL),
    [config?.baseUrl, customBaseURL, sourceType]
  );
  const apiKey = sourceType === "custom" ? String(customAPIKey || "").trim() : localKeyRecord?.key || "";
  const localFallback = useMemo(() => fallbackModels(config), [config]);

  useEffect(() => {
    const ready = sourceType === "custom" ? Boolean(normalizedBaseURL && apiKey) : keyEnabled(localKeyRecord);
    if (!ready) {
      setModels(sourceType === "custom" ? [] : localFallback);
      setError("");
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    wsProxyRequest({
      method: "GET",
      path: sourceType === "custom" ? "" : "/v1/models",
      url: sourceType === "custom" ? openAICompatURL(normalizedBaseURL, "/v1/models") : "",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache"
      }
    })
      .then(async (response) => {
        const raw = await response.text();
        let payload = null;
        if (raw.trim()) {
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = null;
          }
        }
        if (!response.ok) {
          throw new Error(payload?.error?.message || raw.slice(0, 180) || `HTTP ${response.status}`);
        }
        const nextModels = modelsFromOpenAIList(payload);
        setModels(nextModels.length ? nextModels : sourceType === "custom" ? [] : localFallback);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err?.message || "模型列表获取失败");
        setModels(sourceType === "custom" ? [] : localFallback);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [apiKey, localFallback, localKeyRecord, normalizedBaseURL, nonce, sourceType]);

  return {
    models,
    loading,
    error,
    refresh,
    baseURL: normalizedBaseURL,
    apiKey
  };
}

export function openAICompatRequest({ sourceType, baseURL, path, apiKey, method = "POST", headers = {}, body = null, form = null, signal }) {
  const endpoint = String(path || "").startsWith("/") ? path : `/${path || ""}`;
  return wsProxyRequest({
    method,
    path: sourceType === "custom" ? "" : endpoint,
    url: sourceType === "custom" ? openAICompatURL(baseURL, endpoint) : "",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...headers
    },
    body,
    form
  });
}
