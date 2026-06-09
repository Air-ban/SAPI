# AGENTS.md — SAPI

## Build & Deploy

```bash
# Frontend
npm install                           # first time only
npm run build                         # Vite → public/

# Backend
cd backend && go mod download         # first time only
cd backend && go build -o ../bin/sapi-main-linux-amd64-github-single-domain .

# Restart (binary at bin/ runs via systemd user service)
systemctl --user restart sapi.service
```

**Critical order:** edit source → rebuild binary → restart service. The running binary is at `bin/sapi-main-linux-amd64-github-single-domain`, not `go run`. Source-only edits have zero effect until rebuilt.

## Testing

```bash
cd backend && go test ./...           # all tests
cd backend && go test -race ./...     # high-risk changes
npm run build                         # frontend verification (no test framework)
```

No frontend test runner exists; `npm run build` serves as the sole frontend check.

## Project Layout

```
client/src/         React + MUI frontend (Edit in Vite dev: `npm run client:dev`)
  admin/            Admin panel components
  user/             User portal components
  components/       Shared UI
backend/            Go API server (go 1.22)
  handlers/         HTTP routes (auth, admin, user, proxy, public)
  proxy/            Upstream relay (OpenAI, Anthropic, Gemini, Responses)
  middleware/        Auth, CORS, RPM, bans, maintenance mode
  models/           Database/Provider/User/RequestLog structs
  store/            JSON-file persistence (default) + optional PostgreSQL
  config/           Env var loading (.env, SAPI_* vars)
  auth/             JWT, passwords, API keys
  security/         Rate limiting, IP, Redis, input sanitization
public/             Vite build output (served by Go backend)
data/               sapi.json (state) + sapi.request-logs.jsonl
bin/                Deployment binary + start/watch scripts
```

## Key Conventions

### State mutations
Always use `store.MutateDB` for writes. Never mutate `store.ReadDB()` directly.
```go
store.MutateDB(func(db *models.Database) interface{} {
    db.SomeField = value
    return nil
})
```
`cloneDatabase` uses JSON marshal/unmarshal — new fields on `Database` are auto-included.

### Adding new fields to Database
1. Add to `backend/models/models.go` struct tag (JSON key is lowercaseCamel: `"myNewField"`)
2. Update `store.normalizeDB()` and `store.RedactProvider()` if the field needs normalization / redaction
3. If editable via admin, add handler + route + frontend form
4. No migration needed — the JSON store defaults missing fields to zero values

### Admin API pattern
- Register in `MountAdminRoutes` (`backend/handlers/admin.go:25-67`)
- Use `middleware.RequireAdmin` wrapper
- Include in `writeAdminState` payload (line 75-99) if frontend needs it
- Use `toBool(body["key"])`, `toString(body["key"])` for form fields
- Input sanitization: `security.SafeSingleLine(v, maxLen)`, `security.SafeText(v, maxLen)`

### Frontend routing
Hash-based (no React Router). Pages are determined by `window.location.hash`.
- Login: `/#login`, Admin: `/#admin`, User portal: `/#portal`
- Admin sub-pages: stored in `adminPage` state, passed as `page` prop to `AdminView`

### Vite dev proxy
`npm run client:dev` proxies `/api`, `/v1`, `/responses`, `/messages` → `localhost:3000`.
Run Go backend separately first.

### adminToken auth
Admin JWT is HS256, signed with `appSecret` from `data/sapi.json`.
Header: `{"alg":"HS256","typ":"JWT"}`, Payload: `{"role":"admin","sub":"<SAPI_ADMIN_USER>","exp":...}`.
No separate admin login token; uses the same JWT mechanism as user sessions.

## Database

- **Default:** `data/sapi.json` (JSON file, thread-safe RWMutex)
- **Optional PostgreSQL:** Set `SAPI_POSTGRES_URL`, tables auto-created
- **Optional Redis:** Set `SAPI_REDIS_URL`, used for rate limiting (falls back to in-memory)
- **JSON field naming:** Marshal uses `json:"..."` struct tags — all lowercaseCamel in the file

### Request handling pattern
- Parse JSON body with `readJSONBody(w, r)` (`backend/handlers/json_body.go:12`) — returns `(map[string]interface{}, bool)`
- Send errors with `utils.SendError(w, code, message, errorCode)`
- Extract bearer token with `utils.GetBearerToken(r)`
- Form fields on admin routes use `toString(body["key"])` and `toBool(body["key"])`

### Proxy routing
Bare paths coexist with `/v1/`-prefixed paths:
- `POST /chat/completions` and `POST /v1/chat/completions`
- `POST /messages` and `POST /v1/messages`
- `POST /responses` and `POST /v1/responses`
All proxy handlers live in `backend/handlers/proxy.go:24` (`MountProxyRoutes`).

## Health / Available Models

`availableModelsForKey` in `backend/handlers/public.go:449` builds the `/v1/models` response.
Governed by `db.ShowOnlyAvailableModels`:
- `false` (default): all enabled providers' models appear
- `true`: only providers with `HealthStatus == "healthy"` + pass failover check

Toggle via admin UI (供应商管理 page) or `PUT /api/admin/models-visibility`.

## Docs

Detailed docs in `docs/`: architecture, configuration, deployment, development, API reference.
`docs/development.md` covers backend/frontend conventions in full.
