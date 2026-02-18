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

function createProfileRouter() {
  const router = Router();

  router.get('/me', authMiddleware, accessMiddleware, requirePermission('app.access'), async (req, res) => {
    const welcomeFlowEnabled = await getWelcomeFlowEnabled();
    res.json({
      userId: req.userId,
      groups: req.userGroups,
      roles: req.access?.roles || [],
      permissions: req.access?.permissions || [],
      logoutUrl: config.authLogoutUrl || '',
      welcomeFlowEnabled,
    });
  });

  return router;
}

module.exports = { createProfileRouter };
