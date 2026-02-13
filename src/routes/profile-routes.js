const { Router } = require('express');
const { config } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');

function createProfileRouter() {
  const router = Router();

  router.get('/me', authMiddleware, accessMiddleware, requirePermission('app.access'), (req, res) => {
    res.json({
      userId: req.userId,
      groups: req.userGroups,
      roles: req.access?.roles || [],
      permissions: req.access?.permissions || [],
      logoutUrl: config.authLogoutUrl || '',
    });
  });

  return router;
}

module.exports = { createProfileRouter };
