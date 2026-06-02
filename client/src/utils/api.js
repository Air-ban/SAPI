import { ADMIN_TOKEN_KEY, USER_TOKEN_KEY } from "../constants";

export async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
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

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();

  const contentType = response.headers.get("content-type") || "";
  const looksLikeJson = contentType.includes("application/json") || /^\s*[{\[]/.test(text);

  if (!looksLikeJson) {
    const status = response.status;
    const snippet = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(`服务器暂时不可用 (${status})${snippet ? "：" + snippet : ""}`);
  }

  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }

  return data;
}
