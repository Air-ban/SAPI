# 实现
按代码模块描述 SAPI 的核心实现。文件路径均相对仓库根目录。

## 启动入口
`backend/main.go`
- `main()`: 加载配置、初始化 store/security、挂载路由、托管 SPA、启动健康检查循环。
- `isAPIPath()`: 判定 `/api`、`/v1`、`/responses`、`/messages`、`/models`、`/swagger` 等路径进入后端 API。
- `buildSpaHandler()`: 静态文件存在则直接返回；否则回退 `index.html`。
- `serveGzipStaticFile()`: 对可压缩静态资源按 `Accept-Encoding: gzip` 输出压缩内容。
- `loggingMiddleware()`: 输出方法、路径、状态、耗时。

## 配置加载
`backend/config/config.go`
- `Load()` 读取端口、管理员账号、公开 URL、存储、Redis、PostgreSQL、请求体限制、可信代理、GitHub OAuth、SMTP。
- `.env` 查找顺序:
  1. 仓库根目录。
  2. 编译后可执行文件上一级。
  3. 当前工作目录。
- 系统环境变量优先于 `.env`。

## 路由装配
| Mount 函数 | 文件 | 路由组 |
| --- | --- | --- |
| `MountPublicRoutes` | `backend/handlers/public.go` | 健康检查、公开配置、模型列表、公告、横幅、维护状态、Swagger。 |
| `MountAuthRoutes` | `backend/handlers/auth.go` | 管理/用户登录、注册、验证码、忘记密码、GitHub OAuth、管理员 Passkey。 |
| `MountUserRoutes` | `backend/handlers/user.go` | 用户会话、API Key、设置、用量、请求日志、建议反馈。 |
| `MountAdminRoutes` | `backend/handlers/admin.go` | 管理状态、服务器状态、日志导出、Provider、用户、订阅、邀请码、SMTP、公告、建议、维护、横幅。 |
| `MountProxyRoutes` | `backend/handlers/proxy.go` | `/v1/*`、`/responses`、`/messages`、`/chat/completions`。 |

## 鉴权
控制面:
- `auth.SignTokenString()` 创建 JWT。
- `middleware.RequireAdmin()` 校验 `Role=admin`。
- `middleware.RequireUserAccount()` 校验 `Role=user` 并检查用户启用状态。

代理面:
- `utils.GetUserAPIKey()` 从 `Authorization: Bearer` 或 `X-API-Key` 读取 SAPI Key。
- `middleware.FindUserByKey()` 在普通用户 API Keys 和管理员 API Keys 中查找。
- 管理员 API Key 映射为虚拟用户 `__admin__`，RPM 不限速。

## 登录与注册
`backend/handlers/auth.go`
- `handleAuthLogin`: 统一登录，管理员账号返回 `role=admin`，普通用户返回 `role=user`。
- `handleRegister`: 普通注册。非 `.edu.cn` 邮箱需要邀请码。
- `handleSendVerificationCode`: 发送邮箱验证码，依赖 SMTP。
- `handleForgotPasswordReset`: 邮箱验证码重置用户密码。

GitHub OAuth:
- `handleGitHubStart`: 生成 OAuth state 并跳转 GitHub。
- `handleGitHubCallback`: 换取 token，获取 profile，校验关注列表，创建或登录用户。
- `SAPI_GITHUB_REQUIRED_FOLLOW_TARGET` 非空时，首次注册必须关注目标 GitHub 用户。

Passkey:
- `admin_passkeys.go` 使用 WebAuthn 注册和登录管理员 Passkey。
- Passkey 登录成功后签发管理员 JWT。

## 数据存储
`backend/store/store.go`
- `ReadDB()`: 返回只读 clone，列表请求日志会去除完整 `requestContent`。
- `MutateDB(fn)`: clone 当前状态，执行修改，normalize，持久化，再替换缓存。
- `AppendRequestLog(item)`: 代理请求结束后写请求日志。
- `RequestLogsSince(db, since, userID, limit)`: 从 PostgreSQL、内存或 JSONL 查询请求日志。
- `RequestLogForUserView(item)`: 用户侧脱敏，清除 IP、设备、请求 JSON 和 `hasRequestContent`。
- `WriteRequestLogsTarGZ(w, logs, meta)`: 写出 `metadata.json` 和 `request-logs.jsonl` 到 tar.gz。

`backend/store/postgres.go`
- 自动创建 `sapi_state` 和 `sapi_request_logs`。
- `savePostgresState()` 只保存主状态，不保存高频请求日志。
- `insertPostgresRequestLog()` 将请求日志写入表。
- `queryPostgresRequestLogs()` 读取摘要，不返回完整请求 JSON，只返回 `has_request_content` 标记。
- `prunePostgresRequestLogs()` 归档 7 天前日志后删除。

