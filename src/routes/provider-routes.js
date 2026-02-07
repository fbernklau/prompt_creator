const { Router } = require('express');
const { pool } = require('../db/pool');
const { config } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { encryptApiKey, hasServerEncryptedKey } = require('../security/key-encryption');
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

function createProviderRouter() {
  const router = Router();

  router.get('/providers', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT provider_id, name, kind, model, base_url, base_url_mode, key_meta
       FROM providers
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId]
    );

    res.json(
      result.rows.map((r) => ({
        id: r.provider_id,
        name: r.name,
        kind: r.kind,
        model: r.model,
        baseUrl: r.base_url || getRecommendedBaseUrl(r.kind),
        baseUrlMode: r.base_url_mode || 'custom',
        hasServerKey: hasServerEncryptedKey(r.key_meta),
        canUseSharedTestKey: r.kind === 'google' ? isSharedGoogleAllowed(req) : false,
      }))
    );
  }));

  router.put('/providers/:providerId', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    const providerId = req.params.providerId;
    const { name, kind, model, baseUrl, baseUrlMode, apiKey } = req.body || {};
    const normalizedBaseUrlMode = baseUrlMode === 'preset' ? 'preset' : 'custom';

    if (!name || !kind || !model) {
      return res.status(400).json({ error: 'Missing required provider fields.' });
    }

    const existingResult = await pool.query(
      `SELECT key_meta FROM providers WHERE user_id = $1 AND provider_id = $2`,
      [req.userId, providerId]
    );
    const existingKeyMeta = existingResult.rows[0]?.key_meta || {};
    const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    let encryptedKey = existingKeyMeta;
    if (trimmedApiKey) {
      encryptedKey = encryptApiKey(trimmedApiKey, config.keyEncryptionSecret);
    }

    const hasAnyKey = hasServerEncryptedKey(encryptedKey);
    const canUseShared = kind === 'google' && isSharedGoogleAllowed(req);
    if (!hasAnyKey && !canUseShared) {
      return res.status(400).json({ error: 'Bitte API-Key eingeben (oder fuer Testkonto Shared Google Key verwenden).' });
    }

    await pool.query(
      `INSERT INTO providers (user_id, provider_id, name, kind, model, base_url, base_url_mode, key_meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, provider_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         model = EXCLUDED.model,
         base_url = EXCLUDED.base_url,
         base_url_mode = EXCLUDED.base_url_mode,
         key_meta = EXCLUDED.key_meta,
         updated_at = NOW()`,
      [req.userId, providerId, name, kind, model, baseUrl || null, normalizedBaseUrlMode, encryptedKey]
    );

    res.json({ ok: true });
  }));

  router.delete('/providers/:providerId', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM providers WHERE user_id = $1 AND provider_id = $2', [req.userId, req.params.providerId]);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createProviderRouter };
