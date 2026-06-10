# API 参考
所有响应为 JSON，除非明确说明为文件下载或上游流式响应。

## 鉴权
控制面 JWT:
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

错误格式:
```json
{"error":{"message":"...","type":"invalid_api_key","code":"invalid_api_key"}}
```

## 公开接口
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 进程存活。 |
| `GET` | `/api/ready` | Redis/PostgreSQL 依赖状态。 |
| `GET` | `/api/public/config` | 公开配置、模型列表、GitHub/验证码开关。 |
| `GET` | `/api/public/key` | 校验 SAPI API Key 并返回用户配置。 |
| `GET` | `/api/announcements` | 启用公告。 |
| `GET` | `/api/banner` | 站点横幅。 |
| `GET` | `/api/maintenance` | 维护状态。 |
| `GET` | `/api/health/providers` | Provider 健康。 |
| `GET` | `/api/health/models` | 模型可用性 Dashboard 数据，服务端 TTL 5 分钟。 |
| `POST` | `/api/suggestions` | 提交建议。 |
| `GET` | `/api/swagger.json` | OpenAPI/Swagger JSON。 |
| `GET` | `/swagger` | Swagger UI。 |

示例:
```bash
curl http://localhost:3000/api/ready
```

## 鉴权接口
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 统一登录，返回 `role=admin` 或 `role=user`。 |
| `POST` | `/api/admin/login` | 管理员登录兼容接口。 |
| `POST` | `/api/auth/send-verification-code` | 发送注册验证码。 |
| `POST` | `/api/auth/register` | 用户注册。 |
| `POST` | `/api/auth/forgot-password/send-code` | 发送找回密码验证码。 |
| `POST` | `/api/auth/forgot-password/reset` | 重置用户密码。 |
| `GET` | `/api/auth/github/start` | 开始 GitHub OAuth。 |
| `GET` | `/api/auth/github/callback` | GitHub OAuth 回调。 |
| `POST` | `/api/admin/passkeys/login/options` | 管理员 Passkey 登录选项。 |
| `POST` | `/api/admin/passkeys/login/finish` | 管理员 Passkey 登录完成。 |
| `POST` | `/api/admin/passkeys/register/options` | 管理员 Passkey 注册选项，需要管理员 JWT。 |
| `POST` | `/api/admin/passkeys/register/finish` | 管理员 Passkey 注册完成，需要管理员 JWT。 |
| `DELETE` | `/api/admin/passkeys/{id}` | 删除管理员 Passkey，需要管理员 JWT。 |

统一登录:
```bash
curl http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"change-this-password"}'
```

注册:
```bash
curl http://localhost:3000/api/auth/register -H "Content-Type: application/json" -d '{"username":"alice","email":"alice@example.edu.cn","password":"password123","verificationCode":"123456"}'
```

## 用户接口
需要用户 JWT。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/user/me` | 当前用户信息、API Keys、配置。 |
| `POST` | `/api/user/api-key` | 创建 API Key。 |
| `POST` | `/api/user/api-key/rotate` | 轮换 legacy 默认 Key。 |
| `POST` | `/api/user/api-keys/{id}/rotate` | 轮换指定 Key。 |
| `PUT` | `/api/user/api-keys/{id}` | 更新 Key 名称和模型白名单。 |
| `DELETE` | `/api/user/api-keys/{id}` | 删除 Key。 |
| `PUT` | `/api/user/settings` | 更新用户设置。 |
| `DELETE` | `/api/user/account` | 注销当前用户账号并删除个人 API Key 和请求日志。 |
| `GET` | `/api/user/usage?days=365` | 用户用量统计。 |
| `GET` | `/api/user/request-logs/{id}` | 查看自己的请求日志摘要，不返回 IP、设备或请求 JSON。 |
| `GET` | `/api/user/suggestions` | 查看自己的建议和回复。 |

创建 API Key:
```bash
curl http://localhost:3000/api/user/api-key -H "Authorization: Bearer <user-jwt>" -H "Content-Type: application/json" -d '{"name":"default","allowedModels":["gpt-4o-mini"]}'
```

更新 Key:
```bash
curl -X PUT http://localhost:3000/api/user/api-keys/key_id -H "Authorization: Bearer <user-jwt>" -H "Content-Type: application/json" -d '{"name":"bot","allowedModels":[]}'
```

## 管理员接口
需要管理员 JWT。

### 状态和用量
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/state` | 轻量管理状态，不内联 usage。 |
| `GET` | `/api/admin/state?includeUsage=true` | 兼容旧行为，返回 usage。 |
| `GET` | `/api/admin/usage?days=30` | 全局 usage。 |
| `GET` | `/api/admin/server-status` | 服务器状态，包含 fastfetch、Go runtime、store health。 |
| `GET` | `/api/admin/request-logs/{id}` | 查看任意请求 JSON 内容。 |
| `GET` | `/api/admin/request-logs/export` | 导出全局请求日志 tar.gz。 |

