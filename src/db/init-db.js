const { pool } = require('./pool');
const {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_GROUP_ROLE_BINDINGS,
} = require('../rbac/default-rbac');

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
      prompt_text TEXT NOT NULL,
      fach TEXT NOT NULL,
      handlungsfeld TEXT NOT NULL,
      unterkategorie TEXT NOT NULL,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
  await pool.query('CREATE INDEX IF NOT EXISTS idx_provider_usage_user ON provider_usage_audit(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rbac_group_name ON rbac_group_role_bindings(LOWER(group_name))');

  await seedRbacDefaults();
}

module.exports = { initDb };
