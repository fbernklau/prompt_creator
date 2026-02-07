const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../utils/api-helpers');

function createHistoryRouter() {
  const router = Router();

  router.get('/history', authMiddleware, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT fach, handlungsfeld, created_at
       FROM prompt_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [req.userId]
    );

    res.json(
      result.rows.map((r) => ({
        fach: r.fach,
        handlungsfeld: r.handlungsfeld,
        date: new Date(r.created_at).toLocaleString('de-AT'),
      }))
    );
  }));

  router.post('/history', authMiddleware, asyncHandler(async (req, res) => {
    const { fach, handlungsfeld } = req.body || {};
    if (!fach || !handlungsfeld) {
      return res.status(400).json({ error: 'fach and handlungsfeld are required.' });
    }

    await pool.query('INSERT INTO prompt_history (user_id, fach, handlungsfeld) VALUES ($1,$2,$3)', [req.userId, fach, handlungsfeld]);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createHistoryRouter };