### Provider
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/admin/providers` | 创建 Provider。 |
| `PUT` | `/api/admin/providers/{id}` | 更新 Provider。 |
| `DELETE` | `/api/admin/providers/{id}` | 删除 Provider。 |
| `POST` | `/api/admin/providers/models` | 通过 Base URL/API Key 拉取上游模型。 |

Provider body:
```json
{
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "upstreamFormat": "auto",
  "enabled": true,
  "models": [{"id":"gpt-4o-mini","name":"gpt-4o-mini","description":"","cliSupport":[]}],
  "modelMappings": {"gpt-4o-mini":"gpt-4o-mini"},
  "failoverThreshold": 3,
  "priority": 0
}
```

拉取模型:
```bash
curl http://localhost:3000/api/admin/providers/models -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" -d '{"baseUrl":"https://api.openai.com/v1","apiKey":"sk-..."}'
```

### 用户和 API Key
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `PUT` | `/api/admin/users/{id}` | 更新用户名称、邮箱、启用状态、订阅分组。 |
| `DELETE` | `/api/admin/users/{id}` | 删除用户。 |
| `PUT` | `/api/admin/users/{id}/password` | 重置用户密码。 |
| `GET` | `/api/admin/users/{id}/usage?days=365` | 用户 usage。 |
| `GET` | `/api/admin/users/{id}/request-logs/export` | 导出用户请求日志 tar.gz。 |
| `PUT` | `/api/admin/users/{userId}/api-keys/{keyId}` | 更新用户 Key RPM 或封禁状态。 |
| `GET` | `/api/admin/api-keys` | 管理员 API Key 列表。 |
| `POST` | `/api/admin/api-keys` | 创建管理员 API Key。 |
| `POST` | `/api/admin/api-keys/{id}/rotate` | 轮换管理员 API Key。 |
| `PUT` | `/api/admin/api-keys/{id}` | 更新管理员 API Key。 |
| `DELETE` | `/api/admin/api-keys/{id}` | 删除管理员 API Key。 |

切换订阅:
```bash
curl -X PUT http://localhost:3000/api/admin/users/usr_id -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" -d '{"subscriptionTier":"pro"}'
```

修改单 Key RPM:
```bash
curl -X PUT http://localhost:3000/api/admin/users/usr_id/api-keys/key_id -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" -d '{"rpmLimit":30}'
```

封禁单 Key 1 小时:
```bash
curl -X PUT http://localhost:3000/api/admin/users/usr_id/api-keys/key_id -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" -d '{"banned":true}'
```

导出日志:
```bash
curl "http://localhost:3000/api/admin/request-logs/export?days=7&includeContent=true" -H "Authorization: Bearer <admin-jwt>" -o request-logs.tar.gz
curl "http://localhost:3000/api/admin/users/usr_id/request-logs/export?days=7&includeContent=true" -H "Authorization: Bearer <admin-jwt>" -o user-request-logs.tar.gz
```

tar.gz 内容:
- `metadata.json`
- `request-logs.jsonl`

查询参数:
- `days`: `1` 到 `7`。
- `limit`: 全局最多 `100000`，单用户最多 `20000`。
- `includeContent=false`: 只导出摘要，不补全请求 JSON。

### 订阅和站点配置
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `PUT` | `/api/admin/subscriptions/global-tier` | 一键切换所有用户订阅。 |
| `PUT` | `/api/admin/rpm-limit` | 更新 legacy 默认 RPM。 |
| `PUT` | `/api/admin/banner` | 更新站点横幅。 |
| `PUT` | `/api/admin/maintenance` | 更新维护模式。 |
| `GET` | `/api/admin/site-email` | 获取站长邮箱。 |
| `PUT` | `/api/admin/site-email` | 更新站长邮箱。 |

全局切换订阅:
```bash
curl -X PUT http://localhost:3000/api/admin/subscriptions/global-tier -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" -d '{"subscriptionTier":"base"}'
```

订阅分组:
| ID | RPM |
| --- | --- |
| `lite` | 10 |
| `base` | 30 |
| `pro` | 50 |
| `ultra` | 100 |
| `MAX` | 不限速 |

### 邀请码、SMTP、公告、建议
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/invitation-codes` | 邀请码列表。 |
| `POST` | `/api/admin/invitation-codes` | 创建邀请码。 |
| `DELETE` | `/api/admin/invitation-codes/{id}` | 删除邀请码。 |
| `POST` | `/api/admin/invitation-codes/send` | 邮件发送邀请码。 |
| `GET` | `/api/admin/smtp-config` | SMTP 配置摘要。 |
| `PUT` | `/api/admin/smtp-config` | 保存 SMTP 配置。 |
| `POST` | `/api/admin/smtp-config/test` | 发送测试邮件。 |
| `GET` | `/api/admin/announcements` | 公告列表。 |
| `POST` | `/api/admin/announcements` | 创建公告。 |
| `PUT` | `/api/admin/announcements/{id}` | 更新公告。 |
| `DELETE` | `/api/admin/announcements/{id}` | 删除公告。 |
| `GET` | `/api/admin/suggestions` | 建议列表。 |
| `PUT` | `/api/admin/suggestions/{id}/reply` | 回复建议。 |
| `DELETE` | `/api/admin/suggestions/{id}` | 删除建议。 |

