const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const {
  getVisibleTemplatesForUser,
  getVisibleTemplateNodes,
  createTemplateNode,
  updateTemplateNode,
  createTemplateRecord,
  updateTemplateRecord,
  submitTemplateForReview,
  reviewTemplateSubmission,
  cloneTemplateAsPersonal,
  listTemplateTags,
  createOrUpdateTag,
  rateTemplate,
} = require('../services/template-repository');

function hasAnyPermission(access = {}, keys = []) {
  const permissions = Array.isArray(access.permissions) ? access.permissions : [];
  if (permissions.includes('*')) return true;
  return keys.some((key) => permissions.includes(key));
}

function requireAnyPermission(keys = []) {
  return (req, res, next) => {
    if (hasAnyPermission(req.access, keys)) return next();
    return res.status(403).json({ error: `Missing permissions: one of ${keys.join(', ')}` });
  };
}

function createTemplateManagementRouter() {
  const router = Router();
  const baseGuard = [authMiddleware, accessMiddleware];

  router.get('/templates', ...baseGuard, requirePermission('templates.read'), asyncHandler(async (req, res) => {
    const result = await getVisibleTemplatesForUser({
      userId: req.userId,
      access: req.access,
      filters: {
        search: req.query.search,
        tag: req.query.tag,
        scope: req.query.scope,
        reviewState: req.query.reviewState,
      },
    });
    res.json(result);
  }));

  router.get('/templates/nodes', ...baseGuard, requirePermission('templates.read'), asyncHandler(async (req, res) => {
    const nodes = await getVisibleTemplateNodes({
      userId: req.userId,
      access: req.access,
    });
    res.json(nodes);
  }));

  router.post(
    '/templates/nodes',
    ...baseGuard,
    requireAnyPermission(['templates.nodes.manage_own', 'templates.nodes.official_manage', 'templates.official_manage']),
    asyncHandler(async (req, res) => {
      const created = await createTemplateNode({
        userId: req.userId,
        access: req.access,
        payload: req.body || {},
      });
      res.json(created);
    })
  );

  router.put(
    '/templates/nodes/:nodeId',
    ...baseGuard,
    requireAnyPermission(['templates.nodes.manage_own', 'templates.nodes.official_manage', 'templates.official_manage']),
    asyncHandler(async (req, res) => {
      const updated = await updateTemplateNode({
        userId: req.userId,
        access: req.access,
        nodeId: req.params.nodeId,
        payload: req.body || {},
      });
      res.json(updated);
    })
  );

  router.post(
    '/templates',
    ...baseGuard,
    requireAnyPermission(['templates.manage_own', 'templates.official_manage', 'templates.community_manage']),
    asyncHandler(async (req, res) => {
      const created = await createTemplateRecord({
        userId: req.userId,
        access: req.access,
        payload: req.body || {},
      });
      res.json(created);
    })
  );

  router.put(
    '/templates/:templateUid',
    ...baseGuard,
    requireAnyPermission(['templates.manage_own', 'templates.official_manage', 'templates.community_manage', 'templates.review']),
    asyncHandler(async (req, res) => {
      const updated = await updateTemplateRecord({
        userId: req.userId,
        access: req.access,
        templateUid: req.params.templateUid,
        payload: req.body || {},
      });
      res.json(updated);
    })
  );

  router.post('/templates/:templateUid/submit', ...baseGuard, requirePermission('templates.submit_review'), asyncHandler(async (req, res) => {
    const submitted = await submitTemplateForReview({
      userId: req.userId,
      access: req.access,
      templateUid: req.params.templateUid,
      note: req.body?.note || '',
    });
    res.json(submitted);
  }));

  router.post('/templates/:templateUid/review', ...baseGuard, requirePermission('templates.review'), asyncHandler(async (req, res) => {
    const reviewed = await reviewTemplateSubmission({
      userId: req.userId,
      access: req.access,
      templateUid: req.params.templateUid,
      decision: req.body?.decision,
      note: req.body?.note || '',
      targetScope: req.body?.targetScope || 'community',
    });
    res.json(reviewed);
  }));

  router.post('/templates/:templateUid/clone-personal', ...baseGuard, requirePermission('templates.manage_own'), asyncHandler(async (req, res) => {
    const cloned = await cloneTemplateAsPersonal({
      userId: req.userId,
      access: req.access,
      templateUid: req.params.templateUid,
      titleSuffix: typeof req.body?.titleSuffix === 'string' ? req.body.titleSuffix : ' (Persoenliche Variante)',
      overrides: req.body?.overrides || {},
    });
    res.json(cloned);
  }));

  router.get('/templates/tags', ...baseGuard, requirePermission('tags.read'), asyncHandler(async (_req, res) => {
    const tags = await listTemplateTags();
    res.json(tags);
  }));

  router.post('/templates/tags', ...baseGuard, requireAnyPermission(['tags.manage_own', 'tags.moderate']), asyncHandler(async (req, res) => {
    const created = await createOrUpdateTag({
      userId: req.userId,
      access: req.access,
      key: req.body?.key,
      displayName: req.body?.displayName,
      description: req.body?.description,
      official: req.body?.official,
    });
    res.json(created);
  }));

  router.put('/templates/:templateUid/rating', ...baseGuard, requirePermission('templates.read'), asyncHandler(async (req, res) => {
    const result = await rateTemplate({
      userId: req.userId,
      templateUid: req.params.templateUid,
      rating: req.body?.rating,
    });
    res.json(result);
  }));

  return router;
}

module.exports = { createTemplateManagementRouter };
