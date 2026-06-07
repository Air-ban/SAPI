# 部署
SAPI 部署产物由 `public/` 前端静态文件和 Go 后端二进制组成。后端直接托管前端，不需要单独 Node 服务。

## 构建要求
- Node.js `>=20`
- Go `1.22`
- 可选 Redis
- 可选 PostgreSQL

## 构建
```bash
npm ci
npm run build
cd backend
go build -o sapi-main .
```

产物:
- `public/index.html`
- `public/assets/*`
- `backend/sapi-main` 或指定输出二进制

## 最小生产环境变量
```bash
SAPI_PORT=3000
SAPI_ADMIN_USER=admin
SAPI_ADMIN_PASSWORD=change-this-password
SAPI_PUBLIC_BASE_URL=https://sapi.example.com
SAPI_DATA_FILE=/opt/sapi/data/sapi.json
```

高流量建议:
```bash
SAPI_REDIS_URL=redis://127.0.0.1:6379/0
SAPI_REDIS_POOL_SIZE=128
SAPI_POSTGRES_URL=postgres://sapi:password@127.0.0.1:5432/sapi?sslmode=disable
SAPI_POSTGRES_MAX_CONNS=50
SAPI_PROXY_BODY_LIMIT_BYTES=33554432
SAPI_TRUST_PROXY_HEADERS=true
SAPI_TRUSTED_PROXY_CIDRS=127.0.0.1/32,10.0.0.0/8
```

## 目录布局
推荐:
```text
/opt/sapi/
  SAPI/
    backend/
    public/
    package.json
  data/
    sapi.json
  logs/
  .env
```

`.env` 可放在仓库根目录，也可放在二进制上一级目录。详见 [配置](configuration.md)。

## 单机 nohup 部署
```bash
cd /opt/sapi/SAPI
git pull --ff-only origin main
npm ci
npm run build
cd backend
go build -o /tmp/sapi-main-$(git rev-parse --short HEAD) .
nohup /tmp/sapi-main-$(git rev-parse --short HEAD) > ../logs/server.log 2>&1 &
echo $! > ../logs/server.pid
```

检查:
```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

## 热部署
不改 Nginx，仅替换进程:
```bash
set -e
cd /opt/sapi/SAPI
git pull --ff-only origin main
short=$(git rev-parse --short HEAD)
npm run build
cd backend
go build -o /tmp/sapi-main-$short .
oldpid=$(cat ../logs/server.pid 2>/dev/null || true)
if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
  kill "$oldpid"
fi
nohup /tmp/sapi-main-$short > ../logs/server.log 2>&1 & echo $! > ../logs/server.pid
sleep 2
curl -fsS http://127.0.0.1:3000/api/health
```

第二实例不同端口:
```bash
nohup env SAPI_PORT=3001 PORT=3001 /tmp/sapi-main-$short > ../logs/server-3001.log 2>&1 & echo $! > ../logs/server-3001.pid
```

## systemd 部署
`/etc/systemd/system/sapi.service`:
```ini
[Unit]
Description=SAPI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sapi/SAPI/backend
EnvironmentFile=/opt/sapi/.env
ExecStart=/opt/sapi/SAPI/backend/sapi-main
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
```

启动:
```bash
systemctl daemon-reload
systemctl enable sapi
systemctl restart sapi
systemctl status sapi
```

滚动更新:
```bash
cd /opt/sapi/SAPI
git pull --ff-only origin main
npm ci
npm run build
cd backend
go build -o sapi-main .
systemctl restart sapi
curl -fsS http://127.0.0.1:3000/api/health
```

## Nginx 反向代理
示例:
```nginx
server {
    listen 443 ssl http2;
    server_name sapi.example.com;

    ssl_certificate /etc/letsencrypt/live/sapi.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sapi.example.com/privkey.pem;

    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
```

只在 Nginx 与 SAPI 同机或可信内网时设置:
```bash
SAPI_TRUST_PROXY_HEADERS=true
SAPI_TRUSTED_PROXY_CIDRS=127.0.0.1/32
```

## CDN 回源
SAPI 支持 CDN/反代前置。建议:
- 回源协议使用 HTTPS。
- 回源 Host 使用业务域名。
- Nginx 或源站证书使用真实证书。
- SAPI 的 `SAPI_PUBLIC_BASE_URL` 设置为最终公开域名。
- 只有源站前一跳代理可信时才启用 `SAPI_TRUST_PROXY_HEADERS`。

## 证书
Let's Encrypt:
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d sapi.example.com
certbot renew --dry-run
```

如果不使用 certbot 修改 Nginx，可手动签发:
```bash
certbot certonly --webroot -w /var/www/html -d sapi.example.com
```

## PostgreSQL 部署
创建数据库:
```bash
createdb sapi
createuser sapi
psql -c "alter user sapi with password 'password';"
psql -c "grant all privileges on database sapi to sapi;"
```

配置:
```bash
SAPI_POSTGRES_URL=postgres://sapi:password@127.0.0.1:5432/sapi?sslmode=disable
```

启动后自动创建:
- `sapi_state`
- `sapi_request_logs`
- 请求日志索引

检查:
```bash
psql "$SAPI_POSTGRES_URL" -c "\dt sapi_*"
curl -fsS http://127.0.0.1:3000/api/ready
```

## Redis 部署
```bash
apt install redis-server
redis-cli ping
```

配置:
```bash
SAPI_REDIS_URL=redis://127.0.0.1:6379/0
SAPI_REDIS_POOL_SIZE=128
SAPI_REDIS_KEY_PREFIX=sapi
```

检查:
```bash
redis-cli -u "$SAPI_REDIS_URL" ping
curl -fsS http://127.0.0.1:3000/api/ready
```

## 发布检查
发布前:
```bash
cd backend
go test ./...
cd ..
npm run build
```

发布后:
```bash
curl -fsS https://sapi.example.com/api/health
curl -fsS https://sapi.example.com/api/ready
curl -fsS https://sapi.example.com/v1/models -H "Authorization: Bearer sk-sapi-..."
```

浏览器检查:
- `/#login`
- `/#portal`
- `/#admin`
- `/swagger`

## 回滚
保留旧二进制:
```bash
ls -lh /tmp/sapi-main-*
```

回滚到旧二进制:
```bash
oldpid=$(cat /opt/sapi/SAPI/logs/server.pid)
kill "$oldpid"
nohup /tmp/sapi-main-OLD > /opt/sapi/SAPI/logs/server.log 2>&1 &
echo $! > /opt/sapi/SAPI/logs/server.pid
curl -fsS http://127.0.0.1:3000/api/health
```

如果数据库 schema 已被新版本写入，优先使用备份恢复。详见 [维护](maintenance.md)。
