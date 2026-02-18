const { Router } = require('express');
const { encryptApiKey, hasServerEncryptedKey } = require('./key-encryption');

function createProviderProfileRoutes({ db, auth, requirePermission, config }) {
  const router = Router();
  const guard = [auth, requirePermission('providers.manage_own')];

  router.get('/providers/assigned-system-keys', ...guard, async (req, res, next) => {
    try {
      const settings = await db.query(
        `SELECT setting_value_json
           FROM app_runtime_settings
          WHERE setting_key = 'system_keys'`
      );
      const enabled = settings.rowCount ? settings.rows[0].setting_value_json?.enabled !== false : true;
      if (!enabled) return res.json({ enabled, keys: [] });

      const userId = String(req.user?.id || '').toLowerCase();
      const groups = (req.user?.groups || []).map((g) => String(g || '').toLowerCase());
      const roles = (req.user?.roles || []).map((r) => String(r || '').toLowerCase());

      const rows = await db.query(
        `SELECT sk.system_key_id, sk.name, sk.provider_kind, sk.model_hint, sk.base_url,
                a.id AS assignment_id, a.scope_type, a.scope_value, a.is_active,
                a.budget_limit_usd, a.budget_period, a.per_user_budget_limit_usd, a.per_user_budget_period
           FROM system_provider_keys sk
           JOIN system_key_assignments a ON a.system_key_id = sk.system_key_id
          WHERE sk.is_active = TRUE
            AND a.is_active = TRUE
            AND (
              (a.scope_type = 'global')
              OR (a.scope_type = 'user' AND LOWER(a.scope_value) = LOWER($1))
              OR (a.scope_type = 'group' AND LOWER(a.scope_value) = ANY($2::text[]))
              OR (a.scope_type = 'role' AND LOWER(a.scope_value) = ANY($3::text[]))
            )
          ORDER BY sk.provider_kind, sk.name`,
        [userId, groups, roles]
      );

      res.json({ enabled, keys: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  router.put('/providers/:providerId', ...guard, async (req, res, next) => {
    try {
      const body = req.body || {};
      const providerId = Number(req.params.providerId);

      const rowResult = await db.query(
        `SELECT provider_id, user_id
           FROM providers
          WHERE provider_id = $1`,
        [providerId]
      );
      if (!rowResult.rowCount || rowResult.rows[0].user_id !== req.user?.id) {
        return res.status(404).json({ error: 'Provider not found.' });
      }

      const keyMeta = body.apiKey
        ? encryptApiKey(body.apiKey, config.keyEncryptionSecret)
        : undefined;

      await db.query(
        `UPDATE providers
            SET name = COALESCE($1, name),
                kind = COALESCE($2, kind),
                model = COALESCE($3, model),
                base_url = COALESCE($4, base_url),
                system_key_id = COALESCE($5, system_key_id),
                key_meta = COALESCE($6, key_meta),
                active_meta = COALESCE($7, active_meta),
                active_result = COALESCE($8, active_result),
                updated_at = NOW()
          WHERE provider_id = $9`,
        [
          body.name,
          body.kind,
          body.model,
          body.baseUrl,
          body.systemKeyId,
          keyMeta,
          body.activeMeta,
          body.activeResult,
          providerId,
        ]
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/providers', ...guard, async (req, res, next) => {
    try {
      const rows = await db.query(
        `SELECT provider_id, name, kind, model, base_url, key_meta, system_key_id,
                active_meta, active_result
           FROM providers
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [req.user?.id]
      );

      res.json(rows.rows.map((row) => ({
        providerId: row.provider_id,
        name: row.name,
        kind: row.kind,
        model: row.model,
        baseUrl: row.base_url,
        systemKeyId: row.system_key_id,
        hasEncryptedKey: hasServerEncryptedKey(row.key_meta),
        activeMeta: Boolean(row.active_meta),
        activeResult: Boolean(row.active_result),
      })));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createProviderProfileRoutes };
