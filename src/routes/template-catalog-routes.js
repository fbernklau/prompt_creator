const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { getTemplateCatalogForUser } = require('../services/template-repository');

function collectTagFilters(query = {}) {
  const collected = [];
  const pushValue = (value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    String(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => collected.push(entry));
  };
  pushValue(query.tags);
  pushValue(query.tag);
  return [...new Set(collected)];
}

function createTemplateCatalogRouter() {
  const router = Router();

  router.get('/template-catalog', authMiddleware, accessMiddleware, requirePermission('templates.read'), asyncHandler(async (req, res) => {
    const tags = collectTagFilters(req.query);
    const catalog = await getTemplateCatalogForUser({
      userId: req.userId,
      access: req.access,
      filters: {
        search: req.query.search,
        tag: req.query.tag,
        tags,
        scope: req.query.scope,
        reviewState: req.query.reviewState,
      },
    });
    res.json(catalog);
  }));

  return router;
}

module.exports = { createTemplateCatalogRouter };
