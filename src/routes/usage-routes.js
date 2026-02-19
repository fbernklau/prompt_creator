const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { sanitizeExternalErrorMessage } = require('../security/error-redaction');

function asNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function safePercent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function normalizeBudgetScopeType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'user' || normalized === 'key') return normalized;
  return '';
}

function normalizeBudgetPeriod(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') return normalized;
  return '';
}

function normalizeBudgetMode(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'soft' || normalized === 'hard' || normalized === 'hybrid') return normalized;
  return 'hybrid';
}

function parseNonNegativeNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return normalized;
}

function parseWarningRatio(value) {
  if (value === null || value === undefined || value === '') return 0.9;
  const normalized = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(normalized)) return 0.9;
  return Math.min(Math.max(normalized, 0.1), 1);
}

function createUsageRouter() {
  const router = Router();

  router.get('/usage/summary', authMiddleware, accessMiddleware, requirePermission('app.access'), asyncHandler(async (req, res) => {
    const requestedDays = Number(req.query.days);
    const windowDays = Number.isInteger(requestedDays)
      ? Math.min(Math.max(requestedDays, 7), 120)
      : 30;

    const totalResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE success = TRUE)::int AS success_count,
         ROUND(AVG(latency_ms))::int AS avg_latency_ms,
         COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
         COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(total_cost_usd), 0)::numeric AS total_cost_usd
       FROM provider_generation_events
       WHERE user_id = $1
         AND created_at >= NOW() - (($2::text || ' days')::interval)`,
      [req.userId, String(windowDays)]
    );
    const totalRow = totalResult.rows[0] || {};
    const totalRequests = asNumber(totalRow.total_count, 0);
    const successCount = asNumber(totalRow.success_count, 0);
    const avgLatencyMs = asNumber(totalRow.avg_latency_ms, 0);
    const promptTokens = asNumber(totalRow.prompt_tokens, 0);
    const completionTokens = asNumber(totalRow.completion_tokens, 0);
    const totalTokens = asNumber(totalRow.total_tokens, 0);
    const totalCostUsd = asNumber(totalRow.total_cost_usd, 0);

    const providerResult = await pool.query(
      `SELECT
         provider_id,
         provider_kind,
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE success = TRUE)::int AS success_count,
         ROUND(AVG(latency_ms))::int AS avg_latency_ms,
         COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
         COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(total_cost_usd), 0)::numeric AS total_cost_usd,
         MAX(created_at) AS last_used_at
       FROM provider_generation_events
       WHERE user_id = $1
         AND created_at >= NOW() - (($2::text || ' days')::interval)
       GROUP BY provider_id, provider_kind
       ORDER BY total_count DESC`,
      [req.userId, String(windowDays)]
    );

    const recentErrorResult = await pool.query(
      `SELECT DISTINCT ON (provider_id)
         provider_id,
         error_type,
         created_at
       FROM provider_generation_events
       WHERE user_id = $1
         AND success = FALSE
         AND created_at >= NOW() - (($2::text || ' days')::interval)
       ORDER BY provider_id, created_at DESC`,
      [req.userId, String(windowDays)]
    );
    const recentErrorByProvider = new Map();
    for (const row of recentErrorResult.rows) {
      recentErrorByProvider.set(String(row.provider_id || ''), {
        errorType: row.error_type ? sanitizeExternalErrorMessage(row.error_type, { fallback: 'Externer API-Fehler.' }) : null,
        at: row.created_at || null,
      });
    }

    const byProvider = providerResult.rows.map((row) => {
      const providerId = String(row.provider_id || '');
      const total = asNumber(row.total_count, 0);
      const success = asNumber(row.success_count, 0);
      const recentError = recentErrorByProvider.get(providerId) || null;
      return {
        providerId,
        providerKind: row.provider_kind,
        totalRequests: total,
        successRate: safePercent(success, total),
        avgLatencyMs: asNumber(row.avg_latency_ms, 0),
        promptTokens: asNumber(row.prompt_tokens, 0),
        completionTokens: asNumber(row.completion_tokens, 0),
        totalTokens: asNumber(row.total_tokens, 0),
        totalCostUsd: asNumber(row.total_cost_usd, 0),
        lastUsedAt: row.last_used_at || null,
        lastError: recentError,
      };
    });

    const keyResult = await pool.query(
      `SELECT
         key_fingerprint,
         COUNT(*)::int AS total_count,
         COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
         COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(total_cost_usd), 0)::numeric AS total_cost_usd,
         MAX(created_at) AS last_used_at
       FROM provider_generation_events
       WHERE user_id = $1
         AND key_fingerprint IS NOT NULL
         AND created_at >= NOW() - (($2::text || ' days')::interval)
       GROUP BY key_fingerprint
       ORDER BY total_count DESC`,
      [req.userId, String(windowDays)]
    );
    const byKeyFingerprints = keyResult.rows.map((row) => ({
      keyFingerprint: row.key_fingerprint,
      totalRequests: asNumber(row.total_count, 0),
      promptTokens: asNumber(row.prompt_tokens, 0),
      completionTokens: asNumber(row.completion_tokens, 0),
      totalTokens: asNumber(row.total_tokens, 0),
      totalCostUsd: asNumber(row.total_cost_usd, 0),
      lastUsedAt: row.last_used_at || null,
    }));

    const templateResult = await pool.query(
      `SELECT
         template_id,
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE success = TRUE)::int AS success_count,
         COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
         COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(total_cost_usd), 0)::numeric AS total_cost_usd
       FROM provider_generation_events
       WHERE user_id = $1
         AND created_at >= NOW() - (($2::text || ' days')::interval)
       GROUP BY template_id
       ORDER BY total_count DESC
       LIMIT 8`,
      [req.userId, String(windowDays)]
    );
    const topTemplates = templateResult.rows.map((row) => {
      const total = asNumber(row.total_count, 0);
      const success = asNumber(row.success_count, 0);
      return {
        templateId: row.template_id,
        totalRequests: total,
        successRate: safePercent(success, total),
        promptTokens: asNumber(row.prompt_tokens, 0),
        completionTokens: asNumber(row.completion_tokens, 0),
        totalTokens: asNumber(row.total_tokens, 0),
        totalCostUsd: asNumber(row.total_cost_usd, 0),
      };
    });

    res.json({
      windowDays,
      totalRequests,
      successRate: safePercent(successCount, totalRequests),
      avgLatencyMs,
      promptTokens,
      completionTokens,
      totalTokens,
      totalCostUsd,
      byProvider,
      byKeyFingerprints,
      topTemplates,
    });
  }));

  router.get('/usage/budgets', authMiddleware, accessMiddleware, requirePermission('budgets.manage_own'), asyncHandler(async (req, res) => {
    const groups = (req.userGroups || []).map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean);
    const [ownResult, effectiveResult] = await Promise.all([
      pool.query(
        `SELECT id, scope_type, scope_value, period, limit_usd, mode, warning_ratio, is_active, created_at, updated_at
         FROM budget_policies
         WHERE owner_user_id = $1
         ORDER BY scope_type, scope_value, period`,
        [req.userId]
      ),
      pool.query(
        `SELECT id, owner_user_id, scope_type, scope_value, period, limit_usd, mode, warning_ratio, is_active
         FROM budget_policies
         WHERE is_active = TRUE
           AND (
             (scope_type = 'user' AND LOWER(scope_value) = LOWER($1))
             OR (scope_type = 'group' AND (array_length($2::text[], 1) > 0) AND LOWER(scope_value) = ANY($2::text[]))
             OR (owner_user_id = $1)
           )`,
        [req.userId, groups]
      ),
    ]);

    const mapRow = (row) => ({
      id: Number(row.id),
      ownerUserId: row.owner_user_id || req.userId,
      scopeType: row.scope_type,
      scopeValue: row.scope_value,
      period: row.period,
      limitUsd: Number(row.limit_usd || 0),
      mode: row.mode || 'hybrid',
      warningRatio: Number(row.warning_ratio || 0.9),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    });

    res.json({
      ownPolicies: ownResult.rows.map(mapRow),
      effectivePolicies: effectiveResult.rows.map(mapRow),
    });
  }));

  router.put('/usage/budgets', authMiddleware, accessMiddleware, requirePermission('budgets.manage_own'), asyncHandler(async (req, res) => {
    const scopeType = normalizeBudgetScopeType(req.body?.scopeType || '');
    const scopeValueRaw = String(req.body?.scopeValue || '').trim();
    const period = normalizeBudgetPeriod(req.body?.period || '');
    const limitUsd = parseNonNegativeNumberOrNull(req.body?.limitUsd);
    const mode = normalizeBudgetMode(req.body?.mode || 'hybrid');
    const warningRatio = parseWarningRatio(req.body?.warningRatio);
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    if (!scopeType || !scopeValueRaw || !period || limitUsd === null) {
      return res.status(400).json({ error: 'scopeType, scopeValue, period and limitUsd are required.' });
    }

    let scopeValue = scopeValueRaw;
    if (scopeType === 'user') {
      scopeValue = String(req.userId).toLowerCase();
    }

    const result = await pool.query(
      `INSERT INTO budget_policies
         (owner_user_id, scope_type, scope_value, period, limit_usd, mode, warning_ratio, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$1,$1)
       ON CONFLICT (scope_type, scope_value, period)
       DO UPDATE SET
         owner_user_id = EXCLUDED.owner_user_id,
         limit_usd = EXCLUDED.limit_usd,
         mode = EXCLUDED.mode,
         warning_ratio = EXCLUDED.warning_ratio,
         is_active = EXCLUDED.is_active,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id`,
      [req.userId, scopeType, scopeValue, period, limitUsd, mode, warningRatio, isActive]
    );

    res.json({ ok: true, id: Number(result.rows[0].id) });
  }));

  router.delete('/usage/budgets/:budgetId', authMiddleware, accessMiddleware, requirePermission('budgets.manage_own'), asyncHandler(async (req, res) => {
    const budgetId = Number(req.params.budgetId);
    if (!Number.isInteger(budgetId)) return res.status(400).json({ error: 'Invalid budget id.' });
    const result = await pool.query(
      `DELETE FROM budget_policies
       WHERE id = $1 AND owner_user_id = $2
       RETURNING id`,
      [budgetId, req.userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Budget policy not found.' });
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createUsageRouter };
