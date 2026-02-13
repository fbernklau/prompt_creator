const { Router } = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { config } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { buildMetapromptFromTemplate } = require('../services/template-engine');
const { callProviderDetailed, callProviderDetailedStream, isOverloadedProviderError } = require('../services/provider-clients');
const { decryptApiKey, hasServerEncryptedKey } = require('../security/key-encryption');
const { getRecommendedBaseUrl } = require('../services/provider-defaults');
const {
  getTemplateForGeneration,
  cloneTemplateAsPersonal,
  normalizeDynamicFields,
  normalizeBaseFieldList,
  normalizeTagKeys,
} = require('../services/template-repository');

function normalizeSet(values = []) {
  return new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function uniqueList(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeBudgetMode(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'soft' || normalized === 'hard' || normalized === 'hybrid') return normalized;
  return 'hybrid';
}

function normalizeBudgetPeriod(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') return normalized;
  return 'monthly';
}

function periodToIntervalLiteral(period = 'monthly') {
  const normalized = normalizeBudgetPeriod(period);
  if (normalized === 'daily') return '1 day';
  if (normalized === 'weekly') return '7 days';
  return '30 days';
}

function asLowerList(values = []) {
  return uniqueList(values.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asNonNegativeInt(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return 0;
  return Math.round(normalized);
}

function asNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return normalized;
}

function parseNonNegativeFloatOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return normalized;
}

function estimateTokenCount(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;
  return Math.max(Math.ceil(normalized.length / 4), 1);
}

function mergeUsage(total = {}, next = {}, { promptFallback = '', completionFallback = '' } = {}) {
  const promptTokens = asNonNegativeInt(next.promptTokens);
  const completionTokens = asNonNegativeInt(next.completionTokens);
  const totalTokens = asNonNegativeInt(next.totalTokens);
  const resolvedPrompt = promptTokens > 0 ? promptTokens : estimateTokenCount(promptFallback);
  const resolvedCompletion = completionTokens > 0 ? completionTokens : estimateTokenCount(completionFallback);
  const resolvedTotal = totalTokens > 0 ? totalTokens : resolvedPrompt + resolvedCompletion;

  return {
    promptTokens: asNonNegativeInt(total.promptTokens) + resolvedPrompt,
    completionTokens: asNonNegativeInt(total.completionTokens) + resolvedCompletion,
    totalTokens: asNonNegativeInt(total.totalTokens) + resolvedTotal,
  };
}

function buildKeyFingerprint(apiKey = '') {
  const normalized = String(apiKey || '').trim();
  if (!normalized) return null;
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return `sha256:${digest.slice(0, 16)}`;
}

async function getSystemKeysEnabled() {
  const result = await pool.query(
    `SELECT setting_value_json
     FROM app_runtime_settings
     WHERE setting_key = 'system_keys'`
  );
  if (!result.rowCount) return true;
  return Boolean(result.rows[0]?.setting_value_json?.enabled !== false);
}

async function resolvePricingForProvider(provider) {
  const pricingMode = String(provider?.pricing_mode || 'catalog').trim().toLowerCase();
  const customInput = asNullableNumber(provider?.input_price_per_million);
  const customOutput = asNullableNumber(provider?.output_price_per_million);

  if (pricingMode === 'custom' && customInput !== null && customOutput !== null) {
    return {
      source: 'provider_custom',
      inputPricePerMillion: customInput,
      outputPricePerMillion: customOutput,
      currency: 'USD',
    };
  }

  const catalogResult = await pool.query(
    `SELECT input_price_per_million, output_price_per_million, currency
     FROM provider_model_pricing_catalog
     WHERE provider_kind = $1
       AND model = $2
       AND is_active = TRUE
     LIMIT 1`,
    [provider.kind, provider.model]
  );
  if (!catalogResult.rowCount) return null;

  const row = catalogResult.rows[0];
  const inputPricePerMillion = asNullableNumber(row.input_price_per_million);
  const outputPricePerMillion = asNullableNumber(row.output_price_per_million);
  if (inputPricePerMillion === null || outputPricePerMillion === null) return null;

  return {
    source: 'catalog',
    inputPricePerMillion,
    outputPricePerMillion,
    currency: String(row.currency || 'USD').trim().toUpperCase() || 'USD',
  };
}

function calculateUsageCost(usage = {}, pricing = null) {
  const promptTokens = asNonNegativeInt(usage.promptTokens);
  const completionTokens = asNonNegativeInt(usage.completionTokens);
  const totalTokens = asNonNegativeInt(usage.totalTokens);
  if (!pricing) {
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      inputCostUsd: null,
      outputCostUsd: null,
      totalCostUsd: null,
      pricingSource: null,
      pricingInputPerMillion: null,
      pricingOutputPerMillion: null,
      pricingCurrency: null,
    };
  }

  const inputPricePerMillion = asNullableNumber(pricing.inputPricePerMillion);
  const outputPricePerMillion = asNullableNumber(pricing.outputPricePerMillion);
  if (inputPricePerMillion === null || outputPricePerMillion === null) {
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      inputCostUsd: null,
      outputCostUsd: null,
      totalCostUsd: null,
      pricingSource: pricing.source || null,
      pricingInputPerMillion: null,
      pricingOutputPerMillion: null,
      pricingCurrency: pricing.currency || 'USD',
    };
  }

  const inputCostUsd = (promptTokens / 1000000) * inputPricePerMillion;
  const outputCostUsd = (completionTokens / 1000000) * outputPricePerMillion;
  const totalCostUsd = inputCostUsd + outputCostUsd;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    pricingSource: pricing.source || null,
    pricingInputPerMillion: inputPricePerMillion,
    pricingOutputPerMillion: outputPricePerMillion,
    pricingCurrency: pricing.currency || 'USD',
  };
}

async function estimateCompletionRatio({ userId, providerKind, providerModel }) {
  const result = await pool.query(
    `SELECT AVG((completion_tokens::numeric / NULLIF(prompt_tokens, 0))) AS ratio
     FROM provider_generation_events
     WHERE user_id = $1
       AND provider_kind = $2
       AND provider_model = $3
       AND success = TRUE
       AND prompt_tokens > 0
       AND completion_tokens >= 0
       AND created_at >= NOW() - ('30 days'::interval)`,
    [userId, providerKind, providerModel]
  );
  const ratio = Number(result.rows[0]?.ratio);
  if (!Number.isFinite(ratio) || ratio <= 0) return 1.25;
  return Math.min(Math.max(ratio, 0.2), 6);
}

async function estimateProjectedUsageAndCost({
  userId,
  provider,
  pricing,
  promptText,
}) {
  const promptTokens = Math.max(estimateTokenCount(promptText), 1);
  const ratio = await estimateCompletionRatio({
    userId,
    providerKind: provider.kind,
    providerModel: provider.model,
  });
  const completionTokens = Math.max(Math.round(promptTokens * ratio), 1);
  const usage = {
    promptTokens: asNonNegativeInt(promptTokens),
    completionTokens: asNonNegativeInt(completionTokens),
    totalTokens: asNonNegativeInt(promptTokens + completionTokens),
  };
  const cost = calculateUsageCost(usage, pricing);
  return {
    ratio,
    usage,
    cost,
    projectedCostUsd: Number(cost.totalCostUsd || 0),
  };
}

async function listApplicableBudgetPolicies({
  userId,
  userGroups = [],
  keyFingerprint = '',
}) {
  const groups = asLowerList(userGroups);
  const normalizedFingerprint = String(keyFingerprint || '').trim();
  const result = await pool.query(
    `SELECT id, owner_user_id, scope_type, scope_value, period, limit_usd, mode, warning_ratio, is_active
     FROM budget_policies
     WHERE is_active = TRUE
       AND (owner_user_id IS NULL OR owner_user_id = $1)
       AND (
         (scope_type = 'user' AND LOWER(scope_value) = LOWER($1))
         OR (scope_type = 'group' AND (array_length($2::text[], 1) > 0) AND LOWER(scope_value) = ANY($2::text[]))
         OR (scope_type = 'key' AND $3 <> '' AND scope_value = $3)
       )`,
    [userId, groups, normalizedFingerprint]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    ownerUserId: row.owner_user_id || null,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    period: normalizeBudgetPeriod(row.period),
    limitUsd: Number(row.limit_usd || 0),
    mode: normalizeBudgetMode(row.mode),
    warningRatio: Number(row.warning_ratio || 0.9),
    isActive: Boolean(row.is_active),
  }));
}

