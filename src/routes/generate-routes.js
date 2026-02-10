const { Router } = require('express');
const { pool } = require('../db/pool');
const { config } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/api-helpers');
const { buildMetapromptFromTemplate } = require('../services/template-engine');
const { callProvider, isOverloadedProviderError } = require('../services/provider-clients');
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

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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
    `SELECT provider_id, name, kind, model, base_url, base_url_mode, key_meta
     FROM providers
     WHERE user_id = $1 AND provider_id = $2`,
    [req.userId, providerId]
  );
  return providerResult.rows[0] || null;
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
  provider,
  templateId,
  success,
  latencyMs,
  errorType,
}) {
  await pool.query(
    `INSERT INTO provider_generation_events
       (user_id, provider_id, provider_kind, template_id, success, latency_ms, error_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      userId,
      provider.provider_id,
      provider.kind,
      templateId,
      Boolean(success),
      Math.max(Number(latencyMs) || 0, 0),
      errorType ? String(errorType).slice(0, 180) : null,
    ]
  );
}

async function resolveProviderCredential(req, provider) {
  let apiKey = getStoredApiKey(provider);
  let keySource = 'provider';
  if (!apiKey && provider.kind === 'google' && isSharedGoogleAllowed(req)) {
    apiKey = config.googleTestApiKey;
    keySource = 'shared_google_test';
  }
  if (!apiKey) {
    throw httpError(400, 'Kein gueltiger API-Key verfuegbar. Bitte Provider-Key neu speichern oder Testzugang nutzen.');
  }

  const baseUrl = provider.base_url || getRecommendedBaseUrl(provider.kind);
  if (!baseUrl) {
    throw httpError(400, 'Provider base URL fehlt.');
  }

  return {
    apiKey,
    keySource,
    baseUrl,
  };
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

    const provider = await getProviderForUser(req, providerId);
    if (!provider) return res.status(404).json({ error: 'Aktiver Provider nicht gefunden.' });

    const context = await resolveGenerationContext(req, {
      templateId,
      categoryName,
      subcategoryName,
      baseFields,
      dynamicValues,
      templateOverride,
    });

    const startedAt = Date.now();
    let keySource = 'provider';
    let baseUrl = '';
    try {
      const providerCredential = await resolveProviderCredential(req, provider);
      keySource = providerCredential.keySource;
      baseUrl = providerCredential.baseUrl;
      const metapromptForProvider = typeof metapromptOverride === 'string' && metapromptOverride.trim()
        ? metapromptOverride.trim()
        : context.metaprompt;

      const outputRaw = await callProvider({
        kind: provider.kind,
        baseUrl,
        model: provider.model,
        apiKey: providerCredential.apiKey,
        metaprompt: metapromptForProvider,
        timeoutMs: config.providerRequestTimeoutMs,
      });
      let output = parseHandoffPrompt(outputRaw);
      if (!output) {
        const repairedRaw = await callProvider({
          kind: provider.kind,
          baseUrl,
          model: provider.model,
          apiKey: providerCredential.apiKey,
          metaprompt: buildRepairMetaprompt(outputRaw),
          timeoutMs: config.providerRequestTimeoutMs,
        });
        output = parseHandoffPrompt(repairedRaw);
      }
      if (!output) {
        throw httpError(502, 'Provider lieferte kein gueltiges Handoff-Prompt-Format. Bitte erneut versuchen.');
      }
      if (hasPrivacyRisk(output)) {
        try {
          const privacyRepairRaw = await callProvider({
            kind: provider.kind,
            baseUrl,
            model: provider.model,
            apiKey: providerCredential.apiKey,
            metaprompt: buildPrivacyRepairMetaprompt(output),
            timeoutMs: config.providerRequestTimeoutMs,
          });
          const privacyRepairOutput = parseHandoffPrompt(privacyRepairRaw);
          if (privacyRepairOutput) {
            output = privacyRepairOutput;
          }
        } catch (_privacyRepairError) {
          // Fallback to local sanitization below.
        }
      }
      const sanitized = sanitizePromptForPrivacy(output);
      output = sanitized.output;
      if (hasPrivacyRisk(output)) {
        output = ensurePrivacyPolicyBlock(redactSensitiveTerms(output));
      }

      await pool.query(
        `INSERT INTO provider_usage_audit (user_id, provider_id, provider_kind, key_source, template_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.userId, provider.provider_id, provider.kind, keySource, context.resolvedTemplate.templateUid]
      );

      await logGenerationEvent({
        userId: req.userId,
        provider,
        templateId: context.resolvedTemplate.templateUid,
        success: true,
        latencyMs: Date.now() - startedAt,
        errorType: null,
      });

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

      res.json({
        metaprompt: metapromptForProvider,
        output,
        templateId: context.resolvedTemplate.templateUid,
        runtimeTemplateId: context.template.id,
        savedVariantTemplateId,
        provider: {
          id: provider.provider_id,
          name: provider.name,
          kind: provider.kind,
          model: provider.model,
          baseUrl,
          keySource,
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
          provider,
          templateId: context.resolvedTemplate.templateUid,
          success: false,
          latencyMs: Date.now() - startedAt,
          errorType: finalError?.message || 'generation_failed',
        });
      } catch (_logError) {
        // Do not override original provider error path.
      }
      throw finalError;
    }
  }));

  return router;
}

module.exports = { createGenerateRouter };
