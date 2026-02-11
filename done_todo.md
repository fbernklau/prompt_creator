# Prompt Creator - Done / TODO Tracker

Last updated: 2026-02-11
Owner: Team + Codex

## Purpose
- Keep durable in-repo project memory.
- Track what is implemented vs still open.
- Reduce context loss between sessions.

## Current Snapshot
- Branch: `main`
- HEAD commit: `8fae7d10fe1af89c558eb7650852aa4c538d0cd6`
- HEAD message: `updated todo`
- Stable fallback tag: `0.1-stableish` -> `acee376`
- Working tree: dirty (ongoing UX refactor in progress)

## Environment Status (checked in this session)
- [x] `node` available (`v24.13.0`)
- [x] `npm` available (`11.6.2`)
- [x] `docker` available (`28.2.2`)
- [x] `docker compose` available (`2.37.1`)
- [ ] `docker compose config` without `.env` fails (expected: missing `POSTGRES_PASSWORD`)
- [ ] Full runtime smoke test (`docker compose up -d --build` + UI/API flow) pending

## Done (verified in codebase)

### Architecture / modularity
- [x] Backend split into modular domains (`src/routes`, `src/services`, `src/middleware`, `src/db`, `src/catalog`, `src/security`).
- [x] Frontend split into controllers/modules (`frontend/*`) with `app.js` as orchestrator.
- [x] Central API router composes domain routers (providers, generation, templates, admin, settings, usage, history).

### Auth + access control
- [x] Authentik/Traefik header auth integrated.
- [x] Access gate by required Authentik group (`OIDC_REQUIRED_GROUP`, currently `teachers`).
- [x] RBAC engine implemented with DB-backed permissions, roles, and group-role bindings.
- [x] Default 4-role model seeded (`teachers`, `template_reviewers`, `template_curators`, `platform_admins`).
- [x] App-local roles can be created and managed in admin UI (future extensibility).

### Provider management + security
- [x] Provider presets and recommended base URL lock/unlock implemented.
- [x] Provider model selector supports predefined models + custom entry.
- [x] Provider connectivity test endpoint + UI implemented.
- [x] API keys encrypted server-side at rest (AES-GCM envelope), plaintext never returned to browser.
- [x] Optional shared Gemini test key flow via `.env` allowlists implemented.

### Prompt generation pipeline
- [x] End-to-end flow implemented: template -> fields -> metaprompt -> provider -> handoff prompt.
- [x] Provider integrations implemented (`openai`, `anthropic`, `google`, `mistral`).
- [x] Prompt-only guardrail implemented (`handoff_prompt` parse/repair flow).
- [x] Metaprompt preview endpoint and editable preview UI implemented.
- [x] User can choose edited preview as generation input (`metapromptOverride`).
- [x] Usage audit + generation analytics logging implemented.

### Privacy / safety hardening
- [x] Metaprompt envelope now includes explicit privacy rules (no personal/sensitive data requests, placeholders only).
- [x] Clarifying-question logic constrained to didactic context only.
- [x] Post-generation privacy sanitation in backend route added:
- [x] Detects likely requests for personal/sensitive data.
- [x] Attempts provider-side privacy repair prompt if needed.
- [x] Applies local fallback sanitization and enforces a privacy policy block.

### Template model and governance
- [x] Template model persisted in DB (records + versions + hierarchy nodes + tags + ratings + favorites + review events).
- [x] Template scopes implemented: `official`, `personal`, `community`.
- [x] Review states implemented: `draft`, `submitted`, `approved`, `rejected`.
- [x] Template/node/tag CRUD + review endpoints implemented with permission checks.
- [x] One-off template override per run implemented with optional save-as-personal variant.
- [x] Template fields are template-specific (required/optional per template, no global mandatory base block).

