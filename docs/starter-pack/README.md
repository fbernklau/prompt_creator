# API Key Management Starter Pack (Porting Guide)

This folder is a copy-paste starter pack to implement the same capabilities and visual system in another app:

- encrypted API key storage (server-side only)
- system keys + scoped assignments (global/user/role/group)
- key-level and assignment-level budgets
- per-user limit inside assignment
- stage-specific activation (metaprompt/result)
- compact nested admin UI (mockup-style)
- matching user API-provider UI patterns

## 1) Intended architecture

Use the same separation as this project:

1. `security/` (encryption only)
2. `services/` (key resolution, budget checks, pricing usage)
3. `routes/admin` (system keys + assignments + budgets)
4. `routes/providers` (user provider profiles + stage activation)
5. `routes/generate` (call provider + log usage + enforce budgets)
6. `ui/admin` + `ui/user` (shared row/toggle/status primitives)

## 2) Files in this starter pack

- `001_api_key_management.sql`
  - schema for keys, assignments, usage, runtime settings
- `key-encryption.js`
  - AES-256-GCM envelope encryption helper
- `key-resolution-service.js`
  - key-source resolution + budget enforcement primitives
- `admin-api-key-routes.js`
  - admin CRUD route skeleton
- `provider-profile-routes.js`
  - user provider route skeleton
- `api-key-manager.tokens.css`
  - light/dark token system aligned to the target look
- `api-key-manager.layout.html`
  - nested/collapsible markup pattern (global -> key -> assignment -> quota)
- `api-key-manager.controller.js`
  - collapse + toggle + one-active-per-stage helpers

## 3) Environment variables

Add to `.env`:

```env
KEY_ENCRYPTION_SECRET=<64+ chars random>
KEY_ENCRYPTION_SECRET_PREVIOUS=<optional, for secret rotation>
PROVIDER_REQUEST_TIMEOUT_MS=60000
AUTH_LOGOUT_URL=/outpost.goauthentik.io/sign_out
```

Notes:
- Never run without `KEY_ENCRYPTION_SECRET` in production.
- Keep secrets in runtime env, not committed files.
- Use `KEY_ENCRYPTION_SECRET_PREVIOUS` only during migration/rotation windows.

## 4) Step-by-step integration order

1. Run DB migration from `001_api_key_management.sql`.
2. Drop in `key-encryption.js` and use it in provider/system-key write paths.
3. Add admin routes from `admin-api-key-routes.js`.
4. Add user provider routes from `provider-profile-routes.js`.
5. Wire generation pipeline to `resolveEffectiveKeyForStage` and `enforceBudgets`.
6. Log usage events after each provider call (metaprompt and result stage).
7. Apply UI tokens from `api-key-manager.tokens.css`.
8. Implement nested rows via `api-key-manager.layout.html` + controller helpers.

## 5) Functional behavior to keep

- Global system toggle controls whether any system key access is available.
- Global budget is an independent budget (not aggregated from key budgets).
- Admin key toggles control availability; user stage toggles control active selection.
- User can have exactly one active key per stage (`metaprompt`, `result`).
- Base URL defaults are prefilled and lockable (still overrideable when unlocked).
- Provider cannot be changed for a selected system key; model override is allowed.
- Assignment field appears only after choosing assignment type.

## 6) Budget precedence (recommended)

On each call, enforce in this order:

1. global system budget
2. system key budget
3. assignment budget
4. assignment per-user limit (if configured)
5. optional user personal budget (for personal keys)

Use hybrid mode:
- warning when near limit
- hard block when over limit

## 7) Security checklist

- Encrypted key blobs only; never return plaintext keys over API.
- Decrypt only server-side and only immediately before provider call.
- Redact all key fields from logs.
- Add audit events for key create/update/delete/toggle/assignment changes.
- Add rate limits on key test endpoints.

## 8) Visual parity notes

To achieve the mockup look:

- Keep one-row dense layout per hierarchy row.
- Use semantic color tokens and avoid ad-hoc per-component colors.
- Use tiny status dots + compact toggle sliders.
- Keep nested boxes with slightly different surface tones.
- Keep dashed "add" rows at each level.

## 9) Recommended first commit sequence in target app

1. `feat(db): add system key, assignment, budget, usage schema`
2. `feat(security): add AES-GCM key envelope encryption and decryption`
3. `feat(api): add admin system-key and user provider profile endpoints`
4. `feat(generate): add stage key resolution and budget enforcement`
5. `feat(ui): add nested API key manager layout with light/dark tokens`

