# 使用
SAPI 提供管理端、用户端和 OpenAI/Anthropic/Responses/Gemini 兼容 API 转发。

相关文档:
- [架构](architecture.md)
- [实现](implementation.md)
- [API 参考](reference.md)
- [配置](configuration.md)
- [部署](deployment.md)
- [维护](maintenance.md)

## 启动
```bash
npm install
npm run build
cd backend
go run .
```

默认地址:
- 首页: `http://localhost:3000`
- 登录: `http://localhost:3000/#login`
- 用户注册: `http://localhost:3000/#register`
- 用户控制台: `http://localhost:3000/#portal`
- 管理后台: `http://localhost:3000/#admin`
- Swagger: `http://localhost:3000/swagger`

## 管理员登录
默认账号:
```text
username: admin
password: sapi-admin
```

生产环境在 `.env` 中修改:
```bash
SAPI_ADMIN_USER=admin
SAPI_ADMIN_PASSWORD=change-this-password
SAPI_PUBLIC_BASE_URL=https://sapi.example.com
```

登录接口:
```bash
curl http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change-this-password"}'
```

响应包含 `token`。管理端 API 使用:
```text
Authorization: Bearer <admin-jwt>
```

## 管理员 Passkey
管理员可在管理后台注册 Passkey，之后登录页可用系统 Passkey 登录。

要求:
- 必须使用 HTTPS 域名，或本地 `localhost`。
- `SAPI_PUBLIC_BASE_URL` 必须配置为真实访问域名。
- 首次注册 Passkey 需要先用管理员密码登录。

Passkey 登录接口:
```bash
curl http://localhost:3000/api/admin/passkeys/login/options \
  -H "Content-Type: application/json" \
  -d '{}'
```

前端会调用浏览器 WebAuthn API 完成 `finish`，普通 `curl` 不能直接模拟完整 Passkey 登录。

## 管理上游 Provider
在管理后台配置 Provider:
- 名称
- Base URL
- API Key
- 启用状态
- 上游格式
- 模型列表
- 模型映射
- 优先级
- 故障阈值

Base URL 必须是 `http` 或 `https`，不能包含用户信息、空字节、回车或换行。

获取上游模型:
```bash
curl http://localhost:3000/api/admin/providers/models \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"baseUrl":"https://api.openai.com/v1","apiKey":"sk-..."}'
```

## 上游格式
Provider 的 `upstreamFormat` 支持:

| 值 | 行为 |
| --- | --- |
| `auto` | 根据 Provider 名称和 Base URL 推断 OpenAI、Anthropic 或 Gemini。 |
| `openai` | 强制 OpenAI 兼容格式。 |
| `anthropic` | 强制把 OpenAI Chat 转为 Anthropic Messages。 |
| `gemini` | 强制把 OpenAI Chat 转为 Gemini generateContent。 |

当上游模型实际可用，但应用层因为请求体格式报错时，优先在 Provider 里手动选择 `anthropic` 或 `gemini`，不要只依赖 `auto` 推断。

## 用户注册和登录
用户注册入口:
```text
http://localhost:3000/#register
```

注册要求:
- 用户名 3 到 64 位，只能包含字母、数字、点、下划线、短横线。
- 密码至少 8 位。
- 邮箱验证码 6 位。
- 非 `.edu.cn` 邮箱需要邀请码。

用户登录入口:
```text
http://localhost:3000/#login
```

如果管理员配置了 GitHub OAuth，登录页会显示 GitHub 登录入口。首次通过 GitHub 登录会自动创建用户账号。若配置 `SAPI_GITHUB_REQUIRED_FOLLOW_TARGET=EterUltimate`，首次 GitHub 注册或绑定账号必须关注目标 GitHub 用户；已绑定用户可继续登录。

用户控制台接口使用:
```text
Authorization: Bearer <user-jwt>
```

