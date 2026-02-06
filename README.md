# Prompt Creator

Prompt creator web app with:
- Node.js + Express backend
- PostgreSQL persistence
- Traefik reverse proxy integration
- Authentik forward-auth/OIDC header based access control

Target host: `prompts.berncloud.eu`

## What was broken and what is fixed

1. Container build/runtime error (`Cannot find module 'express'`)
- Cause: `Dockerfile` installed Debian packages (`node-express`, `node-pg`) instead of npm dependencies from `package.json`.
- Fix: `Dockerfile` now runs `npm install --omit=dev` and starts with `node server.js`.

2. App bypassed reverse proxy auth
- Cause: public port mapping `8080:8080` exposed the app directly.
- Fix: no host port mapping; app is reachable only through Traefik on Docker network `proxy`.

3. Authentik headers were not fully supported
- Cause: backend only checked generic forward-auth header names.
- Fix: backend now also supports Authentik headers:
  - `X-Authentik-Username`
  - `X-Authentik-Email`
  - `X-Authentik-Groups`
  - `X-Authentik-Entitlements`

4. Async route error handling
- Cause: unhandled async errors in Express 4 routes can crash/hang requests.
- Fix: wrapped async routes and added centralized error middleware.

## Repository files changed

- `Dockerfile`
- `docker-compose.yml`
- `server.js`
- `.env.example`

## docker-compose setup

Current compose is prepared for:
- external Traefik network: `proxy`
- host: `prompts.berncloud.eu`
- Authentik middleware name from env (`TRAEFIK_AUTH_MIDDLEWARE`)
- postgres password from `.env` (`POSTGRES_PASSWORD`)

Important labels configured on `prompt-creator`:
- `traefik.http.routers.prompt-creator.rule=Host(\`prompts.berncloud.eu\`)`
- `traefik.http.routers.prompt-creator.entrypoints=websecure`
- `traefik.http.routers.prompt-creator.tls.certresolver=myresolver`
- `traefik.http.routers.prompt-creator.middlewares=authentik@docker` (override via env if needed)
- `traefik.http.services.prompt-creator.loadbalancer.server.port=8080`

## Ubuntu VPS deployment

## 1) Prepare project folder

```bash
mkdir -p /opt/prompt-creator
cd /opt/prompt-creator
# copy this repository content here
```

## 2) Create env file

```bash
cp .env.example .env
nano .env
```

Set at least:

```env
PROMPTS_HOST=prompts.berncloud.eu
POSTGRES_DB=prompt_creator
POSTGRES_USER=prompt
POSTGRES_PASSWORD=<strong-random-password>
AUTH_REQUIRED=true
OIDC_REQUIRED_GROUP=teachers
TRAEFIK_DOCKER_NETWORK=proxy
TRAEFIK_AUTH_MIDDLEWARE=authentik@docker
```

## 3) Ensure Docker network exists

Your Traefik stack already uses external network `proxy`. Confirm:

```bash
docker network ls | grep proxy
```

If missing:

```bash
docker network create proxy
```

## 4) Start stack

```bash
docker compose up -d --build
```

## 5) Validate containers

```bash
docker compose ps
docker compose logs -f prompt-creator
docker compose logs -f postgres
```

Expected in prompt-creator logs:
- `prompt-creator server running on :8080`

## 6) DNS

Create/verify DNS record:
- `prompts.berncloud.eu` -> public IP of your VPS

## Authentik configuration (required)

This app expects Traefik to enforce login and inject headers.

Use Authentik Proxy Provider + Traefik Outpost.

## 1) Create group

In Authentik Admin:
- `Directory -> Groups -> Create`
- Name: `teachers`
- Add allowed users to this group.

## 2) Create application + provider

1. `Applications -> Providers -> Create -> Proxy Provider`
2. Recommended settings:
- Name: `prompt-creator-proxy`
- Authorization flow: your default auth flow
- External host: `https://prompts.berncloud.eu`
- Internal host: `http://prompt-creator:8080`
- Forward auth (Traefik) mode: enabled

