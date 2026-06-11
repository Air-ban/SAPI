# 开发
SAPI 是 Go 后端加 React/Vite 前端。前端构建产物输出到 `public/`，由 Go 后端托管。

相关文档:
- [架构](architecture.md)
- [实现](implementation.md)
- [API 参考](reference.md)
- [配置](configuration.md)
- [部署](deployment.md)

## 环境要求
- Node.js `>=20`
- Go `1.22`
- 可选: Redis
- 可选: PostgreSQL

## 安装依赖
```bash
npm install
```

后端依赖由 Go module 管理:
```bash
cd backend
go mod download
```

## 本地开发启动
后端:
```bash
cd backend
go run .
```

前端:
```bash
npm run client:dev
```

默认地址:
- 后端: `http://localhost:3000`
- Vite: `http://localhost:5173`
- 登录页: `http://localhost:3000/#login`
- 管理端: `http://localhost:3000/#admin`
- Swagger: `http://localhost:3000/swagger`

Vite 开发代理:
- `/api` -> `http://localhost:3000`
- `/v1` -> `http://localhost:3000`
- `/responses` -> `http://localhost:3000`
- `/messages` -> `http://localhost:3000`

## 构建
```bash
npm run build
cd backend
go build .
```

`npm run build` 会把 `client/` 构建到 `public/`。后端启动后优先托管 `public/index.html`。

## 测试
后端:
```bash
cd backend
go test ./...
```

前端构建:
```bash
npm run build
```

进程级烟测:
```bash
cd backend
go build -o ../bin/sapi-smoke .
cd ..
npm run smoke
```

文档和空白检查:
```bash
git diff --check
```

高风险改动建议额外运行:
```bash
cd backend
go test -race ./...
cd ..
npm run build
npm run smoke
```

GitHub Actions:
- `.github/workflows/ci.yml`
- Ruff: 只检查已跟踪 Python 文件；无 Python 文件时跳过。
- Go: `cd backend && go test ./...`
- Frontend + smoke: `npm ci`、`npm run build`、`go build -o ../bin/sapi-smoke .`、`npm run smoke`

## 目录结构
```text
backend/
  auth/        密码哈希、JWT、随机 ID。
  config/      环境变量和 .env 加载。
  handlers/    HTTP 路由、请求解析、管理端、用户端、代理端点。
  logging/     结构化日志辅助。
  middleware/  CORS、鉴权、维护模式、RPM、API Key 封禁。
  models/      数据模型。
  proxy/       上游 Provider、格式转换、OpenAI/Anthropic/Responses/Gemini 转发。
  security/    请求体限制、可信代理 IP、Redis 限流、防爆破、防注入清洗。
  store/       JSON/PostgreSQL 状态存储和请求日志。
  subscription/订阅分组和 RPM 计算。
  usage/       Token 用量和请求聚合。
  utils/       错误响应、Header 过滤、上游请求体处理。
client/
  React + MUI 前端源码。
public/
  Vite 构建产物，由 Go 后端托管。
docs/
  项目文档。
```

## 后端开发约定
新增控制面功能:
1. 在 `backend/handlers/*.go` 中实现 handler。
2. 在对应 `Mount*Routes` 函数中注册路由。
3. 管理端接口使用 `middleware.RequireAdmin`。
4. 用户端接口使用 `middleware.RequireUserAccount`。
5. JSON 请求体使用 `readJSONBody(w, r)`。
6. 用户输入先用 `security.SafeSingleLine`、`security.SafeText` 或专用校验函数清洗。
7. 错误响应使用 `utils.SendError(w, status, message, code)`。
8. 涉及状态写入时通过 `store.MutateDB`。

错误格式:
```json
{"error":{"message":"...","type":"invalid_json","code":"invalid_json"}}
```

新增代理能力:
1. 路由边界放在 `backend/handlers/proxy.go`。
2. 上游选择、格式判断、请求转换放在 `backend/proxy/`。
3. 新 Provider 格式优先实现 `Build*UpstreamRequest` 和响应转换测试。
4. 保持 OpenAI Chat、Responses、Anthropic Messages、Gemini 之间的转换可单测。
5. 请求结束后写入 `models.RequestLog`，不要持久化上游响应正文。

## 数据开发
读取状态:
```go
db := store.ReadDB()
```

写入状态:
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

请求日志规则:
- JSON 模式主状态不保存完整请求内容；摘要留在内存和状态，完整内容写入旁路 `*.request-logs.jsonl`。
- PostgreSQL 模式写入 `sapi_request_logs`，主状态不承载高频日志。
- 列表接口只返回 `hasRequestContent`。
- 管理端详情接口返回完整 `requestContent`。
- 用户端 usage 和日志详情会清除 IP、设备、请求 JSON 和 `hasRequestContent`。
- 响应正文不持久化。
- 7 天前日志会压缩归档为 `request-log-archives/*.tar.gz`。

## 订阅开发
订阅分组定义在 `backend/subscription/subscription.go`:

| 分组 | RPM |
| --- | --- |
| `lite` | 10 |
| `base` | 30 |
| `pro` | 50 |
| `ultra` | 100 |
| `MAX` | 不限速 |

规则:
- 普通邮箱新用户默认 `email`，邀请码和 GitHub 注册默认 `lite`，教育邮箱注册默认 `base`。
- API Key 的 `rpmLimit=0` 表示跟随订阅分组。
- API Key 显式 RPM 只能收紧，不能超过订阅分组。
- `MAX` 用户不受订阅分组限制，但 Key 可单独设置上限。
- 管理员 API Key 不限速。