## 订阅、RPM 和额度
普通邮箱新用户默认订阅分组为 `email`，默认 5 RPM。邀请码、GitHub 和教育邮箱注册默认 `lite`；GitHub 来源用户保留 52 RPM，`.edu.cn` 用户保留 50 RPM。

订阅分组:

| 分组 | 默认 RPM | 默认价格 | 说明 |
| --- | --- | --- | --- |
| `email` | 5 | 免费 | 普通邮箱默认分组。 |
| `lite` | 10 | 免费 | 轻量体验分组。 |
| `base` | 30 | 9.90 CNY | 日常使用。 |
| `pro` | 50 | 29.90 CNY | 高频调用。 |
| `ultra` | 100 | 69.90 CNY | 大额度调用。 |
| `MAX` | 不限速 | 免费 | 管理员授予的最高分组。 |

规则:
- 管理员 API Key 不限速。
- 用户 API Key 默认跟随用户订阅。
- 管理员可修改套餐 RPM、价格、入账额度、时长和启用状态。
- 管理员可给单个用户切换订阅。
- 管理员可一键切换所有用户订阅。
- 单个 API Key 可设置更低 RPM 作为额外限制。
- API Key 的显式 RPM 不能超过用户订阅 RPM。
- 用户前台 `计费套餐` 会显示账户余额、近 365 天额度消耗、当前套餐 RPM 和最近订单。

全局切换所有用户到 `base`:
```bash
curl -X PUT http://localhost:3000/api/admin/subscriptions/global-tier \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"subscriptionTier":"base"}'
```

切换单个用户到 `pro`:
```bash
curl -X PUT http://localhost:3000/api/admin/users/usr_id \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"subscriptionTier":"pro"}'
```

## 模型价格和在线支付
管理后台 `总设置` 包含三块计费设置:

- `订阅套餐`: 修改每个套餐的 RPM、价格、入账额度、有效天数和启用状态。
- `计费与模型价格`: 从 `https://models.dev/api.json` 同步模型价格，也可手动覆盖单个模型价格。
- `易支付`: 配置易支付网关、PID、商户 Key、回调 URL 和支付方式。

额度消耗按请求日志里的 token 用量计算:

```text
成本(CNY) = models.dev USD/1M token 价格 * token 数 / 1_000_000 * USD/CNY 汇率 * 加价倍率
```

回调 URL:

```text
https://<domain>/api/payments/ezfpy/notify
https://<domain>/api/payments/ezfpy/return
```

用户购买付费套餐后，支付成功回调会把订单置为 `paid`，更新用户订阅分组、套餐到期时间，并把套餐额度加入账户余额。管理员虚拟用户拥有用户端全部功能且不限 RPM，不需要购买套餐。

## 创建 API Key
用户控制台创建自己的 API Key，管理端也可以创建和管理 API Key。

API Key 调用转发接口时使用任一 Header:
```text
Authorization: Bearer sk-sapi-...
```

```text
X-API-Key: sk-sapi-...
```

用户创建 API Key:
```bash
curl http://localhost:3000/api/user/api-key \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"default","allowedModels":["gpt-4o-mini"]}'
```

## API Key 封禁
管理员可在管理后台一键封禁或解封用户 API Key、管理员 API Key。

封禁用户 Key:
```bash
curl -X PUT http://localhost:3000/api/admin/users/usr_id/api-keys/key_id \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"banned":true}'
```

解封用户 Key:
```bash
curl -X PUT http://localhost:3000/api/admin/users/usr_id/api-keys/key_id \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"banned":false}'
```

自动封禁:
- 同一 API Key 在 1 小时内超过 20 次提交不合规代理请求体，会自动封禁 1 小时。
- 封禁期间返回 `429 api_key_banned`。
- 响应包含 `Retry-After`。

## 查看可用模型
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-sapi-..."
```

也可调用:
```bash
curl http://localhost:3000/models \
  -H "Authorization: Bearer sk-sapi-..."
