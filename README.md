# SAPI

SAPI 是一个轻量级 LLM API 中转站。管理员在后台配置上游 LLM API；用户自行注册、登录，并在用户前台自助创建自己的 API Key。

## 功能特性

- **多格式转发**：OpenAI Chat / Completions / Embeddings / Responses、Anthropic Messages、Gemini
- **流式响应**：支持 SSE 流式转发
- **站内创作**：用户前台提供 Responses Chat 与生图工坊，支持图片生成、参考图编辑和结果下载
- **用户系统**：注册/登录、GitHub OAuth、邀请码、腾讯云验证码
- **API Key 管理**：用户自助创建、模型白名单、RPM 限制、自动封禁
- **订阅计费**：email/lite/base/pro/ultra/MAX 套餐、models.dev 模型价格、额度消耗展示、易支付接入
- **管理后台**：Provider 管理、用户管理、用量统计、服务器中控、公告、建议反馈
- **健康检查**：Provider 健康探测、故障自动切换、模型可用性 Dashboard
- **运维功能**：站点公告、横幅、维护模式、SMTP 邮件邀请
- **安全增强**：WebAuthn Passkey 登录、IP 限流、请求体限制、可信代理头
- **审计归档**：请求日志服务端留存，7 天归档 tar.gz，用户端隐藏 IP/设备/请求 JSON

## 快速启动

```bash
# 前端构建
npm install
npm run build

# 后端启动
cd backend
go run .
```

默认地址：

- 首页：http://localhost:3000
- 登录：http://localhost:3000/#login
- 注册：http://localhost:3000/#register
- 用户控制台：http://localhost:3000/#portal
- 管理后台：http://localhost:3000/#admin
- Swagger：http://localhost:3000/swagger

默认管理员账号：

```
SAPI_ADMIN_USER=admin
SAPI_ADMIN_PASSWORD=sapi-admin
```

生产环境请务必修改 `.env` 中的管理员密码。

## 支持的转发端点

| 路径 | 说明 |
| --- | --- |
| `GET /v1/models` | 模型列表 |
| `POST /v1/chat/completions` | OpenAI Chat |
| `POST /v1/completions` | OpenAI Completions |
| `POST /v1/embeddings` | OpenAI Embeddings |
| `POST /v1/responses` `POST /responses` | Responses API |
| `POST /v1/images/generations` `POST /v1/images/edits` | OpenAI Images |
| `POST /v1/messages` `POST /messages` | Anthropic Messages |
| `其他 /v1/*` | 通用 JSON 转发 |

调用示例：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

API Key 支持 `Authorization: Bearer <key>` 或 `X-API-Key: <key>` 两种方式传递。

## 前端开发

```bash
npm run client:dev
```

开发服务运行在 http://localhost:5173，自动代理 `/api`、`/v1`、`/responses` 到后端 `localhost:3000`。

## 致谢

用户前台的生图工坊嵌入了 MIT 许可项目 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 的静态构建，并通过 SAPI Base URL 与用户 API Key 调用 Images API / Responses API。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SAPI_PORT` | `3000` | HTTP 服务端口 |
| `SAPI_ADMIN_USER` | `admin` | 管理员用户名 |
| `SAPI_ADMIN_PASSWORD` | `sapi-admin` | 管理员密码 |
| `SAPI_PUBLIC_BASE_URL` | `http://localhost:<port>` | 公开访问地址 |
| `SAPI_DATA_FILE` | `data/sapi.json` | JSON 状态文件路径 |
| `SAPI_REDIS_URL` | 空 | Redis 限流（可选） |
| `SAPI_POSTGRES_URL` | 空 | PostgreSQL 状态存储（可选） |
| `SAPI_TRUST_PROXY_HEADERS` | `false` | 是否信任代理头 |
| `SAPI_TRUSTED_PROXY_CIDRS` | 空 | 可信代理 CIDR 列表 |
| `SAPI_IPPURE_ENABLED` | `true` | 是否在请求日志中查询并保存 IPPure IP 情报 |
| `SAPI_IPPURE_ENDPOINT` | `https://api.ippure.com/api/info/ip-risk/{ip}` | IPPure 查询接口，支持 `{ip}` 占位符 |
| `SAPI_IPPURE_API_KEY` | 空 | IPPure API Key（如服务端接口需要鉴权） |
| `SAPI_IPPURE_METHOD` | `POST` | IPPure 查询方法 |
| `SAPI_IPPURE_TIMEOUT_MS` | `1200` | IPPure 查询超时，失败不阻断用户请求 |
| `SAPI_REQUEST_BODY_LIMIT_BYTES` | `1048576` | 控制面请求体限制 |
| `SAPI_PROXY_BODY_LIMIT_BYTES` | `33554432` | 代理接口请求体限制 |
| `SAPI_GITHUB_CLIENT_ID` | 空 | GitHub OAuth Client ID |
| `SAPI_GITHUB_CLIENT_SECRET` | 空 | GitHub OAuth Client Secret |
| `SAPI_TENCENT_CAPTCHA_APP_ID` | 空 | 腾讯云验证码 App ID |
| `SAPI_SMTP_HOST` | 空 | SMTP 主机 |
| `SAPI_SMTP_PORT` | `587` | SMTP 端口 |
| `SAPI_SMTP_USER` | 空 | SMTP 用户名 |
| `SAPI_SMTP_PASS` | 空 | SMTP 密码 |
| `SAPI_SMTP_FROM` | 空 | 发件人地址 |

完整配置说明见 [docs/configuration.md](docs/configuration.md)。

套餐、模型价格和易支付配置可在管理后台 `总设置` 修改。默认模型价格来源为 [models.dev](https://models.dev/)，易支付回调路径为 `/api/payments/ezfpy/notify` 和 `/api/payments/ezfpy/return`。

## 数据存储

默认使用 `data/sapi.json` 保存状态。该文件包含上游 API Key 和用户 API Key，请勿提交到代码仓库。

- **Redis**（`SAPI_REDIS_URL`）：跨实例登录失败、验证码、API Key 失败和 RPM 滑窗限流，未配置时使用进程内内存兜底
- **PostgreSQL**（`SAPI_POSTGRES_URL`）：状态存储和高频请求日志，未配置时使用 JSON 文件

健康检查：

```bash
curl http://localhost:3000/api/health   # 进程存活
curl http://localhost:3000/api/ready    # Redis / PostgreSQL 依赖状态
```

## 文档

详细文档见 `docs/` 目录：

- [架构](docs/architecture.md) — 系统分层、请求链路、数据流
- [实现](docs/implementation.md) — 后端模块、代理转换、鉴权限流
- [API 参考](docs/reference.md) — 完整接口文档
- [配置](docs/configuration.md) — 环境变量、Redis、PostgreSQL、GitHub OAuth、SMTP
- [开发](docs/development.md) — 本地开发、代码约定、测试
- [部署](docs/deployment.md) — 构建、systemd、Nginx、CDN
- [使用](docs/usage.md) — 管理端、用户端、API Key、订阅、AstrBot
- [维护](docs/maintenance.md) — 健康检查、备份恢复、故障处理

## 构建与测试

```bash
# 后端测试
cd backend && go test ./...

# 前端构建验证
npm run build

# 进程级烟测
cd backend && go build -o ../bin/sapi-smoke .
cd ..
npm run smoke

# 生产构建
cd backend && go build -o sapi-main .
```
