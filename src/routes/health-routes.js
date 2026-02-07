const { Router } = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../utils/api-helpers');

function createHealthRouter() {
  const router = Router();

  router.get('/health', asyncHandler(async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error.message || error) });
    }
  }));

  return router;
}

module.exports = { createHealthRouter };