async function resolveBudgetSpendUsd({ policy }) {
  const intervalLiteral = periodToIntervalLiteral(policy.period);
  if (policy.scopeType === 'user') {
    const result = await pool.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE user_id = $1
         AND created_at >= NOW() - ($2::interval)`,
      [policy.scopeValue, intervalLiteral]
    );
    return Number(result.rows[0]?.spend_usd || 0);
  }
  if (policy.scopeType === 'group') {
    const result = await pool.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE user_groups_json ? $1
         AND created_at >= NOW() - ($2::interval)`,
      [policy.scopeValue, intervalLiteral]
    );
    return Number(result.rows[0]?.spend_usd || 0);
  }
  if (policy.scopeType === 'key') {
    const result = await pool.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE key_fingerprint = $1
         AND created_at >= NOW() - ($2::interval)`,
      [policy.scopeValue, intervalLiteral]
    );
    return Number(result.rows[0]?.spend_usd || 0);
  }
  return 0;
}

async function recordBudgetEvent({
  userId,
  policy,
  action,
  message,
  projectedCostUsd,
  currentSpendUsd,
  limitUsd,
}) {
  await pool.query(
    `INSERT INTO budget_events
       (user_id, policy_id, scope_type, scope_value, action, message, projected_cost_usd, current_spend_usd, limit_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      userId,
      policy?.id || null,
      policy?.scopeType || 'user',
      policy?.scopeValue || userId,
      action,
      message,
      projectedCostUsd ?? null,
      currentSpendUsd ?? null,
      limitUsd ?? null,
    ]
  );
}

function budgetLabel(policy) {
  return `${policy.scopeType}:${policy.scopeValue} (${policy.period})`;
}

async function enforceBudgetPolicies({
  req,
  keyFingerprint = '',
  estimatedIncrementUsd = 0,
  phaseLabel = 'Generierung',
  onWarning = null,
}) {
  const incrementUsd = Number(estimatedIncrementUsd);
  if (!Number.isFinite(incrementUsd) || incrementUsd <= 0) return [];

  const policies = await listApplicableBudgetPolicies({
    userId: req.userId,
    userGroups: req.userGroups || [],
    keyFingerprint,
  });
  if (!policies.length) return [];

  const warnings = [];
  for (const policy of policies) {
    const spendUsd = await resolveBudgetSpendUsd({ policy });
    const limitUsd = Number(policy.limitUsd || 0);
    const warningRatio = Number(policy.warningRatio || 0.9);
    const warningThreshold = limitUsd * warningRatio;
    const projectedUsd = spendUsd + incrementUsd;
    const mode = normalizeBudgetMode(policy.mode);

    const shouldWarn = projectedUsd >= warningThreshold;
    const shouldBlock = (mode === 'hard' && projectedUsd > limitUsd)
      || (mode === 'hybrid' && spendUsd >= limitUsd);

    if (shouldWarn) {
      const message = `${phaseLabel}: Budget-Hinweis für ${budgetLabel(policy)} — aktuell $${spendUsd.toFixed(4)}, prognostiziert $${projectedUsd.toFixed(4)} bei Limit $${limitUsd.toFixed(4)}.`;
      warnings.push({
        policyId: policy.id,
        scopeType: policy.scopeType,
        scopeValue: policy.scopeValue,
        period: policy.period,
        mode,
        message,
        spendUsd,
        projectedUsd,
        limitUsd,
      });
      if (typeof onWarning === 'function') onWarning(message);
      await recordBudgetEvent({
        userId: req.userId,
        policy,
        action: 'warn',
        message,
        projectedCostUsd: projectedUsd,
        currentSpendUsd: spendUsd,
        limitUsd,
      });
    }

    if (shouldBlock) {
      const message = `${phaseLabel}: Budget-Limit erreicht für ${budgetLabel(policy)} (aktuell $${spendUsd.toFixed(4)} / Limit $${limitUsd.toFixed(4)}).`;
      await recordBudgetEvent({
        userId: req.userId,
        policy,
        action: 'block',
        message,
        projectedCostUsd: projectedUsd,
        currentSpendUsd: spendUsd,
        limitUsd,
      });
      throw httpError(402, message);
    }
  }

  return warnings;
}

function normalizeSystemAssignment(scopeType = '', scopeValue = '') {
  const type = String(scopeType || '').trim().toLowerCase();
  const value = String(scopeValue || '').trim().toLowerCase();
  return { type, value };
}

async function resolveSystemAssignmentSpendUsd({
  systemKeyId,
  assignmentScopeType,
  assignmentScopeValue,
  period = 'monthly',
}) {
  const intervalLiteral = periodToIntervalLiteral(period);
  const { type, value } = normalizeSystemAssignment(assignmentScopeType, assignmentScopeValue);
  if (type === 'user') {
    const result = await pool.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE effective_key_type = 'system'
         AND effective_key_id = $1
         AND LOWER(user_id) = LOWER($2)
         AND created_at >= NOW() - ($3::interval)`,
      [systemKeyId, value, intervalLiteral]
    );
    return Number(result.rows[0]?.spend_usd || 0);
  }

  if (type === 'group' && value === '*') {
    const result = await pool.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE effective_key_type = 'system'
         AND effective_key_id = $1
         AND created_at >= NOW() - ($2::interval)`,
      [systemKeyId, intervalLiteral]
    );
    return Number(result.rows[0]?.spend_usd || 0);
  }

  if (type === 'group') {
    const result = await pool.query(
      `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
       FROM provider_generation_events
       WHERE effective_key_type = 'system'
         AND effective_key_id = $1
         AND user_groups_json ? $2
         AND created_at >= NOW() - ($3::interval)`,
      [systemKeyId, value, intervalLiteral]
    );
    return Number(result.rows[0]?.spend_usd || 0);
  }

  const result = await pool.query(
    `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
     FROM provider_generation_events
     WHERE effective_key_type = 'system'
       AND effective_key_id = $1
       AND user_roles_json ? $2
       AND created_at >= NOW() - ($3::interval)`,
    [systemKeyId, value, intervalLiteral]
  );
  return Number(result.rows[0]?.spend_usd || 0);
}

async function resolveSystemAssignmentUserSpendUsd({
  userId,
  systemKeyId,
  period = 'monthly',
}) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(total_cost_usd), 0)::numeric AS spend_usd
     FROM provider_generation_events
     WHERE effective_key_type = 'system'
       AND effective_key_id = $1
       AND LOWER(user_id) = LOWER($2)
       AND created_at >= NOW() - ($3::interval)`,
    [systemKeyId, userId, periodToIntervalLiteral(period)]
  );
  return Number(result.rows[0]?.spend_usd || 0);
}

function normalizeSystemBudgetMode(value = '') {
  return normalizeBudgetMode(value || 'hybrid');
}

async function enforceSystemAssignmentBudget({
  req,
  systemKey = null,
  estimatedIncrementUsd = 0,
  phaseLabel = 'Generierung',
  onWarning = null,
}) {
  if (!systemKey) return [];
  const incrementUsd = Number(estimatedIncrementUsd);
  if (!Number.isFinite(incrementUsd) || incrementUsd <= 0) return [];
  const warnings = [];

  const assignmentLimit = parseNonNegativeFloatOrNull(systemKey.budget_limit_usd);
  const assignmentPeriod = normalizeBudgetPeriod(systemKey.budget_period || 'monthly') || 'monthly';
  const assignmentMode = normalizeSystemBudgetMode(systemKey.budget_mode || 'hybrid');
  const assignmentWarningRatio = Number(systemKey.budget_warning_ratio || 0.9);
  const assignmentBudgetEnabled = Boolean(systemKey.budget_is_active) && assignmentLimit !== null;
  if (assignmentBudgetEnabled) {
    const spendUsd = await resolveSystemAssignmentSpendUsd({
      systemKeyId: systemKey.system_key_id,
      assignmentScopeType: systemKey.scope_type,
      assignmentScopeValue: systemKey.scope_value,
      period: assignmentPeriod,
    });
    const projectedUsd = spendUsd + incrementUsd;
    const warningThreshold = assignmentLimit * assignmentWarningRatio;
    const shouldWarn = projectedUsd >= warningThreshold;
    const shouldBlock = (assignmentMode === 'hard' && projectedUsd > assignmentLimit)
      || (assignmentMode === 'hybrid' && spendUsd >= assignmentLimit);
    if (shouldWarn) {
      const message = `${phaseLabel}: Zuweisungsbudget-Hinweis (${systemKey.scope_type}:${systemKey.scope_value}) — aktuell $${spendUsd.toFixed(4)}, prognostiziert $${projectedUsd.toFixed(4)} bei Limit $${assignmentLimit.toFixed(4)}.`;
      warnings.push({
        type: 'assignment',
        scopeType: systemKey.scope_type,
        scopeValue: systemKey.scope_value,
        period: assignmentPeriod,
        mode: assignmentMode,
        message,
        spendUsd,
        projectedUsd,
        limitUsd: assignmentLimit,
      });
      if (typeof onWarning === 'function') onWarning(message);
    }
    if (shouldBlock) {
      throw httpError(402, `${phaseLabel}: Zuweisungsbudget erreicht (${systemKey.scope_type}:${systemKey.scope_value}) — aktuell $${spendUsd.toFixed(4)} / Limit $${assignmentLimit.toFixed(4)}.`);
    }
  }

  const perUserLimit = parseNonNegativeFloatOrNull(systemKey.per_user_budget_limit_usd);
  const perUserPeriod = normalizeBudgetPeriod(systemKey.per_user_budget_period || assignmentPeriod || 'monthly') || 'monthly';
  if (perUserLimit !== null) {
    const spendUsd = await resolveSystemAssignmentUserSpendUsd({
      userId: req.userId,
      systemKeyId: systemKey.system_key_id,
      period: perUserPeriod,
    });
    const projectedUsd = spendUsd + incrementUsd;
    const warningThreshold = perUserLimit * assignmentWarningRatio;
    const shouldWarn = projectedUsd >= warningThreshold;
    const shouldBlock = (assignmentMode === 'hard' && projectedUsd > perUserLimit)
      || (assignmentMode === 'hybrid' && spendUsd >= perUserLimit);
    if (shouldWarn) {
      const message = `${phaseLabel}: Pro-Nutzer-Budget-Hinweis (${req.userId}) — aktuell $${spendUsd.toFixed(4)}, prognostiziert $${projectedUsd.toFixed(4)} bei Limit $${perUserLimit.toFixed(4)}.`;
      warnings.push({
        type: 'assignment_per_user',
        scopeType: 'user',
        scopeValue: req.userId,
        period: perUserPeriod,
        mode: assignmentMode,
        message,
        spendUsd,
        projectedUsd,
        limitUsd: perUserLimit,
      });
      if (typeof onWarning === 'function') onWarning(message);
    }
    if (shouldBlock) {
      throw httpError(402, `${phaseLabel}: Pro-Nutzer-Budget erreicht — aktuell $${spendUsd.toFixed(4)} / Limit $${perUserLimit.toFixed(4)}.`);
    }
  }
  return warnings;
}

function combineUsageSummaries(...entries) {
  return entries.reduce((acc, current) => ({
    promptTokens: asNonNegativeInt(acc.promptTokens) + asNonNegativeInt(current?.promptTokens),
    completionTokens: asNonNegativeInt(acc.completionTokens) + asNonNegativeInt(current?.completionTokens),
    totalTokens: asNonNegativeInt(acc.totalTokens) + asNonNegativeInt(current?.totalTokens),
  }), {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
}

function combineCostSummaries(...entries) {
  const sumNullable = (key) => {
    let hasNumber = false;
    let total = 0;
    entries.forEach((entry) => {
      const value = asNullableNumber(entry?.[key]);
      if (value === null) return;
      hasNumber = true;
      total += value;
    });
    return hasNumber ? total : null;
  };

  return {
    inputCostUsd: sumNullable('inputCostUsd'),
    outputCostUsd: sumNullable('outputCostUsd'),
    totalCostUsd: sumNullable('totalCostUsd'),
    pricingSource: entries
      .map((entry) => String(entry?.pricingSource || '').trim())
      .filter(Boolean)
      .join('+') || null,
    pricingInputPerMillion: null,
    pricingOutputPerMillion: null,
    pricingCurrency: entries.find((entry) => entry?.pricingCurrency)?.pricingCurrency || 'USD',
  };
}

function isSharedGoogleAllowed(req) {
  if (!config.googleTestApiKey) return false;
  const allowedUsers = normalizeSet(config.googleTestAllowedUsers);
  const allowedGroups = normalizeSet(config.googleTestAllowedGroups);
  const user = String(req.userId || '').trim().toLowerCase();
  const groups = normalizeSet(req.userGroups || []);

  if (allowedUsers.size > 0 && allowedUsers.has(user)) return true;
  if (allowedGroups.size > 0) {
    for (const group of groups) {
      if (allowedGroups.has(group)) return true;
    }
  }
  return false;
}

function getStoredApiKey(row) {
  if (!hasServerEncryptedKey(row.key_meta)) return null;
  return decryptApiKey(row.key_meta, config.keyEncryptionSecret);
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function stripCodeFence(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('```')) return trimmed;

  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : trimmed;
}

