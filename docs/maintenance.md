# 维护
SAPI 维护重点是健康检查、备份、Redis/PostgreSQL 状态、限流、日志、密钥轮换和上游 Provider 健康。

## 健康检查
进程存活:

```bash
curl http://localhost:3000/api/health
```

依赖状态:

```bash
curl http://localhost:3000/api/ready
```

`/api/ready` 返回:

- `checks.store.postgres`
- `checks.security.redis`

Provider 健康:

```bash
curl http://localhost:3000/api/health/providers
```

Swagger:

```bash
curl http://localhost:3000/api/swagger.json
```

## 备份
JSON 存储模式:

```bash
cp data/sapi.json backups/sapi-$(date +%Y%m%d-%H%M%S).json
```

PostgreSQL 存储模式:

```bash
pg_dump "$SAPI_POSTGRES_URL" > backups/sapi-$(date +%Y%m%d-%H%M%S).sql
```

必须备份:

- `sapi_state`
- `sapi_request_logs`
- `.env`

不要提交:

- `data/sapi.json`
- `.env`
- 上游 Provider API Key
- 用户 API Key
- SMTP 密码

## 恢复
JSON 恢复:

```bash
cp backups/sapi.json data/sapi.json
cd backend
go run .
```

PostgreSQL 恢复:

```bash
psql "$SAPI_POSTGRES_URL" < backups/sapi.sql
cd backend
go run .
```

从 JSON 迁移到 PostgreSQL:

1. 保留现有 `data/sapi.json`。
2. 配置 `SAPI_POSTGRES_URL`。
3. 启动服务。
4. 检查 `/api/ready` 中 `checks.store.postgres.status` 为 `ok`。

## 日志
后端启动时会在当前工作目录创建诊断日志。按 `cd backend && go run .` 启动时路径为:

```text
backend/logs/v1chat-YYYY-MM-DD.log
```

请求日志:

- JSON 模式: 写入状态文件中的请求日志字段。
- PostgreSQL 模式: 写入 `sapi_request_logs`。
- 请求 JSON 内容随请求日志保存，自动保留 7 天；响应正文不持久化保存。

查看最近错误:

```bash
grep -i "error\\|failed\\|upstream" backend/logs/v1chat-$(date +%F).log
```

Windows PowerShell:

```powershell
Select-String -Path backend/logs/v1chat-*.log -Pattern "error|failed|upstream"
```

## Redis 维护
检查连接:

```bash
redis-cli -u "$SAPI_REDIS_URL" ping
```

查看 SAPI key:

```bash
PREFIX=${SAPI_REDIS_KEY_PREFIX:-sapi}
redis-cli -u "$SAPI_REDIS_URL" --scan --pattern "$PREFIX:*"
```

清理 SAPI 限流状态:

```bash
PREFIX=${SAPI_REDIS_KEY_PREFIX:-sapi}
for key in $(redis-cli -u "$SAPI_REDIS_URL" --scan --pattern "$PREFIX:*"); do
  redis-cli -u "$SAPI_REDIS_URL" del "$key"
done
```

生产环境不要清理全部 Redis，只清理当前 `SAPI_REDIS_KEY_PREFIX` 下的 key。

## PostgreSQL 维护
连接检查:

```bash
psql "$SAPI_POSTGRES_URL" -c "select now();"
```

表检查:

```bash
psql "$SAPI_POSTGRES_URL" -c "\dt sapi_*"
```

请求日志量:

```bash
psql "$SAPI_POSTGRES_URL" -c "select count(*) from sapi_request_logs;"
```

按时间清理 7 天前旧日志:

```bash
psql "$SAPI_POSTGRES_URL" -c "delete from sapi_request_logs where timestamp < now() - interval '7 days';"
```

清理后建议:

```bash
psql "$SAPI_POSTGRES_URL" -c "vacuum analyze sapi_request_logs;"
```

