const { Router } = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { config } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { encryptApiKey, hasServerEncryptedKey } = require('../security/key-encryption');

function normalizeRoleKey(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function normalizePermissionKey(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function parseNonNegativeNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return normalized;
}

function normalizeSystemScopeType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'user' || normalized === 'role' || normalized === 'group' || normalized === 'global') return normalized;
  return '';
}

function normalizeBudgetScopeType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'key' || normalized === 'user' || normalized === 'group') return normalized;
  return '';
}

function normalizeBudgetPeriod(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') return normalized;
  return '';
}

function normalizeBudgetMode(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'soft' || normalized === 'hard' || normalized === 'hybrid') return normalized;
  return 'hybrid';
}

function parseWarningRatio(value) {
  if (value === null || value === undefined || value === '') return 0.9;
  const normalized = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(normalized)) return 0.9;
  return Math.min(Math.max(normalized, 0.1), 1);
}

function normalizeScopeValue(scopeType, scopeValue) {
  const raw = String(scopeValue || '').trim();
  if (scopeType === 'global') return '*';
  if (!raw) return '';
  if (scopeType === 'key') return raw;
  return raw.toLowerCase();
}

function normalizeSystemKeyId(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  if (raw) return raw;
  return `sys_${crypto.randomUUID().slice(0, 12)}`;
}

function periodToIntervalLiteral(period = '') {
  if (period === 'daily') return '1 day';
  if (period === 'weekly') return '7 days';
  return '30 days';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeOptionalBudgetPayload(payload = {}) {
  const budgetLimitUsd = parseNonNegativeNumberOrNull(payload?.budgetLimitUsd);
  const budgetPeriod = normalizeBudgetPeriod(payload?.budgetPeriod || 'monthly') || 'monthly';
  const budgetMode = normalizeBudgetMode(payload?.budgetMode || 'hybrid');
  const budgetWarningRatio = parseWarningRatio(payload?.budgetWarningRatio);
  const budgetIsActive = payload?.budgetIsActive === undefined
    ? budgetLimitUsd !== null
    : Boolean(payload.budgetIsActive);
  if (budgetIsActive && budgetLimitUsd === null) {
    return { error: 'Budget-Limit ist erforderlich, wenn Budget aktiv ist.' };
  }
  return {
    budgetLimitUsd,
    budgetPeriod,
    budgetMode,
    budgetWarningRatio,
    budgetIsActive,
  };
}

function normalizeOptionalPerUserBudgetPayload(payload = {}) {
  const perUserBudgetLimitUsd = parseNonNegativeNumberOrNull(payload?.perUserBudgetLimitUsd);
  const perUserBudgetPeriod = normalizeBudgetPeriod(payload?.perUserBudgetPeriod || payload?.budgetPeriod || 'monthly') || 'monthly';
  return {
    perUserBudgetLimitUsd,
    perUserBudgetPeriod,
  };
}

function normalizeSystemKeySettings(raw = {}) {
  const globalBudgetLimitUsd = parseNonNegativeNumberOrNull(raw?.globalBudgetLimitUsd);
  const globalBudgetPeriod = normalizeBudgetPeriod(raw?.globalBudgetPeriod || 'monthly') || 'monthly';
  const globalBudgetMode = normalizeBudgetMode(raw?.globalBudgetMode || 'hybrid');
  const globalBudgetWarningRatio = parseWarningRatio(raw?.globalBudgetWarningRatio);
  const enabled = raw?.enabled === undefined ? true : Boolean(raw.enabled);
  const welcomeFlowEnabled = raw?.welcomeFlowEnabled === undefined ? true : Boolean(raw.welcomeFlowEnabled);
  const globalBudgetIsActiveRaw = raw?.globalBudgetIsActive;
  let globalBudgetIsActive = globalBudgetIsActiveRaw === undefined
    ? globalBudgetLimitUsd !== null
    : Boolean(globalBudgetIsActiveRaw);
  if (globalBudgetLimitUsd === null) globalBudgetIsActive = false;
  return {
    enabled,
    welcomeFlowEnabled,
    globalBudgetIsActive,
    globalBudgetLimitUsd,
    globalBudgetPeriod,
    globalBudgetMode,
    globalBudgetWarningRatio,
  };
}

async function getSystemKeySettings() {
  const result = await pool.query(
    `SELECT setting_value_json
     FROM app_runtime_settings
     WHERE setting_key = 'system_keys'`
  );
  if (!result.rowCount) {
    return normalizeSystemKeySettings({});
  }
  return normalizeSystemKeySettings(result.rows[0]?.setting_value_json || {});
}

async function setSystemKeySettings(partial = {}, updatedBy = 'system') {
  const current = await getSystemKeySettings();
  const next = normalizeSystemKeySettings({
    ...current,
    ...(partial || {}),
  });
  await pool.query(
    `INSERT INTO app_runtime_settings (setting_key, setting_value_json, updated_by, updated_at)
     VALUES ('system_keys', $1::jsonb, $2, NOW())
     ON CONFLICT (setting_key)
     DO UPDATE SET
       setting_value_json = EXCLUDED.setting_value_json,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [JSON.stringify(next), String(updatedBy || 'system')]
  );
  return next;
}

async function resolveGlobalSystemUsage(period = 'monthly') {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_count,
       COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
     FROM provider_generation_events
     WHERE effective_key_type = 'system'
       AND created_at >= NOW() - ($1::interval)`,
    [periodToIntervalLiteral(period)]
  );
  return {
    totalCount: Number(result.rows[0]?.total_count || 0),
    spendUsd: Number(result.rows[0]?.spend_usd || 0),
  };
}

async function resolveSystemKeyUsage(systemKeyId, period = 'monthly') {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_count,
       COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
     FROM provider_generation_events
     WHERE effective_key_type = 'system'
       AND effective_key_id = $1
       AND created_at >= NOW() - ($2::interval)`,
    [systemKeyId, periodToIntervalLiteral(period)]
  );
  return {
    totalCount: Number(result.rows[0]?.total_count || 0),
    spendUsd: Number(result.rows[0]?.spend_usd || 0),
  };
}

async function resolveAssignmentUsage({ systemKeyId, scopeType, scopeValue, period = 'monthly' }) {
  const intervalLiteral = periodToIntervalLiteral(period);
  if (scopeType === 'user') {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_count,
         COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE effective_key_type = 'system'
         AND effective_key_id = $1
         AND LOWER(user_id) = LOWER($2)
         AND created_at >= NOW() - ($3::interval)`,
      [systemKeyId, scopeValue, intervalLiteral]
    );
    return {
      totalCount: Number(result.rows[0]?.total_count || 0),
      spendUsd: Number(result.rows[0]?.spend_usd || 0),
    };
  }

  if (scopeType === 'group') {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_count,
         COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE effective_key_type = 'system'
         AND effective_key_id = $1
         AND user_groups_json ? $2
         AND created_at >= NOW() - ($3::interval)`,
      [systemKeyId, String(scopeValue || '').toLowerCase(), intervalLiteral]
    );
    return {
      totalCount: Number(result.rows[0]?.total_count || 0),
      spendUsd: Number(result.rows[0]?.spend_usd || 0),
    };
  }

  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_count,
       COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
     FROM provider_generation_events
     WHERE effective_key_type = 'system'
       AND effective_key_id = $1
       AND user_roles_json ? $2
       AND created_at >= NOW() - ($3::interval)`,
    [systemKeyId, String(scopeValue || '').toLowerCase(), intervalLiteral]
  );
  return {
    totalCount: Number(result.rows[0]?.total_count || 0),
    spendUsd: Number(result.rows[0]?.spend_usd || 0),
  };
}

