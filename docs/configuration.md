# 配置
SAPI 通过 `.env` 和系统环境变量配置后端、存储、限流、代理头、GitHub 登录、SMTP 和验证码。

## 配置加载
`backend/config/config.go` 会按顺序查找第一个存在的 `.env`:

1. 仓库根目录 `.env`，支持 `go run`。
2. 编译后可执行文件所在目录的上一级 `.env`。
3. 当前工作目录 `.env`。

已存在的系统环境变量优先级高于 `.env`。找到一个 `.env` 后停止继续查找。

## 基础配置
| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SAPI_PORT` | `PORT` 或 `3000` | HTTP 服务端口。 |
| `PORT` | `3000` | `SAPI_PORT` 未设置时使用。 |
| `SAPI_ADMIN_USER` | `admin` | 管理员用户名。 |
| `SAPI_ADMIN_PASSWORD` | `sapi-admin` | 管理员密码，生产必须改。 |
| `SAPI_PUBLIC_BASE_URL` | `http://localhost:<port>` | 前端和公开配置展示的服务地址。 |
| `SAPI_DATA_FILE` | 空 | JSON 存储文件路径。空值时使用 `data/sapi.json`。 |

生产最小配置:

```bash
SAPI_PORT=3000
SAPI_ADMIN_USER=admin
SAPI_ADMIN_PASSWORD=change-this-password
SAPI_PUBLIC_BASE_URL=https://sapi.example.com
```

## 存储配置
默认使用 JSON 文件保存状态:

```bash
SAPI_DATA_FILE=data/sapi.json
```

启用 PostgreSQL:

```bash
SAPI_POSTGRES_URL=postgres://user:password@127.0.0.1:5432/sapi?sslmode=disable
SAPI_POSTGRES_MAX_CONNS=20
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SAPI_POSTGRES_URL` | `DATABASE_URL` 或空 | 启用 PostgreSQL 状态存储。 |
| `DATABASE_URL` | 空 | `SAPI_POSTGRES_URL` 未设置时使用。 |
| `SAPI_POSTGRES_MAX_CONNS` | `20` | PostgreSQL 连接池最大连接数。 |

PostgreSQL 启用后自动创建:

- `sapi_state`: 保存主状态 JSONB，不保存高频请求日志。
- `sapi_request_logs`: 保存请求日志和请求 JSON 内容，自动保留 7 天。
- `sapi_request_logs_timestamp_idx`
- `sapi_request_logs_user_timestamp_idx`
- `sapi_request_logs_api_key_idx`

启动时如果 PostgreSQL 主状态为空，会从当前 JSON 状态初始化；之后状态写入 PostgreSQL。

## Redis 限流配置
Redis 用于跨实例共享防爆破和高流量 RPM 滑窗限流。未配置或不可用时使用进程内内存兜底。

```bash
SAPI_REDIS_URL=redis://127.0.0.1:6379/0
SAPI_REDIS_POOL_SIZE=64
SAPI_REDIS_KEY_PREFIX=sapi
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SAPI_REDIS_URL` | `REDIS_URL` 或空 | 启用 Redis 限流。 |
| `REDIS_URL` | 空 | `SAPI_REDIS_URL` 未设置时使用。 |
| `SAPI_REDIS_POOL_SIZE` | `64` | Redis 连接池大小。 |
| `SAPI_REDIS_KEY_PREFIX` | `sapi` | Redis key 前缀。 |

Redis 保护范围:

- 登录失败: IP 维度 30 次/10 分钟，账号维度 8 次/15 分钟，封禁 15 分钟。
- 验证码请求: IP 维度 20 次/分钟。
- API Key 失败: IP 维度 60 次/5 分钟，封禁 10 分钟。
- API Key RPM: 按 Key 做 1 分钟滑窗，普通用户默认跟随订阅分组，管理员 Key 不限速。
- 异常请求体: 同一 API Key 在 1 小时内超过 20 次不合规代理请求体，自动封禁 1 小时。

订阅分组:

| 分组 | RPM |
| --- | --- |
| `lite` | 10 |
| `base` | 30 |
| `pro` | 50 |
| `ultra` | 100 |
| `MAX` | 不限速 |

新用户默认 `lite`。教育邮箱和 GitHub 账号来源会被记录，但当前默认 RPM 由订阅分组决定。

## 请求体限制
```bash
SAPI_REQUEST_BODY_LIMIT_BYTES=1048576
SAPI_PROXY_BODY_LIMIT_BYTES=33554432
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SAPI_REQUEST_BODY_LIMIT_BYTES` | `1048576` | 控制面接口请求体限制，默认 1 MiB。 |
| `SAPI_PROXY_BODY_LIMIT_BYTES` | `33554432` | 转发接口请求体限制，默认 32 MiB。 |

