const { Router } = require('express');
const { getTemplateCatalog } = require('../catalog/template-catalog');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');

function createTemplateCatalogRouter() {
  const router = Router();

  router.get('/template-catalog', authMiddleware, accessMiddleware, requirePermission('app.access'), (_req, res) => {
    res.json(getTemplateCatalog());
  });

  return router;
}

module.exports = { createTemplateCatalogRouter };