### Discovery, filtering, and ranking
- [x] Tag catalog and tag filtering implemented.
- [x] Home discovery includes recommended/recent/favorites.
- [x] Tag filtering is additive (multi-tag intersection behavior).
- [x] Tag chips shown contextually (focus/active-tag aware behavior).
- [x] Search + ranking includes usage, recency, rating, and textual relevance.

### UX/UI progress (major, 2026-02-10 cycle)
- [x] Mockup-driven redesign across major screens (home, subcategory, template form, result, library).
- [x] Responsive topbar + main-shell alignment improved.
- [x] Category cards converted to full-card click behavior.
- [x] Home layout compacted and discovery/search structure improved.
- [x] Required/optional field sections split and reordered for clarity.
- [x] Metaprompt preview restyled and made visually distinct.
- [x] Generate button and metaprompt preview now move together in one right rail.
- [x] Checkbox UX improved (clear checked state, better hit area, fixed style conflicts).

## Partially Done / Needs Follow-up
- [ ] Full Docker + Authentik + provider smoke test against real `.env` on VPS still pending.
- [ ] Privacy policy is strong, but not yet strict hard-fail mode (currently sanitize/repair fallback).
- [ ] Template Studio UX still needs extra guardrails (validation clarity, safer official edit flow, clearer review transitions).

## Not Done Yet (high-value backlog)
- [ ] Introduce explicit DB migrations (current schema evolves in bootstrap).
- [ ] Add integration tests for critical flows (auth/rbac, provider key behavior, generation pipeline, template lifecycle, tags/ratings).
- [ ] Add regression tests for privacy constraints in generated prompts.
- [ ] Decide handling of legacy `templates/*.yaml` and legacy frontend helpers to avoid drift.
- [ ] Add observability hardening (structured tracing/metrics beyond current event tables).

## Decisions Confirmed
- [x] Authentik remains identity/access gate source.
- [x] Feature permissions remain app-local RBAC (not only Authentik groups).
- [x] API keys stay per-user and encrypted server-side.
- [x] Governance model remains `official` / `personal` / `community`.
- [x] Product output stays prompt-only (no final task solution output from this app).

## Immediate Next Steps (recommended order)
- [ ] Step 1: Deploy current `main` to VPS and run full smoke test with real `.env`.
- [ ] Step 2: Run provider sanity matrix (OpenAI/Google/Anthropic/Mistral where available) with at least one template per category.
- [ ] Step 3: Add privacy hard-fail switch (optional): reject output if personal-data requests still detected after repair.
- [ ] Step 4: Add migration baseline (schema version table + first migration).
- [ ] Step 5: Add integration/regression tests (especially privacy + generation parser).
- [ ] Step 6: Final Template Studio UX pass (review/approval flow clarity + form validation).

## New Intake (2026-02-11)
- [x] Rebuild compact flow mode as cascading selection flow (category -> template -> fields) with no forced first-template auto-selection.
- [x] Cascading flow behavior: selecting category/template auto-focuses next step and collapses previous (with "Aendern" re-open controls).
- [x] Client-side view history navigation added (`popstate` + app screen state), so browser back returns to previous app view.
- [x] Mobile navigation variant implemented as bottom tab bar for primary actions.
- [x] For rewrite-style text parameters, placeholder mode added ("Platzhalter statt Originaltext"), including token control.
- [ ] Dark mode refinement started: token palette updated + `system`/`dark` selector consistency improved; final visual tuning pass still pending.

## In Progress Now (UI/UX cycle)
- [ ] Visual QA pass for compact flow across all templates (desktop + mobile).
- [ ] Dark mode polish pass against latest mockups (contrast, spacing, panel hierarchy).
- [ ] End-to-end smoke test: compact flow + generation + preview + placeholder mode.

## Notes for Tomorrow
- The current UI is in a good state for supervisor testing.
- Highest risk right now is not functionality, but deployment/runtime verification and missing automated tests.
- If anything breaks after deploy, compare against tag `0.1-stableish` and roll back quickly.
