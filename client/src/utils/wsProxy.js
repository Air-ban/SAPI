function makeWebSocketURL(path = "/api/ws/proxy") {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function makeAbortError() {
  const error = new Error("请求已停止");
  error.name = "AbortError";
  return error;
}

export function wsProxyRequest({ path, url = "", method = "POST", headers = {}, body = null, form = null, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    const socket = new WebSocket(makeWebSocketURL());
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch {
        // The socket may already be closed.
      }
      fn(value);
    };

    const onAbort = () => {
      try {
        socket.close(4000, "aborted");
      } catch {
        // Ignore close failures during abort.
      }
      finish(reject, makeAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    socket.onopen = () => {
      socket.send(JSON.stringify({
        id,
        method,
        path,
        url,
        headers,
        body,
        form
      }));
    };

    socket.onmessage = (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        finish(reject, new Error("WebSocket 返回了无法解析的数据"));
        return;
      }
      if (message.id !== id) return;
      if (message.type === "error") {
        const error = new Error(message.error || "WebSocket 请求失败");
        error.code = message.code || "";
        finish(reject, error);
        return;
      }
      const raw = String(message.body || "");
      finish(resolve, {
        ok: Number(message.status || 0) >= 200 && Number(message.status || 0) < 300,
        status: Number(message.status || 0),
        headers: message.headers || {},
        body: raw,
        text: async () => raw,
        json: async () => JSON.parse(raw)
      });
    };

    socket.onerror = () => {
      finish(reject, new Error("WebSocket 连接失败，请检查 CDN、反向代理是否允许 Upgrade。"));
    };

    socket.onclose = () => {
      if (!settled) {
        finish(reject, new Error("WebSocket 连接已关闭"));
      }
    };
  });
}
