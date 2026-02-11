const { Router } = require('express');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');

function asNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function safePercent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
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
    const totalTokens = asNumber(totalRow.total_tokens, 0);
    const totalCostUsd = asNumber(totalRow.total_cost_usd, 0);

    const providerResult = await pool.query(
      `SELECT
         provider_id,
         provider_kind,
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE success = TRUE)::int AS success_count,
         ROUND(AVG(latency_ms))::int AS avg_latency_ms,
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
        errorType: row.error_type || null,
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
      totalTokens: asNumber(row.total_tokens, 0),
      totalCostUsd: asNumber(row.total_cost_usd, 0),
      lastUsedAt: row.last_used_at || null,
    }));

    const templateResult = await pool.query(
      `SELECT
         template_id,
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE success = TRUE)::int AS success_count,
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
        totalTokens: asNumber(row.total_tokens, 0),
        totalCostUsd: asNumber(row.total_cost_usd, 0),
      };
    });

    res.json({
      windowDays,
      totalRequests,
      successRate: safePercent(successCount, totalRequests),
      avgLatencyMs,
      totalTokens,
      totalCostUsd,
      byProvider,
      byKeyFingerprints,
      topTemplates,
    });
  }));

  return router;
}

module.exports = { createUsageRouter };
