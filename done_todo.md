# Prompt Creator - Done / TODO Tracker

Last updated: 2026-02-12
Owner: Team + Codex

## Purpose
- Keep durable in-repo project memory.
- Track what is implemented vs still open.
- Reduce context loss between sessions.

## Current Snapshot
- Branch: `main`
- HEAD commit: `7b6b0af1da6c4627a883208548bfd36d4179b9bb`
- HEAD message: `Description visibility fix`
- Stable tags: `0.1-stableish` -> `acee376`, `stable-0.3` -> current mainline snapshot
- Working tree: dirty (Dashboard user-menu refactor in progress)

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
- [x] Default 4-role model seeded (`teachers`, `prompt_creator_template_reviewers`, `prompt_creator_template_curators`, `prompt_creator_platform_admins`).
- [x] App-local roles can be created and managed in admin UI (future extensibility).

### Provider management + security
- [x] Provider presets and recommended base URL lock/unlock implemented.
- [x] Provider model selector supports predefined models + custom entry.
- [x] Provider model catalog now supports dynamic server-side additions (admin-managed entries merged with built-ins).
- [x] Provider connectivity test endpoint + UI implemented.
- [x] API keys encrypted server-side at rest (AES-GCM envelope), plaintext never returned to browser.
- [x] Optional shared Gemini test key flow via `.env` allowlists implemented.
- [x] Stage-specific provider assignment persisted in user settings (`metapromptProviderId`, `resultProviderId`).
- [x] Prompt generation now resolves provider from `metapromptProviderId` (fallback to previous active provider logic).
- [x] Result mode setting persisted in user settings (`resultModeEnabled`, default `false`).

### Prompt generation pipeline
- [x] End-to-end flow implemented: template -> fields -> metaprompt -> provider -> handoff prompt.
- [x] Provider integrations implemented (`openai`, `anthropic`, `google`, `mistral`).
- [x] Prompt-only guardrail implemented (`handoff_prompt` parse/repair flow).
- [x] Metaprompt preview endpoint and editable preview UI implemented.
- [x] User can choose edited preview as generation input (`metapromptOverride`).
- [x] Usage audit + generation analytics logging implemented.
- [x] Generation events now track provider model, key fingerprint, token usage and estimated USD costs.
- [x] Multi-call generation accounting included (main call + repair/privacy repair calls accumulate usage/cost).

### Pricing + cost analytics
- [x] DB schema extended for provider pricing mode (`catalog`/`custom`) and per-provider custom input/output pricing.
- [x] Admin pricing catalog implemented (CRUD + active/inactive) for provider/model input+output cost per 1M tokens.
- [x] Admin area restructured with tabs (`Rollen & Berechtigungen`, `Authentik Zuordnung`, `Model Administration`) to reduce overload.
- [x] Model Administration now acts as master record for provider model selection in API-Provider sidebar.
- [x] Provider form supports pricing mode switch + custom input/output prices.
- [x] Usage dashboard extended with total tokens, total cost, per-provider cost/tokens and key-fingerprint usage overview.
- [x] Pricing row save now persists correctly to DB and survives reload.
- [x] Inline pricing rows support fast save flow (incl. keyboard/Enter path and visible save feedback).
- [x] Usage view includes input/output token split (instead of only aggregate totals).

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
- [x] Home search and tag-result rendering fixed (results now actually filter/show).
- [x] Additive tag intersection filter working in discovery flow.
- [x] Subcategory view toggle now supports both grid and list mode.
- [x] Template form header now shows template description/long description reliably.
- [x] Dashboard information architecture started: Dashboard now structured as user center with tabs (`API-Provider`, `Usage Stats`, `Optionen`).
- [x] Navigation behavior updated: topbar/mobile `API-Provider` and `Optionen` open Dashboard tab context instead of standalone drawer entrypoints.