3. Create application:
- Name: `Prompt Creator`
- Slug: `prompt-creator`
- Provider: `prompt-creator-proxy`
- Group/Policy assignment: allow `teachers` group

## 3) Outpost integration with Traefik

If you already have Authentik Traefik outpost running (common in your setup), keep using it.

Important:
- The outpost must publish a middleware in Traefik Docker provider.
- Middleware name must match `.env`:
  - default here is `authentik@docker`
  - if yours differs (for example `authentik-auth@docker`), set `TRAEFIK_AUTH_MIDDLEWARE` accordingly.

How to verify middleware name:

```bash
docker inspect traefik | grep -i authentik
```

Or check Traefik dashboard -> `HTTP -> Middlewares`.

### Minimal outpost middleware snippet (reference)

Use this only in your Authentik/Outpost stack if you still need to define the forward-auth middleware explicitly:

```yaml
services:
  authentik-proxy:
    image: ghcr.io/goauthentik/proxy:2025.10.3
    container_name: authentik-proxy
    restart: unless-stopped
    networks:
      - proxy
    environment:
      - AUTHENTIK_HOST=https://auth.berncloud.eu
      - AUTHENTIK_INSECURE=false
      - AUTHENTIK_TOKEN=<outpost-token-from-authentik>
    labels:
      - "traefik.enable=true"
      # Middleware name "authentik@docker" is what prompt-creator uses by default.
      - "traefik.http.middlewares.authentik.forwardauth.address=http://authentik-proxy:9000/outpost.goauthentik.io/auth/traefik"
      - "traefik.http.middlewares.authentik.forwardauth.trustForwardHeader=true"
      - "traefik.http.middlewares.authentik.forwardauth.authResponseHeaders=X-authentik-username,X-authentik-email,X-authentik-groups,X-authentik-entitlements"

networks:
  proxy:
    external: true
```

If your middleware has another name, set:

```env
TRAEFIK_AUTH_MIDDLEWARE=<your-name>@docker
```

## 4) Header mapping

No custom mapping needed in app code anymore. The app accepts:
- `X-Authentik-Username` or `X-Authentik-Email` as user id
- `X-Authentik-Groups` / `X-Forwarded-Groups` for group checks

## 5) Group enforcement in app

Env var:
- `OIDC_REQUIRED_GROUP=teachers`

Behavior:
- no authenticated user header -> `401`
- authenticated user not in `teachers` -> `403`
- authenticated user in `teachers` -> access granted

## End-to-end test checklist

1. Open `https://prompts.berncloud.eu`
2. You should be redirected to Authentik login if not authenticated.
3. Login with user in `teachers` group -> app loads.
4. Login with user not in `teachers` group -> app API returns `403`.
5. Save provider and refresh page -> data persists (PostgreSQL).

## First deployment order (recommended)

1. Traefik running on network `proxy` with working ACME resolver `myresolver`.
2. Authentik server reachable at `https://auth.berncloud.eu`.
3. Authentik outpost deployed and visible as middleware in Traefik dashboard.
4. `teachers` group exists and at least one test user belongs to it.
5. Prompt-creator stack started with `.env` values.
6. DNS `prompts.berncloud.eu` points to VPS and TLS certificate is issued.

Useful checks:

```bash
docker compose logs --tail=200 prompt-creator
docker exec -it prompt-creator-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"
```

## Troubleshooting

1. `Cannot find module 'express'`
- Rebuild image after this fix:
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

2. `404` or wrong service on `prompts.berncloud.eu`
- Check DNS and Traefik router rule host.
- Confirm container is on `proxy` network.

3. `401 Authentication required`
- Auth middleware not attached or wrong middleware name.
- Verify `TRAEFIK_AUTH_MIDDLEWARE`.

4. `403 User is not in required group`
- User not in Authentik `teachers` group.
- Or group header format mismatch in outpost/policy.

5. TLS/certificate issues
- Verify Traefik `myresolver` is valid in your Traefik stack.
