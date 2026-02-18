const { Router } = require('express');
const { encryptApiKey } = require('./key-encryption');

function createAdminApiKeyRoutes({ db, auth, requirePermission, config }) {
  const router = Router();

  const guard = [auth, requirePermission('providers.system_keys.manage')];

  router.get('/admin/system-provider-keys/config', ...guard, async (req, res, next) => {
    try {
      const settings = await db.query(
        `SELECT setting_value_json
           FROM app_runtime_settings
          WHERE setting_key = 'system_keys'`
      );
      const keys = await db.query(
        `SELECT system_key_id, name, provider_kind, model_hint, base_url, is_active,
                budget_limit_usd, budget_period, budget_mode, budget_warning_ratio, budget_is_active,
                created_at, updated_at
           FROM system_provider_keys
          ORDER BY updated_at DESC`
      );
      res.json({
        config: settings.rowCount ? settings.rows[0].setting_value_json : { enabled: true },
        keys: keys.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/admin/system-provider-keys/config', ...guard, async (req, res, next) => {
    try {
      const payload = req.body || {};
      await db.query(
        `INSERT INTO app_runtime_settings (setting_key, setting_value_json, updated_by, updated_at)
         VALUES ('system_keys', $1::jsonb, $2, NOW())
         ON CONFLICT (setting_key)
         DO UPDATE SET
           setting_value_json = EXCLUDED.setting_value_json,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [JSON.stringify(payload), req.user?.id || 'system']
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/system-provider-keys', ...guard, async (req, res, next) => {
    try {
      const body = req.body || {};
      const keyBlob = body.apiKey
        ? encryptApiKey(body.apiKey, config.keyEncryptionSecret)
        : null;

      const result = await db.query(
        `INSERT INTO system_provider_keys (
           system_key_id, name, provider_kind, model_hint, base_url, key_meta, is_active,
           budget_limit_usd, budget_period, budget_mode, budget_warning_ratio, budget_is_active,
           created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,
           $8,$9,$10,$11,$12,
           $13,$13
         )
         RETURNING system_key_id`,
        [
          body.systemKeyId,
          body.name,
          body.providerKind,
          body.modelHint || '',
          body.baseUrl || '',
          keyBlob,
          body.isActive !== false,
          body.budgetLimitUsd ?? null,
          body.budgetPeriod || 'monthly',
          body.budgetMode || 'hybrid',
          body.budgetWarningRatio ?? 0.9,
          Boolean(body.budgetIsActive),
          req.user?.id || 'system',
        ]
      );

      res.json({ ok: true, systemKeyId: result.rows[0].system_key_id });
    } catch (err) {
      next(err);
    }
  });

  router.put('/admin/system-provider-keys/:systemKeyId', ...guard, async (req, res, next) => {
    try {
      const body = req.body || {};
      const patches = [];
      const values = [];
      let idx = 1;

      function add(field, value) {
        patches.push(`${field} = $${idx++}`);
        values.push(value);
      }

      if (Object.prototype.hasOwnProperty.call(body, 'name')) add('name', body.name);
      if (Object.prototype.hasOwnProperty.call(body, 'modelHint')) add('model_hint', body.modelHint || '');
      if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) add('base_url', body.baseUrl || '');
      if (Object.prototype.hasOwnProperty.call(body, 'isActive')) add('is_active', Boolean(body.isActive));
      if (Object.prototype.hasOwnProperty.call(body, 'budgetLimitUsd')) add('budget_limit_usd', body.budgetLimitUsd ?? null);
      if (Object.prototype.hasOwnProperty.call(body, 'budgetPeriod')) add('budget_period', body.budgetPeriod || 'monthly');
      if (Object.prototype.hasOwnProperty.call(body, 'budgetMode')) add('budget_mode', body.budgetMode || 'hybrid');
      if (Object.prototype.hasOwnProperty.call(body, 'budgetWarningRatio')) add('budget_warning_ratio', body.budgetWarningRatio ?? 0.9);
      if (Object.prototype.hasOwnProperty.call(body, 'budgetIsActive')) add('budget_is_active', Boolean(body.budgetIsActive));
      if (Object.prototype.hasOwnProperty.call(body, 'apiKey') && String(body.apiKey || '').trim()) {
        add('key_meta', encryptApiKey(body.apiKey, config.keyEncryptionSecret));
      }

      add('updated_by', req.user?.id || 'system');
      patches.push('updated_at = NOW()');

      values.push(req.params.systemKeyId);

      await db.query(
        `UPDATE system_provider_keys
            SET ${patches.join(', ')}
          WHERE system_key_id = $${idx}`,
        values
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/system-provider-keys/:systemKeyId/assignments', ...guard, async (req, res, next) => {
    try {
      const body = req.body || {};
      const result = await db.query(
        `INSERT INTO system_key_assignments (
           system_key_id, scope_type, scope_value, is_active,
           budget_limit_usd, budget_period, budget_mode, budget_warning_ratio, budget_is_active,
           per_user_budget_limit_usd, per_user_budget_period,
           created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
         RETURNING id`,
        [
          req.params.systemKeyId,
          body.scopeType,
          body.scopeValue,
          body.isActive !== false,
          body.budgetLimitUsd ?? null,
          body.budgetPeriod || 'monthly',
          body.budgetMode || 'hybrid',
          body.budgetWarningRatio ?? 0.9,
          Boolean(body.budgetIsActive),
          body.perUserBudgetLimitUsd ?? null,
          body.perUserBudgetPeriod || 'monthly',
          req.user?.id || 'system',
        ]
      );
      res.json({ ok: true, assignmentId: result.rows[0].id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createAdminApiKeyRoutes };