### Template content refresh
- [x] First-category content refresh applied (Paedagogische Planung family).
- [x] New template added: `Unterrichtssequenz` (with required/optional field model and helper texts).
- [x] Category/subcategory short descriptions aligned with mockup-style discovery cards.

## Partially Done / Needs Follow-up
- [ ] Full Docker + Authentik + provider smoke test against real `.env` on VPS still pending.
- [ ] Privacy policy is strong, but not yet strict hard-fail mode (currently sanitize/repair fallback).
- [ ] Template Studio UX still needs extra guardrails (validation clarity, safer official edit flow, clearer review transitions).
- [ ] Pricing accuracy depends on maintained catalog values (admin needs to keep model prices current).
- [ ] Token accounting currently uses provider usage metadata, with local fallback estimation if provider usage is missing.
- [ ] Full per-template content QA still pending for all remaining categories (required/optional fields + placeholder/help text quality).
- [ ] Stage-specific assignment is stored and selectable, but `resultProviderId` is not executed yet until Result-Modus is implemented.

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
- [ ] Step 1: Finalize Dashboard user-menu refactor and visual QA (providers/options embedded, no drawer regressions).
- [x] Step 2: Add stage-specific provider assignment model (`metapromptProviderId`, `resultProviderId`) while keeping `Prompt-only` as default mode.
- [x] Step 3: Add user mode toggle (`Prompt-only` default, `Direktes Ergebnis` optional beta) in Optionen.
- [ ] Step 4: Add clearer generation status pipeline (metaprompt build -> provider call -> post-process -> done).
- [ ] Step 5: Implement streaming generation UX (switch to result screen immediately and stream partial output).
- [ ] Step 6: Continue template-content QA category-by-category (required/optional fields, descriptions, placeholders/help texts).
- [ ] Step 7: Dark mode polish pass vs mockups (contrast, spacing, panel hierarchy, legacy style cleanup).
- [ ] Step 8: Deploy current `main` to VPS and run full smoke test with real `.env`, then provider sanity matrix + pricing validation.
- [ ] Step 9: Add migration baseline + integration/regression tests (privacy, generation parser, stream fallbacks).

## New Intake (2026-02-11)
- [x] Rebuild compact flow mode as cascading selection flow (category -> template -> fields) with no forced first-template auto-selection.
- [x] Cascading flow behavior: selecting category/template auto-focuses next step and collapses previous (with "Aendern" re-open controls).
- [x] Client-side view history navigation added (`popstate` + app screen state), so browser back returns to previous app view.
- [x] Mobile navigation variant implemented as bottom tab bar for primary actions.
- [x] For rewrite-style text parameters, placeholder mode added ("Platzhalter statt Originaltext"), including token control.
- [ ] Dark mode refinement started: token palette updated + `system`/`dark` selector consistency improved; final visual tuning pass still pending.

## In Progress Now (UI/UX cycle)
- [ ] Dashboard as user control center: tab flow and nav consistency pass.
- [ ] Visual QA pass for compact flow across all templates (desktop + mobile).
- [ ] Per-template content consistency pass (field semantics + UX text quality).
- [ ] End-to-end smoke test: compact flow + generation + preview + placeholder mode.

## New Intake (2026-02-12)
- [ ] Streaming response UX for prompt generation (show live progress/output while generation runs).
- [ ] Optional direct result mode (`Prompt-only` remains default): template -> metaprompt model -> result model.
- [ ] Dashboard ownership of user controls confirmed:
- [ ] Tab 1: API-Provider (with `Metaprompt-Model`/`Result-Model` subtabs).
- [ ] Tab 2: Usage Stats.
- [ ] Tab 3: Optionen.

## Notes for Tomorrow
- Current UX baseline is stable and much closer to mockups; main open work is content quality + dark mode finish.
- Highest risk remains deployment/runtime verification and missing automated regression tests.
- Rollback anchors available: `stable-0.3` (newer) and `0.1-stableish` (older fallback).