超过限制会返回 `413` 和 `request_too_large`。

## 可信代理头
默认不信任 `X-Forwarded-For`、`CF-Connecting-IP`、`True-Client-IP`、`X-Real-IP`。

```bash
SAPI_TRUST_PROXY_HEADERS=false
SAPI_TRUSTED_PROXY_CIDRS=
```

启用示例:

```bash
SAPI_TRUST_PROXY_HEADERS=true
SAPI_TRUSTED_PROXY_CIDRS=127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
```

只有请求的直连 `RemoteAddr` 命中 `SAPI_TRUSTED_PROXY_CIDRS` 时，后端才读取代理头作为客户端 IP。Cloudflare 或其他边缘代理策略失效时，后端仍能按直连 IP 进行兜底限流。

## CORS
当前 CORS 固定开放:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: Authorization, Content-Type, X-API-Key, anthropic-version, anthropic-beta`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`

如果生产环境需要限制来源，在 `backend/middleware/middleware.go` 修改 `CORS` 中间件。

## 腾讯云验证码
```bash
SAPI_TENCENT_CAPTCHA_APP_ID=
SAPI_TENCENT_CAPTCHA_APP_SECRET_KEY=
SAPI_TENCENT_SECRET_ID=
SAPI_TENCENT_SECRET_KEY=
```

| 变量 | 说明 |
| --- | --- |
| `SAPI_TENCENT_CAPTCHA_APP_ID` | 前端公开的 Captcha App ID。 |
| `SAPI_TENCENT_CAPTCHA_APP_SECRET_KEY` | Captcha 应用密钥。 |
| `SAPI_TENCENT_SECRET_ID` | 腾讯云 API 3.0 签名 Secret ID。 |
| `SAPI_TENCENT_SECRET_KEY` | 腾讯云 API 3.0 签名 Secret Key。 |

`SAPI_TENCENT_CAPTCHA_APP_ID` 和 `SAPI_TENCENT_CAPTCHA_APP_SECRET_KEY` 同时存在时，公开配置显示验证码启用。

## GitHub OAuth
```bash
SAPI_GITHUB_CLIENT_ID=
SAPI_GITHUB_CLIENT_SECRET=
SAPI_GITHUB_REDIRECT_URL=
SAPI_GITHUB_REQUIRED_FOLLOW_TARGET=
SAPI_GITHUB_HOST_RESOLVE=
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SAPI_GITHUB_CLIENT_ID` | 空 | GitHub OAuth App Client ID。 |
| `SAPI_GITHUB_CLIENT_SECRET` | 空 | GitHub OAuth App Client Secret。 |
| `SAPI_GITHUB_REDIRECT_URL` | `SAPI_PUBLIC_BASE_URL/api/auth/github/callback` | GitHub OAuth 回调地址。 |
| `SAPI_GITHUB_REQUIRED_FOLLOW_TARGET` | 空 | 非空时，首次 GitHub 注册或绑定账号必须关注该 GitHub 用户，例如 `EterUltimate`。已绑定的 GitHub 用户可继续登录。 |
| `SAPI_GITHUB_HOST_RESOLVE` | 空 | 可选的后端 GitHub 请求域名到 IP 映射，例如 `github.com=140.82.113.3,api.github.com=140.82.114.5`。用于服务器 DNS 解析到不可达 GitHub IP 时绕开超时，不影响浏览器跳转或 TLS 域名校验。 |

`SAPI_GITHUB_CLIENT_ID` 和 `SAPI_GITHUB_CLIENT_SECRET` 同时存在时，登录页显示 GitHub 登录入口。

## SMTP
```bash
SAPI_SMTP_HOST=smtp.example.com
SAPI_SMTP_PORT=587
SAPI_SMTP_SECURE=false
SAPI_SMTP_USER=your-email@example.com
SAPI_SMTP_PASS=your-email-password
SAPI_SMTP_FROM=noreply@example.com
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SAPI_SMTP_HOST` | 空 | SMTP 主机。 |
| `SAPI_SMTP_PORT` | `587` | SMTP 端口。 |
| `SAPI_SMTP_SECURE` | `false` | `true` 或端口 `465` 时使用隐式 TLS。 |
| `SAPI_SMTP_USER` | 空 | SMTP 用户名。 |
| `SAPI_SMTP_PASS` | 空 | SMTP 密码。 |
| `SAPI_SMTP_FROM` | 空 | 发件人。空值时使用 `SAPI_SMTP_USER`。 |

管理端保存的 SMTP 配置会覆盖环境变量中的 SMTP 配置。

## 健康检查
```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

`/api/health` 返回进程存活状态。`/api/ready` 返回 `store.postgres` 和 `security.redis` 状态。
