const { Router } = require('express');
const { config } = require('../config');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler, sanitizeSettings } = require('../utils/api-helpers');

function createSettingsRouter() {
  const router = Router();

  router.get('/settings', authMiddleware, asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT settings_json FROM user_settings WHERE user_id = $1', [req.userId]);
    const stored = result.rows[0]?.settings_json || {};
    res.json({ ...config.settingsDefaults, ...stored });
  }));

  router.put('/settings', authMiddleware, asyncHandler(async (req, res) => {
    const incoming = sanitizeSettings(req.body || {});
    const existingResult = await pool.query('SELECT settings_json FROM user_settings WHERE user_id = $1', [req.userId]);
    const existing = existingResult.rows[0]?.settings_json || {};
    const merged = { ...config.settingsDefaults, ...existing, ...incoming };

    await pool.query(
      `INSERT INTO user_settings (user_id, settings_json)
       VALUES ($1,$2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()`,
      [req.userId, JSON.stringify(merged)]
    );

    res.json(merged);
  }));

  return router;
}

module.exports = { createSettingsRouter };
