const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler, clampRating, normalizeLibraryRow } = require('../utils/api-helpers');

function createLibraryRouter() {
  const router = Router();

  router.get('/library', authMiddleware, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT
         l.*,
         COALESCE(r.avg_rating, 0) AS avg_rating,
         COALESCE(r.rating_count, 0) AS rating_count,
         ur.rating AS my_rating
       FROM prompt_library l
       LEFT JOIN (
         SELECT library_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
         FROM prompt_library_ratings
         GROUP BY library_id
       ) r ON r.library_id = l.id
       LEFT JOIN prompt_library_ratings ur ON ur.library_id = l.id AND ur.user_id = $1
       WHERE l.user_id = $1
       ORDER BY l.updated_at DESC`,
      [req.userId]
    );

    res.json(result.rows.map(normalizeLibraryRow));
  }));

  router.get('/library/public', authMiddleware, asyncHandler(async (req, res) => {
    const filters = ['l.is_public = TRUE'];
    const params = [req.userId];
    let idx = 2;

    if (req.query.handlungsfeld) {
      filters.push(`l.handlungsfeld = $${idx++}`);
      params.push(String(req.query.handlungsfeld));
    }
    if (req.query.unterkategorie) {
      filters.push(`l.unterkategorie = $${idx++}`);
      params.push(String(req.query.unterkategorie));
    }
    if (req.query.search) {
      filters.push(`(l.title ILIKE $${idx} OR l.prompt_text ILIKE $${idx})`);
      params.push(`%${String(req.query.search)}%`);
      idx += 1;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    params.push(limit);

    const result = await pool.query(
      `SELECT
         l.*,
         COALESCE(r.avg_rating, 0) AS avg_rating,
         COALESCE(r.rating_count, 0) AS rating_count,
         ur.rating AS my_rating
       FROM prompt_library l
       LEFT JOIN (
         SELECT library_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
         FROM prompt_library_ratings
         GROUP BY library_id
       ) r ON r.library_id = l.id
       LEFT JOIN prompt_library_ratings ur ON ur.library_id = l.id AND ur.user_id = $1
       WHERE ${filters.join(' AND ')}
       ORDER BY l.updated_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json(result.rows.map(normalizeLibraryRow));
  }));

  router.post('/library', authMiddleware, asyncHandler(async (req, res) => {
    const { title, promptText, fach, handlungsfeld, unterkategorie, isPublic, rating } = req.body || {};
    if (!title || !promptText || !fach || !handlungsfeld || !unterkategorie) {
      return res.status(400).json({ error: 'title, promptText, fach, handlungsfeld and unterkategorie are required.' });
    }

    const insertResult = await pool.query(
      `INSERT INTO prompt_library (user_id, title, prompt_text, fach, handlungsfeld, unterkategorie, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [req.userId, String(title), String(promptText), String(fach), String(handlungsfeld), String(unterkategorie), Boolean(isPublic)]
    );

    const libraryId = insertResult.rows[0].id;
    const normalizedRating = clampRating(rating);
    if (normalizedRating) {
      await pool.query(
        `INSERT INTO prompt_library_ratings (library_id, user_id, rating)
         VALUES ($1,$2,$3)
         ON CONFLICT (library_id, user_id)
         DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
        [libraryId, req.userId, normalizedRating]
      );
    }

    res.json({ ok: true, id: libraryId });
  }));

  router.put('/library/:id', authMiddleware, asyncHandler(async (req, res) => {
    const libraryId = Number(req.params.id);
    if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });

    const fields = [];
    const values = [];
    let idx = 1;
    const body = req.body || {};

    if (typeof body.title === 'string' && body.title.trim()) {
      fields.push(`title = $${idx++}`);
      values.push(body.title.trim());
    }
    if (typeof body.promptText === 'string' && body.promptText.trim()) {
      fields.push(`prompt_text = $${idx++}`);
      values.push(body.promptText.trim());
    }
    if (typeof body.fach === 'string' && body.fach.trim()) {
      fields.push(`fach = $${idx++}`);
      values.push(body.fach.trim());
    }
    if (typeof body.handlungsfeld === 'string' && body.handlungsfeld.trim()) {
      fields.push(`handlungsfeld = $${idx++}`);
      values.push(body.handlungsfeld.trim());
    }
    if (typeof body.unterkategorie === 'string' && body.unterkategorie.trim()) {
      fields.push(`unterkategorie = $${idx++}`);
      values.push(body.unterkategorie.trim());
    }
    if (typeof body.isPublic === 'boolean') {
      fields.push(`is_public = $${idx++}`);
      values.push(body.isPublic);
    }

    if (!fields.length) return res.status(400).json({ error: 'No valid fields to update.' });
    fields.push('updated_at = NOW()');

    values.push(libraryId, req.userId);
    const updateResult = await pool.query(
      `UPDATE prompt_library
       SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id`,
      values
    );

    if (!updateResult.rowCount) return res.status(404).json({ error: 'Library entry not found.' });
    res.json({ ok: true });
  }));

  router.put('/library/:id/rating', authMiddleware, asyncHandler(async (req, res) => {
    const libraryId = Number(req.params.id);
    const rating = clampRating(req.body?.rating);
    if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });
    if (!rating) return res.status(400).json({ error: 'rating must be an integer between 1 and 5.' });

    const accessResult = await pool.query(
      `SELECT id FROM prompt_library WHERE id = $1 AND (is_public = TRUE OR user_id = $2)`,
      [libraryId, req.userId]
    );
    if (!accessResult.rowCount) return res.status(404).json({ error: 'Library entry not found.' });

    await pool.query(
      `INSERT INTO prompt_library_ratings (library_id, user_id, rating)
       VALUES ($1,$2,$3)
       ON CONFLICT (library_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
      [libraryId, req.userId, rating]
    );

    res.json({ ok: true });
  }));

  router.delete('/library/:id', authMiddleware, asyncHandler(async (req, res) => {
    const libraryId = Number(req.params.id);
    if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });

    const deleteResult = await pool.query(
      `DELETE FROM prompt_library WHERE id = $1 AND user_id = $2 RETURNING id`,
      [libraryId, req.userId]
    );
    if (!deleteResult.rowCount) return res.status(404).json({ error: 'Library entry not found.' });
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createLibraryRouter };
