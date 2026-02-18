// Starter service for stage key resolution + budget enforcement.
// Wire this with your DB adapter and generation pipeline.

const crypto = require('crypto');

function normalizeSet(values = []) {
  return new Set(values.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean));
}

function normalizeBudgetPeriod(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') return normalized;
  return 'monthly';
}

function normalizeBudgetMode(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'soft' || normalized === 'hard' || normalized === 'hybrid') return normalized;
  return 'hybrid';
}

function periodToIntervalLiteral(period = 'monthly') {
  const p = normalizeBudgetPeriod(period);
  if (p === 'daily') return '1 day';
  if (p === 'weekly') return '7 days';
  return '30 days';
}

function buildKeyFingerprint(apiKey = '') {
  const normalized = String(apiKey || '').trim();
  if (!normalized) return '';
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return `sha256:${digest.slice(0, 16)}`;
}

function calcProjectedCostUsd({
  promptTokens = 0,
  completionTokens = 0,
  inputPricePerMillion = null,
  outputPricePerMillion = null,
}) {
  if (
    !Number.isFinite(Number(inputPricePerMillion)) ||
    !Number.isFinite(Number(outputPricePerMillion))
  ) {
    return null;
  }
  const inCost = (Number(promptTokens) / 1000000) * Number(inputPricePerMillion);
  const outCost = (Number(completionTokens) / 1000000) * Number(outputPricePerMillion);
  return inCost + outCost;
}

function evaluateBudget({
  isActive = false,
  limitUsd = null,
  mode = 'hybrid',
  warningRatio = 0.9,
  spendUsd = 0,
  projectedAdditionalUsd = 0,
  label = 'budget',
}) {
  if (!isActive || limitUsd === null || !Number.isFinite(Number(limitUsd))) {
    return { ok: true, warning: null, hardBlock: false, limitUsd: null, spendUsd };
  }

  const normalizedMode = normalizeBudgetMode(mode);
  const normalizedWarning = Math.min(Math.max(Number(warningRatio || 0.9), 0.1), 1);
  const nextSpend = Number(spendUsd || 0) + Number(projectedAdditionalUsd || 0);
  const limit = Number(limitUsd);
  const ratio = limit > 0 ? (nextSpend / limit) : 0;

  const warning = ratio >= normalizedWarning
    ? `${label}: warning threshold reached (${(ratio * 100).toFixed(1)}%).`
    : null;

  const over = nextSpend > limit;
  const hardBlock = over && (normalizedMode === 'hard' || normalizedMode === 'hybrid');

  return {
    ok: !hardBlock,
    warning,
    hardBlock,
    limitUsd: limit,
    spendUsd: Number(spendUsd || 0),
    projectedSpendUsd: nextSpend,
  };
}

async function resolveEffectiveKeyForStage({ db, userContext, stage }) {
  // stage: 'metaprompt' | 'result'
  // 1) load active provider profile for stage (active_meta / active_result)
  // 2) resolve key source: personal -> system assignment -> shared fallback

  const stageColumn = stage === 'result' ? 'active_result' : 'active_meta';
  const providerResult = await db.query(
    `SELECT provider_id, user_id, kind, model, base_url, key_meta, system_key_id,
            input_price_per_million, output_price_per_million, pricing_mode
       FROM providers
      WHERE user_id = $1
        AND ${stageColumn} = TRUE
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userContext.userId]
  );

  if (!providerResult.rowCount) {
    throw Object.assign(new Error(`No active provider for stage: ${stage}`), { status: 400 });
  }

  const provider = providerResult.rows[0];

  return {
    provider,
    keySource: provider.system_key_id ? 'system' : 'personal',
    systemKeyId: provider.system_key_id || null,
    assignment: null, // fill this when system key is used
  };
}

async function loadBudgetState({ db, period = 'monthly', scope }) {
  // scope examples:
  // { type: 'system_global' }
  // { type: 'system_key', systemKeyId }
  // { type: 'assignment', systemKeyId, scopeType, scopeValue }
  // { type: 'assignment_user_cap', systemKeyId, assignmentId, userId }

  const intervalLiteral = periodToIntervalLiteral(period);

  if (scope.type === 'system_global') {
    const usage = await db.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend
         FROM provider_generation_events
        WHERE effective_key_type = 'system'
          AND created_at >= NOW() - ($1::interval)`,
      [intervalLiteral]
    );
    return Number(usage.rows[0]?.spend || 0);
  }

  if (scope.type === 'system_key') {
    const usage = await db.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend
         FROM provider_generation_events
        WHERE effective_key_type = 'system'
          AND effective_key_id = $1
          AND created_at >= NOW() - ($2::interval)`,
      [scope.systemKeyId, intervalLiteral]
    );
    return Number(usage.rows[0]?.spend || 0);
  }

  return 0;
}

async function enforceBudgets({
  db,
  globalPolicy,
  keyPolicy,
  assignmentPolicy,
  perUserPolicy,
  projectedAdditionalUsd,
}) {
  const evaluations = [];

  if (globalPolicy) evaluations.push(evaluateBudget({ ...globalPolicy, projectedAdditionalUsd, label: 'global_system' }));
  if (keyPolicy) evaluations.push(evaluateBudget({ ...keyPolicy, projectedAdditionalUsd, label: 'system_key' }));
  if (assignmentPolicy) evaluations.push(evaluateBudget({ ...assignmentPolicy, projectedAdditionalUsd, label: 'assignment' }));
  if (perUserPolicy) evaluations.push(evaluateBudget({ ...perUserPolicy, projectedAdditionalUsd, label: 'assignment_per_user' }));

  const hardBlock = evaluations.find((item) => item.hardBlock);
  if (hardBlock) {
    const err = new Error(`Budget exceeded: ${hardBlock.limitUsd} USD.`);
    err.status = 402;
    err.code = 'BUDGET_LIMIT_REACHED';
    err.details = evaluations;
    throw err;
  }

  return {
    warnings: evaluations.map((item) => item.warning).filter(Boolean),
    details: evaluations,
  };
}

module.exports = {
  normalizeSet,
  normalizeBudgetPeriod,
  normalizeBudgetMode,
  periodToIntervalLiteral,
  buildKeyFingerprint,
  calcProjectedCostUsd,
  evaluateBudget,
  resolveEffectiveKeyForStage,
  loadBudgetState,
  enforceBudgets,
};
