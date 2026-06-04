# 使用
SAPI 提供管理端、用户端和 OpenAI/Anthropic 兼容 API 转发。

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

## 管理上游 Provider
在管理后台配置 Provider:

- 名称
- Base URL
- API Key
- 启用状态
- 模型列表
- 模型映射

Base URL 必须是 `http` 或 `https`，不能包含用户信息、空字节、回车或换行。

获取上游模型:

```bash
curl http://localhost:3000/api/admin/providers/models \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"baseUrl":"https://api.openai.com/v1","apiKey":"sk-..."}'
```

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

用户控制台接口使用:

```text
Authorization: Bearer <user-jwt>
```

## 创建 API Key
用户控制台创建自己的 API Key，管理端也可以创建和管理 API Key。

API Key 调用转发接口时使用任一 Header:

```text
Authorization: Bearer sk-sapi-...
```

```text
X-API-Key: sk-sapi-...
```

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

## 错误格式
统一错误响应:

```json
{"error":{"message":"Invalid or disabled SAPI API key.","type":"invalid_api_key","code":"invalid_api_key"}}
```

常见状态:

| 状态码 | code | 场景 |
| --- | --- | --- |
| `400` | `invalid_json` | 请求体不是单个 JSON 对象。 |
| `401` | `missing_api_key` | 转发接口缺少 API Key。 |
| `401` | `invalid_api_key` | API Key 不存在、禁用或无效。 |
| `403` | `model_not_allowed` | API Key 不允许调用该模型。 |
| `413` | `request_too_large` | 请求体超过配置限制。 |
| `429` | `login_rate_limited` | 登录失败次数过多。 |
| `429` | `rate_limit_exceeded` | API Key RPM 超限。 |
| `503` | `maintenance_mode` | 站点维护中。 |
| `503` | `no_provider` | 没有可用上游 Provider。 |
| `502` | `upstream_request_failed` | 上游请求失败。 |
