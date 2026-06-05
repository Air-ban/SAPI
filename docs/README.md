# SAPI 文档
面向配置、开发、使用和维护的最小文档集。

## 目录
- [配置](configuration.md): 环境变量、Redis、PostgreSQL、代理可信头、GitHub 登录、SMTP、验证码。
- [开发](development.md): 本地启动、目录结构、路由开发、测试和构建。
- [使用](usage.md): 管理端、用户端、API Key、RPM 策略、OpenAI/Anthropic 兼容调用。
- [维护](maintenance.md): 健康检查、备份、限流、7 天请求日志留存、密钥轮换和故障处理。

## 快速命令
```bash
npm install
npm run build
cd backend
go run .
```

## 默认地址
- 首页: `http://localhost:3000`
- 登录: `http://localhost:3000/#login`
- 注册: `http://localhost:3000/#register`
- 用户控制台: `http://localhost:3000/#portal`
- 管理后台: `http://localhost:3000/#admin`
- Swagger: `http://localhost:3000/swagger`
