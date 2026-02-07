# Prompt Creator - Done / TODO Tracker

Last updated: 2026-02-06
Owner: Team + Codex

## Purpose
- Keep a persistent project memory in-repo.
- Track what is done, what is planned, and how items should be implemented.
- Reduce risk if chat history is lost.

## Current Snapshot
- Branch: `main`
- Latest commit: `ff982bd` (2026-02-06) `refactor for modularity`
- Local note: `node` is not installed in this environment, so runtime checks were not executed here.

## Done (confirmed in git/code)
- [x] Docker/build refactor (`56bb8de`): Dockerfile + compose + env cleanup.
- [x] UI/backend rewrite (`acee376`): new frontend UX flow and API-backed state.
- [x] Backend modularization (`ff982bd`): split into `src/config`, `src/create-app`, `src/routes`, `src/middleware`, `src/db`, `src/utils`.
- [x] API route decomposition completed: domain routers for health/profile/settings/providers/history/library/template-catalog.
- [x] Template catalog extracted from frontend monolith into backend module (`src/catalog/default-template-catalog.js`).
- [x] Frontend now loads template catalog dynamically from `/api/template-catalog` instead of hardcoded definitions.
- [x] Frontend modularization completed: `app.js` is now an entry/orchestrator and logic is split into `frontend/*` controllers/modules.
- [x] Container build hardening: added `.dockerignore`, and Dockerfile now prefers `npm ci` when `package-lock.json` is present.
- [x] Traefik/Auth headers and access control are integrated.
- [x] PostgreSQL-backed persistence exists for:
  - Providers
  - Prompt history
  - User settings
  - Prompt library + ratings
- [x] Provider key vault encryption/decryption flow exists on the client side.

## What is NOT done yet (from requested roadmap)
- [ ] Provider base URLs prefilled by known provider and lockable with checkbox override.
- [ ] Real per-template required/optional fields model (current logic is category-level config).
- [ ] User-managed template hierarchy (category/subcategory/template creation by level).
- [ ] Official vs Personal vs Community template lifecycle with review/approval flow.
- [ ] User setting to hide/show community templates.
- [ ] Tag system for search/filter.
- [ ] Migration/test workflow (schema currently bootstrapped in app start).

## Known Issues to Fix Early
- [ ] `Jahresplanung` validation mismatch: `pflichtangaben` includes base fields that are not part of dynamic validation.
- [ ] `templates/*.yaml` remains documentation-only; if kept, align/update policy is needed to avoid drift from runtime catalog module.

## Git History (key milestones)
- `ff982bd` (2026-02-06): `refactor for modularity`
  - touched: `server.js`, `src/config.js`, `src/create-app.js`, `src/db/*`, `src/middleware/auth.js`, `src/routes/api-routes.js`, `src/utils/api-helpers.js`
- `acee376` (2026-02-06): `UI and backend rewrite`
  - touched: `README.md`, `app.js`, `docker-compose.yml`, `index.html`, `server.js`, `styles.css`
- `56bb8de` (2026-02-06): `refactor`
  - touched: `.env.example`, `Dockerfile`, `README.md`, `docker-compose.yml`, `server.js`
- `f6bd37f` (2026-02-05): PostgreSQL API + Traefik OIDC header auth

## Best Course of Action to Get to a Stable Working State

### Phase 0 - Stabilize before new features
- [ ] Identify currently deployed VPS commit hash.
- [ ] Create DB backup from VPS before any upgrade.
- [ ] Run current code in staging (same compose/env as VPS).
- [ ] Execute smoke test checklist (health, login/auth, provider CRUD, generate prompt, save library, public library filter, rating).
- [ ] Fix critical mismatches (template validation + source-of-truth) before shipping new large features.

### Phase 1 - Low-risk UX wins
- [ ] Provider presets:
  - `openai -> https://api.openai.com/v1`
  - `anthropic -> https://api.anthropic.com`
  - `google -> https://generativelanguage.googleapis.com`
  - `mistral -> https://api.mistral.ai/v1`
- [ ] Add checkbox: `Use recommended base URL` (locked by default).
- [ ] Add checkbox override: `Allow custom base URL`.
- [ ] Persist provider `base_url_mode` (`preset`/`custom`) and validate in API.

### Phase 2 - Template model foundation (must-have for roadmap)
- [ ] Move template metadata to DB tables (`template_categories`, `template_nodes`, `templates`, `template_fields`, `template_versions`).
- [ ] Make field requirements fully template-driven (including former base fields).
- [ ] Keep read-only seed templates for initial official set.

### Phase 3 - Governance and sharing model
- [ ] Add scopes: `official`, `personal`, `community`.
- [ ] Add review states: `draft`, `submitted`, `approved`, `rejected`.
- [ ] Add moderation endpoints and admin checks.
- [ ] Add per-user preference: `show_community_templates`.

### Phase 4 - Discovery features
- [ ] Implement tag tables and filtering endpoints.
- [ ] Add tag chips + search filters in UI.

### Phase 5 - Future-proofing
- [ ] Split frontend into modules (`api`, `state`, `templates`, `providers`, `library`, `ui`).
- [ ] Add DB migration tooling.
- [ ] Add basic integration tests for critical flows.

## Deployment Safety Plan (VPS with older version running)
- [ ] On VPS, record:
  - deployed commit hash
  - active `.env`
  - compose file used
- [ ] Backup:
  - DB dump
  - current container image tag/hash
- [ ] Rollout strategy:
  - deploy to staging first
  - run smoke tests
  - deploy production in maintenance window
- [ ] Rollback readiness:
  - keep previous image + compose
  - keep backup DB snapshot
  - document exact rollback commands

## Session Update Rule (for future chats)
- At start/end of each work session:
  - move completed items to `[x]`
  - add decisions and assumptions
  - add next concrete 1-3 steps

## Next 3 Recommended Steps
- [ ] Step 1: Confirm VPS deployed commit and create backup.
- [ ] Step 2: Implement/fix template validation/source-of-truth issues.
- [ ] Step 3: Implement provider base URL presets + lock/override UX.