function isLikelyHandoffPrompt(text = '') {
  const normalized = String(text || '').trim();
  if (normalized.length < 40) return false;
  return /^(du bist|you are)\b/i.test(normalized);
}

function extractPromptFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.handoff_prompt,
    payload.handoffPrompt,
    payload.prompt,
    payload.final_prompt,
  ];
  for (const entry of candidates) {
    if (typeof entry !== 'string') continue;
    const candidate = entry.trim();
    if (!candidate) continue;
    if (isLikelyHandoffPrompt(candidate)) return candidate;
  }
  return null;
}

function parseHandoffPrompt(rawOutput = '') {
  const text = String(rawOutput || '').trim();
  if (!text) return null;

  const directJson = tryParseJson(text);
  const fromDirectJson = extractPromptFromPayload(directJson);
  if (fromDirectJson) return fromDirectJson;

  const fenceStripped = stripCodeFence(text);
  const fenceJson = tryParseJson(fenceStripped);
  const fromFenceJson = extractPromptFromPayload(fenceJson);
  if (fromFenceJson) return fromFenceJson;

  if (isLikelyHandoffPrompt(fenceStripped)) return fenceStripped;
  return null;
}

function buildRepairMetaprompt(rawOutput) {
  const original = String(rawOutput || '').trim() || '(leer)';
  return `Konvertiere die folgende Antwort strikt in ein JSON-Objekt mit genau einem Feld "handoff_prompt".

Regeln:
- Gib nur JSON aus, kein Markdown.
- "handoff_prompt" muss mit "Du bist" beginnen.
- Liefere keinen fachlichen Ergebnistext, sondern nur einen ausfuehrbaren Handoff-Prompt fuer eine zweite KI.

Antwort zum Konvertieren:
${original}`;
}

const SENSITIVE_DATA_TERMS = [
  'name des sch',
  'name der sch',
  'name des kind',
  'voller name',
  'vorname',
  'nachname',
  'adresse',
  'anschrift',
  'geburtsdatum',
  'telefon',
  'handynummer',
  'email',
  'e-mail',
  'mailadresse',
  'kontaktdaten',
  'id-nummer',
  'id nummer',
  'personalausweis',
  'svnr',
  'sozialversicherungsnummer',
  'gesundheitsdaten',
  'diagnose',
  'krankheit',
];

const PRIVACY_SAFE_MARKERS = [
  'keine',
  'nicht',
  'ohne',
  'vermeide',
  'platzhalter',
  'anonym',
  '[vorname]',
  '[nachname]',
  '[klasse]',
  '[schule]',
  '[datum]',
];

const PRIVACY_POLICY_BLOCK = `Datenschutzvorgaben (verbindlich):
- Fordere keine personenbezogenen oder sensiblen Daten an.
- Nutze bei Personenbezug ausschliesslich Platzhalter wie [VORNAME], [NACHNAME], [KLASSE], [SCHULE], [DATUM].
- Falls personenbezogene Angaben vorliegen, ersetze sie durch Platzhalter und verarbeite sie nicht woertlich.`;