改动订阅逻辑时同步更新:
- `backend/subscription/subscription_test.go`
- `backend/handlers/admin_subscription_test.go`
- [使用文档](usage.md)
- [API 参考](reference.md)

## 代理开发
代理入口:
- `GET /v1/models`
- `GET /models`
- `GET /v1/models/{model}`
- `GET /models/{model}`
- `POST /chat/completions`
- `POST /v1/chat/completions`
- `POST /v1/completions`
- `POST /v1/embeddings`
- `POST /responses`
- `POST /v1/responses`
- `POST /messages`
- `POST /v1/messages`
- `POST /messages/count_tokens`
- `POST /v1/messages/count_tokens`
- `POST /v1/*`

站内 Chat/生图 WebSocket 代理:
- 入口: `GET /api/ws/proxy`
- 内部目标: 只允许上面列出的 OpenAI/Responses/Images/Models 路径。
- 外部目标: 只允许 HTTPS，禁止 URL 用户信息、localhost、私网、链路本地和多播地址。
- 外部 GET: `/v1/models`、`/models`
- 外部 POST: `/responses`、`/v1/responses`、`/v1/chat/completions`、`/chat/completions`、`/v1/images/generations`、`/v1/images/edits`
- 外部请求不跟随重定向，解析域名后按已验证公网 IP 建连。

调用前置逻辑:
1. 从 `Authorization: Bearer <key>` 或 `X-API-Key` 读取 SAPI Key。
2. 校验 Key 是否启用、是否封禁。
3. 检查站点维护模式。
4. 检查模型白名单。
5. 检查 RPM。
6. 选择可用上游 Provider。
7. 根据 `upstreamFormat` 转换请求体。
8. 重写上游模型和鉴权 Header。
9. 转发上游响应。
10. 写入结构化请求日志，包括请求 JSON、状态、耗时和 token 用量。

`upstreamFormat`:
- `auto`: 根据 Provider 名称和 Base URL 推断。
- `openai`: 强制 OpenAI Chat/Completions/Embeddings 格式。
- `anthropic`: 强制 Anthropic Messages 格式。
- `gemini`: 强制 Gemini generateContent 格式。

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

客户端 IP:
```go
security.ClientIP(r)
```

不要直接信任 `X-Forwarded-For`。只有启用 `SAPI_TRUST_PROXY_HEADERS` 且直连 IP 命中 `SAPI_TRUSTED_PROXY_CIDRS` 时才会读取代理头。

API Key 请求体不合规:
- 代理请求 JSON 无效或不是对象时记录一次。
- 1 小时内超过 20 次自动封禁该 Key 1 小时。
- 返回 `429 api_key_banned` 和 `Retry-After`。

## 前端开发约定
核心文件:
- `client/src/main.jsx`: App 状态、路由、登录、数据加载、管理端动作。
- `client/src/utils/api.js`: 控制面 API client。
- `client/src/theme.js`: 明暗主题 token。
- `client/src/admin/`: 管理端模块。
- `client/src/user/`: 用户控制台模块。

控制面鉴权:
```text
Authorization: Bearer <jwt>
```

代理 API Key:
```text
Authorization: Bearer sk-sapi-...
```

或:
```text
X-API-Key: sk-sapi-...
```

管理端刷新约定:
- 普通管理操作调用 `afterAdminChange()`，只刷新 `/api/admin/state`。
- Provider 变更调用 `afterProviderChange()`，刷新状态、Provider 健康和模型可用性。
- usage 单独调用 `/api/admin/usage?days=30`。
- 不要在普通按钮操作后强制拉 `/api/admin/state?includeUsage=true`，会拖慢后台。

UI 约定:
- 页面同时支持暗黑模式和白模式。
- 文字颜色使用主题 token，不直接写死接近背景色的黑白值。
- 表格、按钮、Chip、输入框都要检查两种模式下可读。
- 管理后台偏操作型，优先密集、可扫描、低装饰的布局。

站内 Chat 和生图:
- `client/src/utils/openaiCompat.js` 统一处理 OpenAI 兼容 Base URL、模型列表和 WebSocket 请求。
- 用户可选择 SAPI Key 或自有 OpenAI 兼容 Base URL/API Key。
- 模型列表通过 `/v1/models` 动态获取；SAPI 模式在失败时回落到公开配置模型。
- 自有 API Key 只通过当前 WebSocket 请求转发，不写入站点状态。

## 常见开发任务
新增管理员接口:
1. Handler 写入 `backend/handlers/admin.go` 或独立 admin 文件。
2. `MountAdminRoutes` 注册。
3. 前端在 `client/src/admin/` 添加操作入口。
4. 如果返回全局状态，优先复用轻量 `/api/admin/state`。
5. 添加 handler 单测。
6. 更新 [API 参考](reference.md)。

新增用户接口:
1. Handler 写入 `backend/handlers/user.go` 或独立 user 文件。
2. 使用 `RequireUserAccount`。
3. 确保用户只能访问自己的资源。
4. 前端在 `client/src/user/` 添加入口。
5. 添加权限边界测试。

新增 Provider 字段:
1. 更新 `backend/models/models.go`。
2. 更新 `store.normalizeDB()` 和 `sanitizeProvider()`。
3. 更新创建和编辑 Provider 的 handler。
4. 更新前端 Provider 表单。
5. 更新 [配置](configuration.md)、[使用](usage.md)、[API 参考](reference.md)。

## 提交前检查
```bash
cd backend
go test ./...
cd ..
npm run build
npm run smoke
git diff --check
```

文档只改动时至少运行:
```bash
git diff --check
```
