const { Router } = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { config } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { encryptApiKey, hasServerEncryptedKey, decryptApiKey } = require('../security/key-encryption');
const { sanitizeExternalErrorMessage } = require('../security/error-redaction');
const { getRecommendedBaseUrl } = require('../services/provider-defaults');
const { callProvider } = require('../services/provider-clients');

function normalizeSet(values = []) {
  return new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function parseNonNegativeNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return normalized;
}

function groupModelCatalogRows(rows = []) {
  const merged = {
    openai: new Set(),
    anthropic: new Set(),
    google: new Set(),
    mistral: new Set(),
    custom: new Set(),
  };
  rows.forEach((row) => {
    const kind = String(row.provider_kind || '').trim().toLowerCase();
    const model = String(row.model || '').trim();
    if (!kind || !model) return;
    if (!merged[kind]) merged[kind] = new Set();
    merged[kind].add(model);
  });

  const result = {};
  Object.entries(merged).forEach(([kind, modelSet]) => {
    result[kind] = Array.from(modelSet).sort((a, b) => a.localeCompare(b));
  });
  return result;
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
  if (!hasServerEncryptedKey(row?.key_meta)) return null;
  return decryptApiKey(row.key_meta, config.keyEncryptionSecret);
}

function buildKeyFingerprint(apiKey = '') {
  const normalized = String(apiKey || '').trim();
  if (!normalized) return '';
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return `sha256:${digest.slice(0, 16)}`;
}

async function listAssignedSystemKeysForUser(req, providerKind = '') {
  const groups = normalizeSet(req.userGroups || []);
  const roles = normalizeSet(req.access?.roles || []);
  const normalizedGroups = Array.from(groups);
  const normalizedRoles = Array.from(roles);
  const normalizedUserId = String(req.userId || '').trim().toLowerCase();
  const normalizedProviderKind = String(providerKind || '').trim().toLowerCase();

  const result = await pool.query(
    `SELECT
       sk.system_key_id,
       sk.name,
       sk.provider_kind,
       sk.model_hint,
       sk.base_url,
       sk.key_meta,
       sk.is_active,
       a.id AS assignment_id,
       a.scope_type,
       a.scope_value,
       a.is_active AS assignment_is_active,
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
       AND ($1 = '' OR sk.provider_kind = $1)
       AND (
         (a.scope_type = 'user' AND LOWER(a.scope_value) = LOWER($2))
         OR (a.scope_type = 'group' AND a.scope_value = '*')
         OR (a.scope_type = 'group' AND (array_length($3::text[], 1) > 0) AND LOWER(a.scope_value) = ANY($3::text[]))
         OR (a.scope_type = 'role' AND (array_length($4::text[], 1) > 0) AND LOWER(a.scope_value) = ANY($4::text[]))
       )
     ORDER BY
       sk.provider_kind ASC,
       sk.name ASC,
       CASE a.scope_type
         WHEN 'user' THEN 0
         WHEN 'role' THEN 1
         ELSE 2
       END,
       sk.updated_at DESC`,
    [normalizedProviderKind, normalizedUserId, normalizedGroups, normalizedRoles]
  );

  const bySystemKey = new Map();
  result.rows.forEach((row) => {
    const keyId = String(row.system_key_id || '');
    if (!keyId) return;
    const existing = bySystemKey.get(keyId);
    const assignment = {
      id: Number(row.assignment_id),
      scopeType: row.scope_type === 'group' && row.scope_value === '*' ? 'global' : row.scope_type,
      scopeValue: row.scope_type === 'group' && row.scope_value === '*' ? '*' : row.scope_value,
      isActive: Boolean(row.assignment_is_active),
      budgetLimitUsd: row.budget_limit_usd === null ? null : Number(row.budget_limit_usd),
      budgetPeriod: String(row.budget_period || 'monthly').trim().toLowerCase() || 'monthly',
      budgetMode: String(row.budget_mode || 'hybrid').trim().toLowerCase() || 'hybrid',
      budgetWarningRatio: Number(row.budget_warning_ratio || 0.9),
      budgetIsActive: Boolean(row.budget_is_active),
      perUserBudgetLimitUsd: row.per_user_budget_limit_usd === null ? null : Number(row.per_user_budget_limit_usd),
      perUserBudgetPeriod: String(row.per_user_budget_period || row.budget_period || 'monthly').trim().toLowerCase() || 'monthly',
    };
    if (!existing) {
      let keyFingerprint = '';
      try {
        if (hasServerEncryptedKey(row.key_meta)) {
          const decrypted = decryptApiKey(row.key_meta, config.keyEncryptionSecret);
          keyFingerprint = buildKeyFingerprint(decrypted);
        }
      } catch (_error) {
        keyFingerprint = '';
      }
      bySystemKey.set(keyId, {
        systemKeyId: keyId,
        name: row.name,
        providerKind: row.provider_kind,
        modelHint: row.model_hint || '',
        baseUrl: row.base_url || '',
        isActive: Boolean(row.is_active),
        keyFingerprint,
        assignments: [assignment],
      });
      return;
    }
    existing.assignments.push(assignment);
  });

  return Array.from(bySystemKey.values());
}