async function resolveAccessForGroups(groups = []) {
  const normalizedGroups = normalizeStringList(groups).map((group) => group.toLowerCase());
  if (!normalizedGroups.length) {
    return { roles: [], permissions: [] };
  }
  const result = await pool.query(
    `SELECT DISTINCT r.role_key, p.permission_key
     FROM rbac_group_role_bindings b
     JOIN rbac_roles r ON r.id = b.role_id
     JOIN rbac_role_permissions rp ON rp.role_id = r.id
     JOIN rbac_permissions p ON p.id = rp.permission_id
     WHERE LOWER(b.group_name) = ANY($1::text[])`,
    [normalizedGroups]
  );
  const roleSet = new Set();
  const permissionSet = new Set();
  result.rows.forEach((row) => {
    if (row.role_key) roleSet.add(String(row.role_key));
    if (row.permission_key) permissionSet.add(String(row.permission_key));
  });
  return {
    roles: [...roleSet].sort((a, b) => a.localeCompare(b)),
    permissions: [...permissionSet].sort((a, b) => a.localeCompare(b)),
  };
}

function createAdminRouter() {
  const router = Router();
  const guard = [authMiddleware, accessMiddleware, requirePermission('rbac.manage')];
  const pricingGuard = [authMiddleware, accessMiddleware, requirePermission('pricing.manage')];
  const systemKeyGuard = [authMiddleware, accessMiddleware, requirePermission('providers.system_keys.manage')];
  const budgetGuard = [authMiddleware, accessMiddleware, requirePermission('budgets.manage')];

  router.get('/admin/permissions', ...guard, asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT id, permission_key, description
       FROM rbac_permissions
       ORDER BY permission_key ASC`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      key: row.permission_key,
      description: row.description,
    })));
  }));

  router.post('/admin/permissions', ...guard, asyncHandler(async (req, res) => {
    const key = normalizePermissionKey(req.body?.key || '');
    const description = String(req.body?.description || '').trim();
    if (!key) return res.status(400).json({ error: 'permission key is required.' });

    const result = await pool.query(
      `INSERT INTO rbac_permissions (permission_key, description)
       VALUES ($1,$2)
       ON CONFLICT (permission_key) DO NOTHING
       RETURNING id`,
      [key, description]
    );
    if (!result.rowCount) {
      return res.status(409).json({ error: 'Permission key already exists.' });
    }
    res.json({ ok: true, id: result.rows[0].id, key });
  }));

  router.get('/admin/roles', ...guard, asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT
         r.id,
         r.role_key,
         r.role_name,
         r.description,
         r.is_system,
         COALESCE(array_agg(p.permission_key ORDER BY p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL), '{}') AS permission_keys
       FROM rbac_roles r
       LEFT JOIN rbac_role_permissions rp ON rp.role_id = r.id
       LEFT JOIN rbac_permissions p ON p.id = rp.permission_id
       GROUP BY r.id
       ORDER BY r.role_key ASC`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      roleKey: row.role_key,
      roleName: row.role_name,
      description: row.description,
      isSystem: row.is_system,
      permissionKeys: row.permission_keys || [],
    })));
  }));

  router.post('/admin/roles', ...guard, asyncHandler(async (req, res) => {
    const roleKey = normalizeRoleKey(req.body?.roleKey || req.body?.roleName || '');
    const roleName = String(req.body?.roleName || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!roleKey || !roleName) {
      return res.status(400).json({ error: 'roleKey and roleName are required.' });
    }

    const insert = await pool.query(
      `INSERT INTO rbac_roles (role_key, role_name, description, is_system)
       VALUES ($1,$2,$3,FALSE)
       ON CONFLICT (role_key) DO NOTHING
       RETURNING id`,
      [roleKey, roleName, description]
    );
    if (!insert.rowCount) {
      return res.status(409).json({ error: 'Role key already exists.' });
    }
    res.json({ ok: true, id: insert.rows[0].id, roleKey });
  }));

  router.put('/admin/roles/:roleId', ...guard, asyncHandler(async (req, res) => {
    const roleId = Number(req.params.roleId);
    if (!Number.isInteger(roleId)) return res.status(400).json({ error: 'Invalid role id.' });

    const roleName = String(req.body?.roleName || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!roleName) return res.status(400).json({ error: 'roleName is required.' });

    const result = await pool.query(
      `UPDATE rbac_roles
       SET role_name = $1, description = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id`,
      [roleName, description, roleId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Role not found.' });
    res.json({ ok: true });
  }));

  router.delete('/admin/roles/:roleId', ...guard, asyncHandler(async (req, res) => {
    const roleId = Number(req.params.roleId);
    if (!Number.isInteger(roleId)) return res.status(400).json({ error: 'Invalid role id.' });

    const systemCheck = await pool.query(
      `SELECT is_system FROM rbac_roles WHERE id = $1`,
      [roleId]
    );
    if (!systemCheck.rowCount) return res.status(404).json({ error: 'Role not found.' });
    if (systemCheck.rows[0].is_system) {
      return res.status(400).json({ error: 'System roles cannot be deleted.' });
    }

    await pool.query('DELETE FROM rbac_roles WHERE id = $1', [roleId]);
    res.json({ ok: true });
  }));

  router.put('/admin/roles/:roleId/permissions', ...guard, asyncHandler(async (req, res) => {
    const roleId = Number(req.params.roleId);
    if (!Number.isInteger(roleId)) return res.status(400).json({ error: 'Invalid role id.' });

    const keys = Array.isArray(req.body?.permissionKeys)
      ? req.body.permissionKeys.map((key) => String(key || '').trim()).filter(Boolean)
      : null;
    if (!keys) return res.status(400).json({ error: 'permissionKeys must be an array.' });

    const roleExists = await pool.query('SELECT id FROM rbac_roles WHERE id = $1', [roleId]);
    if (!roleExists.rowCount) return res.status(404).json({ error: 'Role not found.' });

    await pool.query('DELETE FROM rbac_role_permissions WHERE role_id = $1', [roleId]);
    if (keys.length > 0) {
      await pool.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id)
         SELECT $1, p.id
         FROM rbac_permissions p
         WHERE p.permission_key = ANY($2::text[])
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleId, keys]
      );
    }

    res.json({ ok: true });
  }));

  router.get('/admin/group-role-bindings', ...guard, asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT b.id, b.group_name, r.id AS role_id, r.role_key, r.role_name
       FROM rbac_group_role_bindings b
       JOIN rbac_roles r ON r.id = b.role_id
       ORDER BY LOWER(b.group_name), r.role_key`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      groupName: row.group_name,
      roleId: row.role_id,
      roleKey: row.role_key,
      roleName: row.role_name,
    })));
  }));

  router.post('/admin/group-role-bindings', ...guard, asyncHandler(async (req, res) => {
    const groupName = String(req.body?.groupName || '').trim();
    const roleId = Number(req.body?.roleId);
    if (!groupName || !Number.isInteger(roleId)) {
      return res.status(400).json({ error: 'groupName and roleId are required.' });
    }

    await pool.query(
      `INSERT INTO rbac_group_role_bindings (group_name, role_id)
       VALUES ($1, $2)
       ON CONFLICT (group_name, role_id) DO NOTHING`,
      [groupName, roleId]
    );
    res.json({ ok: true });
  }));

  router.delete('/admin/group-role-bindings/:bindingId', ...guard, asyncHandler(async (req, res) => {
    const bindingId = Number(req.params.bindingId);
    if (!Number.isInteger(bindingId)) return res.status(400).json({ error: 'Invalid binding id.' });
    const result = await pool.query('DELETE FROM rbac_group_role_bindings WHERE id = $1 RETURNING id', [bindingId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Binding not found.' });
    res.json({ ok: true });
  }));

  router.get('/admin/users', ...guard, asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `WITH app_users AS (
         SELECT user_id FROM user_settings
         UNION SELECT user_id FROM providers
         UNION SELECT user_id FROM prompt_history
         UNION SELECT user_id FROM prompt_library
         UNION SELECT user_id FROM provider_generation_events
       )
       SELECT
         u.user_id,
         us.settings_json,
         le.user_groups_json,
         le.user_roles_json,
         le.created_at AS last_seen_at,
         COALESCE((SELECT COUNT(*)::int FROM providers p WHERE p.user_id = u.user_id), 0) AS provider_count,
         COALESCE((SELECT COUNT(*)::int FROM providers p WHERE p.user_id = u.user_id AND COALESCE(p.system_key_id, '') = ''), 0) AS personal_provider_count,
         COALESCE((SELECT COUNT(*)::int FROM prompt_history h WHERE h.user_id = u.user_id), 0) AS history_count,
         COALESCE((SELECT COUNT(*)::int FROM prompt_library l WHERE l.user_id = u.user_id), 0) AS library_count
       FROM app_users u
       LEFT JOIN user_settings us ON us.user_id = u.user_id
       LEFT JOIN LATERAL (
         SELECT e.user_groups_json, e.user_roles_json, e.created_at
         FROM provider_generation_events e
         WHERE e.user_id = u.user_id
         ORDER BY e.created_at DESC
         LIMIT 1
       ) le ON TRUE
       ORDER BY LOWER(u.user_id) ASC`
    );

    const users = await Promise.all(result.rows.map(async (row) => {
      const settings = row.settings_json && typeof row.settings_json === 'object'
        ? row.settings_json
        : {};
      const groupHints = normalizeStringList(row.user_groups_json || []);
      const roleHints = normalizeStringList(row.user_roles_json || []);
      const effective = await resolveAccessForGroups(groupHints);
      return {
        userId: row.user_id,
        settings: {
          hasSeenIntroduction: settings.hasSeenIntroduction === true,
          introTourVersion: Number(settings.introTourVersion || 0),
          theme: String(settings.theme || config.settingsDefaults.theme || 'system'),
          flowMode: settings.flowMode || null,
          navLayout: String(settings.navLayout || config.settingsDefaults.navLayout || 'topbar'),
          resultModeEnabled: settings.resultModeEnabled === true,
        },
        groupHints,
        roleHints,
        effectiveRoles: effective.roles,
        effectivePermissions: effective.permissions,
        lastSeenAt: row.last_seen_at,
        providerCount: Number(row.provider_count || 0),
        personalProviderCount: Number(row.personal_provider_count || 0),
        historyCount: Number(row.history_count || 0),
        libraryCount: Number(row.library_count || 0),
      };
    }));

    res.json(users);
  }));

  router.put('/admin/users/:userId/introduction-reset', ...guard, asyncHandler(async (req, res) => {
    const targetUserId = String(req.params.userId || '').trim();
    if (!targetUserId) return res.status(400).json({ error: 'Invalid user id.' });

    const existingResult = await pool.query(
      'SELECT settings_json FROM user_settings WHERE user_id = $1 LIMIT 1',
      [targetUserId]
    );
    const existing = existingResult.rows[0]?.settings_json || {};
    const merged = {
      ...config.settingsDefaults,
      ...existing,
      hasSeenIntroduction: false,
      introTourVersion: 0,
    };
    await pool.query(
      `INSERT INTO user_settings (user_id, settings_json)
       VALUES ($1,$2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()`,
      [targetUserId, JSON.stringify(merged)]
    );
    res.json({ ok: true, userId: targetUserId });
  }));

  router.put('/admin/users/:userId/settings-reset', ...guard, asyncHandler(async (req, res) => {
    const targetUserId = String(req.params.userId || '').trim();
    if (!targetUserId) return res.status(400).json({ error: 'Invalid user id.' });

    const defaults = {
      ...config.settingsDefaults,
      hasSeenIntroduction: false,
      introTourVersion: 0,
    };
    await pool.query(
      `INSERT INTO user_settings (user_id, settings_json)
       VALUES ($1,$2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()`,
      [targetUserId, JSON.stringify(defaults)]
    );
    res.json({ ok: true, userId: targetUserId });
  }));

  router.put('/admin/users/:userId/revoke-personal-keys', ...guard, asyncHandler(async (req, res) => {
    const targetUserId = String(req.params.userId || '').trim();
    if (!targetUserId) return res.status(400).json({ error: 'Invalid user id.' });

    const result = await pool.query(
      `UPDATE providers
       SET key_meta = '{}'::jsonb,
           updated_at = NOW()
       WHERE user_id = $1
         AND COALESCE(system_key_id, '') = ''`,
      [targetUserId]
    );
    res.json({
      ok: true,
      userId: targetUserId,
      updatedProviders: Number(result.rowCount || 0),
    });
  }));

  router.get('/admin/model-pricing', ...pricingGuard, asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT id, provider_kind, model, input_price_per_million, output_price_per_million, currency, is_active, updated_at
       FROM provider_model_pricing_catalog
       ORDER BY provider_kind ASC, model ASC`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      providerKind: row.provider_kind,
      model: row.model,
      inputPricePerMillion: row.input_price_per_million === null ? null : Number(row.input_price_per_million),
      outputPricePerMillion: row.output_price_per_million === null ? null : Number(row.output_price_per_million),
      currency: String(row.currency || 'USD').trim().toUpperCase() || 'USD',
      isActive: Boolean(row.is_active),
      hasPricing: row.input_price_per_million !== null && row.output_price_per_million !== null,
      updatedAt: row.updated_at,
    })));
  }));

  router.post('/admin/model-pricing', ...pricingGuard, asyncHandler(async (req, res) => {
    const providerKind = String(req.body?.providerKind || '').trim().toLowerCase();
    const model = String(req.body?.model || '').trim();
    const inputPricePerMillion = parseNonNegativeNumberOrNull(req.body?.inputPricePerMillion);
    const outputPricePerMillion = parseNonNegativeNumberOrNull(req.body?.outputPricePerMillion);
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase() || 'USD';

    if (!providerKind || !model) {
      return res.status(400).json({ error: 'providerKind and model are required.' });
    }
    const result = await pool.query(
      `INSERT INTO provider_model_pricing_catalog
         (provider_kind, model, input_price_per_million, output_price_per_million, currency, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (provider_kind, model)
       DO UPDATE SET
         input_price_per_million = EXCLUDED.input_price_per_million,
         output_price_per_million = EXCLUDED.output_price_per_million,
         currency = EXCLUDED.currency,
         is_active = EXCLUDED.is_active,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id`,
      [providerKind, model, inputPricePerMillion, outputPricePerMillion, currency, req.body?.isActive === undefined ? true : Boolean(req.body.isActive), req.userId]
    );

    res.json({ ok: true, id: result.rows[0].id });
  }));

  router.put('/admin/model-pricing/:pricingId', ...pricingGuard, asyncHandler(async (req, res) => {
    const pricingId = Number(req.params.pricingId);
    if (!Number.isInteger(pricingId)) return res.status(400).json({ error: 'Invalid pricing id.' });

    const inputPricePerMillion = parseNonNegativeNumberOrNull(req.body?.inputPricePerMillion);
    const outputPricePerMillion = parseNonNegativeNumberOrNull(req.body?.outputPricePerMillion);
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase() || 'USD';
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    const result = await pool.query(
      `UPDATE provider_model_pricing_catalog
       SET input_price_per_million = $1,
           output_price_per_million = $2,
           currency = $3,
           is_active = $4,
           updated_by = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id`,
      [inputPricePerMillion, outputPricePerMillion, currency, isActive, req.userId, pricingId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Pricing entry not found.' });
    res.json({ ok: true });
  }));

  router.delete('/admin/model-pricing/:pricingId', ...pricingGuard, asyncHandler(async (req, res) => {
    const pricingId = Number(req.params.pricingId);
    if (!Number.isInteger(pricingId)) return res.status(400).json({ error: 'Invalid pricing id.' });

    const result = await pool.query(
      `UPDATE provider_model_pricing_catalog
       SET is_active = FALSE,
           updated_by = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [req.userId, pricingId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Pricing entry not found.' });
    res.json({ ok: true });
  }));

  router.get('/admin/system-provider-keys', ...systemKeyGuard, asyncHandler(async (_req, res) => {
    const systemSettings = await getSystemKeySettings();
    const [keysResult, assignmentsResult] = await Promise.all([
      pool.query(
        `SELECT
           id,
           system_key_id,
           name,
           provider_kind,
           model_hint,
           base_url,
           key_meta,
           is_active,
           budget_limit_usd,
           budget_period,
           budget_mode,
           budget_warning_ratio,
            budget_is_active,
            created_by,
            updated_by,
            created_at,
            updated_at
         FROM system_provider_keys
         ORDER BY provider_kind ASC, name ASC`
      ),
      pool.query(
        `SELECT
           id,
           system_key_id,
           scope_type,
           scope_value,
           is_active,
           budget_limit_usd,
           budget_period,
           budget_mode,
           budget_warning_ratio,
           budget_is_active,
           per_user_budget_limit_usd,
           per_user_budget_period,
           created_by,
           updated_by,
           created_at,
           updated_at
         FROM system_key_assignments
         ORDER BY system_key_id ASC, scope_type ASC, scope_value ASC`
      ),
    ]);

    const assignmentRows = await Promise.all(assignmentsResult.rows.map(async (row) => {
      const period = normalizeBudgetPeriod(row.budget_period || 'monthly') || 'monthly';
      const usage = await resolveAssignmentUsage({
        systemKeyId: row.system_key_id,
        scopeType: row.scope_type,
        scopeValue: row.scope_value,
        period,
      });
      return {
        id: Number(row.id),
        systemKeyId: row.system_key_id,
        scopeType: row.scope_type === 'group' && row.scope_value === '*' ? 'global' : row.scope_type,
        scopeValue: row.scope_type === 'group' && row.scope_value === '*' ? '*' : row.scope_value,
        isActive: Boolean(row.is_active),
        budgetLimitUsd: row.budget_limit_usd === null ? null : Number(row.budget_limit_usd),
        budgetPeriod: period,
        budgetMode: normalizeBudgetMode(row.budget_mode || 'hybrid'),
        budgetWarningRatio: Number(row.budget_warning_ratio || 0.9),
        budgetIsActive: Boolean(row.budget_is_active),
        perUserBudgetLimitUsd: row.per_user_budget_limit_usd === null ? null : Number(row.per_user_budget_limit_usd),
        perUserBudgetPeriod: normalizeBudgetPeriod(row.per_user_budget_period || row.budget_period || 'monthly') || 'monthly',
        usage: {
          totalRequests: usage.totalCount,
          spendUsd: usage.spendUsd,
        },
        createdBy: row.created_by,
        updatedBy: row.updated_by || row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at,
      };
    }));

    const assignmentsByKey = new Map();
    assignmentRows.forEach((assignment) => {
      const keyId = String(assignment.systemKeyId || '');
      if (!assignmentsByKey.has(keyId)) assignmentsByKey.set(keyId, []);
      assignmentsByKey.get(keyId).push(assignment);
    });

    const payload = await Promise.all(keysResult.rows.map(async (row) => {
      const period = normalizeBudgetPeriod(row.budget_period || 'monthly') || 'monthly';
      const usage = await resolveSystemKeyUsage(row.system_key_id, period);
      return {
        id: Number(row.id),
        systemKeyId: row.system_key_id,
        name: row.name,
        providerKind: row.provider_kind,
        modelHint: row.model_hint || '',
        baseUrl: row.base_url || '',
        hasServerKey: hasServerEncryptedKey(row.key_meta),
        isActive: Boolean(row.is_active),
        budgetLimitUsd: row.budget_limit_usd === null ? null : Number(row.budget_limit_usd),
        budgetPeriod: period,
        budgetMode: normalizeBudgetMode(row.budget_mode || 'hybrid'),
        budgetWarningRatio: Number(row.budget_warning_ratio || 0.9),
        budgetIsActive: Boolean(row.budget_is_active),
        usage: {
          totalRequests: usage.totalCount,
          spendUsd: usage.spendUsd,
        },
        createdBy: row.created_by,
        updatedBy: row.updated_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        assignments: assignmentsByKey.get(String(row.system_key_id || '')) || [],
      };
    }));

    res.json({
      systemKeysEnabled: Boolean(systemSettings.enabled),
      welcomeFlowEnabled: Boolean(systemSettings.welcomeFlowEnabled),
      globalBudgetIsActive: Boolean(systemSettings.globalBudgetIsActive),
      globalBudgetLimitUsd: systemSettings.globalBudgetLimitUsd,
      globalBudgetPeriod: systemSettings.globalBudgetPeriod,
      globalBudgetMode: systemSettings.globalBudgetMode,
      globalBudgetWarningRatio: systemSettings.globalBudgetWarningRatio,
      keys: payload,
    });
  }));

  router.get('/admin/system-provider-keys/config', ...systemKeyGuard, asyncHandler(async (_req, res) => {
    const settings = await getSystemKeySettings();
    const usage = await resolveGlobalSystemUsage(settings.globalBudgetPeriod);
    res.json({
      systemKeysEnabled: Boolean(settings.enabled),
      welcomeFlowEnabled: Boolean(settings.welcomeFlowEnabled),
      globalBudgetIsActive: Boolean(settings.globalBudgetIsActive),
      globalBudgetLimitUsd: settings.globalBudgetLimitUsd,
      globalBudgetPeriod: settings.globalBudgetPeriod,
      globalBudgetMode: settings.globalBudgetMode,
      globalBudgetWarningRatio: settings.globalBudgetWarningRatio,
      globalBudgetUsage: {
        totalRequests: usage.totalCount,
        spendUsd: usage.spendUsd,
      },
    });
  }));

  router.put('/admin/system-provider-keys/config', ...systemKeyGuard, asyncHandler(async (req, res) => {
    const payload = req.body || {};
    const update = {};
    if (Object.prototype.hasOwnProperty.call(payload, 'systemKeysEnabled')) {
      update.enabled = Boolean(payload.systemKeysEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'welcomeFlowEnabled')) {
      update.welcomeFlowEnabled = Boolean(payload.welcomeFlowEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'globalBudgetLimitUsd')) {
      update.globalBudgetLimitUsd = parseNonNegativeNumberOrNull(payload.globalBudgetLimitUsd);
      if (!Object.prototype.hasOwnProperty.call(payload, 'globalBudgetIsActive')) {
        update.globalBudgetIsActive = update.globalBudgetLimitUsd !== null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'globalBudgetPeriod')) {
      update.globalBudgetPeriod = normalizeBudgetPeriod(payload.globalBudgetPeriod || 'monthly') || 'monthly';
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'globalBudgetMode')) {
      update.globalBudgetMode = normalizeBudgetMode(payload.globalBudgetMode || 'hybrid');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'globalBudgetWarningRatio')) {
      update.globalBudgetWarningRatio = parseWarningRatio(payload.globalBudgetWarningRatio);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'globalBudgetIsActive')) {
      update.globalBudgetIsActive = Boolean(payload.globalBudgetIsActive);
    }

    const settings = await setSystemKeySettings(update, req.userId);
    const usage = await resolveGlobalSystemUsage(settings.globalBudgetPeriod);
    res.json({
      ok: true,
      systemKeysEnabled: Boolean(settings.enabled),
      welcomeFlowEnabled: Boolean(settings.welcomeFlowEnabled),
      globalBudgetIsActive: Boolean(settings.globalBudgetIsActive),
      globalBudgetLimitUsd: settings.globalBudgetLimitUsd,
      globalBudgetPeriod: settings.globalBudgetPeriod,
      globalBudgetMode: settings.globalBudgetMode,
      globalBudgetWarningRatio: settings.globalBudgetWarningRatio,
      globalBudgetUsage: {
        totalRequests: usage.totalCount,
        spendUsd: usage.spendUsd,
      },
    });
  }));

  router.post('/admin/system-provider-keys', ...systemKeyGuard, asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const providerKind = String(req.body?.providerKind || '').trim().toLowerCase();
    const modelHint = String(req.body?.modelHint || '').trim();
    const baseUrl = String(req.body?.baseUrl || '').trim();
    const apiKey = String(req.body?.apiKey || '').trim();
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    const normalizedBudget = normalizeOptionalBudgetPayload(req.body || {});
    if (normalizedBudget.error) {
      return res.status(400).json({ error: normalizedBudget.error });
    }
    const systemKeyId = normalizeSystemKeyId(req.body?.systemKeyId || '');
    if (!name || !providerKind) {
      return res.status(400).json({ error: 'name and providerKind are required.' });
    }
    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required when creating a system key.' });
    }

    const encryptedKey = encryptApiKey(apiKey, config.keyEncryptionSecret);
    const result = await pool.query(
      `INSERT INTO system_provider_keys
         (system_key_id, name, provider_kind, model_hint, base_url, key_meta, is_active, budget_limit_usd, budget_period, budget_mode, budget_warning_ratio, budget_is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$13)
       ON CONFLICT (system_key_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         provider_kind = EXCLUDED.provider_kind,
         model_hint = EXCLUDED.model_hint,
         base_url = EXCLUDED.base_url,
         key_meta = EXCLUDED.key_meta,
         is_active = EXCLUDED.is_active,
         budget_limit_usd = EXCLUDED.budget_limit_usd,
         budget_period = EXCLUDED.budget_period,
         budget_mode = EXCLUDED.budget_mode,
         budget_warning_ratio = EXCLUDED.budget_warning_ratio,
         budget_is_active = EXCLUDED.budget_is_active,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, system_key_id`,
      [
        systemKeyId,
        name,
        providerKind,
        modelHint || null,
        baseUrl || null,
        JSON.stringify(encryptedKey),
        isActive,
        normalizedBudget.budgetLimitUsd,
        normalizedBudget.budgetPeriod,
        normalizedBudget.budgetMode,
        normalizedBudget.budgetWarningRatio,
        normalizedBudget.budgetIsActive,
        req.userId,
      ]
    );
    res.json({
      ok: true,
      id: Number(result.rows[0].id),
      systemKeyId: result.rows[0].system_key_id,
    });
  }));

  router.put('/admin/system-provider-keys/:systemKeyId', ...systemKeyGuard, asyncHandler(async (req, res) => {
    const systemKeyId = normalizeSystemKeyId(req.params.systemKeyId || '');
    if (!systemKeyId) return res.status(400).json({ error: 'Invalid system key id.' });

    const existing = await pool.query(
      `SELECT key_meta
       FROM system_provider_keys
       WHERE system_key_id = $1`,
      [systemKeyId]
    );
    if (!existing.rowCount) return res.status(404).json({ error: 'System key not found.' });
    const apiKey = String(req.body?.apiKey || '').trim();
    const keyMeta = apiKey
      ? encryptApiKey(apiKey, config.keyEncryptionSecret)
      : (existing.rows[0].key_meta || {});
    const name = String(req.body?.name || '').trim();
    const providerKind = String(req.body?.providerKind || '').trim().toLowerCase();
    const modelHint = String(req.body?.modelHint || '').trim();
    const baseUrl = String(req.body?.baseUrl || '').trim();
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    const normalizedBudget = normalizeOptionalBudgetPayload(req.body || {});
    if (normalizedBudget.error) {
      return res.status(400).json({ error: normalizedBudget.error });
    }
    if (!name || !providerKind) {
      return res.status(400).json({ error: 'name and providerKind are required.' });
    }

    await pool.query(
      `UPDATE system_provider_keys
       SET name = $1,
           provider_kind = $2,
           model_hint = $3,
           base_url = $4,
           key_meta = $5::jsonb,
           is_active = $6,
           budget_limit_usd = $7,
           budget_period = $8,
           budget_mode = $9,
           budget_warning_ratio = $10,
           budget_is_active = $11,
           updated_by = $12,
           updated_at = NOW()
       WHERE system_key_id = $13`,
      [
        name,
        providerKind,
        modelHint || null,
        baseUrl || null,
        JSON.stringify(keyMeta),
        isActive,
        normalizedBudget.budgetLimitUsd,
        normalizedBudget.budgetPeriod,
        normalizedBudget.budgetMode,
        normalizedBudget.budgetWarningRatio,
        normalizedBudget.budgetIsActive,
        req.userId,
        systemKeyId,
      ]
    );
    res.json({ ok: true });
  }));

  router.delete('/admin/system-provider-keys/:systemKeyId', ...systemKeyGuard, asyncHandler(async (req, res) => {
    const systemKeyId = normalizeSystemKeyId(req.params.systemKeyId || '');
    if (!systemKeyId) return res.status(400).json({ error: 'Invalid system key id.' });
    const result = await pool.query(
      `UPDATE system_provider_keys
       SET is_active = FALSE,
           updated_by = $1,
           updated_at = NOW()
       WHERE system_key_id = $2
       RETURNING id`,
      [req.userId, systemKeyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'System key not found.' });
    res.json({ ok: true });
  }));

  router.post('/admin/system-provider-keys/:systemKeyId/assignments', ...systemKeyGuard, asyncHandler(async (req, res) => {
    const systemKeyId = normalizeSystemKeyId(req.params.systemKeyId || '');
    const scopeType = normalizeSystemScopeType(req.body?.scopeType || '');
    const scopeValue = normalizeScopeValue(scopeType, req.body?.scopeValue || '');
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    const normalizedBudget = normalizeOptionalBudgetPayload(req.body || {});
    const normalizedPerUserBudget = normalizeOptionalPerUserBudgetPayload(req.body || {});
    if (normalizedBudget.error) {
      return res.status(400).json({ error: normalizedBudget.error });
    }
    if (!systemKeyId || !scopeType || !scopeValue) {
      return res.status(400).json({ error: 'systemKeyId, scopeType and scopeValue are required.' });
    }

    const keyExists = await pool.query(
      `SELECT id
       FROM system_provider_keys
       WHERE system_key_id = $1`,
      [systemKeyId]
    );
    if (!keyExists.rowCount) return res.status(404).json({ error: 'System key not found.' });

    const persistedScopeType = scopeType === 'global' ? 'group' : scopeType;
    const persistedScopeValue = scopeType === 'global' ? '*' : scopeValue;

    await pool.query(
      `INSERT INTO system_key_assignments
         (system_key_id, scope_type, scope_value, is_active, budget_limit_usd, budget_period, budget_mode, budget_warning_ratio, budget_is_active, per_user_budget_limit_usd, per_user_budget_period, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       ON CONFLICT (system_key_id, scope_type, scope_value)
       DO UPDATE SET
         is_active = EXCLUDED.is_active,
         budget_limit_usd = EXCLUDED.budget_limit_usd,
         budget_period = EXCLUDED.budget_period,
         budget_mode = EXCLUDED.budget_mode,
         budget_warning_ratio = EXCLUDED.budget_warning_ratio,
         budget_is_active = EXCLUDED.budget_is_active,
         per_user_budget_limit_usd = EXCLUDED.per_user_budget_limit_usd,
         per_user_budget_period = EXCLUDED.per_user_budget_period,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        systemKeyId,
        persistedScopeType,
        persistedScopeValue,
        isActive,
        normalizedBudget.budgetLimitUsd,
        normalizedBudget.budgetPeriod,
        normalizedBudget.budgetMode,
        normalizedBudget.budgetWarningRatio,
        normalizedBudget.budgetIsActive,
        normalizedPerUserBudget.perUserBudgetLimitUsd,
        normalizedPerUserBudget.perUserBudgetPeriod,
        req.userId,
      ]
    );
    res.json({ ok: true });
  }));

  router.put('/admin/system-provider-keys/:systemKeyId/assignments/:assignmentId', ...systemKeyGuard, asyncHandler(async (req, res) => {
    const systemKeyId = normalizeSystemKeyId(req.params.systemKeyId || '');
    const assignmentId = Number(req.params.assignmentId);
    if (!systemKeyId || !Number.isInteger(assignmentId)) {
      return res.status(400).json({ error: 'Invalid assignment reference.' });
    }
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    const normalizedBudget = normalizeOptionalBudgetPayload(req.body || {});
    const normalizedPerUserBudget = normalizeOptionalPerUserBudgetPayload(req.body || {});
    if (normalizedBudget.error) {
      return res.status(400).json({ error: normalizedBudget.error });
    }

    const result = await pool.query(
      `UPDATE system_key_assignments
       SET is_active = $1,
           budget_limit_usd = $2,
           budget_period = $3,
           budget_mode = $4,
           budget_warning_ratio = $5,
           budget_is_active = $6,
           per_user_budget_limit_usd = $7,
           per_user_budget_period = $8,
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10
         AND system_key_id = $11
       RETURNING id`,
      [
        isActive,
        normalizedBudget.budgetLimitUsd,
        normalizedBudget.budgetPeriod,
        normalizedBudget.budgetMode,
        normalizedBudget.budgetWarningRatio,
        normalizedBudget.budgetIsActive,
        normalizedPerUserBudget.perUserBudgetLimitUsd,
        normalizedPerUserBudget.perUserBudgetPeriod,
        req.userId,
        assignmentId,
        systemKeyId,
      ]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Assignment not found.' });
    }
    res.json({ ok: true });
  }));

  router.delete('/admin/system-provider-keys/:systemKeyId/assignments/:assignmentId', ...systemKeyGuard, asyncHandler(async (req, res) => {
    const systemKeyId = normalizeSystemKeyId(req.params.systemKeyId || '');
    const assignmentId = Number(req.params.assignmentId);
    if (!systemKeyId || !Number.isInteger(assignmentId)) {
      return res.status(400).json({ error: 'Invalid assignment reference.' });
    }
    const result = await pool.query(
      `DELETE FROM system_key_assignments
       WHERE id = $1 AND system_key_id = $2
       RETURNING id`,
      [assignmentId, systemKeyId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Assignment not found.' });
    res.json({ ok: true });
  }));

  router.get('/admin/budgets', ...budgetGuard, asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT id, owner_user_id, scope_type, scope_value, period, limit_usd, mode, warning_ratio, is_active, created_by, updated_by, created_at, updated_at
       FROM budget_policies
       ORDER BY scope_type ASC, scope_value ASC, period ASC`
    );
    res.json(result.rows.map((row) => ({
      id: Number(row.id),
      ownerUserId: row.owner_user_id || null,
      scopeType: row.scope_type,
      scopeValue: row.scope_value,
      period: row.period,
      limitUsd: Number(row.limit_usd || 0),
      mode: row.mode || 'hybrid',
      warningRatio: Number(row.warning_ratio || 0.9),
      isActive: Boolean(row.is_active),
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })));
  }));

  router.post('/admin/budgets', ...budgetGuard, asyncHandler(async (req, res) => {
    const scopeType = normalizeBudgetScopeType(req.body?.scopeType || '');
    const scopeValue = normalizeScopeValue(scopeType, req.body?.scopeValue || '');
    const period = normalizeBudgetPeriod(req.body?.period || '');
    const limitUsd = parseNonNegativeNumberOrNull(req.body?.limitUsd);
    const mode = normalizeBudgetMode(req.body?.mode || 'hybrid');
    const warningRatio = parseWarningRatio(req.body?.warningRatio);
    const ownerUserId = req.body?.ownerUserId ? String(req.body.ownerUserId).trim() : null;
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    if (!scopeType || !scopeValue || !period || limitUsd === null) {
      return res.status(400).json({ error: 'scopeType, scopeValue, period and limitUsd are required.' });
    }

    const result = await pool.query(
      `INSERT INTO budget_policies
         (owner_user_id, scope_type, scope_value, period, limit_usd, mode, warning_ratio, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (scope_type, scope_value, period)
       DO UPDATE SET
         owner_user_id = EXCLUDED.owner_user_id,
         limit_usd = EXCLUDED.limit_usd,
         mode = EXCLUDED.mode,
         warning_ratio = EXCLUDED.warning_ratio,
         is_active = EXCLUDED.is_active,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id`,
      [ownerUserId, scopeType, scopeValue, period, limitUsd, mode, warningRatio, isActive, req.userId]
    );
    res.json({ ok: true, id: Number(result.rows[0].id) });
  }));

  router.put('/admin/budgets/:budgetId', ...budgetGuard, asyncHandler(async (req, res) => {
    const budgetId = Number(req.params.budgetId);
    if (!Number.isInteger(budgetId)) return res.status(400).json({ error: 'Invalid budget id.' });
    const scopeType = normalizeBudgetScopeType(req.body?.scopeType || '');
    const scopeValue = normalizeScopeValue(scopeType, req.body?.scopeValue || '');
    const period = normalizeBudgetPeriod(req.body?.period || '');
    const limitUsd = parseNonNegativeNumberOrNull(req.body?.limitUsd);
    const mode = normalizeBudgetMode(req.body?.mode || 'hybrid');
    const warningRatio = parseWarningRatio(req.body?.warningRatio);
    const ownerUserId = req.body?.ownerUserId ? String(req.body.ownerUserId).trim() : null;
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    if (!scopeType || !scopeValue || !period || limitUsd === null) {
      return res.status(400).json({ error: 'scopeType, scopeValue, period and limitUsd are required.' });
    }

    const result = await pool.query(
      `UPDATE budget_policies
       SET owner_user_id = $1,
           scope_type = $2,
           scope_value = $3,
           period = $4,
           limit_usd = $5,
           mode = $6,
           warning_ratio = $7,
           is_active = $8,
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING id`,
      [ownerUserId, scopeType, scopeValue, period, limitUsd, mode, warningRatio, isActive, req.userId, budgetId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Budget policy not found.' });
    res.json({ ok: true });
  }));

  router.delete('/admin/budgets/:budgetId', ...budgetGuard, asyncHandler(async (req, res) => {
    const budgetId = Number(req.params.budgetId);
    if (!Number.isInteger(budgetId)) return res.status(400).json({ error: 'Invalid budget id.' });
    const result = await pool.query(
      `UPDATE budget_policies
       SET is_active = FALSE,
           updated_by = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [req.userId, budgetId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Budget policy not found.' });
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createAdminRouter };