## 数据规范化
`normalizeDB()` 在 store 内部执行:
- 补齐默认字段。
- 迁移 legacy `user.apiKey` 到 `user.apiKeys`。
- 默认订阅分组为 `lite`。
- 规范 Provider 模型、上游格式、故障阈值、优先级。
- 清理过期验证码和旧请求日志。

## 订阅和 RPM
`backend/subscription/subscription.go`
- `lite`: 10 RPM。
- `base`: 30 RPM。
- `pro`: 50 RPM。
- `ultra`: 100 RPM。
- `MAX`: 0，表示不限速。

有效 RPM:
```text
effective = min(subscription tier rpm, api key rpm)
```
当订阅为 `MAX` 或 API Key RPM 为空时按对应不限/继承规则处理。

`middleware.CheckRPMLimit()`:
- 管理员 API Key 直接放行。
- Redis 可用时使用 1 分钟滑窗脚本。
- Redis 不可用时使用进程内 `sync.Map` 滑窗。

## 防爆破和封禁
登录:
- IP 维度和账号维度失败计数。
- Redis 优先，内存兜底。

API Key:
- 缺失或无效 Key 按 IP 记录失败。
- 过多失败返回 `api_key_rate_limited`。

异常请求体:
- `RecordInvalidRequestBody()` 按 API Key 记录。
- 1 小时内超过 20 次不合规，自动封禁 API Key 1 小时。
- 管理端可手动封禁/解封 API Key。

## 请求保护
`backend/security/security.go`
- `RequestGuard()`:
  - 设置 `X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`。
  - 拦截 URL path 中的空字节、CR、LF。
  - 使用 `http.MaxBytesReader` 限制请求体。
- 控制面默认 1 MiB。
- 代理面默认 32 MiB。

可信代理:
- `ClientIP(r)` 默认使用 `RemoteAddr`。
- 只有开启 `SAPI_TRUST_PROXY_HEADERS` 且直连 IP 命中 `SAPI_TRUSTED_PROXY_CIDRS` 时，才读取 `CF-Connecting-IP`、`True-Client-IP`、`X-Real-IP`、`X-Forwarded-For`。

## Provider 管理
`backend/handlers/admin.go`
- `handleAdminCreateProvider`
- `handleAdminUpdateProvider`
- `handleAdminDeleteProvider`
- `handleAdminFetchProviderModels`

Provider 字段:
- `baseUrl`: 上游 `/v1` base URL。
- `apiKey`: 上游密钥。
- `upstreamFormat`: `auto`、`openai`、`gemini`、`anthropic`。
- `models`: 对外模型列表。
- `modelMappings`: 对外模型 ID 到上游模型 ID 映射。
- `priority`: 候选排序，越大越优先。
- `failoverThreshold`: 连续失败超过阈值后暂时跳过。

## Provider 选择
`backend/proxy/provider.go`
- `ChooseProviderCandidates(db, body)`:
  - 过滤 `enabled`。
  - 跳过故障计数超过阈值的 Provider。
  - 按 `priority` 和 `createdAt` 排序。
  - 按请求 `model` 匹配 Provider 模型或映射。
- `RecordProviderFailure()` 和 `RecordProviderSuccess()` 维护进程内连续失败计数。

## 上游格式转换
`backend/proxy/upstream.go`
- `ProviderUpstreamKind(provider)`:
  - `upstreamFormat` 强制指定时直接使用。
  - `auto` 时根据 Base URL 和名称推断 OpenAI、Anthropic、Gemini。
- `BuildChatCompletionsUpstreamRequestDetailed()`:
  - OpenAI: 保留 OpenAI Chat Completions 格式。
  - Anthropic: `OpenAIChatToAnthropic()` 转为 `/v1/messages`。
  - Gemini: `OpenAIChatToGemini()` 转为 `generateContent` 或 `streamGenerateContent`。
- OpenAI 流式请求自动补 `stream_options.include_usage=true`。

Responses:
- `backend/proxy/responses.go`
- `ConvertToChatCompletionsPayload()` 将 Responses API 输入转换为 Chat Completions 请求。
- 支持 `/responses` 和 `/v1/responses`。

Anthropic:
- `backend/proxy/anthropic.go`
- 兼容 `/messages`、`/v1/messages`、`/messages/count_tokens`、`/v1/messages/count_tokens`。

Gemini:
- `backend/proxy/gemini.go`
- 转换 OpenAI messages、tools、stream 等字段到 Gemini payload。

