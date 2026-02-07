const { Router } = require('express');
const { getTemplateCatalog } = require('../catalog/template-catalog');
const { authMiddleware } = require('../middleware/auth');

function createTemplateCatalogRouter() {
  const router = Router();

  router.get('/template-catalog', authMiddleware, (_req, res) => {
    res.json(getTemplateCatalog());
  });

  return router;
}

module.exports = { createTemplateCatalogRouter };