```

返回模型受 Provider 启用状态、模型映射、API Key 模型白名单影响。

查询单个模型:
```bash
curl http://localhost:3000/v1/models/gpt-4o-mini \
  -H "Authorization: Bearer sk-sapi-..."
```

模型 ID 如果包含 `/`，调用方应按 URL path 规则编码。

## 模型可用性 Dashboard
公开接口:
```bash
curl http://localhost:3000/api/health/models
```

特性:
- 展示模型当前可用性。
- 服务端数据 TTL 为 5 分钟。
- 管理后台 Provider 变更后会刷新模型可用性。
- 可用于判断上游是否因为故障阈值、禁用状态或模型映射导致不可用。

## 管理端用量和导出
全局 usage:
```bash
curl "http://localhost:3000/api/admin/usage?days=30" \
  -H "Authorization: Bearer <admin-jwt>"
```

用户 usage:
```bash
curl "http://localhost:3000/api/admin/users/usr_id/usage?days=365" \
  -H "Authorization: Bearer <admin-jwt>"
```

导出用户请求日志:
```bash
curl "http://localhost:3000/api/admin/users/usr_id/request-logs/export?days=7" \
  -H "Authorization: Bearer <admin-jwt>" \
  -o user-request-logs.tar.gz
```

导出全局请求日志:
```bash
curl "http://localhost:3000/api/admin/request-logs/export?days=7&includeContent=true" \
  -H "Authorization: Bearer <admin-jwt>" \
  -o request-logs.tar.gz
```

导出文件是 tar.gz，包含:
- `metadata.json`
- `request-logs.jsonl`

管理后台热力图基于 usage 中的按小时和按天聚合数据生成。

## 管理端服务器中控
管理后台 `服务器中控` 调用:
```bash
curl http://localhost:3000/api/admin/server-status \
  -H "Authorization: Bearer <admin-jwt>"
```

返回:
- `fastfetch.available`
- `fastfetch.modules`
- `goVersion`
- `goroutines`
- `memory`
- `store`

服务端安装 `fastfetch` 时展示主机、CPU、内存、磁盘等模块；未安装时仍返回 Go runtime 和 store health。前端可设置自动刷新频率。

## 用户端 BaseURL 测速
用户控制台首页提供 Base URL 到 `/api/health` 的浏览器侧测速。结果包含最佳、平均和最近状态。测速只发起健康检查，不携带 API Key。

## 站内 Chat 和生图
用户控制台:
- `站内 Chat`: Responses/OpenAI 兼容聊天，支持附件、Markdown/HTML 渲染和下载。
- `生图工坊`: Images API 和 Responses 图像工具调用。

API 来源:
- `SAPI Key`: 使用当前站点 API Key。
- `自有 API`: 填写自有 OpenAI 兼容 Base URL 和 API Key。

模型列表:
- 通过当前来源的 `/v1/models` 动态获取。
- SAPI 来源获取失败时回退到站点公开模型配置。
- 自有 API Key 只在当前 WebSocket 请求中使用，不写入 SAPI 状态。

## AstrBot 接入
AstrBot 使用 OpenAI 兼容提供商接入 SAPI。

在 AstrBot 管理面板进入 `服务提供商`，新增提供商时选择 `OpenAI`:
- API Base URL: `https://sapi.eterultimate.asia/v1`
- API Key: 用户控制台或管理员创建的 `sk-sapi-...`
- 模型: 点击获取模型列表后选择需要启用的模型

本地开发环境可把 API Base URL 改为:
```text
http://localhost:3000/v1
```

不要把 API Base URL 填成 `/v1/chat/completions`。AstrBot 会自己拼接 OpenAI Chat Completions 路径，并会通过 `GET /v1/models` 获取模型列表。SAPI 同时兼容 `GET /v1/models/{model}`，用于 OpenAI SDK 或 AstrBot 侧的单模型探测。

