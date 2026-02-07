const { Router } = require('express');
const { pool } = require('../db/pool');
const { config } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { buildMetaprompt } = require('../services/template-engine');
const { callProvider } = require('../services/provider-clients');
const { decryptApiKey, hasServerEncryptedKey } = require('../security/key-encryption');
const { getRecommendedBaseUrl } = require('../services/provider-defaults');

function normalizeSet(values = []) {
  return new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function isSharedGoogleAllowed(req) {
  if (!config.googleTestApiKey) return false;
  const allowedUsers = normalizeSet(config.googleTestAllowedUsers);
  const allowedGroups = normalizeSet(config.googleTestAllowedGroups);
  const user = String(req.userId || '').trim().toLowerCase();
  const groups = normalizeSet(req.userGroups || []);

  if (allowedUsers.size > 0 && allowedUsers.has(user)) return true;
  if (allowedGroups.size > 0) {
    for (const group of groups) {
      if (allowedGroups.has(group)) return true;
    }
  }
  return false;
}

function getStoredApiKey(row) {
  if (!hasServerEncryptedKey(row.key_meta)) return null;
  return decryptApiKey(row.key_meta, config.keyEncryptionSecret);
}

function createGenerateRouter() {
  const router = Router();

  router.post('/generate', authMiddleware, accessMiddleware, requirePermission('prompts.generate'), asyncHandler(async (req, res) => {
    const { providerId, categoryName, subcategoryName, baseFields, dynamicValues } = req.body || {};
    if (!providerId || !categoryName || !subcategoryName) {
      return res.status(400).json({ error: 'providerId, categoryName and subcategoryName are required.' });
    }

    const providerResult = await pool.query(
      `SELECT provider_id, name, kind, model, base_url, base_url_mode, key_meta
       FROM providers
       WHERE user_id = $1 AND provider_id = $2`,
      [req.userId, providerId]
    );
    const provider = providerResult.rows[0];
    if (!provider) return res.status(404).json({ error: 'Aktiver Provider nicht gefunden.' });

    const { metaprompt, template } = buildMetaprompt({
      categoryName: String(categoryName),
      subcategoryName: String(subcategoryName),
      baseFields: baseFields || {},
      dynamicValues: dynamicValues || {},
    });

    let apiKey = getStoredApiKey(provider);
    let keySource = 'provider';
    if (!apiKey && provider.kind === 'google' && isSharedGoogleAllowed(req)) {
      apiKey = config.googleTestApiKey;
      keySource = 'shared_google_test';
    }
    if (!apiKey) {
      return res.status(400).json({
        error: 'Kein gueltiger API-Key verfuegbar. Bitte Provider-Key neu speichern oder Testzugang nutzen.',
      });
    }

    const baseUrl = provider.base_url || getRecommendedBaseUrl(provider.kind);
    if (!baseUrl) {
      return res.status(400).json({ error: 'Provider base URL fehlt.' });
    }

    const output = await callProvider({
      kind: provider.kind,
      baseUrl,
      model: provider.model,
      apiKey,
      metaprompt,
      timeoutMs: config.providerRequestTimeoutMs,
    });

    await pool.query(
      `INSERT INTO provider_usage_audit (user_id, provider_id, provider_kind, key_source, template_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.userId, provider.provider_id, provider.kind, keySource, template.id]
    );

    res.json({
      metaprompt,
      output,
      templateId: template.id,
      provider: {
        id: provider.provider_id,
        name: provider.name,
        kind: provider.kind,
        model: provider.model,
        baseUrl,
        keySource,
      },
    });
  }));

  return router;
}

module.exports = { createGenerateRouter };
