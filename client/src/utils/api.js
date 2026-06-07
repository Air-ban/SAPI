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

  const response = await fetch(withNoCacheParam(path), {
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

  const response = await fetch(withNoCacheParam(path), {
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
