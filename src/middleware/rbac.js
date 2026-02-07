const { config } = require('../config');
const { pool } = require('../db/pool');
const { DEFAULT_ROLES } = require('../rbac/default-rbac');

async function hydrateAccess(req) {
  if (req.access) return req.access;

  if (!config.authRequired) {
    req.access = {
      roles: ['local-dev-admin'],
      permissions: ['*'],
    };
    return req.access;
  }

  const groups = Array.isArray(req.userGroups) ? req.userGroups : [];
  if (!groups.length) {
    req.access = { roles: [], permissions: [] };
    return req.access;
  }

  const result = await pool.query(
    `SELECT DISTINCT r.role_key, p.permission_key
     FROM rbac_group_role_bindings b
     JOIN rbac_roles r ON r.id = b.role_id
     JOIN rbac_role_permissions rp ON rp.role_id = r.id
     JOIN rbac_permissions p ON p.id = rp.permission_id
     WHERE LOWER(b.group_name) = ANY($1::text[])`,
    [groups.map((group) => String(group || '').toLowerCase())]
  );

  const roles = new Set();
  const permissions = new Set();
  for (const row of result.rows) {
    if (row.role_key) roles.add(row.role_key);
    if (row.permission_key) permissions.add(row.permission_key);
  }
  req.access = {
    roles: [...roles],
    permissions: [...permissions],
  };

  // Backward-compatible fallback: if required OIDC group is present but no binding exists yet,
  // grant baseline teacher permissions so existing deployments don't lock out users.
  if (!req.access.permissions.length && config.requiredGroup) {
    const requiredGroup = String(config.requiredGroup).toLowerCase();
    const inRequiredGroup = groups.some((group) => String(group).toLowerCase() === requiredGroup);
    if (inRequiredGroup) {
      const teacherRole = DEFAULT_ROLES.find((role) => role.key === 'teachers');
      req.access = {
        roles: ['teachers-fallback'],
        permissions: teacherRole ? [...teacherRole.permissions] : ['app.access'],
      };
    }
  }

  return req.access;
}

function accessMiddleware(req, res, next) {
  hydrateAccess(req).then(() => next()).catch(next);
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    hydrateAccess(req)
      .then((access) => {
        const permissionSet = new Set(access.permissions || []);
        if (permissionSet.has('*') || permissionSet.has(permissionKey)) {
          return next();
        }
        return res.status(403).json({ error: `Missing permission: ${permissionKey}` });
      })
      .catch(next);
  };
}

module.exports = {
  accessMiddleware,
  requirePermission,
};