## OpenAI Chat Completions
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

根路径兼容:
```bash
curl http://localhost:3000/chat/completions \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

## OpenAI Completions
```bash
curl http://localhost:3000/v1/completions \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5-turbo-instruct","prompt":"hello"}'
```

## OpenAI Embeddings
```bash
curl http://localhost:3000/v1/embeddings \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-3-small","input":"hello"}'
```

## Responses API
```bash
curl http://localhost:3000/responses \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","input":"hello"}'
```

兼容路径:
```bash
curl http://localhost:3000/v1/responses \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","input":"hello"}'
```

## Anthropic Messages
```bash
curl http://localhost:3000/v1/messages \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-5-sonnet-latest","max_tokens":128,"messages":[{"role":"user","content":"hello"}]}'
```

根路径兼容:
```bash
curl http://localhost:3000/messages \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-5-sonnet-latest","max_tokens":128,"messages":[{"role":"user","content":"hello"}]}'
```

## Anthropic Count Tokens
```bash
curl http://localhost:3000/v1/messages/count_tokens \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-5-sonnet-latest","messages":[{"role":"user","content":"hello"}]}'
```

根路径兼容:
```bash
curl http://localhost:3000/messages/count_tokens \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-5-sonnet-latest","messages":[{"role":"user","content":"hello"}]}'
```

## 公开接口
```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
curl http://localhost:3000/api/public/config
curl http://localhost:3000/api/maintenance
curl http://localhost:3000/api/banner
curl http://localhost:3000/api/announcements
curl http://localhost:3000/api/health/providers
curl http://localhost:3000/api/health/models
```

校验 API Key 并返回服务配置:
```bash
curl http://localhost:3000/api/public/key \
  -H "Authorization: Bearer sk-sapi-..."
```

提交建议:
```bash
curl http://localhost:3000/api/suggestions \
  -H "Content-Type: application/json" \
  -d '{"title":"问题标题","content":"问题内容"}'
```

## 请求内容留存
模型转发请求会把用户提交的请求 JSON 内容写入请求日志，保留 7 天:
- JSON 存储模式: 主状态只存摘要，完整内容写入 `*.request-logs.jsonl`。
- PostgreSQL 存储模式: 写入 `sapi_request_logs.request_content` JSONB 字段。
- 响应正文不会被持久化保存。

用户控制台不会显示 IP、设备信息或请求 JSON。管理后台可查看完整请求 JSON，并可导出 tar.gz。7 天前日志会先归档到 `request-log-archives/*.tar.gz` 再清理。

## 错误格式
统一错误响应:
```json
{"error":{"message":"Invalid or disabled SAPI API key.","type":"invalid_api_key","code":"invalid_api_key"}}
```

常见状态:

| 状态码 | code | 场景 |
| --- | --- | --- |
| `400` | `invalid_json` | 请求体不是单个 JSON 对象。 |
| `400` | `invalid_model` | 模型字段不合法。 |
| `401` | `missing_api_key` | 转发接口缺少 API Key。 |
| `401` | `invalid_api_key` | API Key 不存在、禁用或无效。 |
| `401` | `unauthorized` | 控制面 JWT 缺失或无效。 |
| `403` | `user_disabled` | 用户被禁用。 |
| `403` | `model_not_allowed` | API Key 不允许调用该模型。 |
| `413` | `request_too_large` | 请求体超过配置限制。 |
| `429` | `login_rate_limited` | 登录失败次数过多。 |
| `429` | `api_key_rate_limited` | API Key 失败尝试过多。 |
| `429` | `api_key_banned` | API Key 被手动或自动封禁。 |
| `429` | `rate_limit_exceeded` | API Key RPM 超限。 |
| `503` | `maintenance_mode` | 站点维护中。 |
| `503` | `no_provider` | 没有可用上游 Provider。 |
| `502` | `upstream_request_failed` | 上游请求失败。 |
