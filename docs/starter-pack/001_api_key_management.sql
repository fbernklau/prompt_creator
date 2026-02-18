-- Starter pack migration: API key management + budgets + usage
-- Target: PostgreSQL 13+

BEGIN;

CREATE TABLE IF NOT EXISTS app_runtime_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_provider_keys (
  id BIGSERIAL PRIMARY KEY,
  system_key_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  model_hint TEXT,
  base_url TEXT,
  key_meta JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  budget_limit_usd NUMERIC(18, 6),
  budget_period TEXT NOT NULL DEFAULT 'monthly',
  budget_mode TEXT NOT NULL DEFAULT 'hybrid',
  budget_warning_ratio NUMERIC(6, 5) NOT NULL DEFAULT 0.9,
  budget_is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (provider_kind ~ '^[a-z0-9_-]+$'),
  CHECK (budget_period IN ('daily', 'weekly', 'monthly')),
  CHECK (budget_mode IN ('soft', 'hard', 'hybrid')),
  CHECK (budget_warning_ratio >= 0.1 AND budget_warning_ratio <= 1)
);

CREATE INDEX IF NOT EXISTS idx_system_provider_keys_provider
  ON system_provider_keys (provider_kind);

CREATE TABLE IF NOT EXISTS system_key_assignments (
  id BIGSERIAL PRIMARY KEY,
  system_key_id TEXT NOT NULL REFERENCES system_provider_keys(system_key_id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  budget_limit_usd NUMERIC(18, 6),
  budget_period TEXT NOT NULL DEFAULT 'monthly',
  budget_mode TEXT NOT NULL DEFAULT 'hybrid',
  budget_warning_ratio NUMERIC(6, 5) NOT NULL DEFAULT 0.9,
  budget_is_active BOOLEAN NOT NULL DEFAULT FALSE,
  per_user_budget_limit_usd NUMERIC(18, 6),
  per_user_budget_period TEXT NOT NULL DEFAULT 'monthly',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (scope_type IN ('global', 'user', 'role', 'group')),
  CHECK (budget_period IN ('daily', 'weekly', 'monthly')),
  CHECK (budget_mode IN ('soft', 'hard', 'hybrid')),
  CHECK (budget_warning_ratio >= 0.1 AND budget_warning_ratio <= 1),
  CHECK (per_user_budget_period IN ('daily', 'weekly', 'monthly'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_scope
  ON system_key_assignments (system_key_id, scope_type, lower(scope_value));

CREATE INDEX IF NOT EXISTS idx_assignments_lookup
  ON system_key_assignments (scope_type, lower(scope_value), is_active);

CREATE TABLE IF NOT EXISTS providers (
  provider_id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT,
  base_url_mode TEXT NOT NULL DEFAULT 'recommended',
  pricing_mode TEXT NOT NULL DEFAULT 'catalog',
  input_price_per_million NUMERIC(18, 6),
  output_price_per_million NUMERIC(18, 6),
  key_meta JSONB,
  system_key_id TEXT REFERENCES system_provider_keys(system_key_id),
  active_meta BOOLEAN NOT NULL DEFAULT FALSE,
  active_result BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (base_url_mode IN ('recommended', 'custom')),
  CHECK (pricing_mode IN ('catalog', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_providers_user ON providers (user_id);

CREATE TABLE IF NOT EXISTS provider_generation_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  provider_kind TEXT,
  provider_model TEXT,
  key_fingerprint TEXT,
  effective_key_type TEXT,
  effective_key_id TEXT,
  assignment_scope_type TEXT,
  assignment_scope_value TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(18, 6),
  user_groups_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (stage IN ('metaprompt', 'result')),
  CHECK (effective_key_type IN ('personal', 'system', 'shared') OR effective_key_type IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_generation_user_created
  ON provider_generation_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_key_window
  ON provider_generation_events (effective_key_type, effective_key_id, created_at DESC);

-- Seed global system-key settings row if missing.
INSERT INTO app_runtime_settings (setting_key, setting_value_json, updated_by)
VALUES (
  'system_keys',
  jsonb_build_object(
    'enabled', true,
    'globalBudgetIsActive', false,
    'globalBudgetLimitUsd', NULL,
    'globalBudgetPeriod', 'monthly',
    'globalBudgetMode', 'hybrid',
    'globalBudgetWarningRatio', 0.9
  ),
  'migration'
)
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
