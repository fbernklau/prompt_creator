const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler, clampRating, normalizeLibraryRow } = require('../utils/api-helpers');

function createLibraryRouter() {
  const router = Router();

  router.get('/library', authMiddleware, accessMiddleware, requirePermission('library.manage_own'), asyncHandler(async (req, res) => {
    const filters = ['l.user_id = $1'];
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
    if (req.query.templateId) {
      filters.push(`l.template_id = $${idx++}`);
      params.push(String(req.query.templateId));
    }
    if (req.query.search) {
      filters.push(`(l.title ILIKE $${idx} OR COALESCE(l.description_text, '') ILIKE $${idx} OR l.prompt_text ILIKE $${idx} OR COALESCE(l.result_text, '') ILIKE $${idx})`);
      params.push(`%${String(req.query.search)}%`);
      idx += 1;
    }
    if (req.query.generationMode) {
      const mode = String(req.query.generationMode).trim().toLowerCase();
      if (mode === 'prompt' || mode === 'result') {
        filters.push(`l.generation_mode = $${idx++}`);
        params.push(mode);
      }
    }

    const result = await pool.query(
      `SELECT
         l.*,
         COALESCE(r.avg_rating, 0) AS avg_rating,
         COALESCE(r.rating_count, 0) AS rating_count,
         ur.rating AS my_rating,
         (uf.library_id IS NOT NULL) AS is_favorite
       FROM prompt_library l
       LEFT JOIN (
         SELECT library_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
         FROM prompt_library_ratings
         GROUP BY library_id
       ) r ON r.library_id = l.id
       LEFT JOIN prompt_library_ratings ur ON ur.library_id = l.id AND ur.user_id = $1
       LEFT JOIN prompt_library_favorites uf ON uf.library_id = l.id AND uf.user_id = $1
       WHERE ${filters.join(' AND ')}
       ORDER BY l.updated_at DESC`,
      params
    );

    res.json(result.rows.map(normalizeLibraryRow));
  }));

  router.get('/library/public', authMiddleware, accessMiddleware, requirePermission('library.view_public'), asyncHandler(async (req, res) => {
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
    if (req.query.templateId) {
      filters.push(`l.template_id = $${idx++}`);
      params.push(String(req.query.templateId));
    }
    if (req.query.generationMode) {
      const mode = String(req.query.generationMode).trim().toLowerCase();
      if (mode === 'prompt' || mode === 'result') {
        filters.push(`l.generation_mode = $${idx++}`);
        params.push(mode);
      }
    }
    if (req.query.search) {
      filters.push(`(l.title ILIKE $${idx} OR COALESCE(l.description_text, '') ILIKE $${idx} OR l.prompt_text ILIKE $${idx} OR COALESCE(l.result_text, '') ILIKE $${idx})`);
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
         ur.rating AS my_rating,
         (uf.library_id IS NOT NULL) AS is_favorite
       FROM prompt_library l
       LEFT JOIN (
         SELECT library_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
         FROM prompt_library_ratings
         GROUP BY library_id
       ) r ON r.library_id = l.id
       LEFT JOIN prompt_library_ratings ur ON ur.library_id = l.id AND ur.user_id = $1
       LEFT JOIN prompt_library_favorites uf ON uf.library_id = l.id AND uf.user_id = $1
       WHERE ${filters.join(' AND ')}
       ORDER BY l.updated_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json(result.rows.map(normalizeLibraryRow));
  }));

  router.post('/library', authMiddleware, accessMiddleware, requirePermission('library.manage_own'), asyncHandler(async (req, res) => {
    const {
      title,
      descriptionText,
      promptText,
      fach,
      handlungsfeld,
      unterkategorie,
      isPublic,
      rating,
      templateId,
      providerKind,
      providerModel,
      generationMode,
      formSnapshot,
      metapromptText,
      resultText,
      hasResult,
    } = req.body || {};
    if (!title || !promptText || !fach || !handlungsfeld || !unterkategorie) {
      return res.status(400).json({ error: 'title, promptText, fach, handlungsfeld and unterkategorie are required.' });
    }

    const normalizedGenerationMode = String(generationMode || 'prompt').trim().toLowerCase() === 'result' ? 'result' : 'prompt';
    const normalizedSnapshot = formSnapshot && typeof formSnapshot === 'object' && !Array.isArray(formSnapshot)
      ? formSnapshot
      : {};
    const normalizedResultText = typeof resultText === 'string' ? resultText : '';
    const normalizedHasResult = typeof hasResult === 'boolean'
      ? hasResult
      : normalizedGenerationMode === 'result' && Boolean(normalizedResultText.trim());

    const insertResult = await pool.query(
      `INSERT INTO prompt_library
         (user_id, title, description_text, prompt_text, fach, handlungsfeld, unterkategorie, template_id, provider_kind, provider_model, generation_mode, form_snapshot_json, metaprompt_text, result_text, has_result, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
       RETURNING id`,
      [
        req.userId,
        String(title),
        typeof descriptionText === 'string' && descriptionText.trim() ? descriptionText.trim() : null,
        String(promptText),
        String(fach),
        String(handlungsfeld),
        String(unterkategorie),
        templateId ? String(templateId).trim() : null,
        providerKind ? String(providerKind).trim().toLowerCase() : null,
        providerModel ? String(providerModel).trim() : null,
        normalizedGenerationMode,
        JSON.stringify(normalizedSnapshot),
        typeof metapromptText === 'string' && metapromptText.trim() ? metapromptText : String(promptText),
        normalizedResultText || null,
        normalizedHasResult,
        Boolean(isPublic),
      ]
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

  router.put('/library/:id', authMiddleware, accessMiddleware, requirePermission('library.manage_own'), asyncHandler(async (req, res) => {
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
    if (typeof body.descriptionText === 'string') {
      fields.push(`description_text = $${idx++}`);
      values.push(body.descriptionText.trim() || null);
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
    if (typeof body.templateId === 'string') {
      fields.push(`template_id = $${idx++}`);
      values.push(body.templateId.trim() || null);
    }
    if (typeof body.providerKind === 'string') {
      fields.push(`provider_kind = $${idx++}`);
      values.push(body.providerKind.trim().toLowerCase() || null);
    }
    if (typeof body.providerModel === 'string') {
      fields.push(`provider_model = $${idx++}`);
      values.push(body.providerModel.trim() || null);
    }
    if (typeof body.generationMode === 'string') {
      const mode = body.generationMode.trim().toLowerCase();
      if (mode === 'prompt' || mode === 'result') {
        fields.push(`generation_mode = $${idx++}`);
        values.push(mode);
      }
    }
    if (body.formSnapshot && typeof body.formSnapshot === 'object' && !Array.isArray(body.formSnapshot)) {
      fields.push(`form_snapshot_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(body.formSnapshot));
    }
    if (typeof body.metapromptText === 'string') {
      fields.push(`metaprompt_text = $${idx++}`);
      values.push(body.metapromptText.trim() || null);
    }
    if (typeof body.resultText === 'string') {
      fields.push(`result_text = $${idx++}`);
      values.push(body.resultText.trim() || null);
    }
    if (typeof body.hasResult === 'boolean') {
      fields.push(`has_result = $${idx++}`);
      values.push(body.hasResult);
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

  router.put('/library/:id/rating', authMiddleware, accessMiddleware, requirePermission('library.rate'), asyncHandler(async (req, res) => {
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

  router.put('/library/:id/favorite', authMiddleware, accessMiddleware, requirePermission('library.view_public'), asyncHandler(async (req, res) => {
    const libraryId = Number(req.params.id);
    const isFavorite = Boolean(req.body?.isFavorite);
    if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });

    const accessResult = await pool.query(
      `SELECT id FROM prompt_library WHERE id = $1 AND (is_public = TRUE OR user_id = $2)`,
      [libraryId, req.userId]
    );
    if (!accessResult.rowCount) return res.status(404).json({ error: 'Library entry not found.' });

    if (isFavorite) {
      await pool.query(
        `INSERT INTO prompt_library_favorites (library_id, user_id)
         VALUES ($1,$2)
         ON CONFLICT (library_id, user_id) DO NOTHING`,
        [libraryId, req.userId]
      );
    } else {
      await pool.query(
        `DELETE FROM prompt_library_favorites WHERE library_id = $1 AND user_id = $2`,
        [libraryId, req.userId]
      );
    }

    res.json({ ok: true, isFavorite });
  }));

  router.get('/library/:id/open', authMiddleware, accessMiddleware, requirePermission('library.view_public'), asyncHandler(async (req, res) => {
    const libraryId = Number(req.params.id);
    if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });

    const result = await pool.query(
      `SELECT
         l.*,
         COALESCE(r.avg_rating, 0) AS avg_rating,
         COALESCE(r.rating_count, 0) AS rating_count,
         ur.rating AS my_rating,
         (uf.library_id IS NOT NULL) AS is_favorite
       FROM prompt_library l
       LEFT JOIN (
         SELECT library_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
         FROM prompt_library_ratings
         GROUP BY library_id
       ) r ON r.library_id = l.id
       LEFT JOIN prompt_library_ratings ur ON ur.library_id = l.id AND ur.user_id = $2
       LEFT JOIN prompt_library_favorites uf ON uf.library_id = l.id AND uf.user_id = $2
       WHERE l.id = $1
         AND (l.user_id = $2 OR l.is_public = TRUE)
       LIMIT 1`,
      [libraryId, req.userId]
    );

    if (!result.rowCount) return res.status(404).json({ error: 'Library entry not found.' });
    res.json(normalizeLibraryRow(result.rows[0]));
  }));

  router.delete('/library/:id', authMiddleware, accessMiddleware, requirePermission('library.manage_own'), asyncHandler(async (req, res) => {
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
