const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');

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

function createAdminRouter() {
  const router = Router();
  const guard = [authMiddleware, accessMiddleware, requirePermission('rbac.manage')];

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

  return router;
}

module.exports = { createAdminRouter };
