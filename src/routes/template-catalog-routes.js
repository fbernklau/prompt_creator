const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { getTemplateCatalogForUser } = require('../services/template-repository');

function createTemplateCatalogRouter() {
  const router = Router();

  router.get('/template-catalog', authMiddleware, accessMiddleware, requirePermission('templates.read'), asyncHandler(async (req, res) => {
    const catalog = await getTemplateCatalogForUser({
      userId: req.userId,
      access: req.access,
      filters: {
        search: req.query.search,
        tag: req.query.tag,
        scope: req.query.scope,
        reviewState: req.query.reviewState,
      },
    });
    res.json(catalog);
  }));

  return router;
}

module.exports = { createTemplateCatalogRouter };
