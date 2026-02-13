const { pool } = require('./pool');
const {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_GROUP_ROLE_BINDINGS,
} = require('../rbac/default-rbac');
const { getTemplateCatalog } = require('../catalog/template-catalog');

function slugify(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function findTemplateNode({ parentId = null, scope, ownerUserId = null, nodeKey }) {
  const result = await pool.query(
    `SELECT id
     FROM template_nodes
     WHERE COALESCE(parent_id, 0) = COALESCE($1::bigint, 0)
       AND scope = $2
       AND COALESCE(owner_user_id, '') = COALESCE($3::text, '')
       AND node_key = $4
       AND is_archived = FALSE
     LIMIT 1`,
    [parentId, scope, ownerUserId, nodeKey]
  );
  return result.rows[0]?.id || null;
}

async function ensureTemplateNode({
  parentId = null,
  scope,
  ownerUserId = null,
  nodeType,
  displayName,
  description = '',
  reviewState = 'approved',
  isSystem = false,
}) {
  const nodeKey = slugify(displayName) || 'node';
  const existingId = await findTemplateNode({ parentId, scope, ownerUserId, nodeKey });
  if (existingId) return existingId;

  const inserted = await pool.query(
    `INSERT INTO template_nodes
       (parent_id, owner_user_id, scope, review_state, node_type, node_key, display_name, description, is_system)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [parentId, ownerUserId, scope, reviewState, nodeType, nodeKey, displayName, description, isSystem]
  );
  return inserted.rows[0].id;
}

async function ensureTemplateVersion({
  templateId,
  requiredBaseFields = [],
  optionalBaseFields = [],
  dynamicFields = [],
  tags = [],
  promptMode = 'schema',
  basePrompt = '',
  taxonomyPath = [],
  createdBy = 'system_seed',
  changeNote = 'Initial seed import',
}) {
  const versionResult = await pool.query(
    `SELECT COALESCE(MAX(version_no), 0) AS max_version
     FROM template_versions
     WHERE template_id = $1`,
    [templateId]
  );
  const versionNo = Number(versionResult.rows[0]?.max_version || 0) + 1;
  const insert = await pool.query(
    `INSERT INTO template_versions
       (template_id, version_no, base_prompt, prompt_mode, taxonomy_path, required_base_fields, optional_base_fields, dynamic_fields, tags, change_note, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING id`,
    [
      templateId,
      versionNo,
      basePrompt || '',
      promptMode || 'schema',
      JSON.stringify(Array.isArray(taxonomyPath) ? taxonomyPath : []),
      JSON.stringify(Array.isArray(requiredBaseFields) ? requiredBaseFields : []),
      JSON.stringify(Array.isArray(optionalBaseFields) ? optionalBaseFields : []),
      JSON.stringify(Array.isArray(dynamicFields) ? dynamicFields : []),
      JSON.stringify(Array.isArray(tags) ? tags : []),
      changeNote,
      createdBy,
    ]
  );

  await pool.query(
    `UPDATE template_records
     SET active_version_id = $1, updated_at = NOW()
     WHERE id = $2`,
    [insert.rows[0].id, templateId]
  );

  return insert.rows[0].id;
}

async function seedTemplateCatalogDefaults() {
  const catalog = getTemplateCatalog();
  const categories = catalog.categories || {};

  for (const [categoryName, category] of Object.entries(categories)) {
    const categoryNodeId = await ensureTemplateNode({
      parentId: null,
      scope: 'official',
      ownerUserId: null,
      nodeType: 'category',
      displayName: category.title || categoryName,
      description: category.description || '',
      reviewState: 'approved',
      isSystem: true,
    });

    const subcategories = Array.isArray(category.unterkategorien) ? category.unterkategorien : [];
    for (const subcategoryName of subcategories) {
      const templateDef = category.templates?.[subcategoryName] || {};
      const subNodeId = await ensureTemplateNode({
        parentId: categoryNodeId,
        scope: 'official',
        ownerUserId: null,
        nodeType: 'subcategory',
        displayName: subcategoryName,
        description: templateDef.description || '',
        reviewState: 'approved',
        isSystem: true,
      });

      const templateUid = String(templateDef.id || `${slugify(categoryName)}-${slugify(subcategoryName)}`).slice(0, 160);
      const existingTemplate = await pool.query(
        `SELECT id, active_version_id
         FROM template_records
         WHERE template_uid = $1`,
        [templateUid]
      );
      if (existingTemplate.rowCount) continue;

      const insertTemplate = await pool.query(
        `INSERT INTO template_records
           (template_uid, node_id, owner_user_id, scope, review_state, title, description, profile, prompt_mode, is_system)
         VALUES ($1,$2,NULL,'official','approved',$3,$4,$5,$6,TRUE)
         RETURNING id`,
        [
          templateUid,
          subNodeId,
          subcategoryName,
          templateDef.description || category.description || '',
          templateDef.profile || 'unterrichtsnah',
          templateDef.promptMode || (templateDef.basePrompt ? 'custom' : 'schema'),
        ]
      );
      const templateId = insertTemplate.rows[0].id;

      await ensureTemplateVersion({
        templateId,
        requiredBaseFields: templateDef.requiredBaseFields || ['fach', 'schulstufe', 'ziel'],
        optionalBaseFields: templateDef.optionalBaseFields || ['zeitrahmen', 'niveau', 'rahmen', 'ergebnisformat', 'ton', 'rueckfragen'],
        dynamicFields: templateDef.dynamicFields || [],
        tags: templateDef.tags || [],
        promptMode: templateDef.promptMode || (templateDef.basePrompt ? 'custom' : 'schema'),
        basePrompt: templateDef.basePrompt || '',
        taxonomyPath: templateDef.taxonomyPath || [categoryName, subcategoryName],
        createdBy: 'system_seed',
        changeNote: 'Initial official seed import',
      });
    }
  }
}

const LEGACY_ROLE_KEY_RENAMES = [
  { oldKey: 'template_reviewers', newKey: 'prompt_creator_template_reviewers' },
  { oldKey: 'template_curators', newKey: 'prompt_creator_template_curators' },
  { oldKey: 'platform_admins', newKey: 'prompt_creator_platform_admins' },
];

const LEGACY_GROUP_NAME_RENAMES = [
  { oldGroup: 'template_reviewers', newGroup: 'prompt_creator_template_reviewers' },
  { oldGroup: 'template_curators', newGroup: 'prompt_creator_template_curators' },
  { oldGroup: 'platform_admins', newGroup: 'prompt_creator_platform_admins' },
];

const DEFAULT_PROVIDER_MODEL_CATALOG = {
  openai: [
    'gpt-5.2',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-5.2-codex',
    'gpt-5.2-pro',
  ],
  anthropic: [
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-opus-4-5',
  ],
  google: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
  ],
  mistral: [
    'mistral-large-2512',
    'mistral-medium-2508',
    'mistral-small-2506',
    'ministral-14b-2512',
    'ministral-8b-2512',
    'ministral-3b-2512',
    'codestral-2508',
    'devstral-2512',
  ],
  custom: [],
};

async function migrateLegacyRoleKeys() {
  for (const { oldKey, newKey } of LEGACY_ROLE_KEY_RENAMES) {
    const oldRoleResult = await pool.query('SELECT id FROM rbac_roles WHERE role_key = $1', [oldKey]);
    const newRoleResult = await pool.query('SELECT id FROM rbac_roles WHERE role_key = $1', [newKey]);
    const oldRoleId = oldRoleResult.rows[0]?.id || null;
    const newRoleId = newRoleResult.rows[0]?.id || null;

    if (!oldRoleId) continue;

    if (!newRoleId) {
      await pool.query(
        `UPDATE rbac_roles
         SET role_key = $1, updated_at = NOW()
         WHERE id = $2`,
        [newKey, oldRoleId]
      );
      continue;
    }

    await pool.query(
      `INSERT INTO rbac_role_permissions (role_id, permission_id)
       SELECT $1, permission_id
       FROM rbac_role_permissions
       WHERE role_id = $2
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [newRoleId, oldRoleId]
    );
    await pool.query(
      `INSERT INTO rbac_group_role_bindings (group_name, role_id)
       SELECT group_name, $1
       FROM rbac_group_role_bindings
       WHERE role_id = $2
       ON CONFLICT (group_name, role_id) DO NOTHING`,
      [newRoleId, oldRoleId]
    );
    await pool.query('DELETE FROM rbac_group_role_bindings WHERE role_id = $1', [oldRoleId]);
    await pool.query('DELETE FROM rbac_roles WHERE id = $1', [oldRoleId]);
  }
}

async function migrateLegacyGroupBindings() {
  for (const { oldGroup, newGroup } of LEGACY_GROUP_NAME_RENAMES) {
    const oldBindings = await pool.query(
      `SELECT role_id
       FROM rbac_group_role_bindings
       WHERE LOWER(group_name) = LOWER($1)`,
      [oldGroup]
    );
    if (!oldBindings.rowCount) continue;

    for (const row of oldBindings.rows) {
      await pool.query(
        `INSERT INTO rbac_group_role_bindings (group_name, role_id)
         VALUES ($1, $2)
         ON CONFLICT (group_name, role_id) DO NOTHING`,
        [newGroup, row.role_id]
      );
    }
    await pool.query(
      `DELETE FROM rbac_group_role_bindings
       WHERE LOWER(group_name) = LOWER($1)`,
      [oldGroup]
    );
  }
}

async function seedProviderModelCatalogDefaults() {
  for (const [providerKind, models] of Object.entries(DEFAULT_PROVIDER_MODEL_CATALOG)) {
    for (const model of models) {
      await pool.query(
        `INSERT INTO provider_model_pricing_catalog
           (provider_kind, model, input_price_per_million, output_price_per_million, currency, is_active, created_by, updated_by)
         VALUES ($1,$2,NULL,NULL,'USD',TRUE,'system_seed','system_seed')
         ON CONFLICT (provider_kind, model)
         DO NOTHING`,
        [providerKind, model]
      );
    }
  }
}

async function seedRbacDefaults() {
  for (const permission of DEFAULT_PERMISSIONS) {
    await pool.query(
      `INSERT INTO rbac_permissions (permission_key, description)
       VALUES ($1, $2)
       ON CONFLICT (permission_key)
       DO UPDATE SET description = EXCLUDED.description`,
      [permission.key, permission.description]
    );
  }

  await migrateLegacyRoleKeys();
  await migrateLegacyGroupBindings();

  for (const role of DEFAULT_ROLES) {
    await pool.query(
      `INSERT INTO rbac_roles (role_key, role_name, description, is_system)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (role_key)
       DO UPDATE SET
         role_name = EXCLUDED.role_name,
         description = EXCLUDED.description`,
      [role.key, role.name, role.description, role.system]
    );
  }

  for (const role of DEFAULT_ROLES) {
    const roleResult = await pool.query('SELECT id FROM rbac_roles WHERE role_key = $1', [role.key]);
    const roleId = roleResult.rows[0]?.id;
    if (!roleId) continue;

    for (const permissionKey of role.permissions) {
      await pool.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         SELECT $1, p.id
         FROM rbac_permissions p
         WHERE p.permission_key = $2
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleId, permissionKey]
      );
    }
  }

  for (const binding of DEFAULT_GROUP_ROLE_BINDINGS) {
    await pool.query(
      `INSERT INTO rbac_group_role_bindings (group_name, role_id)
       SELECT $1, r.id
       FROM rbac_roles r
       WHERE r.role_key = $2
       ON CONFLICT (group_name, role_id) DO NOTHING`,
      [binding.groupName, binding.roleKey]
    );
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS providers (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT,
      base_url_mode TEXT NOT NULL DEFAULT 'custom',
      pricing_mode TEXT NOT NULL DEFAULT 'catalog',
      input_price_per_million NUMERIC(14,8),
      output_price_per_million NUMERIC(14,8),
      key_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, provider_id)
    );
  `);

  await pool.query(`
    ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS base_url_mode TEXT
  `);
  await pool.query(`
    ALTER TABLE providers
    ALTER COLUMN base_url_mode SET DEFAULT 'custom'
  `);
  await pool.query(`
    UPDATE providers
    SET base_url_mode = 'custom'
    WHERE base_url_mode IS NULL
  `);
  await pool.query(`
    ALTER TABLE providers
    ALTER COLUMN base_url_mode SET NOT NULL
  `);
  await pool.query(`
    ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS pricing_mode TEXT
  `);
  await pool.query(`
    ALTER TABLE providers
    ALTER COLUMN pricing_mode SET DEFAULT 'catalog'
  `);
  await pool.query(`
    UPDATE providers
    SET pricing_mode = 'catalog'
    WHERE pricing_mode IS NULL
  `);
  await pool.query(`
    ALTER TABLE providers
    ALTER COLUMN pricing_mode SET NOT NULL
  `);
  await pool.query(`
    ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS input_price_per_million NUMERIC(14,8)
  `);
  await pool.query(`
    ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS output_price_per_million NUMERIC(14,8)
  `);
  await pool.query(`
    ALTER TABLE providers
    ALTER COLUMN key_meta SET DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    UPDATE providers
    SET key_meta = '{}'::jsonb
    WHERE key_meta IS NULL
  `);
  await pool.query(`
    ALTER TABLE providers
    ALTER COLUMN key_meta SET NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_history (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      fach TEXT NOT NULL,
      handlungsfeld TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_library (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description_text TEXT,
      prompt_text TEXT NOT NULL,
      fach TEXT NOT NULL,
      handlungsfeld TEXT NOT NULL,
      unterkategorie TEXT NOT NULL,
      template_id TEXT,
      provider_kind TEXT,
      provider_model TEXT,
      generation_mode TEXT NOT NULL DEFAULT 'prompt' CHECK (generation_mode IN ('prompt', 'result')),
      form_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      metaprompt_text TEXT,
      result_text TEXT,
      has_result BOOLEAN NOT NULL DEFAULT FALSE,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS description_text TEXT
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS template_id TEXT
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS provider_kind TEXT
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS provider_model TEXT
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'prompt'
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS form_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS metaprompt_text TEXT
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS result_text TEXT
  `);
  await pool.query(`
    ALTER TABLE prompt_library
    ADD COLUMN IF NOT EXISTS has_result BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_library_ratings (
      id BIGSERIAL PRIMARY KEY,
      library_id BIGINT NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(library_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_model_pricing_catalog (
      id BIGSERIAL PRIMARY KEY,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      input_price_per_million NUMERIC(14,8) CHECK (input_price_per_million >= 0),
      output_price_per_million NUMERIC(14,8) CHECK (output_price_per_million >= 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL DEFAULT 'system',
      updated_by TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider_kind, model)
    );
  `);
  await pool.query(`
    ALTER TABLE provider_model_pricing_catalog
    ALTER COLUMN input_price_per_million DROP NOT NULL
  `);
  await pool.query(`
    ALTER TABLE provider_model_pricing_catalog
    ALTER COLUMN output_price_per_million DROP NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_usage_audit (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      key_source TEXT NOT NULL,
      template_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_generation_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_groups_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      provider_id TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      provider_model TEXT,
      key_fingerprint TEXT,
      effective_key_type TEXT NOT NULL DEFAULT 'user' CHECK (effective_key_type IN ('user', 'system', 'shared_test')),
      effective_key_id TEXT,
      template_id TEXT NOT NULL,
      success BOOLEAN NOT NULL DEFAULT FALSE,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      input_cost_usd NUMERIC(14,8),
      output_cost_usd NUMERIC(14,8),
      total_cost_usd NUMERIC(14,8),
      pricing_source TEXT,
      pricing_input_per_million NUMERIC(14,8),
      pricing_output_per_million NUMERIC(14,8),
      error_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS provider_model TEXT
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS user_groups_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS key_fingerprint TEXT
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS effective_key_type TEXT NOT NULL DEFAULT 'user'
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS effective_key_id TEXT
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS completion_tokens INTEGER
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS total_tokens INTEGER
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS input_cost_usd NUMERIC(14,8)
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS output_cost_usd NUMERIC(14,8)
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(14,8)
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS pricing_source TEXT
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS pricing_input_per_million NUMERIC(14,8)
  `);
  await pool.query(`
    ALTER TABLE provider_generation_events
    ADD COLUMN IF NOT EXISTS pricing_output_per_million NUMERIC(14,8)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_favorites (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      template_uid TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, template_uid)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_provider_keys (
      id BIGSERIAL PRIMARY KEY,
      system_key_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      model_hint TEXT,
      base_url TEXT,
      key_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_key_assignments (
      id BIGSERIAL PRIMARY KEY,
      system_key_id TEXT NOT NULL REFERENCES system_provider_keys(system_key_id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'role', 'group')),
      scope_value TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(system_key_id, scope_type, scope_value)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budget_policies (
      id BIGSERIAL PRIMARY KEY,
      owner_user_id TEXT,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('key', 'user', 'group')),
      scope_value TEXT NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
      limit_usd NUMERIC(14,8) NOT NULL CHECK (limit_usd >= 0),
      mode TEXT NOT NULL DEFAULT 'hybrid' CHECK (mode IN ('soft', 'hard', 'hybrid')),
      warning_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.9000 CHECK (warning_ratio >= 0.1000 AND warning_ratio <= 1.0000),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(scope_type, scope_value, period)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budget_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      policy_id BIGINT REFERENCES budget_policies(id) ON DELETE SET NULL,
      scope_type TEXT NOT NULL,
      scope_value TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('warn', 'block')),
      message TEXT NOT NULL,
      projected_cost_usd NUMERIC(14,8),
      current_spend_usd NUMERIC(14,8),
      limit_usd NUMERIC(14,8),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_nodes (
      id BIGSERIAL PRIMARY KEY,
      parent_id BIGINT REFERENCES template_nodes(id) ON DELETE CASCADE,
      owner_user_id TEXT,
      scope TEXT NOT NULL CHECK (scope IN ('official', 'personal', 'community')),
      review_state TEXT NOT NULL DEFAULT 'approved' CHECK (review_state IN ('draft', 'submitted', 'approved', 'rejected')),
      node_type TEXT NOT NULL CHECK (node_type IN ('category', 'subcategory', 'group')),
      node_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_records (
      id BIGSERIAL PRIMARY KEY,
      template_uid TEXT NOT NULL UNIQUE,
      node_id BIGINT NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
      owner_user_id TEXT,
      scope TEXT NOT NULL CHECK (scope IN ('official', 'personal', 'community')),
      review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'submitted', 'approved', 'rejected')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      profile TEXT NOT NULL DEFAULT 'unterrichtsnah',
      prompt_mode TEXT NOT NULL DEFAULT 'schema' CHECK (prompt_mode IN ('schema', 'custom')),
      source_template_id BIGINT REFERENCES template_records(id) ON DELETE SET NULL,
      active_version_id BIGINT,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_versions (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES template_records(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      base_prompt TEXT NOT NULL DEFAULT '',
      prompt_mode TEXT NOT NULL DEFAULT 'schema' CHECK (prompt_mode IN ('schema', 'custom')),
      taxonomy_path JSONB NOT NULL DEFAULT '[]'::jsonb,
      required_base_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      optional_base_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      dynamic_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      change_note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(template_id, version_no)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_review_events (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES template_records(id) ON DELETE CASCADE,
      from_state TEXT,
      to_state TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      acted_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_tag_catalog (
      id BIGSERIAL PRIMARY KEY,
      tag_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_official BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_ratings (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES template_records(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(template_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rbac_permissions (
      id BIGSERIAL PRIMARY KEY,
      permission_key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rbac_roles (
      id BIGSERIAL PRIMARY KEY,
      role_key TEXT NOT NULL UNIQUE,
      role_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rbac_role_permissions (
      role_id BIGINT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      permission_id BIGINT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(role_id, permission_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rbac_group_role_bindings (
      id BIGSERIAL PRIMARY KEY,
      group_name TEXT NOT NULL,
      role_id BIGINT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(group_name, role_id)
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_prompt_library_user ON prompt_library(user_id, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_prompt_library_public ON prompt_library(is_public, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_prompt_library_template ON prompt_library(template_id, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_usage_user ON provider_usage_audit(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_generation_events_user ON provider_generation_events(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_generation_events_groups ON provider_generation_events USING GIN (user_groups_json)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_generation_events_provider ON provider_generation_events(provider_kind, success, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_generation_events_model ON provider_generation_events(provider_kind, provider_model, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_generation_events_keyfp ON provider_generation_events(user_id, key_fingerprint, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_generation_events_effective_key ON provider_generation_events(effective_key_type, effective_key_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_generation_events_cost ON provider_generation_events(user_id, total_cost_usd DESC, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_model_pricing_catalog_lookup ON provider_model_pricing_catalog(provider_kind, is_active, model)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_system_provider_keys_kind ON system_provider_keys(provider_kind, is_active, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_system_key_assignments_scope ON system_key_assignments(scope_type, LOWER(scope_value))');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_budget_policies_scope ON budget_policies(scope_type, LOWER(scope_value), period, is_active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_budget_events_user ON budget_events(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_favorites_user ON template_favorites(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_favorites_template ON template_favorites(template_uid)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rbac_group_name ON rbac_group_role_bindings(LOWER(group_name))');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_nodes_parent ON template_nodes(parent_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_nodes_scope_owner ON template_nodes(scope, owner_user_id, review_state, is_archived)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_nodes_lookup ON template_nodes(COALESCE(parent_id, 0), scope, COALESCE(owner_user_id, \'\'), node_key)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_records_scope_owner ON template_records(scope, owner_user_id, review_state, is_archived, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_records_node ON template_records(node_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id, version_no DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_template_tags_active ON template_tag_catalog(is_active, tag_key)');

  await seedProviderModelCatalogDefaults();
  await seedRbacDefaults();
  await seedTemplateCatalogDefaults();
}

module.exports = { initDb };
