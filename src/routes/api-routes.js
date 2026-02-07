const { Router } = require('express');
const { createHealthRouter } = require('./health-routes');
const { createProfileRouter } = require('./profile-routes');
const { createSettingsRouter } = require('./settings-routes');
const { createProviderRouter } = require('./provider-routes');
const { createHistoryRouter } = require('./history-routes');
const { createLibraryRouter } = require('./library-routes');
const { createTemplateCatalogRouter } = require('./template-catalog-routes');
const { createGenerateRouter } = require('./generate-routes');
const { createRbacRouter } = require('./rbac-routes');
const { createAdminRouter } = require('./admin-routes');

function createApiRouter() {
  const router = Router();

  router.use(createHealthRouter());
  router.use(createProfileRouter());
  router.use(createSettingsRouter());
  router.use(createProviderRouter());
  router.use(createHistoryRouter());
  router.use(createLibraryRouter());
  router.use(createTemplateCatalogRouter());
  router.use(createGenerateRouter());
  router.use(createRbacRouter());
  router.use(createAdminRouter());

  return router;
}

module.exports = { createApiRouter };
