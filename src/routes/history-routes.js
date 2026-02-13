const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');

function createHistoryRouter() {
  const router = Router();

  router.get('/history', authMiddleware, accessMiddleware, requirePermission('history.manage_own'), asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, fach, handlungsfeld, unterkategorie, schulstufe, ziel, template_id, provider_kind, provider_model,
              generation_mode, form_snapshot_json, metaprompt_text, result_text, has_result, created_at
       FROM prompt_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.userId]
    );

    res.json(
      result.rows.map((r) => ({
        id: r.id,
        fach: r.fach,
        handlungsfeld: r.handlungsfeld,
        unterkategorie: r.unterkategorie || '',
        schulstufe: r.schulstufe || '',
        ziel: r.ziel || '',
        templateId: r.template_id || null,
        providerKind: r.provider_kind || null,
        providerModel: r.provider_model || null,
        generationMode: r.generation_mode || 'prompt',
        formSnapshot: r.form_snapshot_json && typeof r.form_snapshot_json === 'object' ? r.form_snapshot_json : {},
        metapromptText: r.metaprompt_text || '',
        resultText: r.result_text || '',
        hasResult: Boolean(r.has_result),
        date: new Date(r.created_at).toLocaleString('de-AT'),
      }))
    );
  }));

  router.post('/history', authMiddleware, accessMiddleware, requirePermission('history.manage_own'), asyncHandler(async (req, res) => {
    const {
      fach,
      handlungsfeld,
      unterkategorie,
      schulstufe,
      ziel,
      templateId,
      providerKind,
      providerModel,
      generationMode,
      formSnapshot,
      metapromptText,
      resultText,
      hasResult,
    } = req.body || {};
    if (!fach || !handlungsfeld) {
      return res.status(400).json({ error: 'fach and handlungsfeld are required.' });
    }

    const normalizedMode = String(generationMode || 'prompt').trim().toLowerCase() === 'result' ? 'result' : 'prompt';
    const normalizedSnapshot = formSnapshot && typeof formSnapshot === 'object' && !Array.isArray(formSnapshot)
      ? formSnapshot
      : {};
    const normalizedResultText = typeof resultText === 'string' ? resultText : '';
    const normalizedHasResult = typeof hasResult === 'boolean'
      ? hasResult
      : normalizedMode === 'result' && Boolean(normalizedResultText.trim());

    const insertResult = await pool.query(
      `INSERT INTO prompt_history
         (user_id, fach, handlungsfeld, unterkategorie, schulstufe, ziel, template_id, provider_kind, provider_model,
          generation_mode, form_snapshot_json, metaprompt_text, result_text, has_result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
       RETURNING id, fach, handlungsfeld, unterkategorie, schulstufe, ziel, template_id, provider_kind, provider_model,
                 generation_mode, form_snapshot_json, metaprompt_text, result_text, has_result, created_at`,
      [
        req.userId,
        String(fach),
        String(handlungsfeld),
        typeof unterkategorie === 'string' && unterkategorie.trim() ? unterkategorie.trim() : null,
        typeof schulstufe === 'string' && schulstufe.trim() ? schulstufe.trim() : null,
        typeof ziel === 'string' && ziel.trim() ? ziel.trim() : null,
        typeof templateId === 'string' && templateId.trim() ? templateId.trim() : null,
        typeof providerKind === 'string' && providerKind.trim() ? providerKind.trim().toLowerCase() : null,
        typeof providerModel === 'string' && providerModel.trim() ? providerModel.trim() : null,
        normalizedMode,
        JSON.stringify(normalizedSnapshot),
        typeof metapromptText === 'string' && metapromptText.trim() ? metapromptText : null,
        normalizedResultText || null,
        normalizedHasResult,
      ]
    );

    const row = insertResult.rows[0];
    res.json({
      ok: true,
      entry: {
        id: row.id,
        fach: row.fach,
        handlungsfeld: row.handlungsfeld,
        unterkategorie: row.unterkategorie || '',
        schulstufe: row.schulstufe || '',
        ziel: row.ziel || '',
        templateId: row.template_id || null,
        providerKind: row.provider_kind || null,
        providerModel: row.provider_model || null,
        generationMode: row.generation_mode || 'prompt',
        formSnapshot: row.form_snapshot_json && typeof row.form_snapshot_json === 'object' ? row.form_snapshot_json : {},
        metapromptText: row.metaprompt_text || '',
        resultText: row.result_text || '',
        hasResult: Boolean(row.has_result),
        date: new Date(row.created_at).toLocaleString('de-AT'),
      },
    });
  }));

  return router;
}

module.exports = { createHistoryRouter };
