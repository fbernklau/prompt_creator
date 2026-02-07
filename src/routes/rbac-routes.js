const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware } = require('../middleware/rbac');

function createRbacRouter() {
  const router = Router();

  router.get('/rbac/me', authMiddleware, accessMiddleware, (req, res) => {
    res.json({
      userId: req.userId,
      groups: req.userGroups || [],
      roles: req.access?.roles || [],
      permissions: req.access?.permissions || [],
    });
  });

  return router;
}

module.exports = { createRbacRouter };