## 代理接口
需要 SAPI API Key。

| 方法 | 路径 | 兼容 |
| --- | --- | --- |
| `GET` | `/v1/models` | OpenAI Models。 |
| `GET` | `/models` | OpenAI Models 根路径兼容。 |
| `GET` | `/v1/models/{model}` | 单模型查询。 |
| `GET` | `/models/{model}` | 单模型查询根路径兼容。 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions。 |
| `POST` | `/chat/completions` | Chat Completions 根路径兼容。 |
| `POST` | `/v1/completions` | OpenAI Completions 透传。 |
| `POST` | `/v1/embeddings` | OpenAI Embeddings 透传。 |
| `POST` | `/responses` | Responses API。 |
| `POST` | `/v1/responses` | Responses API。 |
| `POST` | `/messages` | Anthropic Messages。 |
| `POST` | `/v1/messages` | Anthropic Messages。 |
| `POST` | `/messages/count_tokens` | Anthropic Count Tokens。 |
| `POST` | `/v1/messages/count_tokens` | Anthropic Count Tokens。 |
| `POST` | `/v1/*` | 其他 OpenAI 兼容 JSON 代理。 |

OpenAI Chat:
```bash
curl http://localhost:3000/v1/chat/completions -H "Authorization: Bearer sk-sapi-..." -H "Content-Type: application/json" -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

Responses:
```bash
curl http://localhost:3000/v1/responses -H "Authorization: Bearer sk-sapi-..." -H "Content-Type: application/json" -d '{"model":"gpt-4o-mini","input":"hello"}'
```

Anthropic:
```bash
curl http://localhost:3000/v1/messages -H "Authorization: Bearer sk-sapi-..." -H "Content-Type: application/json" -H "anthropic-version: 2023-06-01" -d '{"model":"claude-3-5-sonnet-latest","max_tokens":128,"messages":[{"role":"user","content":"hello"}]}'
```

## 常见错误
| HTTP | code | 说明 |
| --- | --- | --- |
| `400` | `invalid_json` | 请求体不是合法 JSON。 |
| `400` | `invalid_model` | 模型字段不合法。 |
| `401` | `missing_api_key` | 代理请求缺少 SAPI API Key。 |
| `401` | `invalid_api_key` | API Key 不存在、禁用或无效。 |
| `401` | `unauthorized` | 控制面 JWT 缺失或无效。 |
| `403` | `user_disabled` | 用户被禁用。 |
| `403` | `model_not_allowed` | API Key 不允许调用该模型。 |
| `413` | `request_too_large` | 请求体超过限制。 |
| `429` | `login_rate_limited` | 登录失败过多。 |
| `429` | `api_key_rate_limited` | API Key 失败尝试过多。 |
| `429` | `api_key_banned` | API Key 被封禁。 |
| `429` | `rate_limit_exceeded` | RPM 超限。 |
| `503` | `maintenance_mode` | 维护模式。 |
| `503` | `no_provider` | 无可用 Provider。 |
| `502` | `upstream_request_failed` | 上游请求失败。 |
