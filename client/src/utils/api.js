import { ADMIN_TOKEN_KEY, USER_TOKEN_KEY } from "../constants";

function withNoCacheParam(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("_sapi_no_cache", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (url.origin === window.location.origin) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}

function makeRequestError(message, status = 0, code = "") {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function makeNetworkError(error) {
  const message = error?.message || "";
  if (error?.name === "AbortError") {
    return makeRequestError("请求超时，请检查服务器、CDN 回源或反向代理状态。", 0, "request_timeout");
  }
  if (/failed to fetch|load failed|networkerror/i.test(message)) {
    return makeRequestError("无法连接到服务器，请检查 HTTPS 证书、CDN 回源、代理或防火墙配置。", 0, "network_error");
  }
  return makeRequestError(message || "无法连接到服务器，请稍后重试。", 0, "network_error");
}

async function fetchNoCache(path, options) {
  const { timeoutMs = 25000, signal, ...fetchOptions } = options;
  let controller = null;
  let timeoutID = null;
  if (!signal && timeoutMs > 0 && typeof AbortController !== "undefined") {
    controller = new AbortController();
    timeoutID = window.setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    return await fetch(withNoCacheParam(path), {
      ...fetchOptions,
      signal: signal || controller?.signal
    });
  } catch (error) {
    throw makeNetworkError(error);
  } finally {
    if (timeoutID) {
      window.clearTimeout(timeoutID);
    }
  }
}

export async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    ...(options.headers || {})
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  } else {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (options.admin !== false && token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetchNoCache(path, {
    ...options,
    method,
    cache: "no-store",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();

  if (!text.trim()) {
    if (!response.ok) {
      throw makeRequestError(`HTTP ${response.status}`, response.status);
    }
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const looksLikeJson = contentType.includes("application/json") || /^\s*[{\[]/.test(text);

  if (!looksLikeJson) {
    const status = response.status;
    const snippet = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    throw makeRequestError(`服务器暂时不可用 (${status})${snippet ? "：" + snippet : ""}`, status);
  }

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw makeRequestError(`服务器返回异常 (${response.status})`, response.status);
  }

  if (!response.ok) {
    throw makeRequestError(data?.error?.message || `HTTP ${response.status}`, response.status, data?.error?.code || "");
  }

  return data;
}

export async function requestBlob(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    ...(options.headers || {})
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  } else {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (options.admin !== false && token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetchNoCache(path, {
    ...options,
    method,
    cache: "no-store",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json") || /^\s*[{\[]/.test(text)) {
      try {
        const data = JSON.parse(text);
        throw makeRequestError(data?.error?.message || `HTTP ${response.status}`, response.status, data?.error?.code || "");
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw makeRequestError(`HTTP ${response.status}`, response.status);
        }
        throw error;
      }
    }
    throw makeRequestError(`HTTP ${response.status}`, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : "";
  return { blob, filename };
}