function normalizeForMatch(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function lineContainsSensitiveDataRequest(line = '') {
  const normalized = normalizeForMatch(line);
  if (!normalized) return false;
  const hasSensitiveTerm = SENSITIVE_DATA_TERMS.some((term) => normalized.includes(term));
  if (!hasSensitiveTerm) return false;
  const hasSafeMarker = PRIVACY_SAFE_MARKERS.some((marker) => normalized.includes(marker));
  return !hasSafeMarker;
}

function hasPrivacyRisk(prompt = '') {
  const lines = String(prompt || '').split(/\r?\n/);
  return lines.some((line) => lineContainsSensitiveDataRequest(line));
}

function ensurePrivacyPolicyBlock(prompt = '') {
  const text = String(prompt || '').trim();
  if (!text) return PRIVACY_POLICY_BLOCK;
  if (/datenschutzvorgaben\s*\(verbindlich\)/i.test(text)) return text;
  return `${text}\n\n${PRIVACY_POLICY_BLOCK}`;
}

function redactSensitiveTerms(prompt = '') {
  const replacements = [
    [/name des sch(?:u|ue)lers?/gi, '[VORNAME]'],
    [/name der sch(?:u|ue)lerin/gi, '[VORNAME]'],
    [/name des kindes/gi, '[VORNAME]'],
    [/\bvorname\b/gi, '[VORNAME]'],
    [/\bnachname\b/gi, '[NACHNAME]'],
    [/\bgeburtsdatum\b/gi, '[DATUM]'],
    [/\badresse\b/gi, '[ADRESSE]'],
    [/\banschrift\b/gi, '[ADRESSE]'],
    [/\btelefon(?:nummer)?\b/gi, '[TELEFON]'],
    [/\bhandynummer\b/gi, '[TELEFON]'],
    [/\be-?mail(?:adresse)?\b/gi, '[E-MAIL]'],
    [/\bsozialversicherungsnummer\b/gi, '[ID]'],
    [/\bsvnr\b/gi, '[ID]'],
    [/\bid-?nummer\b/gi, '[ID]'],
    [/\bpersonalausweis\b/gi, '[ID]'],
  ];
  let redacted = String(prompt || '');
  replacements.forEach(([pattern, replacement]) => {
    redacted = redacted.replace(pattern, replacement);
  });
  return redacted;
}

function sanitizePromptForPrivacy(prompt = '') {
  const lines = String(prompt || '').split(/\r?\n/);
  const kept = [];
  let removedSensitiveLines = 0;
  lines.forEach((line) => {
    if (lineContainsSensitiveDataRequest(line)) {
      removedSensitiveLines += 1;
      return;
    }
    kept.push(line);
  });
  const compact = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const redacted = redactSensitiveTerms(compact || String(prompt || '').trim());
  const withPolicy = ensurePrivacyPolicyBlock(redacted);
  return {
    output: withPolicy,
    removedSensitiveLines: removedSensitiveLines > 0,
  };
}

function buildPrivacyRepairMetaprompt(rawPrompt) {
  const original = String(rawPrompt || '').trim() || '(leer)';
  return `Du bist ein Prompt-Editor.
Schreibe den folgenden Handoff-Prompt datenschutzkonform um.

Regeln:
- Erhalte Ziel, Struktur und fachlichen Kontext.
- Entferne jede Aufforderung zur Eingabe personenbezogener oder sensibler Daten.
- Ersetze personenbezogene Angaben konsequent durch Platzhalter (z. B. [VORNAME], [KLASSE], [SCHULE], [DATUM]).
- Falls Rueckfragen noetig sind, frage nur nach anonymem didaktischem Kontext.
- Der Prompt muss mit "Du bist" beginnen.
- Gib nur JSON aus.

Verbindliches Ausgabeformat:
{
  "handoff_prompt": "Du bist ..."
}

Zu ueberarbeitender Prompt:
${original}`;
}

async function getProviderForUser(req, providerId) {
  const providerResult = await pool.query(
    `SELECT provider_id, name, kind, model, base_url, base_url_mode, pricing_mode, input_price_per_million, output_price_per_million, key_meta, system_key_id
     FROM providers
     WHERE user_id = $1 AND provider_id = $2`,
    [req.userId, providerId]
  );
  return providerResult.rows[0] || null;
}

async function findAssignedSystemKey(req, provider) {
  const systemKeysEnabled = await getSystemKeysEnabled();
  if (!systemKeysEnabled) return null;
  const groups = asLowerList(req.userGroups || []);
  const roles = asLowerList(req.access?.roles || []);
  const result = await pool.query(
    `SELECT
       sk.system_key_id,
       sk.name,
	   sk.provider_kind,
	   sk.model_hint,
	   sk.base_url,
	   sk.key_meta,
	   a.id AS assignment_id,
	   a.scope_type,
	   a.scope_value,
	   a.budget_limit_usd,
	   a.budget_period,
	   a.budget_mode,
	   a.budget_warning_ratio,
	   a.budget_is_active,
	   a.per_user_budget_limit_usd,
	   a.per_user_budget_period
     FROM system_provider_keys sk
     JOIN system_key_assignments a ON a.system_key_id = sk.system_key_id
     WHERE sk.is_active = TRUE
       AND a.is_active = TRUE
       AND sk.provider_kind = $1
       AND ($6 = '' OR sk.system_key_id = $6)
       AND (
         (a.scope_type = 'user' AND LOWER(a.scope_value) = LOWER($2))
         OR (a.scope_type = 'group' AND a.scope_value = '*')
         OR (a.scope_type = 'group' AND (array_length($3::text[], 1) > 0) AND LOWER(a.scope_value) = ANY($3::text[]))
         OR (a.scope_type = 'role' AND (array_length($4::text[], 1) > 0) AND LOWER(a.scope_value) = ANY($4::text[]))
       )
     ORDER BY
       CASE a.scope_type
         WHEN 'user' THEN 0
         WHEN 'role' THEN 1
         ELSE 2
       END,
       CASE
         WHEN sk.model_hint IS NOT NULL AND sk.model_hint <> '' AND LOWER(sk.model_hint) = LOWER($5) THEN 0
         WHEN sk.model_hint IS NULL OR sk.model_hint = '' THEN 1
         ELSE 2
       END,
       sk.updated_at DESC
     LIMIT 1`,
    [provider.kind, req.userId, groups, roles, provider.model, String(provider.system_key_id || '').trim()]
  );
  return result.rows[0] || null;
}

function buildRuntimeTemplate(resolvedTemplate, templateOverride) {
  let runtimeTemplate = {
    id: resolvedTemplate.templateUid,
    description: resolvedTemplate.description,
    profile: resolvedTemplate.profile,
    requiredBaseFields: resolvedTemplate.requiredBaseFields,
    optionalBaseFields: resolvedTemplate.optionalBaseFields,
    dynamicFields: resolvedTemplate.dynamicFields,
    tags: resolvedTemplate.tags,
    promptMode: resolvedTemplate.promptMode,
    taxonomyPath: resolvedTemplate.taxonomyPath,
    basePrompt: resolvedTemplate.basePrompt,
  };

  if (!templateOverride || typeof templateOverride !== 'object') {
    return runtimeTemplate;
  }

  const overrideRequired = Array.isArray(templateOverride.requiredBaseFields)
    ? normalizeBaseFieldList(templateOverride.requiredBaseFields, runtimeTemplate.requiredBaseFields)
    : runtimeTemplate.requiredBaseFields;
  const overrideOptional = Array.isArray(templateOverride.optionalBaseFields)
    ? normalizeBaseFieldList(templateOverride.optionalBaseFields, runtimeTemplate.optionalBaseFields)
    : runtimeTemplate.optionalBaseFields;
  const overrideDynamic = Array.isArray(templateOverride.dynamicFields)
    ? normalizeDynamicFields(templateOverride.dynamicFields)
    : runtimeTemplate.dynamicFields;
  const overrideTags = Array.isArray(templateOverride.tags)
    ? normalizeTagKeys(templateOverride.tags)
    : runtimeTemplate.tags;
  const overrideTaxonomyPath = Array.isArray(templateOverride.taxonomyPath)
    ? templateOverride.taxonomyPath.map((entry) => String(entry || '').trim()).filter(Boolean)
    : runtimeTemplate.taxonomyPath;

  runtimeTemplate = {
    ...runtimeTemplate,
    id: `${resolvedTemplate.templateUid}::oneoff`,
    description: typeof templateOverride.description === 'string' ? templateOverride.description.trim() : runtimeTemplate.description,
    profile: typeof templateOverride.profile === 'string' && templateOverride.profile.trim()
      ? templateOverride.profile.trim()
      : runtimeTemplate.profile,
    promptMode: typeof templateOverride.promptMode === 'string' ? templateOverride.promptMode : runtimeTemplate.promptMode,
    basePrompt: typeof templateOverride.basePrompt === 'string' ? templateOverride.basePrompt : runtimeTemplate.basePrompt,
    requiredBaseFields: overrideRequired,
    optionalBaseFields: overrideOptional,
    dynamicFields: overrideDynamic,
    tags: overrideTags,
    taxonomyPath: overrideTaxonomyPath.length ? overrideTaxonomyPath : runtimeTemplate.taxonomyPath,
  };

  return runtimeTemplate;
}

async function resolveGenerationContext(req, payload = {}) {
  const {
    templateId,
    categoryName,
    subcategoryName,
    baseFields,
    dynamicValues,
    templateOverride,
  } = payload;

  if (!templateId && (!categoryName || !subcategoryName)) {
    throw httpError(400, 'templateId oder categoryName+subcategoryName sind erforderlich.');
  }

  const resolvedTemplate = await getTemplateForGeneration({
    userId: req.userId,
    access: req.access,
    templateUid: templateId ? String(templateId) : null,
    categoryName: categoryName ? String(categoryName) : null,
    subcategoryName: subcategoryName ? String(subcategoryName) : null,
  });
  if (!resolvedTemplate) {
    throw httpError(404, 'Template nicht gefunden oder nicht sichtbar.');
  }

  const categoryLabel = resolvedTemplate.categoryName || String(categoryName || 'Unsortiert');
  const subcategoryLabel = resolvedTemplate.subcategoryName || String(subcategoryName || resolvedTemplate.title || 'Template');
  const runtimeTemplate = buildRuntimeTemplate(resolvedTemplate, templateOverride);
  const { metaprompt, template } = buildMetapromptFromTemplate({
    template: runtimeTemplate,
    categoryName: categoryLabel,
    subcategoryName: subcategoryLabel,
    baseFields: baseFields || {},
    dynamicValues: dynamicValues || {},
  });

  return {
    resolvedTemplate,
    runtimeTemplate,
    template,
    metaprompt,
    categoryLabel,
    subcategoryLabel,
  };
}

async function logGenerationEvent({
  userId,
  userGroups = [],
  userRoles = [],
  provider,
  templateId,
  success,
  latencyMs,
  errorType,
  effectiveKeyType = 'user',
  effectiveKeyId = null,
  keyFingerprint = null,
  usage = null,
  costSummary = null,
}) {
  const usageSafe = usage || {};
  const costSafe = costSummary || {};
  const normalizedGroups = uniqueList((userGroups || []).map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean));
  const normalizedRoles = uniqueList((userRoles || []).map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean));
  const safeTemplateId = String(templateId || 'unknown');

  await pool.query(
    `INSERT INTO provider_generation_events
       (user_id, user_groups_json, user_roles_json, provider_id, provider_kind, provider_model, key_fingerprint, effective_key_type, effective_key_id, template_id, success, latency_ms, prompt_tokens, completion_tokens, total_tokens, input_cost_usd, output_cost_usd, total_cost_usd, pricing_source, pricing_input_per_million, pricing_output_per_million, error_type)
     VALUES ($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      userId,
      JSON.stringify(normalizedGroups),
      JSON.stringify(normalizedRoles),
      provider.provider_id,
      provider.kind,
      provider.model,
      keyFingerprint,
      String(effectiveKeyType || 'user'),
      effectiveKeyId ? String(effectiveKeyId) : null,
      safeTemplateId,
      Boolean(success),
      Math.max(Number(latencyMs) || 0, 0),
      asNonNegativeInt(usageSafe.promptTokens),
      asNonNegativeInt(usageSafe.completionTokens),
      asNonNegativeInt(usageSafe.totalTokens),
      asNullableNumber(costSafe.inputCostUsd),
      asNullableNumber(costSafe.outputCostUsd),
      asNullableNumber(costSafe.totalCostUsd),
      costSafe.pricingSource ? String(costSafe.pricingSource).slice(0, 80) : null,
      asNullableNumber(costSafe.pricingInputPerMillion),
      asNullableNumber(costSafe.pricingOutputPerMillion),
      errorType ? String(errorType).slice(0, 180) : null,
    ]
  );
}

async function resolveProviderCredential(req, provider) {
  const systemKeysEnabled = await getSystemKeysEnabled();
  const selectedSystemKeyId = String(provider.system_key_id || '').trim();
  let apiKey = null;
  let keySource = 'provider';
  let effectiveKeyType = 'user';
  let effectiveKeyId = provider.provider_id;
  let systemKey = null;

  if (selectedSystemKeyId) {
    if (!systemKeysEnabled) {
      throw httpError(400, 'System-Keys sind global deaktiviert.');
    }
    systemKey = await findAssignedSystemKey(req, provider);
    if (!systemKey || !hasServerEncryptedKey(systemKey.key_meta)) {
      throw httpError(400, 'Der zugewiesene System-Key ist nicht aktiv oder nicht mehr verfuegbar.');
    }
    apiKey = decryptApiKey(systemKey.key_meta, config.keyEncryptionSecret);
    keySource = `system:${systemKey.system_key_id}`;
    effectiveKeyType = 'system';
    effectiveKeyId = systemKey.system_key_id;
  } else {
    apiKey = getStoredApiKey(provider);
    if (!apiKey && provider.kind === 'google' && isSharedGoogleAllowed(req)) {
      apiKey = config.googleTestApiKey;
      keySource = 'shared_google_test';
      effectiveKeyType = 'shared_test';
      effectiveKeyId = 'google_test_shared';
    }
    if (!apiKey && systemKeysEnabled) {
      systemKey = await findAssignedSystemKey(req, provider);
      if (systemKey && hasServerEncryptedKey(systemKey.key_meta)) {
        apiKey = decryptApiKey(systemKey.key_meta, config.keyEncryptionSecret);
        keySource = `system:${systemKey.system_key_id}`;
        effectiveKeyType = 'system';
        effectiveKeyId = systemKey.system_key_id;
      }
    }
  }
  if (!apiKey) {
    throw httpError(400, 'Kein gueltiger API-Key verfuegbar. Bitte Provider-Key neu speichern oder Testzugang nutzen.');
  }

  const baseUrl = provider.base_url || systemKey?.base_url || getRecommendedBaseUrl(provider.kind);
  if (!baseUrl) {
    throw httpError(400, 'Provider base URL fehlt.');
  }

  return {
    apiKey,
    keySource,
    baseUrl,
    effectiveKeyType,
    effectiveKeyId,
    systemKeyName: systemKey?.name || null,
    systemKey: systemKey || null,
  };
}

function setupStreamResponse(res) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

function writeStreamEvent(res, event, payload = {}) {
  const line = JSON.stringify({
    event,
    ...payload,
  });
  res.write(`${line}\n`);
}

const RESULT_EXECUTION_SYSTEM_INSTRUCTION = `Du bist ein fachlich-didaktischer Assistent fuer Lehrkraefte.
Fuehre den erhaltenen Prompt direkt aus und liefere ausschliesslich das angeforderte Endergebnis.
Stelle keine Rueckfragen und keine Meta-Erklaerungen, ausser der Prompt fordert dies explizit.`;

function normalizeGenerationMode(value) {
  return String(value || '').trim().toLowerCase() === 'result' ? 'result' : 'prompt';
}

function createGenerateRouter() {
  const router = Router();

  router.post('/generate/preview', authMiddleware, accessMiddleware, requirePermission('prompts.generate'), asyncHandler(async (req, res) => {
    const {
      templateId,
      categoryName,
      subcategoryName,
      baseFields,
      dynamicValues,
      templateOverride,
    } = req.body || {};

    const context = await resolveGenerationContext(req, {
      templateId,
      categoryName,
      subcategoryName,
      baseFields,
      dynamicValues,
      templateOverride,
    });

    res.json({
      metaprompt: context.metaprompt,
      templateId: context.resolvedTemplate.templateUid,
      runtimeTemplateId: context.template.id,
      templateSummary: {
        title: context.resolvedTemplate.title,
        categoryName: context.categoryLabel,
        subcategoryName: context.subcategoryLabel,
        promptMode: context.template.promptMode,
        requiredFields: context.template.requiredFields,
      },
    });
  }));

  router.post('/generate', authMiddleware, accessMiddleware, requirePermission('prompts.generate'), asyncHandler(async (req, res) => {
    const {
      providerId,
      resultProviderId,
      generationMode,
      templateId,
      categoryName,
      subcategoryName,
      baseFields,
      dynamicValues,
      metapromptOverride,
      templateOverride,
      saveOverrideAsPersonal,
      saveOverrideTitleSuffix,
    } = req.body || {};
    if (!providerId || (!templateId && (!categoryName || !subcategoryName))) {
      return res.status(400).json({ error: 'providerId and either templateId or categoryName+subcategoryName are required.' });
    }

    const mode = normalizeGenerationMode(generationMode);
    const metapromptProvider = await getProviderForUser(req, providerId);
    if (!metapromptProvider) return res.status(404).json({ error: 'Aktiver Metaprompt-Provider nicht gefunden.' });

    let resultProvider = null;
    if (mode === 'result') {
      const effectiveResultProviderId = String(resultProviderId || providerId).trim();
      resultProvider = await getProviderForUser(req, effectiveResultProviderId);
      if (!resultProvider) return res.status(404).json({ error: 'Aktiver Result-Provider nicht gefunden.' });
    }

    const context = await resolveGenerationContext(req, {
      templateId,
      categoryName,
      subcategoryName,
      baseFields,
      dynamicValues,
      templateOverride,
    });

    const startedAt = Date.now();
    let metapromptKeyFingerprint = null;
    let resultKeyFingerprint = null;
    let metapromptUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let resultUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let metapromptCost = calculateUsageCost(metapromptUsage, null);
    let resultCost = calculateUsageCost(resultUsage, null);
    let metapromptCredential = null;
    let resultCredential = null;
    let metapromptForProvider = '';
    let handoffPrompt = '';
    let resultOutput = null;
    const budgetWarnings = [];

    try {
      metapromptCredential = await resolveProviderCredential(req, metapromptProvider);
      const metapromptPricing = await resolvePricingForProvider(metapromptProvider);
      metapromptKeyFingerprint = buildKeyFingerprint(metapromptCredential.apiKey);
      metapromptCost = calculateUsageCost(metapromptUsage, metapromptPricing);
      metapromptForProvider = typeof metapromptOverride === 'string' && metapromptOverride.trim()
        ? metapromptOverride.trim()
        : context.metaprompt;
      const metapromptEstimated = await estimateProjectedUsageAndCost({
        userId: req.userId,
        provider: metapromptProvider,
        pricing: metapromptPricing,
        promptText: metapromptForProvider,
      });
      const metapromptAssignmentBudgetWarnings = await enforceSystemAssignmentBudget({
        req,
        systemKey: metapromptCredential?.systemKey || null,
        estimatedIncrementUsd: metapromptEstimated.projectedCostUsd,
        phaseLabel: 'Metaprompt-Phase',
      });
      budgetWarnings.push(...metapromptAssignmentBudgetWarnings);
      const metapromptBudgetWarnings = await enforceBudgetPolicies({
        req,
        keyFingerprint: metapromptKeyFingerprint,
        estimatedIncrementUsd: metapromptEstimated.projectedCostUsd,
        phaseLabel: 'Metaprompt-Phase',
      });
      budgetWarnings.push(...metapromptBudgetWarnings);

      const callMetapromptProvider = async (metapromptText) => {
        const result = await callProviderDetailed({
          kind: metapromptProvider.kind,
          baseUrl: metapromptCredential.baseUrl,
          model: metapromptProvider.model,
          apiKey: metapromptCredential.apiKey,
          metaprompt: metapromptText,
          timeoutMs: config.providerRequestTimeoutMs,
        });
        metapromptUsage = mergeUsage(metapromptUsage, result.usage || {}, {
          promptFallback: metapromptText,
          completionFallback: result.text,
        });
        metapromptCost = calculateUsageCost(metapromptUsage, metapromptPricing);
        return result.text;
      };

      const outputRaw = await callMetapromptProvider(metapromptForProvider);
      handoffPrompt = parseHandoffPrompt(outputRaw);
      if (!handoffPrompt) {
        const repairedRaw = await callMetapromptProvider(buildRepairMetaprompt(outputRaw));
        handoffPrompt = parseHandoffPrompt(repairedRaw);
      }
      if (!handoffPrompt) {
        throw httpError(502, 'Provider lieferte kein gueltiges Handoff-Prompt-Format. Bitte erneut versuchen.');
      }
      if (hasPrivacyRisk(handoffPrompt)) {
        try {
          const privacyRepairRaw = await callMetapromptProvider(buildPrivacyRepairMetaprompt(handoffPrompt));
          const privacyRepairOutput = parseHandoffPrompt(privacyRepairRaw);
          if (privacyRepairOutput) {
            handoffPrompt = privacyRepairOutput;
          }
        } catch (_privacyRepairError) {
          // Fallback to local sanitization below.
        }
      }
      const sanitized = sanitizePromptForPrivacy(handoffPrompt);
      handoffPrompt = sanitized.output;
      if (hasPrivacyRisk(handoffPrompt)) {
        handoffPrompt = ensurePrivacyPolicyBlock(redactSensitiveTerms(handoffPrompt));
      }

      if (mode === 'result' && resultProvider) {
        resultCredential = await resolveProviderCredential(req, resultProvider);
        const resultPricing = await resolvePricingForProvider(resultProvider);
        resultKeyFingerprint = buildKeyFingerprint(resultCredential.apiKey);
        resultCost = calculateUsageCost(resultUsage, resultPricing);
        const resultEstimated = await estimateProjectedUsageAndCost({
          userId: req.userId,
          provider: resultProvider,
          pricing: resultPricing,
          promptText: handoffPrompt,
        });
        const resultAssignmentBudgetWarnings = await enforceSystemAssignmentBudget({
          req,
          systemKey: resultCredential?.systemKey || null,
          estimatedIncrementUsd: resultEstimated.projectedCostUsd,
          phaseLabel: 'Direktes Ergebnis',
        });
        budgetWarnings.push(...resultAssignmentBudgetWarnings);
        const resultBudgetWarnings = await enforceBudgetPolicies({
          req,
          keyFingerprint: resultKeyFingerprint,
          estimatedIncrementUsd: resultEstimated.projectedCostUsd,
          phaseLabel: 'Direktes Ergebnis',
        });
        budgetWarnings.push(...resultBudgetWarnings);

        const resultCall = await callProviderDetailed({
          kind: resultProvider.kind,
          baseUrl: resultCredential.baseUrl,
          model: resultProvider.model,
          apiKey: resultCredential.apiKey,
          metaprompt: handoffPrompt,
          timeoutMs: config.providerRequestTimeoutMs,
          systemInstruction: RESULT_EXECUTION_SYSTEM_INSTRUCTION,
        });
        resultUsage = mergeUsage(resultUsage, resultCall.usage || {}, {
          promptFallback: handoffPrompt,
          completionFallback: resultCall.text,
        });
        resultCost = calculateUsageCost(resultUsage, resultPricing);
        resultOutput = String(resultCall.text || '').trim();
      }

      await pool.query(
        `INSERT INTO provider_usage_audit (user_id, provider_id, provider_kind, key_source, template_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.userId, metapromptProvider.provider_id, metapromptProvider.kind, metapromptCredential.keySource, context.resolvedTemplate.templateUid]
      );
      if (mode === 'result' && resultProvider && resultCredential) {
        await pool.query(
          `INSERT INTO provider_usage_audit (user_id, provider_id, provider_kind, key_source, template_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.userId, resultProvider.provider_id, resultProvider.kind, resultCredential.keySource, context.resolvedTemplate.templateUid]
        );
      }

      await logGenerationEvent({
        userId: req.userId,
        userGroups: req.userGroups || [],
        userRoles: req.access?.roles || [],
        provider: metapromptProvider,
        templateId: context.resolvedTemplate.templateUid,
        success: true,
        latencyMs: Date.now() - startedAt,
        errorType: null,
        effectiveKeyType: metapromptCredential?.effectiveKeyType,
        effectiveKeyId: metapromptCredential?.effectiveKeyId,
        keyFingerprint: metapromptKeyFingerprint,
        usage: metapromptUsage,
        costSummary: metapromptCost,
      });
      if (mode === 'result' && resultProvider) {
        await logGenerationEvent({
          userId: req.userId,
          userGroups: req.userGroups || [],
          userRoles: req.access?.roles || [],
          provider: resultProvider,
          templateId: context.resolvedTemplate.templateUid,
          success: true,
          latencyMs: Date.now() - startedAt,
          errorType: null,
          effectiveKeyType: resultCredential?.effectiveKeyType,
          effectiveKeyId: resultCredential?.effectiveKeyId,
          keyFingerprint: resultKeyFingerprint,
          usage: resultUsage,
          costSummary: resultCost,
        });
      }

      let savedVariantTemplateId = null;
      if (saveOverrideAsPersonal && templateOverride && typeof templateOverride === 'object') {
        const clone = await cloneTemplateAsPersonal({
          userId: req.userId,
          access: req.access,
          templateUid: context.resolvedTemplate.templateUid,
          titleSuffix: typeof saveOverrideTitleSuffix === 'string' ? saveOverrideTitleSuffix : ' (Variante)',
          overrides: {
            title: templateOverride.title,
            description: templateOverride.description,
            profile: templateOverride.profile,
            promptMode: templateOverride.promptMode,
            basePrompt: templateOverride.basePrompt,
            requiredBaseFields: templateOverride.requiredBaseFields,
            optionalBaseFields: templateOverride.optionalBaseFields,
            dynamicFields: templateOverride.dynamicFields,
            tags: templateOverride.tags,
            taxonomyPath: templateOverride.taxonomyPath,
            changeNote: templateOverride.changeNote || 'Generated one-off variant saved from run',
          },
        });
        savedVariantTemplateId = clone.templateUid;
      }

      const usageTotal = combineUsageSummaries(metapromptUsage, resultUsage);
      const costTotal = combineCostSummaries(metapromptCost, resultCost);
      res.json({
        mode,
        metaprompt: metapromptForProvider,
        handoffPrompt,
        output: handoffPrompt,
        resultOutput,
        templateId: context.resolvedTemplate.templateUid,
        runtimeTemplateId: context.template.id,
        savedVariantTemplateId,
        provider: {
          id: metapromptProvider.provider_id,
          name: metapromptProvider.name,
          kind: metapromptProvider.kind,
          model: metapromptProvider.model,
          baseUrl: metapromptCredential.baseUrl,
          keySource: metapromptCredential.keySource,
          effectiveKeyType: metapromptCredential.effectiveKeyType,
          effectiveKeyId: metapromptCredential.effectiveKeyId,
          systemKeyName: metapromptCredential.systemKeyName,
        },
        providers: {
          metaprompt: {
            id: metapromptProvider.provider_id,
            name: metapromptProvider.name,
            kind: metapromptProvider.kind,
            model: metapromptProvider.model,
            baseUrl: metapromptCredential.baseUrl,
            keySource: metapromptCredential.keySource,
            effectiveKeyType: metapromptCredential.effectiveKeyType,
            effectiveKeyId: metapromptCredential.effectiveKeyId,
            systemKeyName: metapromptCredential.systemKeyName,
          },
          result: mode === 'result' && resultProvider && resultCredential
            ? {
              id: resultProvider.provider_id,
              name: resultProvider.name,
              kind: resultProvider.kind,
              model: resultProvider.model,
              baseUrl: resultCredential.baseUrl,
              keySource: resultCredential.keySource,
              effectiveKeyType: resultCredential.effectiveKeyType,
              effectiveKeyId: resultCredential.effectiveKeyId,
              systemKeyName: resultCredential.systemKeyName,
            }
            : null,
        },
        usage: usageTotal,
        usageStages: {
          metaprompt: metapromptUsage,
          result: mode === 'result' ? resultUsage : null,
        },
        cost: costTotal,
        costStages: {
          metaprompt: metapromptCost,
          result: mode === 'result' ? resultCost : null,
        },
        budget: {
          mode: 'hybrid',
          warnings: budgetWarnings,
        },
      });
    } catch (error) {
      let finalError = error;
      if (isOverloadedProviderError(error)) {
        finalError = httpError(503, 'Das gewaehlte Modell ist derzeit ueberlastet. Bitte in wenigen Sekunden erneut versuchen oder ein anderes Modell waehlen.');
      }
      try {
        await logGenerationEvent({
          userId: req.userId,
          userGroups: req.userGroups || [],
          userRoles: req.access?.roles || [],
          provider: metapromptProvider,
          templateId: context?.resolvedTemplate?.templateUid || templateId || null,
          success: false,
          latencyMs: Date.now() - startedAt,
          errorType: finalError?.message || 'generation_failed',
          effectiveKeyType: metapromptCredential?.effectiveKeyType,
          effectiveKeyId: metapromptCredential?.effectiveKeyId,
          keyFingerprint: metapromptKeyFingerprint,
          usage: metapromptUsage,
          costSummary: metapromptCost,
        });
        if (mode === 'result' && resultProvider) {
          await logGenerationEvent({
            userId: req.userId,
            userGroups: req.userGroups || [],
            userRoles: req.access?.roles || [],
            provider: resultProvider,
            templateId: context?.resolvedTemplate?.templateUid || templateId || null,
            success: false,
            latencyMs: Date.now() - startedAt,
            errorType: finalError?.message || 'generation_failed',
            effectiveKeyType: resultCredential?.effectiveKeyType,
            effectiveKeyId: resultCredential?.effectiveKeyId,
            keyFingerprint: resultKeyFingerprint,
            usage: resultUsage,
            costSummary: resultCost,
          });
        }
      } catch (_logError) {
        // Do not override original provider error path.
      }
      throw finalError;
    }
  }));

  router.post('/generate/stream', authMiddleware, accessMiddleware, requirePermission('prompts.generate'), asyncHandler(async (req, res) => {
    setupStreamResponse(res);
    let stage = 'input';
    let metapromptProvider = null;
    let resultProvider = null;
    let context = null;
    const startedAt = Date.now();
    let metapromptKeyFingerprint = null;
    let resultKeyFingerprint = null;
    let metapromptUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let resultUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let metapromptCost = calculateUsageCost(metapromptUsage, null);
    let resultCost = calculateUsageCost(resultUsage, null);
    let mode = 'prompt';
    let metapromptCredential = null;
    let resultCredential = null;
    const budgetWarnings = [];

    try {
      const {
        providerId,
        resultProviderId,
        generationMode,
        templateId,
        categoryName,
        subcategoryName,
        baseFields,
        dynamicValues,
        metapromptOverride,
        templateOverride,
        saveOverrideAsPersonal,
        saveOverrideTitleSuffix,
      } = req.body || {};
      if (!providerId || (!templateId && (!categoryName || !subcategoryName))) {
        writeStreamEvent(res, 'error', {
          stage: 'input',
          message: 'providerId and either templateId or categoryName+subcategoryName are required.',
        });
        return res.end();
      }

      mode = normalizeGenerationMode(generationMode);
      metapromptProvider = await getProviderForUser(req, providerId);
      if (!metapromptProvider) {
        writeStreamEvent(res, 'error', {
          stage: 'input',
          message: 'Aktiver Metaprompt-Provider nicht gefunden.',
        });
        return res.end();
      }
      if (mode === 'result') {
        const effectiveResultProviderId = String(resultProviderId || providerId).trim();
        resultProvider = await getProviderForUser(req, effectiveResultProviderId);
        if (!resultProvider) {
          writeStreamEvent(res, 'error', {
            stage: 'input',
            message: 'Aktiver Result-Provider nicht gefunden.',
          });
          return res.end();
        }
      }

      context = await resolveGenerationContext(req, {
        templateId,
        categoryName,
        subcategoryName,
        baseFields,
        dynamicValues,
        templateOverride,
      });

      metapromptCredential = await resolveProviderCredential(req, metapromptProvider);
      const metapromptPricing = await resolvePricingForProvider(metapromptProvider);
      metapromptKeyFingerprint = buildKeyFingerprint(metapromptCredential.apiKey);
      metapromptCost = calculateUsageCost(metapromptUsage, metapromptPricing);
      const metapromptForProvider = typeof metapromptOverride === 'string' && metapromptOverride.trim()
        ? metapromptOverride.trim()
        : context.metaprompt;
      const metapromptEstimated = await estimateProjectedUsageAndCost({
        userId: req.userId,
        provider: metapromptProvider,
        pricing: metapromptPricing,
        promptText: metapromptForProvider,
      });
      const metapromptAssignmentBudgetWarnings = await enforceSystemAssignmentBudget({
        req,
        systemKey: metapromptCredential?.systemKey || null,
        estimatedIncrementUsd: metapromptEstimated.projectedCostUsd,
        phaseLabel: 'Metaprompt-Phase',
        onWarning: (message) => {
          writeStreamEvent(res, 'status', { stage: 'budget', message });
        },
      });
      budgetWarnings.push(...metapromptAssignmentBudgetWarnings);
      const metapromptBudgetWarnings = await enforceBudgetPolicies({
        req,
        keyFingerprint: metapromptKeyFingerprint,
        estimatedIncrementUsd: metapromptEstimated.projectedCostUsd,
        phaseLabel: 'Metaprompt-Phase',
        onWarning: (message) => {
          writeStreamEvent(res, 'status', { stage: 'budget', message });
        },
      });
      budgetWarnings.push(...metapromptBudgetWarnings);

      let streamedHandoffPrompt = '';
      const callMetapromptProvider = async (metapromptText, { streamOutput = false } = {}) => {
        if (streamOutput) {
          const result = await callProviderDetailedStream({
            kind: metapromptProvider.kind,
            baseUrl: metapromptCredential.baseUrl,
            model: metapromptProvider.model,
            apiKey: metapromptCredential.apiKey,
            metaprompt: metapromptText,
            timeoutMs: config.providerRequestTimeoutMs,
            onTextDelta: (delta) => {
              if (!delta) return;
              streamedHandoffPrompt += delta;
              writeStreamEvent(res, 'handoff_delta', { delta });
            },
          });
          metapromptUsage = mergeUsage(metapromptUsage, result.usage || {}, {
            promptFallback: metapromptText,
            completionFallback: result.text,
          });
          metapromptCost = calculateUsageCost(metapromptUsage, metapromptPricing);
          return result.text;
        }

        const result = await callProviderDetailed({
          kind: metapromptProvider.kind,
          baseUrl: metapromptCredential.baseUrl,
          model: metapromptProvider.model,
          apiKey: metapromptCredential.apiKey,
          metaprompt: metapromptText,
          timeoutMs: config.providerRequestTimeoutMs,
        });
        metapromptUsage = mergeUsage(metapromptUsage, result.usage || {}, {
          promptFallback: metapromptText,
          completionFallback: result.text,
        });
        metapromptCost = calculateUsageCost(metapromptUsage, metapromptPricing);
        return result.text;
      };

      stage = 'metaprompt';
      writeStreamEvent(res, 'status', {
        stage,
        message: metapromptOverride
          ? `Schritt 1/${mode === 'result' ? '5' : '4'}: Bearbeitete Metaprompt wird vorbereitet...`
          : `Schritt 1/${mode === 'result' ? '5' : '4'}: Metaprompt wird aus Template-Daten erstellt...`,
      });

      stage = 'provider_call';
      writeStreamEvent(res, 'status', {
        stage,
        message: `Schritt 2/${mode === 'result' ? '5' : '4'}: Anfrage an ${metapromptProvider.name} (${metapromptProvider.model}) wird gesendet...`,
      });
      const outputRaw = await callMetapromptProvider(metapromptForProvider, { streamOutput: true });

      stage = 'postprocess';
      writeStreamEvent(res, 'status', {
        stage,
        message: `Schritt 3/${mode === 'result' ? '5' : '4'}: Metaprompt-Antwort wird geprueft und aufbereitet...`,
      });
      let handoffPrompt = parseHandoffPrompt(outputRaw);
      if (!handoffPrompt) {
        const repairedRaw = await callMetapromptProvider(buildRepairMetaprompt(outputRaw));
        handoffPrompt = parseHandoffPrompt(repairedRaw);
      }
      if (!handoffPrompt) {
        throw httpError(502, 'Provider lieferte kein gueltiges Handoff-Prompt-Format. Bitte erneut versuchen.');
      }
      if (hasPrivacyRisk(handoffPrompt)) {
        try {
          const privacyRepairRaw = await callMetapromptProvider(buildPrivacyRepairMetaprompt(handoffPrompt));
          const privacyRepairOutput = parseHandoffPrompt(privacyRepairRaw);
          if (privacyRepairOutput) {
            handoffPrompt = privacyRepairOutput;
          }
        } catch (_privacyRepairError) {
          // Fallback to local sanitization below.
        }
      }
      const sanitized = sanitizePromptForPrivacy(handoffPrompt);
      handoffPrompt = sanitized.output;
      if (hasPrivacyRisk(handoffPrompt)) {
        handoffPrompt = ensurePrivacyPolicyBlock(redactSensitiveTerms(handoffPrompt));
      }
      if (!streamedHandoffPrompt || handoffPrompt !== streamedHandoffPrompt) {
        writeStreamEvent(res, 'handoff_replace', { output: handoffPrompt });
      }

      let resultOutput = null;
      if (mode === 'result' && resultProvider) {
        stage = 'result_provider_call';
        writeStreamEvent(res, 'status', {
          stage,
          message: `Schritt 4/5: Direktes Ergebnis wird mit ${resultProvider.name} (${resultProvider.model}) erzeugt...`,
        });
        resultCredential = await resolveProviderCredential(req, resultProvider);
        const resultPricing = await resolvePricingForProvider(resultProvider);
        resultKeyFingerprint = buildKeyFingerprint(resultCredential.apiKey);
        resultCost = calculateUsageCost(resultUsage, resultPricing);
        const resultEstimated = await estimateProjectedUsageAndCost({
          userId: req.userId,
          provider: resultProvider,
          pricing: resultPricing,
          promptText: handoffPrompt,
        });
        const resultAssignmentBudgetWarnings = await enforceSystemAssignmentBudget({
          req,
          systemKey: resultCredential?.systemKey || null,
          estimatedIncrementUsd: resultEstimated.projectedCostUsd,
          phaseLabel: 'Direktes Ergebnis',
          onWarning: (message) => {
            writeStreamEvent(res, 'status', { stage: 'budget', message });
          },
        });
        budgetWarnings.push(...resultAssignmentBudgetWarnings);
        const resultBudgetWarnings = await enforceBudgetPolicies({
          req,
          keyFingerprint: resultKeyFingerprint,
          estimatedIncrementUsd: resultEstimated.projectedCostUsd,
          phaseLabel: 'Direktes Ergebnis',
          onWarning: (message) => {
            writeStreamEvent(res, 'status', { stage: 'budget', message });
          },
        });
        budgetWarnings.push(...resultBudgetWarnings);

        const resultCall = await callProviderDetailedStream({
          kind: resultProvider.kind,
          baseUrl: resultCredential.baseUrl,
          model: resultProvider.model,
          apiKey: resultCredential.apiKey,
          metaprompt: handoffPrompt,
          timeoutMs: config.providerRequestTimeoutMs,
          systemInstruction: RESULT_EXECUTION_SYSTEM_INSTRUCTION,
          onTextDelta: (delta) => {
            if (!delta) return;
            writeStreamEvent(res, 'result_delta', { delta });
          },
        });
        resultUsage = mergeUsage(resultUsage, resultCall.usage || {}, {
          promptFallback: handoffPrompt,
          completionFallback: resultCall.text,
        });
        resultCost = calculateUsageCost(resultUsage, resultPricing);
        resultOutput = String(resultCall.text || '').trim();
        writeStreamEvent(res, 'result_replace', { output: resultOutput });

        await pool.query(
          `INSERT INTO provider_usage_audit (user_id, provider_id, provider_kind, key_source, template_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.userId, resultProvider.provider_id, resultProvider.kind, resultCredential.keySource, context.resolvedTemplate.templateUid]
        );
      }

      await pool.query(
        `INSERT INTO provider_usage_audit (user_id, provider_id, provider_kind, key_source, template_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.userId, metapromptProvider.provider_id, metapromptProvider.kind, metapromptCredential.keySource, context.resolvedTemplate.templateUid]
      );

      await logGenerationEvent({
        userId: req.userId,
        userGroups: req.userGroups || [],
        userRoles: req.access?.roles || [],
        provider: metapromptProvider,
        templateId: context.resolvedTemplate.templateUid,
        success: true,
        latencyMs: Date.now() - startedAt,
        errorType: null,
        effectiveKeyType: metapromptCredential?.effectiveKeyType,
        effectiveKeyId: metapromptCredential?.effectiveKeyId,
        keyFingerprint: metapromptKeyFingerprint,
        usage: metapromptUsage,
        costSummary: metapromptCost,
      });
      if (mode === 'result' && resultProvider) {
        await logGenerationEvent({
          userId: req.userId,
          userGroups: req.userGroups || [],
          userRoles: req.access?.roles || [],
          provider: resultProvider,
          templateId: context.resolvedTemplate.templateUid,
          success: true,
          latencyMs: Date.now() - startedAt,
          errorType: null,
          effectiveKeyType: resultCredential?.effectiveKeyType,
          effectiveKeyId: resultCredential?.effectiveKeyId,
          keyFingerprint: resultKeyFingerprint,
          usage: resultUsage,
          costSummary: resultCost,
        });
      }

      let savedVariantTemplateId = null;
      if (saveOverrideAsPersonal && templateOverride && typeof templateOverride === 'object') {
        const clone = await cloneTemplateAsPersonal({
          userId: req.userId,
          access: req.access,
          templateUid: context.resolvedTemplate.templateUid,
          titleSuffix: typeof saveOverrideTitleSuffix === 'string' ? saveOverrideTitleSuffix : ' (Variante)',
          overrides: {
            title: templateOverride.title,
            description: templateOverride.description,
            profile: templateOverride.profile,
            promptMode: templateOverride.promptMode,
            basePrompt: templateOverride.basePrompt,
            requiredBaseFields: templateOverride.requiredBaseFields,
            optionalBaseFields: templateOverride.optionalBaseFields,
            dynamicFields: templateOverride.dynamicFields,
            tags: templateOverride.tags,
            taxonomyPath: templateOverride.taxonomyPath,
            changeNote: templateOverride.changeNote || 'Generated one-off variant saved from run',
          },
        });
        savedVariantTemplateId = clone.templateUid;
      }

      stage = 'finalize';
      writeStreamEvent(res, 'status', {
        stage,
        message: `Schritt ${mode === 'result' ? '5/5' : '4/4'}: Verlauf und Discovery werden aktualisiert...`,
      });
      const usageTotal = combineUsageSummaries(metapromptUsage, resultUsage);
      const costTotal = combineCostSummaries(metapromptCost, resultCost);
      writeStreamEvent(res, 'done', {
        mode,
        metaprompt: metapromptForProvider,
        handoffPrompt,
        output: handoffPrompt,
        resultOutput,
        templateId: context.resolvedTemplate.templateUid,
        runtimeTemplateId: context.template.id,
        savedVariantTemplateId,
        provider: {
          id: metapromptProvider.provider_id,
          name: metapromptProvider.name,
          kind: metapromptProvider.kind,
          model: metapromptProvider.model,
          baseUrl: metapromptCredential.baseUrl,
          keySource: metapromptCredential.keySource,
          effectiveKeyType: metapromptCredential.effectiveKeyType,
          effectiveKeyId: metapromptCredential.effectiveKeyId,
          systemKeyName: metapromptCredential.systemKeyName,
        },
        providers: {
          metaprompt: {
            id: metapromptProvider.provider_id,
            name: metapromptProvider.name,
            kind: metapromptProvider.kind,
            model: metapromptProvider.model,
            baseUrl: metapromptCredential.baseUrl,
            keySource: metapromptCredential.keySource,
            effectiveKeyType: metapromptCredential.effectiveKeyType,
            effectiveKeyId: metapromptCredential.effectiveKeyId,
            systemKeyName: metapromptCredential.systemKeyName,
          },
          result: mode === 'result' && resultProvider && resultCredential
            ? {
              id: resultProvider.provider_id,
              name: resultProvider.name,
              kind: resultProvider.kind,
              model: resultProvider.model,
              baseUrl: resultCredential.baseUrl,
              keySource: resultCredential.keySource,
              effectiveKeyType: resultCredential.effectiveKeyType,
              effectiveKeyId: resultCredential.effectiveKeyId,
              systemKeyName: resultCredential.systemKeyName,
            }
            : null,
        },
        usage: usageTotal,
        usageStages: {
          metaprompt: metapromptUsage,
          result: mode === 'result' ? resultUsage : null,
        },
        cost: costTotal,
        costStages: {
          metaprompt: metapromptCost,
          result: mode === 'result' ? resultCost : null,
        },
        budget: {
          mode: 'hybrid',
          warnings: budgetWarnings,
        },
      });
      return res.end();
    } catch (error) {
      let finalError = error;
      if (isOverloadedProviderError(error)) {
        finalError = httpError(503, 'Das gewaehlte Modell ist derzeit ueberlastet. Bitte in wenigen Sekunden erneut versuchen oder ein anderes Modell waehlen.');
      }
      if (metapromptProvider && context) {
        try {
          await logGenerationEvent({
            userId: req.userId,
            userGroups: req.userGroups || [],
            userRoles: req.access?.roles || [],
            provider: metapromptProvider,
            templateId: context.resolvedTemplate.templateUid,
            success: false,
            latencyMs: Date.now() - startedAt,
            errorType: finalError?.message || 'generation_failed',
            effectiveKeyType: metapromptCredential?.effectiveKeyType,
            effectiveKeyId: metapromptCredential?.effectiveKeyId,
            keyFingerprint: metapromptKeyFingerprint,
            usage: metapromptUsage,
            costSummary: metapromptCost,
          });
          if (mode === 'result' && resultProvider) {
            await logGenerationEvent({
              userId: req.userId,
              userGroups: req.userGroups || [],
              userRoles: req.access?.roles || [],
              provider: resultProvider,
              templateId: context.resolvedTemplate.templateUid,
              success: false,
              latencyMs: Date.now() - startedAt,
              errorType: finalError?.message || 'generation_failed',
              effectiveKeyType: resultCredential?.effectiveKeyType,
              effectiveKeyId: resultCredential?.effectiveKeyId,
              keyFingerprint: resultKeyFingerprint,
              usage: resultUsage,
              costSummary: resultCost,
            });
          }
        } catch (_logError) {
          // Do not override original provider error path.
        }
      }
      writeStreamEvent(res, 'error', {
        stage,
        message: finalError?.message || 'Unbekannter Fehler bei der Generierung.',
        status: Number(finalError?.status) || 500,
      });
      return res.end();
    }
  }));

  return router;
}

module.exports = { createGenerateRouter };
