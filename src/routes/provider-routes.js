const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../utils/api-helpers');

function createProviderRouter() {
  const router = Router();

  router.get('/providers', authMiddleware, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT provider_id, name, kind, model, base_url, key_meta
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
        baseUrl: r.base_url || '',
        keyMeta: r.key_meta,
      }))
    );
  }));

  router.put('/providers/:providerId', authMiddleware, asyncHandler(async (req, res) => {
    const providerId = req.params.providerId;
    const { name, kind, model, baseUrl, keyMeta } = req.body || {};

    if (!name || !kind || !model || !keyMeta) {
      return res.status(400).json({ error: 'Missing required provider fields.' });
    }

    await pool.query(
      `INSERT INTO providers (user_id, provider_id, name, kind, model, base_url, key_meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, provider_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         model = EXCLUDED.model,
         base_url = EXCLUDED.base_url,
         key_meta = EXCLUDED.key_meta,
         updated_at = NOW()`,
      [req.userId, providerId, name, kind, model, baseUrl || null, keyMeta]
    );

    res.json({ ok: true });
  }));

  router.delete('/providers/:providerId', authMiddleware, asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM providers WHERE user_id = $1 AND provider_id = $2', [req.userId, req.params.providerId]);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createProviderRouter };
