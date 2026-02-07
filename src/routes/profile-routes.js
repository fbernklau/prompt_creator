const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');

function createProfileRouter() {
  const router = Router();

  router.get('/me', authMiddleware, (req, res) => {
    res.json({ userId: req.userId, groups: req.userGroups });
  });

  return router;
}

module.exports = { createProfileRouter };
