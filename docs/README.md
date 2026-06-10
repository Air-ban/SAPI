# SAPI 文档
SAPI 是一个 Go + React 的 LLM API 中转站，提供用户注册、API Key 管理、订阅 RPM、上游 Provider 管理、OpenAI/Anthropic/Responses/Gemini 兼容转发、请求日志和管理后台。

## 文档目录
- [架构](architecture.md): 系统分层、请求链路、数据流、状态存储、前端结构。
- [实现](implementation.md): 后端模块、代理转换、鉴权限流、请求日志、后台刷新优化。
- [API 参考](reference.md): 公开接口、鉴权接口、用户接口、管理员接口、代理接口。
- [配置](configuration.md): `.env`、Redis、PostgreSQL、可信代理、GitHub OAuth、SMTP、验证码。
- [开发](development.md): 本地开发、目录结构、代码约定、测试、常见改动路径。
- [部署](deployment.md): 构建、单机部署、热部署、systemd、反向代理、健康检查。
- [使用](usage.md): 管理端、用户端、API Key、订阅、AstrBot、兼容调用示例。
- [维护](maintenance.md): 健康检查、备份恢复、日志、Redis/PostgreSQL、故障处理。

## 快速启动
```bash
npm install
npm run build
cd backend
go run .
```

默认地址:
- 首页: `http://localhost:3000`
- 登录: `http://localhost:3000/#login`
- 注册: `http://localhost:3000/#register`
- 用户控制台: `http://localhost:3000/#portal`
- 管理后台: `http://localhost:3000/#admin`
- Swagger: `http://localhost:3000/swagger`

## 核心命令
```bash
cd backend && go test ./...
npm run build
cd backend && go build -o ../bin/sapi-smoke .
cd ..
npm run smoke
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

## 生产必读
- 设置 `SAPI_ADMIN_PASSWORD`，不要使用默认密码。
- 配置 `SAPI_PUBLIC_BASE_URL` 为真实 HTTPS 域名。
- 高流量部署启用 `SAPI_REDIS_URL` 和 `SAPI_POSTGRES_URL`。
- 仅在可信代理 CIDR 后启用 `SAPI_TRUST_PROXY_HEADERS=true`。
- 不要提交 `.env`、`data/sapi.json`、Provider API Key、用户 API Key。
