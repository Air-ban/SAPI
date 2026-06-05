# 开发
SAPI 是 Go 后端加 React/Vite 前端。前端构建产物输出到 `public/`，由 Go 后端托管。

## 环境要求
- Node.js `>=20`
- Go `1.22`
- 可选: Redis
- 可选: PostgreSQL

## 安装
```bash
npm install
```

## 前端开发
```bash
npm run client:dev
```

Vite 地址: `http://localhost:5173`

开发代理:

- `/api` -> `http://localhost:3000`
- `/v1` -> `http://localhost:3000`
- `/responses` -> `http://localhost:3000`

## 后端开发
```bash
cd backend
go run .
```

默认地址:

- `http://localhost:3000`
- `http://localhost:3000/#admin`
- `http://localhost:3000/swagger`

## 构建
```bash
npm run build
cd backend
go build .
```

`npm run build` 会把 `client/` 构建到 `public/`。后端启动后优先托管 `public/index.html`。

## 测试
```bash
cd backend
go test ./...
```

高风险改动建议额外运行:

```bash
cd backend
go test -race ./...
npm run build
```

## 目录结构
```text
backend/
  auth/        密码哈希、Token、随机 ID。
  config/      环境变量和 .env 加载。
  handlers/    HTTP 路由、请求解析、管理端、用户端、代理端点。
  logging/     结构化日志辅助。
  middleware/  CORS、鉴权、维护模式、RPM 限流。
  models/      数据模型。
  proxy/       上游模型、OpenAI/Anthropic/Responses/Gemini 转发逻辑。
  security/    请求体限制、可信代理 IP、Redis 限流、防注入清洗。
  store/       JSON/PostgreSQL 状态存储和请求日志。
  usage/       Token 用量统计。
  utils/       错误响应、Header 过滤、上游请求体处理。
client/
  React + MUI 前端源码。
public/
  前端构建产物。
```

## 路由开发
新增后端路由:

1. 在 `backend/handlers/*.go` 中实现 handler。
2. 在对应 `Mount*Routes` 函数中注册路由。
3. 管理端接口使用 `middleware.RequireAdmin`。
4. 用户端接口使用 `middleware.RequireUserAccount`。
5. JSON 请求体使用 `readJSONBody(w, r)`。
6. 错误响应使用 `utils.SendError(w, status, message, code)`。

错误格式:

```json
{"error":{"message":"...","type":"invalid_json","code":"invalid_json"}}
```

## 数据开发
状态读取:

```go
db := store.ReadDB()
```

状态写入:

```go
store.MutateDB(func(db *models.Database) interface{} {
    // mutate db
    return nil
})
```

不要绕过 `store.MutateDB` 直接改全局状态。PostgreSQL 启用时，`MutateDB` 会同步写入 `sapi_state`。

请求日志:

```go
store.AppendRequestLog(item)
```

PostgreSQL 启用时，请求日志进入 `sapi_request_logs`，主状态中的 `RequestLogs` 不再承载高频日志。代理请求日志需要填充 `RequestContent`，用于保存用户请求 JSON 内容 7 天；不要写入上游响应正文。

## 代理开发
代理入口:

- `POST /chat/completions`
- `POST /v1/*`
- `POST /responses`
- `POST /v1/responses`
- `POST /messages`
- `POST /v1/messages`
- `POST /messages/count_tokens`
- `POST /v1/messages/count_tokens`

调用前置逻辑:

1. 从 `Authorization: Bearer <key>` 或 `X-API-Key` 读取 SAPI Key。
2. 校验 Key 是否启用。
3. 检查站点维护模式。
4. 检查模型白名单。
5. 检查 RPM。
6. 选择可用上游 Provider。
7. 重写上游模型和授权 Header。
8. 请求完成后写入结构化请求日志，包括请求 JSON 内容、状态、耗时和 token 用量。

新增上游适配时，优先放在 `backend/proxy/`，并保持 `handlers/proxy.go` 只处理请求边界和响应转发。

## 安全开发
默认安全入口在 `security.RequestGuard`:

- 拦截 URL 中的空字节、回车、换行。
- 限制控制面和代理请求体大小。
- 添加 `X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`。

用户输入清洗:

```go
security.SafeSingleLine(value, maxLen)
security.SafeText(value, maxLen)
security.ValidHTTPBaseURL(value)
```

涉及 IP 维度限流时使用:

```go
security.ClientIP(r)
```

不要直接信任 `X-Forwarded-For`。只有启用 `SAPI_TRUST_PROXY_HEADERS` 且直连 IP 命中 `SAPI_TRUSTED_PROXY_CIDRS` 时才会读取代理头。

## 前后端集成
前端调用后端控制面接口使用 `/api/*`。用户和管理员登录后拿到 JWT，控制面接口使用:

```text
Authorization: Bearer <jwt>
```

模型转发接口使用 SAPI API Key:

```text
Authorization: Bearer sk-sapi-...
```

或:

```text
X-API-Key: sk-sapi-...
```