function buildProviderTestPrompt() {
  return 'Gib nur JSON aus: {"handoff_prompt":"Du bist Test erfolgreich."}';
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

function createProviderRouter() {
  const router = Router();

  router.get('/providers/model-catalog', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (_req, res) => {
    const pricingRows = await pool.query(
      `SELECT provider_kind, model, input_price_per_million, output_price_per_million, currency
       FROM provider_model_pricing_catalog
       WHERE is_active = TRUE
       ORDER BY provider_kind, model`
    );

    res.json({
      catalog: groupModelCatalogRows(pricingRows.rows),
      pricing: pricingRows.rows.map((row) => ({
        providerKind: row.provider_kind,
        model: row.model,
        inputPricePerMillion: row.input_price_per_million === null ? null : Number(row.input_price_per_million),
        outputPricePerMillion: row.output_price_per_million === null ? null : Number(row.output_price_per_million),
        currency: String(row.currency || 'USD').trim().toUpperCase() || 'USD',
        hasPricing: row.input_price_per_million !== null && row.output_price_per_million !== null,
      })),
    });
  }));

  router.get('/providers/assigned-system-keys', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    const enabled = await getSystemKeysEnabled();
    const providerKind = String(req.query.providerKind || '').trim().toLowerCase();
    const keys = enabled ? await listAssignedSystemKeysForUser(req, providerKind) : [];
    res.json({ enabled, keys });
  }));

  router.get('/providers', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT provider_id, name, kind, model, base_url, base_url_mode, pricing_mode, input_price_per_million, output_price_per_million, key_meta, system_key_id
       FROM providers
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId]
    );

    const systemKeysEnabled = await getSystemKeysEnabled();
    const referencedSystemKeyIds = [...new Set(
      result.rows
        .map((row) => String(row.system_key_id || '').trim())
        .filter(Boolean)
    )];
    const systemKeyMetaMap = new Map();
    if (referencedSystemKeyIds.length) {
      const systemKeyMetaResult = await pool.query(
        `SELECT system_key_id, key_meta
         FROM system_provider_keys
         WHERE system_key_id = ANY($1::text[])`,
        [referencedSystemKeyIds]
      );
      systemKeyMetaResult.rows.forEach((row) => {
        systemKeyMetaMap.set(String(row.system_key_id || '').trim(), row.key_meta || null);
      });
    }

    res.json(
      result.rows.map((r) => ({
        ...(function deriveFingerprintFields() {
          let ownKeyFingerprint = '';
          let systemKeyFingerprint = '';
          try {
            const ownApiKey = getStoredApiKey(r);
            ownKeyFingerprint = ownApiKey ? buildKeyFingerprint(ownApiKey) : '';
          } catch (_error) {
            ownKeyFingerprint = '';
          }
          try {
            const systemKeyMeta = r.system_key_id ? systemKeyMetaMap.get(String(r.system_key_id || '').trim()) : null;
            if (hasServerEncryptedKey(systemKeyMeta)) {
              const decrypted = decryptApiKey(systemKeyMeta, config.keyEncryptionSecret);
              systemKeyFingerprint = buildKeyFingerprint(decrypted);
            }
          } catch (_error) {
            systemKeyFingerprint = '';
          }
          return { ownKeyFingerprint, systemKeyFingerprint };
        })(),
        id: r.provider_id,
        name: r.name,
        kind: r.kind,
        model: r.model,
        baseUrl: r.base_url || getRecommendedBaseUrl(r.kind),
        baseUrlMode: r.base_url_mode || 'custom',
        pricingMode: r.pricing_mode || 'catalog',
        inputPricePerMillion: r.input_price_per_million === null ? null : Number(r.input_price_per_million),
        outputPricePerMillion: r.output_price_per_million === null ? null : Number(r.output_price_per_million),
        systemKeyId: r.system_key_id || '',
        systemKeysEnabled,
        hasServerKey: hasServerEncryptedKey(r.key_meta),
        canUseSharedTestKey: r.kind === 'google' ? isSharedGoogleAllowed(req) : false,
      }))
    );
  }));

  router.put('/providers/:providerId', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    const providerId = req.params.providerId;
    const { name, kind, model, baseUrl, baseUrlMode, pricingMode, inputPricePerMillion, outputPricePerMillion, apiKey, systemKeyId, keySource } = req.body || {};
    const normalizedBaseUrlMode = baseUrlMode === 'preset' ? 'preset' : 'custom';
    const normalizedPricingMode = pricingMode === 'custom' ? 'custom' : 'catalog';
    const normalizedInputPrice = parseNonNegativeNumberOrNull(inputPricePerMillion);
    const normalizedOutputPrice = parseNonNegativeNumberOrNull(outputPricePerMillion);
    const requestedSystemKeyId = String(systemKeyId || '').trim();
    const normalizedKeySource = String(keySource || '').trim().toLowerCase();
    const useSystemKeySource = normalizedKeySource === 'system' || Boolean(requestedSystemKeyId);
    const systemKeysEnabled = await getSystemKeysEnabled();

    if (!name || !kind || !model) {
      return res.status(400).json({ error: 'Missing required provider fields.' });
    }
    if (normalizedPricingMode === 'custom' && (normalizedInputPrice === null || normalizedOutputPrice === null)) {
      return res.status(400).json({ error: 'Bei Custom-Pricing sind Input- und Output-Preis erforderlich.' });
    }

    const existingResult = await pool.query(
      `SELECT key_meta FROM providers WHERE user_id = $1 AND provider_id = $2`,
      [req.userId, providerId]
    );
    const existingKeyMeta = existingResult.rows[0]?.key_meta || {};
    const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    let encryptedKey = useSystemKeySource ? {} : existingKeyMeta;
    if (!useSystemKeySource && trimmedApiKey) {
      encryptedKey = encryptApiKey(trimmedApiKey, config.keyEncryptionSecret);
    }

    let resolvedSystemKeyId = null;
    let resolvedProviderKind = String(kind || '').trim().toLowerCase();
    if (requestedSystemKeyId) {
      if (!systemKeysEnabled) {
        return res.status(400).json({ error: 'System-Keys sind global deaktiviert.' });
      }
      const assignedKeys = await listAssignedSystemKeysForUser(req);
      const selected = assignedKeys.find((entry) => entry.systemKeyId === requestedSystemKeyId);
      if (!selected) {
        return res.status(400).json({ error: 'Ausgewählter System-Key ist nicht zugewiesen oder nicht aktiv.' });
      }
      resolvedSystemKeyId = selected.systemKeyId;
      if (resolvedProviderKind && resolvedProviderKind !== selected.providerKind) {
        return res.status(400).json({ error: 'Provider-Art passt nicht zum ausgewählten System-Key.' });
      }
      resolvedProviderKind = selected.providerKind;
    }

    const hasAnyKey = hasServerEncryptedKey(encryptedKey);
    const canUseShared = resolvedProviderKind === 'google' && isSharedGoogleAllowed(req);
    if (!resolvedSystemKeyId && !hasAnyKey && !canUseShared) {
      return res.status(400).json({ error: 'Bitte API-Key eingeben (oder für Testkonto Shared Google Key verwenden).' });
    }

    await pool.query(
      `INSERT INTO providers (user_id, provider_id, name, kind, model, base_url, base_url_mode, pricing_mode, input_price_per_million, output_price_per_million, key_meta, system_key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id, provider_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         model = EXCLUDED.model,
         base_url = EXCLUDED.base_url,
         base_url_mode = EXCLUDED.base_url_mode,
         pricing_mode = EXCLUDED.pricing_mode,
         input_price_per_million = EXCLUDED.input_price_per_million,
         output_price_per_million = EXCLUDED.output_price_per_million,
         key_meta = EXCLUDED.key_meta,
         system_key_id = EXCLUDED.system_key_id,
         updated_at = NOW()`,
      [
        req.userId,
        providerId,
        name,
        resolvedProviderKind,
        model,
        baseUrl || null,
        normalizedBaseUrlMode,
        normalizedPricingMode,
        normalizedPricingMode === 'custom' ? normalizedInputPrice : null,
        normalizedPricingMode === 'custom' ? normalizedOutputPrice : null,
        encryptedKey,
        resolvedSystemKeyId,
      ]
    );

    res.json({ ok: true });
  }));

  router.delete('/providers/:providerId', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM providers WHERE user_id = $1 AND provider_id = $2', [req.userId, req.params.providerId]);
    res.json({ ok: true });
  }));

  router.post('/providers/test', authMiddleware, accessMiddleware, requirePermission('providers.manage_own'), asyncHandler(async (req, res) => {
    const providerId = typeof req.body?.providerId === 'string' ? req.body.providerId.trim() : '';
    const existingResult = providerId
      ? await pool.query(
        `SELECT provider_id, name, kind, model, base_url, base_url_mode, key_meta, system_key_id
         FROM providers
         WHERE user_id = $1 AND provider_id = $2`,
        [req.userId, providerId]
      )
      : { rows: [] };
    const existing = existingResult.rows[0] || null;

    const kind = String(req.body?.kind || existing?.kind || '').trim().toLowerCase();
    const model = String(req.body?.model || existing?.model || '').trim();
    const baseUrl = String(req.body?.baseUrl || existing?.base_url || getRecommendedBaseUrl(kind) || '').trim();
    if (!kind || !model || !baseUrl) {
      return res.status(400).json({ error: 'kind, model und baseUrl sind für den Verbindungstest erforderlich.' });
    }

    const requestedSystemKeyId = typeof req.body?.systemKeyId === 'string' ? req.body.systemKeyId.trim() : '';
    const requestedKeySource = String(req.body?.keySource || '').trim().toLowerCase();
    const forceSystemKeySource = requestedKeySource === 'system';
    const systemKeysEnabled = await getSystemKeysEnabled();
    const inlineApiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    let apiKey = inlineApiKey;
    let keySource = inlineApiKey ? 'inline_test' : 'provider';
    const resolveSystemKey = async (targetSystemKeyId) => {
      const normalizedTarget = String(targetSystemKeyId || '').trim();
      if (!normalizedTarget) return null;
      const assignedKeys = await listAssignedSystemKeysForUser(req, kind);
      const selected = assignedKeys.find((entry) => entry.systemKeyId === normalizedTarget);
      if (!selected) return null;
      const selectedKey = await pool.query(
        `SELECT key_meta
         FROM system_provider_keys
         WHERE system_key_id = $1
           AND is_active = TRUE`,
        [selected.systemKeyId]
      );
      if (!selectedKey.rowCount || !hasServerEncryptedKey(selectedKey.rows[0].key_meta)) return null;
      return {
        apiKey: decryptApiKey(selectedKey.rows[0].key_meta, config.keyEncryptionSecret),
        keySource: `system:${selected.systemKeyId}`,
      };
    };

    if (!systemKeysEnabled && requestedSystemKeyId) {
      return res.status(400).json({ error: 'System-Keys sind global deaktiviert.' });
    }
    if (!apiKey && systemKeysEnabled && (requestedSystemKeyId || forceSystemKeySource)) {
      const resolved = await resolveSystemKey(requestedSystemKeyId || existing?.system_key_id || '');
      if (resolved?.apiKey) {
        apiKey = resolved.apiKey;
        keySource = resolved.keySource;
      }
      if (!apiKey && forceSystemKeySource) {
        return res.status(400).json({ error: 'Ausgewählter System-Key ist nicht verfügbar oder hat keinen aktiven API-Key.' });
      }
    }
    if (!apiKey && !forceSystemKeySource) {
      apiKey = getStoredApiKey(existing);
      keySource = apiKey ? 'provider' : keySource;
    }
    if (!apiKey && existing?.system_key_id && systemKeysEnabled) {
      const resolved = await resolveSystemKey(existing.system_key_id);
      if (resolved?.apiKey) {
        apiKey = resolved.apiKey;
        keySource = resolved.keySource;
      }
    }
    if (!apiKey && kind === 'google' && isSharedGoogleAllowed(req)) {
      apiKey = config.googleTestApiKey;
      keySource = 'shared_google_test';
    }
    if (!apiKey) {
      return res.status(400).json({ error: 'Kein API-Key für Verbindungstest verfügbar.' });
    }

    const startedAt = Date.now();
    let output = '';
    try {
      output = await callProvider({
        kind,
        baseUrl,
        model,
        apiKey,
        metaprompt: buildProviderTestPrompt(),
        timeoutMs: Math.min(config.providerRequestTimeoutMs, 30000),
      });
    } catch (error) {
      const safeMessage = sanitizeExternalErrorMessage(error?.message || '', { fallback: 'Provider-Test fehlgeschlagen.' });
      return res.status(502).json({ error: `Provider-Test fehlgeschlagen: ${safeMessage}` });
    }
    const latencyMs = Date.now() - startedAt;

    res.json({
      ok: true,
      latencyMs,
      keySource,
      preview: String(output || '').slice(0, 220),
    });
  }));

  return router;
}

module.exports = { createProviderRouter };
