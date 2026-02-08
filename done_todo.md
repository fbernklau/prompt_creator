# Prompt Creator - Done / TODO Tracker

Last updated: 2026-02-08
Owner: Team + Codex

## Purpose
- Keep durable in-repo project memory.
- Track what is implemented vs still open.
- Reduce context loss between sessions.

## Current Snapshot
- Branch: `main`
- HEAD commit: `ed41038c6e238c13c6b49ecca84c8aa9539e9625`
- HEAD message: `Added templates, rewrote database schema, added rating and template creation. changed prompt engine`
- Stable fallback tag: `0.1-stableish` -> `acee376`
- Working tree note: tracker was refreshed to match current code state.

## Environment Status (checked in this session)
- [x] `node` available (`v24.13.0`)
- [x] `npm` available (`11.6.2`)
- [x] `docker` available (`28.2.2`)
- [x] `docker compose` available (`2.37.1`)
- [x] `docker compose config` parses successfully when required env vars are present.
- [ ] Full runtime smoke test (`docker compose up -d --build` + API/UI flow checks) still pending.

## Done (verified in codebase)

### Architecture / modularity
- [x] Backend split into modular domains (`src/routes`, `src/services`, `src/middleware`, `src/db`, `src/catalog`, `src/security`).
- [x] Frontend split into controllers/modules (`frontend/*`) with `app.js` as orchestrator.
- [x] Central API router composes domain routers, including admin and template management.

### Auth + access control
- [x] Authentik/Traefik header auth integrated.
- [x] Access gate by required Authentik group (`OIDC_REQUIRED_GROUP`, currently `teachers`).
- [x] RBAC engine implemented with DB-backed permissions, roles, and group-role bindings.
- [x] Default 4-role model seeded (`teachers`, `template_reviewers`, `template_curators`, `platform_admins`).
- [x] Backward-compatible teacher fallback if required group exists but no binding yet.

### Admin interface (RBAC management)
- [x] Admin API for permissions, roles, role-permission mappings, group-role bindings.
- [x] Admin UI for creating/editing roles and assigning granular permissions.
- [x] Supports adding new roles in-app for future expansion.

### Provider management + security
- [x] Provider base URL presets implemented for known providers.
- [x] "Use recommended base URL" checkbox implemented (lock/unlock behavior in UI).
- [x] Base URL mode persisted (`preset`/`custom`) in DB.
- [x] Provider connectivity test endpoint + UI action implemented (latency + key source feedback).
- [x] Provider API keys encrypted server-side at rest (AES-GCM metadata envelope).
- [x] Plain API keys are not returned to browser responses.
- [x] Optional shared Gemini test key flow implemented via `.env` allowlists (`GOOGLE_TEST_API_KEY`, `GOOGLE_TEST_ALLOWED_USERS`, `GOOGLE_TEST_ALLOWED_GROUPS`).

### Prompt generation pipeline
- [x] User flow implemented end-to-end (choose template -> fill fields -> build metaprompt -> call provider -> return handoff prompt).
- [x] Provider calling implemented for `openai`, `anthropic`, `google`, `mistral`.
- [x] Prompt-only guardrail added (strict instruction + parser validation/repair to `handoff_prompt` + rejection of invalid output).
- [x] Usage audit logging implemented (`provider_usage_audit`).
- [x] Metaprompt preview endpoint (`/api/generate/preview`) and UI preview panel implemented.
- [x] Per-request generation analytics logging added (`provider_generation_events`) including success/failure and latency.

### Template model and persistence
- [x] Template system persisted in DB (not only static frontend config).
- [x] Schema includes hierarchy nodes (`template_nodes`), template records (`template_records`), versions (`template_versions`), review events (`template_review_events`), tag catalog (`template_tag_catalog`), template ratings (`template_ratings`).
- [x] Seed import from default catalog into DB on startup if missing.
- [x] Template fields are template-specific and versioned (required base fields, optional base fields, dynamic fields).
- [x] Metaprompt builder is hierarchy-aware (`taxonomyPath` and parent context).
- [x] Supports both `schema` and `custom` prompt modes.

### Template lifecycle / governance
- [x] Scopes implemented: `official`, `personal`, `community`.
- [x] Review states implemented: `draft`, `submitted`, `approved`, `rejected`.
- [x] Review workflow endpoints implemented (submit, approve/reject with events, optional promotion target scope with permission checks).
- [x] Node (category/subcategory/group) creation and update endpoints implemented.
- [x] Template create/update/versioning endpoints implemented.
- [x] Clone official/community template to personal variant implemented.

### Discovery features (tags, filters, ranking, ratings)
- [x] Tag catalog DB + API implemented.
- [x] Tag creation/moderation permissions implemented.
- [x] Template tag filtering implemented (`/api/templates`, `/api/template-catalog`).
- [x] Search/ranking implemented (search + tag + rating + usage + recency score).
- [x] Template rating API + DB implemented.
- [x] Favorites implemented (`template_favorites` + API + Home quick access cards).
- [x] Home discovery UI implemented (recommended/recent/favorites/tag chips/template search).

### User preferences
- [x] `showCommunityTemplates` setting persisted per user.
- [x] Community template visibility respects user setting + permissions.

### UI coverage
- [x] Template Studio screen implemented (list/filter/create/edit/review/clone/rate/tag/node).
- [x] Admin screen implemented for RBAC management.
- [x] Provider UI includes preset base URL lock toggle.
- [x] First-run setup wizard implemented (provider setup + active provider test shortcut).
- [x] Main form includes one-off template override editor + optional save-as-personal variant.
- [x] Generation UX improved with status feedback + metaprompt preview.
- [x] Result UX improved with clean/meta copy buttons and compare-with-previous output panel.
- [x] Usage dashboard screen implemented (requests, success rate, latency, provider table, top templates).

## Partially Done / Needs Follow-up
- [ ] Full end-to-end Docker + Authentik smoke test still needs execution against a real `.env` and running stack.
- [ ] UX polish and guardrails in Template Studio are still needed (validation depth, clearer state transitions, safer official edit UX).

## Not Done Yet (high-value backlog)
- [ ] Introduce explicit DB migrations (current schema evolves in startup bootstrap).
- [ ] Add integration tests for critical flows (auth/rbac, provider CRUD + encrypted key behavior, generate pipeline, template lifecycle, tags + ratings).
- [ ] Decide policy for legacy `templates/*.yaml` assets (remove, archive, or auto-sync) to avoid drift from DB/runtime catalog.
- [ ] Add observability hardening (structured audit fields, request tracing, metrics).

## Decisions Confirmed
- [x] Keep Authentik as identity source and access gate.
- [x] Use app-local RBAC for feature permissions (not only Authentik groups).
- [x] Keep API keys per user and encrypted server-side.
- [x] Support official/personal/community template governance model.

## Immediate Next Steps
- [ ] Step 1: Run full local Docker smoke test with real `.env` (`docker compose up -d --build`, UI/API flow, provider call).
- [ ] Step 2: Add migration tooling baseline (e.g. migration table + first versioned migration).
- [ ] Step 3: Add integration tests for template governance + RBAC permission matrix.
- [ ] Step 4: Polish Template Studio UX (safer edit paths, clearer review actions, improved validation feedback).
- [ ] Step 5: Tune discovery ranking heuristics based on real supervisor feedback.
