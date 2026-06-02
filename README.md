# SAPI

SAPI 是一个轻量级 LLM API 中转站。管理员在后台配置上游 LLM API；用户自行注册、登录，并在用户前台自助创建自己的 API Key。

## 快速启动

前端构建：

```bash
npm install
npm run build
```

后端启动（Go）：

```bash
cd backend
go run .
```

默认地址：

- 首页：http://localhost:3000
- 统一登录：http://localhost:3000/#login
- 用户注册：http://localhost:3000/#register
- 用户控制台：http://localhost:3000/#portal
- 管理员后台：http://localhost:3000/#admin

登录页会根据账号自动区分管理员和普通用户。默认管理员账号来自环境变量：

- `SAPI_ADMIN_USER`，默认 `admin`
- `SAPI_ADMIN_PASSWORD`，默认 `sapi-admin`

生产环境请务必设置 `.env` 或系统环境变量中的管理员密码。

## 前端开发

前端使用 React + MUI，源码在 `client/`，构建产物输出到 `public/` 并由 Go 后端直接托管。

```bash
npm run client:dev
```

开发服务默认运行在 http://localhost:5173，并会把 `/api` 和 `/v1` 代理到后端 http://localhost:3000。

## 支持的转发端点

SAPI 使用 OpenAI 兼容路径：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/completions`
- `POST /v1/embeddings`
- 其他 `/v1/*` JSON 请求会按相同规则转发

用户调用时使用 SAPI 生成的 Key：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-sapi-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

## 数据存储

配置默认保存到 `data/sapi.json`。该文件会包含上游 API Key 和用户 API Key，请不要提交到代码仓库。