## 高流量配置
建议生产配置:

```bash
SAPI_REDIS_URL=redis://redis:6379/0
SAPI_REDIS_POOL_SIZE=128
SAPI_POSTGRES_URL=postgres://user:password@postgres:5432/sapi
SAPI_POSTGRES_MAX_CONNS=50
SAPI_REQUEST_BODY_LIMIT_BYTES=1048576
SAPI_PROXY_BODY_LIMIT_BYTES=33554432
SAPI_TRUST_PROXY_HEADERS=true
SAPI_TRUSTED_PROXY_CIDRS=10.0.0.0/8
```

关键点:

- 多实例部署必须配置 Redis，保证登录、防爆破、API Key 失败、RPM 限流跨实例生效。
- 高请求日志量必须配置 PostgreSQL，避免 JSON 文件成为写入瓶颈。
- PostgreSQL 请求日志自动清理 7 天前数据，清理动作最多每分钟触发一次，避免高并发请求逐条执行清理。
- 只在可信代理 CIDR 内启用代理头读取。
- 根据业务上限调小或调大 `SAPI_PROXY_BODY_LIMIT_BYTES`。
- 为 Provider 设置合理的模型白名单和 Key 级 RPM。

## 密钥轮换
管理员密码:

1. 修改 `.env` 中 `SAPI_ADMIN_PASSWORD`。
2. 重启后端。
3. 旧管理员 JWT 到期前仍可能有效，必要时轮换 `AppSecret` 或清理持久状态。

上游 Provider API Key:

1. 管理后台进入 Provider。
2. 更新 API Key。
3. 使用获取模型或一次小流量请求验证。
4. 确认 Provider 健康状态恢复。

用户 API Key:

1. 用户控制台或管理后台执行 rotate。
2. 通知调用方替换新 Key。
3. 禁用或删除旧 Key。

SMTP 密码:

1. 更新环境变量或管理后台 SMTP 配置。
2. 发送测试邮件。
3. 确认验证码和邀请邮件可发送。

## 维护模式
管理后台可开启维护模式。开启后，用户模型调用会返回:

```json
{"error":{"message":"站点维护中，请稍后重试。","type":"maintenance_mode","code":"maintenance_mode"}}
```

带恢复时间时，返回消息会转换为 Asia/Shanghai 时间。

## 故障处理
| 现象 | 检查项 | 处理 |
| --- | --- | --- |
| `401 invalid_api_key` | Key 是否存在、启用、Header 是否正确。 | 使用 `Authorization: Bearer sk-sapi-...` 或 `X-API-Key`。 |
| `429 login_rate_limited` | 登录失败次数过多。 | 等待 `Retry-After`，确认 Redis key 和客户端 IP。 |
| `429 rate_limit_exceeded` | Key RPM 超限。 | 调整默认 RPM 或 Key 级 RPM。 |
| `503 maintenance_mode` | 维护模式是否开启。 | 管理后台关闭维护模式或等待恢复时间。 |
| `503 no_provider` | 是否有启用 Provider 和模型。 | 启用 Provider，配置 Base URL/API Key/模型。 |
| `502 upstream_request_failed` | 上游网络、鉴权、模型名。 | 检查 Provider API Key、Base URL、上游状态。 |
| `400 smtp_not_configured` | SMTP 是否完整。 | 配置 Host/User/Pass，并测试邮件。 |
| `/api/ready` Redis `degraded` | Redis ping 失败。 | 检查 `SAPI_REDIS_URL`、网络、连接池。 |
| `/api/ready` PostgreSQL `degraded` | PostgreSQL ping 失败。 | 检查 `SAPI_POSTGRES_URL`、连接数、数据库权限。 |

## 发布检查
发布前运行:

```bash
cd backend
go test ./...
cd ..
npm run build
```

发布后检查:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
curl http://localhost:3000/v1/models -H "Authorization: Bearer sk-sapi-..."
```