## 响应转发
`backend/proxy/relay.go`
- `RelayUpstreamResponse()`: 非流式响应，复制上游 Header，过滤 hop-by-hop Header。
- `WriteUpstreamStreamToResponse()`: 逐块转发 SSE，并从流中提取 usage。
- `RelayStreamToAnthropic()`: Anthropic 原生流转发。

## WebSocket 站内工具代理
`backend/handlers/ws_proxy.go`
- `GET /api/ws/proxy`: 浏览器内 Chat/生图模块复用的 WebSocket 请求通道。
- 内部请求直接分发到 SAPI handler。
- 外部请求只允许 HTTPS OpenAI 兼容路径。
- 外部目标禁止 localhost、私网、链路本地、多播、保留地址和 URL credentials。
- 外部请求不跟随重定向。
- 外部 client 使用连接池和 HTTP/2，减少重复建连延迟。

## 请求日志和 usage
代理请求完成后写入 `models.RequestLog`:
- 用户、API Key、Provider、模型。
- endpoint、method、status、OK、stream、durationMs。
- prompt/completion/total/cache/reasoning tokens。
- error code/message。
- 请求 JSON 内容。

完整请求内容查看:
- 列表中只返回 `hasRequestContent`。
- 管理端调用 `/api/admin/request-logs/{id}`。
- 用户调用 `/api/user/request-logs/{id}` 只能确认自己的日志摘要，不返回请求 JSON、IP 或设备信息。
- 管理端可调用 `/api/admin/request-logs/export` 导出全局 tar.gz。
- 管理端可调用 `/api/admin/users/{id}/request-logs/export` 导出单用户 tar.gz。
- JSONL/PostgreSQL 中 7 天前日志会先归档为 tar.gz 再清理。

`usage.GetUsageStats(db, userID, days)`:
- 聚合用户、API Key、模型、天、小时。
- 返回最近 100 条请求摘要。
- 管理状态接口默认不再内联 usage；管理端通过 `/api/admin/usage` 单独加载。

## 管理后台刷新优化
`client/src/main.jsx`
- `loadAdminState()`: 请求 `/api/admin/state`，只加载轻量状态。
- `loadAdminUsage()`: 请求 `/api/admin/usage?days=30`。
- `afterAdminChange()`: 普通管理操作只刷新轻量状态。
- `afterProviderChange()`: Provider 变更后刷新轻量状态、Provider health、Model availability。

`backend/handlers/admin.go`
- `/api/admin/state` 默认不返回 `usage`。
- `?includeUsage=true` 或 `?usage=true` 可恢复旧行为。

## 前端 API 客户端
`client/src/utils/api.js`
- `request(path, options)`: JSON 请求，自动带管理员 JWT，支持传入用户 token。
- `requestBlob(path, options)`: 下载导出文件。
- 非 JSON 响应会转换为可读错误，避免前端把 HTML 错页当 JSON。

`client/src/utils/openaiCompat.js`
- `normalizeOpenAIBaseURL()`: 接受根 URL 或 `/v1` URL，规范为根 URL。
- `useOpenAIModelCatalog()`: 通过 WebSocket 拉取 `/v1/models`。
- `openAICompatRequest()`: 统一转发 SAPI Key 和自有 API 请求。

## 前端页面
- `AuthPage`: 登录、注册、GitHub、Passkey、忘记密码。
- `PortalView`: 用户控制台，API Key、用量、模型、调用示例、设置、建议。
- `AdminView`: 管理后台，概览、用量、服务器中控、Provider、用户、邀请码、SMTP、公告、建议。
- `ServerStatusSection`: 调用 `/api/admin/server-status`，展示 fastfetch 和 Go/store 状态，支持刷新频率。
- `BaseUrlLatencySection`: 用户侧测试当前 Base URL 到 `/api/health` 的浏览器链路延迟。
- `ChatSection`: 站内 Chat，可选 SAPI Key 或自有 OpenAI 兼容 API。
- `ImagePlaygroundSection`: 站内生图，可选 SAPI Key 或自有 OpenAI 兼容 API。
- `ModelAvailabilityDashboard`: 模型可用性 Dashboard，TTL 5 分钟。
- `UsageSection`: 用量统计、最近请求；用户侧隐私模式隐藏 IP、设备和请求 JSON，管理侧可展开请求 JSON。
- `RequestHeatmap`: 用户请求热力图。

## 错误响应
所有控制面和代理面错误使用:
```json
{"error":{"message":"...","type":"code","code":"code"}}
```

发送函数:
```go
utils.SendError(w, status, message, code)
```
