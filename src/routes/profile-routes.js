const { Router } = require('express');
const { config } = require('../config');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');

async function getWelcomeFlowEnabled() {
  try {
    const result = await pool.query(
      `SELECT setting_value_json
       FROM app_runtime_settings
       WHERE setting_key = 'system_keys'
       LIMIT 1`
    );
    if (!result.rowCount) return true;
    return result.rows[0]?.setting_value_json?.welcomeFlowEnabled !== false;
  } catch (_error) {
    return true;
  }
}

function resolveLogoutUrl(rawUrl = '') {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '/outpost.goauthentik.io/sign_out';
  const lower = raw.toLowerCase();
  // Backchannel endpoints are not interactive logout targets in browser UI.
  if (lower.includes('backchannel-logout')) {
    return '/outpost.goauthentik.io/sign_out';
  }
  return raw;
}

function createProfileRouter() {
  const router = Router();

  router.get('/me', authMiddleware, accessMiddleware, requirePermission('app.access'), async (req, res, next) => {
    try {
      const welcomeFlowEnabled = await getWelcomeFlowEnabled();
      res.json({
        userId: req.userId,
        groups: req.userGroups,
        roles: req.access?.roles || [],
        permissions: req.access?.permissions || [],
        logoutUrl: resolveLogoutUrl(config.authLogoutUrl || ''),
        welcomeFlowEnabled,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createProfileRouter };
