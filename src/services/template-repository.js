const crypto = require('crypto');
const { pool } = require('../db/pool');
const { getTemplateCatalog } = require('../catalog/template-catalog');

const VALID_SCOPES = new Set(['official', 'personal', 'community']);
const VALID_REVIEW_STATES = new Set(['draft', 'submitted', 'approved', 'rejected']);
const VALID_PROMPT_MODES = new Set(['schema', 'custom']);
const VALID_NODE_TYPES = new Set(['category', 'subcategory', 'group']);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function slugify(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeScope(scope, fallback = 'personal') {
  const normalized = String(scope || fallback).trim().toLowerCase();
  return VALID_SCOPES.has(normalized) ? normalized : fallback;
}

function normalizeReviewState(state, fallback = 'draft') {
  const normalized = String(state || fallback).trim().toLowerCase();
  return VALID_REVIEW_STATES.has(normalized) ? normalized : fallback;
}

function normalizePromptMode(value, fallback = 'schema') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return VALID_PROMPT_MODES.has(normalized) ? normalized : fallback;
}

function normalizeNodeType(value, fallback = 'subcategory') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return VALID_NODE_TYPES.has(normalized) ? normalized : fallback;
}

function parseJsonArray(input) {
  if (Array.isArray(input)) return input;
  if (!input) return [];
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function asText(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function normalizeTagKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeTagKeys(values = []) {
  return unique((Array.isArray(values) ? values : [])
    .map((entry) => normalizeTagKey(entry))
    .filter(Boolean));
}

function hasPermission(access = {}, permissionKey) {
  const permissions = Array.isArray(access.permissions) ? access.permissions : [];
  return permissions.includes('*') || permissions.includes(permissionKey);
}

async function loadUserSettings(userId) {
  const result = await pool.query('SELECT settings_json FROM user_settings WHERE user_id = $1', [userId]);
  return result.rows[0]?.settings_json || {};
}

async function getNodePath(nodeId) {
  const result = await pool.query(
    `WITH RECURSIVE chain AS (
      SELECT id, parent_id, node_type, node_key, display_name, description, scope, owner_user_id, 0 AS depth
      FROM template_nodes
      WHERE id = $1
      UNION ALL
      SELECT n.id, n.parent_id, n.node_type, n.node_key, n.display_name, n.description, n.scope, n.owner_user_id, c.depth + 1
      FROM template_nodes n
      JOIN chain c ON c.parent_id = n.id
    )
    SELECT id, parent_id, node_type, node_key, display_name, description, scope, owner_user_id, depth
    FROM chain
    ORDER BY depth DESC`,
    [nodeId]
  );
  return result.rows;
}

function canSeeCommunity({ access, showCommunityTemplates }) {
  if (!showCommunityTemplates) return false;
  return hasPermission(access, 'templates.use_community');
}

function canSeeTemplateRow(row, { userId, access, showCommunityTemplates }) {
  if (hasPermission(access, '*')) return true;

  const owner = row.owner_user_id ? String(row.owner_user_id) : null;
  if (owner && owner === String(userId)) return true;

  if (row.scope === 'official' && row.review_state === 'approved') return true;
  if (row.scope === 'community' && row.review_state === 'approved' && canSeeCommunity({ access, showCommunityTemplates })) {
    return true;
  }
  if (row.review_state === 'submitted' && hasPermission(access, 'templates.review')) return true;
  return false;
}

function canSeeNodeRow(row, { userId, access, showCommunityTemplates }) {
  if (hasPermission(access, '*')) return true;
  const owner = row.owner_user_id ? String(row.owner_user_id) : null;
  if (owner && owner === String(userId)) return true;
  if (row.scope === 'official' && row.review_state === 'approved') return true;
  if (row.scope === 'community' && row.review_state === 'approved' && canSeeCommunity({ access, showCommunityTemplates })) {
    return true;
  }
  return false;
}

function ensureTemplateMutationAllowed(row, { userId, access }) {
  const owner = row.owner_user_id ? String(row.owner_user_id) : null;
  if (hasPermission(access, '*')) return;

  if (owner && owner === String(userId) && hasPermission(access, 'templates.manage_own')) return;
  if (row.scope === 'official' && hasPermission(access, 'templates.official_manage')) return;
  if (row.scope === 'community' && hasPermission(access, 'templates.community_manage')) return;
  if (row.review_state === 'submitted' && hasPermission(access, 'templates.review')) return;
  throw httpError(403, 'Keine Berechtigung fuer Template-Aenderung.');
}

function ensureNodeMutationAllowed(row, { userId, access }) {
  if (hasPermission(access, '*')) return;
  const owner = row.owner_user_id ? String(row.owner_user_id) : null;
  if (owner && owner === String(userId) && hasPermission(access, 'templates.nodes.manage_own')) return;
  if ((row.scope === 'official' || row.scope === 'community') && hasPermission(access, 'templates.nodes.official_manage')) return;
  throw httpError(403, 'Keine Berechtigung fuer Taxonomie-Aenderung.');
}

async function getNodeById(nodeId) {
  const result = await pool.query(
    `SELECT *
     FROM template_nodes
     WHERE id = $1`,
    [nodeId]
  );
  return result.rows[0] || null;
}

async function getTemplateRecordByUid(templateUid) {
  const result = await pool.query(
    `SELECT t.*
     FROM template_records t
     WHERE t.template_uid = $1
       AND t.is_archived = FALSE`,
    [templateUid]
  );
  return result.rows[0] || null;
}

async function getTemplateWithVersionByUid(templateUid) {
  const result = await pool.query(
    `SELECT
       t.*,
       v.id AS version_id,
       v.version_no,
       v.base_prompt,
       v.prompt_mode AS version_prompt_mode,
       v.taxonomy_path,
       v.required_base_fields,
       v.optional_base_fields,
       v.dynamic_fields,
       v.tags,
       v.change_note,
       v.created_by AS version_created_by,
       v.created_at AS version_created_at,
       n.display_name AS node_name,
       n.node_type,
       n.scope AS node_scope
     FROM template_records t
     LEFT JOIN template_versions v ON v.id = t.active_version_id
     LEFT JOIN template_nodes n ON n.id = t.node_id
     WHERE t.template_uid = $1
       AND t.is_archived = FALSE`,
    [templateUid]
  );
  return result.rows[0] || null;
}

async function getTemplateVersionById(versionId) {
  const result = await pool.query(
    `SELECT *
     FROM template_versions
     WHERE id = $1`,
    [versionId]
  );
  return result.rows[0] || null;
}

async function ensureTagCatalogEntries({ userId, tagKeys = [], official = false }) {
  const normalized = normalizeTagKeys(tagKeys);
  for (const tagKey of normalized) {
    await pool.query(
      `INSERT INTO template_tag_catalog (tag_key, display_name, description, is_official, created_by)
       VALUES ($1, $2, '', $3, $4)
       ON CONFLICT (tag_key)
       DO UPDATE SET
         is_official = template_tag_catalog.is_official OR EXCLUDED.is_official,
         updated_at = NOW()`,
      [tagKey, tagKey, Boolean(official), String(userId)]
    );
  }
}

function normalizeDynamicFields(values) {
  const dynamic = Array.isArray(values) ? values : [];
  return dynamic
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const id = slugify(entry.id || entry.label || '');
      if (!id) return null;
      const type = asText(entry.type || 'text').trim().toLowerCase();
      const options = Array.isArray(entry.options) ? entry.options.map((option) => asText(option).trim()).filter(Boolean) : undefined;
      return {
        id,
        label: asText(entry.label || id),
        type,
        required: Boolean(entry.required),
        placeholder: asText(entry.placeholder || ''),
        options,
      };
    })
    .filter(Boolean);
}

function normalizeBaseFieldList(values = [], fallback = []) {
  const source = Array.isArray(values) ? values : [];
  const normalized = unique(source.map((entry) => slugify(entry).replace(/-/g, '_')).filter(Boolean));
  return normalized.length ? normalized : [...fallback];
}

function buildTemplateViewRow(row, pathRows = []) {
  const requiredBaseFields = normalizeBaseFieldList(parseJsonArray(row.required_base_fields), ['fach', 'schulstufe', 'ziel']);
  const optionalBaseFields = normalizeBaseFieldList(
    parseJsonArray(row.optional_base_fields),
    ['zeitrahmen', 'niveau', 'rahmen', 'ergebnisformat', 'ton', 'rueckfragen']
  );
  const dynamicFields = normalizeDynamicFields(parseJsonArray(row.dynamic_fields));
  const tags = normalizeTagKeys(parseJsonArray(row.tags));
  const explicitPath = parseJsonArray(row.taxonomy_path).map((entry) => asText(entry).trim()).filter(Boolean);
  const nodePath = pathRows.map((entry) => entry.display_name).filter(Boolean);
  const taxonomyPath = explicitPath.length ? explicitPath : (nodePath.length ? nodePath : [asText(row.node_name || ''), asText(row.title || '')].filter(Boolean));

  const rootCategory = taxonomyPath[0] || 'Sonstige';
  const subPath = taxonomyPath.slice(1);
  const lastPath = subPath[subPath.length - 1];
  const title = asText(row.title || row.node_name || 'Template').trim() || 'Template';
  const subcategoryName = unique([
    ...subPath,
    ...(lastPath && lastPath === title ? [] : [title]),
  ]).join(' / ') || title;

  return {
    dbId: Number(row.id),
    templateUid: row.template_uid,
    sourceTemplateUid: row.source_template_id || null,
    ownerUserId: row.owner_user_id || null,
    scope: row.scope,
    reviewState: row.review_state,
    title,
    description: asText(row.description || ''),
    profile: asText(row.profile || 'unterrichtsnah'),
    promptMode: normalizePromptMode(row.version_prompt_mode || row.prompt_mode || 'schema'),
    basePrompt: asText(row.base_prompt || ''),
    requiredBaseFields,
    optionalBaseFields,
    dynamicFields,
    tags,
    taxonomyPath,
    categoryName: rootCategory,
    subcategoryName,
    versionId: row.version_id ? Number(row.version_id) : null,
    versionNo: row.version_no ? Number(row.version_no) : null,
    avgRating: Number(row.avg_rating || 0),
    ratingCount: Number(row.rating_count || 0),
    usageCount: Number(row.usage_count || 0),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    nodeId: row.node_id ? Number(row.node_id) : null,
  };
}

async function listRawTemplates() {
  const result = await pool.query(
    `SELECT
       t.*,
       v.id AS version_id,
       v.version_no,
       v.base_prompt,
       v.prompt_mode AS version_prompt_mode,
       v.taxonomy_path,
       v.required_base_fields,
       v.optional_base_fields,
       v.dynamic_fields,
       v.tags,
       n.display_name AS node_name,
       COALESCE(r.avg_rating, 0) AS avg_rating,
       COALESCE(r.rating_count, 0) AS rating_count,
       COALESCE(u.usage_count, 0) AS usage_count
     FROM template_records t
     LEFT JOIN template_versions v ON v.id = t.active_version_id
     LEFT JOIN template_nodes n ON n.id = t.node_id
     LEFT JOIN (
       SELECT template_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
       FROM template_ratings
       GROUP BY template_id
     ) r ON r.template_id = t.id
     LEFT JOIN (
       SELECT template_id, COUNT(*) AS usage_count
       FROM provider_usage_audit
       GROUP BY template_id
     ) u ON u.template_id = t.template_uid
     WHERE t.is_archived = FALSE`
  );
  return result.rows;
}

async function getVisibleTemplatesForUser({ userId, access, filters = {} }) {
  const settings = await loadUserSettings(userId);
  const showCommunityTemplates = filters.showCommunityTemplates !== undefined
    ? Boolean(filters.showCommunityTemplates)
    : (settings.showCommunityTemplates !== false);

  const rows = await listRawTemplates();
  const pathCache = new Map();
  const visible = [];

  for (const row of rows) {
    if (!canSeeTemplateRow(row, { userId, access, showCommunityTemplates })) continue;

    const nodeId = row.node_id ? Number(row.node_id) : null;
    let pathRows = [];
    if (nodeId) {
      if (!pathCache.has(nodeId)) {
        pathCache.set(nodeId, await getNodePath(nodeId));
      }
      pathRows = pathCache.get(nodeId) || [];
    }
    visible.push(buildTemplateViewRow(row, pathRows));
  }

  let filtered = visible;
  const scope = filters.scope ? normalizeScope(filters.scope, '') : '';
  if (scope && VALID_SCOPES.has(scope)) {
    filtered = filtered.filter((entry) => entry.scope === scope);
  }

  const reviewState = filters.reviewState ? normalizeReviewState(filters.reviewState, '') : '';
  if (reviewState && VALID_REVIEW_STATES.has(reviewState)) {
    filtered = filtered.filter((entry) => entry.reviewState === reviewState);
  }

  if (typeof filters.ownerUserId === 'string' && filters.ownerUserId.trim()) {
    filtered = filtered.filter((entry) => entry.ownerUserId === filters.ownerUserId.trim());
  }

  const tag = normalizeTagKey(filters.tag || '');
  if (tag) {
    filtered = filtered.filter((entry) => entry.tags.includes(tag));
  }

  const search = asText(filters.search || '').trim().toLowerCase();
  if (search) {
    filtered = filtered.filter((entry) => {
      const title = entry.title.toLowerCase();
      const description = entry.description.toLowerCase();
      const category = entry.categoryName.toLowerCase();
      const subcategory = entry.subcategoryName.toLowerCase();
      return title.includes(search) || description.includes(search) || category.includes(search) || subcategory.includes(search);
    });
  }

  const withScore = filtered.map((entry) => {
    let score = 0;
    if (search) {
      const lowerTitle = entry.title.toLowerCase();
      const lowerDescription = entry.description.toLowerCase();
      if (lowerTitle === search) score += 8;
      else if (lowerTitle.includes(search)) score += 5;
      else if (lowerDescription.includes(search)) score += 2;
    }
    if (tag && entry.tags.includes(tag)) score += 4;
    score += Math.min(entry.avgRating, 5) * 0.35;
    score += Math.min(entry.usageCount, 200) * 0.01;
    return { ...entry, score };
  });

  withScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return {
    templates: withScore,
    showCommunityTemplates,
  };
}

function templatesToCatalog(templates) {
  const categories = {};

  for (const template of templates) {
    const categoryKey = template.categoryName;
    if (!categories[categoryKey]) {
      categories[categoryKey] = {
        title: categoryKey,
        short: categoryKey.slice(0, 2).toUpperCase(),
        description: '',
        unterkategorien: [],
        templates: {},
      };
    }

    const category = categories[categoryKey];
    let subcategoryName = template.subcategoryName;
    let idx = 2;
    while (category.templates[subcategoryName]) {
      subcategoryName = `${template.subcategoryName} (${template.scope}-${idx})`;
      idx += 1;
    }

    category.unterkategorien.push(subcategoryName);
    category.templates[subcategoryName] = {
      id: template.templateUid,
      dbId: template.dbId,
      description: template.description,
      profile: template.profile,
      requiredBaseFields: template.requiredBaseFields,
      optionalBaseFields: template.optionalBaseFields,
      dynamicFields: template.dynamicFields,
      tags: template.tags,
      promptMode: template.promptMode,
      taxonomyPath: template.taxonomyPath,
      basePrompt: template.basePrompt,
      scope: template.scope,
      reviewState: template.reviewState,
      ownerUserId: template.ownerUserId,
      avgRating: template.avgRating,
      ratingCount: template.ratingCount,
      usageCount: template.usageCount,
    };
  }

  Object.values(categories).forEach((category) => {
    category.unterkategorien.sort((a, b) => a.localeCompare(b, 'de'));
  });

  return categories;
}

async function getTemplateCatalogForUser({ userId, access, filters = {} }) {
  const visible = await getVisibleTemplatesForUser({ userId, access, filters });
  const fallbackCatalog = getTemplateCatalog();
  const categories = templatesToCatalog(visible.templates);

  return {
    categories,
    presetOptions: fallbackCatalog.presetOptions || {},
    meta: {
      count: visible.templates.length,
      showCommunityTemplates: visible.showCommunityTemplates,
    },
  };
}

async function getTemplateForGeneration({ userId, access, templateUid, categoryName, subcategoryName, showCommunityTemplates }) {
  const visible = await getVisibleTemplatesForUser({
    userId,
    access,
    filters: { showCommunityTemplates },
  });
  const templates = visible.templates;

  if (templateUid) {
    const exact = templates.find((entry) => entry.templateUid === String(templateUid));
    if (exact) return exact;
  }

  if (categoryName && subcategoryName) {
    const fallback = templates.find(
      (entry) => entry.categoryName === String(categoryName) && entry.subcategoryName === String(subcategoryName)
    );
    if (fallback) return fallback;
  }

  return null;
}

async function getVisibleTemplateNodes({ userId, access, filters = {} }) {
  const settings = await loadUserSettings(userId);
  const showCommunityTemplates = filters.showCommunityTemplates !== undefined
    ? Boolean(filters.showCommunityTemplates)
    : (settings.showCommunityTemplates !== false);

  const result = await pool.query(
    `SELECT *
     FROM template_nodes
     WHERE is_archived = FALSE
     ORDER BY COALESCE(parent_id, 0), display_name`
  );

  return result.rows
    .filter((row) => canSeeNodeRow(row, { userId, access, showCommunityTemplates }))
    .map((row) => ({
      id: Number(row.id),
      parentId: row.parent_id ? Number(row.parent_id) : null,
      ownerUserId: row.owner_user_id || null,
      scope: row.scope,
      reviewState: row.review_state,
      nodeType: row.node_type,
      nodeKey: row.node_key,
      displayName: row.display_name,
      description: row.description || '',
      isSystem: Boolean(row.is_system),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function buildNodeVisibilityScope({ requestedScope, userId, access }) {
  const scope = normalizeScope(requestedScope, 'personal');
  if (scope === 'personal') {
    if (!hasPermission(access, 'templates.nodes.manage_own')) {
      throw httpError(403, 'Keine Berechtigung fuer eigene Taxonomie.');
    }
    return { scope: 'personal', ownerUserId: userId, reviewState: 'draft' };
  }

  if (!hasPermission(access, 'templates.nodes.official_manage') && !hasPermission(access, 'templates.official_manage')) {
    throw httpError(403, 'Keine Berechtigung fuer globale Taxonomie.');
  }
  return { scope, ownerUserId: null, reviewState: 'approved' };
}

async function createTemplateNode({ userId, access, payload = {} }) {
  const displayName = asText(payload.displayName || '').trim();
  if (!displayName) throw httpError(400, 'displayName ist erforderlich.');

  const nodeType = normalizeNodeType(payload.nodeType, payload.parentId ? 'subcategory' : 'category');
  const parentId = payload.parentId ? Number(payload.parentId) : null;
  if (payload.parentId && !Number.isInteger(parentId)) throw httpError(400, 'Ungueltige parentId.');
  if (!payload.parentId && nodeType !== 'category') throw httpError(400, 'Root-Nodes muessen vom Typ category sein.');

  const visibility = buildNodeVisibilityScope({ requestedScope: payload.scope, userId, access });

  if (parentId) {
    const parent = await getNodeById(parentId);
    if (!parent || parent.is_archived) throw httpError(404, 'Parent-Node nicht gefunden.');
    if (visibility.scope === 'personal' && parent.scope === 'personal' && parent.owner_user_id !== String(userId)) {
      throw httpError(403, 'Personal Parent gehoert nicht zum Benutzer.');
    }
  }

  const nodeKey = slugify(payload.nodeKey || displayName);
  const existing = await pool.query(
    `SELECT id
     FROM template_nodes
     WHERE COALESCE(parent_id, 0) = COALESCE($1::bigint, 0)
       AND scope = $2
       AND COALESCE(owner_user_id, '') = COALESCE($3::text, '')
       AND node_key = $4
       AND is_archived = FALSE
     LIMIT 1`,
    [parentId, visibility.scope, visibility.ownerUserId, nodeKey]
  );
  if (existing.rowCount) throw httpError(409, 'Node mit gleichem Key existiert bereits.');

  const insert = await pool.query(
    `INSERT INTO template_nodes
       (parent_id, owner_user_id, scope, review_state, node_type, node_key, display_name, description, is_system)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)
     RETURNING id`,
    [
      parentId,
      visibility.ownerUserId,
      visibility.scope,
      visibility.reviewState,
      nodeType,
      nodeKey,
      displayName,
      asText(payload.description || ''),
    ]
  );

  return { ok: true, id: Number(insert.rows[0].id) };
}

async function updateTemplateNode({ userId, access, nodeId, payload = {} }) {
  const id = Number(nodeId);
  if (!Number.isInteger(id)) throw httpError(400, 'Ungueltige nodeId.');
  const node = await getNodeById(id);
  if (!node || node.is_archived) throw httpError(404, 'Node nicht gefunden.');
  ensureNodeMutationAllowed(node, { userId, access });

  const fields = [];
  const values = [];
  let idx = 1;
  if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
    const displayName = payload.displayName.trim();
    fields.push(`display_name = $${idx++}`);
    values.push(displayName);
    fields.push(`node_key = $${idx++}`);
    values.push(slugify(payload.nodeKey || displayName));
  }
  if (typeof payload.description === 'string') {
    fields.push(`description = $${idx++}`);
    values.push(payload.description.trim());
  }
  if (!fields.length) throw httpError(400, 'Keine gueltigen Felder fuer Update.');
  fields.push('updated_at = NOW()');

  values.push(id);
  await pool.query(
    `UPDATE template_nodes
     SET ${fields.join(', ')}
     WHERE id = $${idx}
    `,
    values
  );

  return { ok: true };
}

function resolveTemplateScope({ requestedScope, userId, access }) {
  const scope = normalizeScope(requestedScope, 'personal');
  if (scope === 'personal') {
    if (!hasPermission(access, 'templates.manage_own')) {
      throw httpError(403, 'Keine Berechtigung fuer persoenliche Templates.');
    }
    return {
      scope: 'personal',
      ownerUserId: userId,
      reviewState: 'draft',
    };
  }

  if (scope === 'official') {
    if (!hasPermission(access, 'templates.official_manage')) {
      throw httpError(403, 'Keine Berechtigung fuer offizielle Templates.');
    }
    return {
      scope: 'official',
      ownerUserId: null,
      reviewState: 'approved',
    };
  }

  if (!hasPermission(access, 'templates.community_manage') && !hasPermission(access, 'templates.official_manage')) {
    throw httpError(403, 'Keine Berechtigung fuer Community-Templates.');
  }
  return {
    scope: 'community',
    ownerUserId: null,
    reviewState: 'approved',
  };
}

function normalizeTemplatePayload(payload = {}) {
  return {
    title: asText(payload.title || '').trim(),
    description: asText(payload.description || '').trim(),
    profile: asText(payload.profile || 'unterrichtsnah').trim() || 'unterrichtsnah',
    promptMode: normalizePromptMode(payload.promptMode, payload.basePrompt ? 'custom' : 'schema'),
    basePrompt: asText(payload.basePrompt || ''),
    requiredBaseFields: normalizeBaseFieldList(payload.requiredBaseFields, ['fach', 'schulstufe', 'ziel']),
    optionalBaseFields: normalizeBaseFieldList(payload.optionalBaseFields, ['zeitrahmen', 'niveau', 'rahmen', 'ergebnisformat', 'ton', 'rueckfragen']),
    dynamicFields: normalizeDynamicFields(payload.dynamicFields),
    tags: normalizeTagKeys(payload.tags),
    taxonomyPath: parseJsonArray(payload.taxonomyPath).map((entry) => asText(entry).trim()).filter(Boolean),
    changeNote: asText(payload.changeNote || '').trim(),
  };
}

function makeTemplateUid() {
  return `tpl-${crypto.randomUUID()}`.slice(0, 160);
}

async function createTemplateRecord({ userId, access, payload = {} }) {
  const templateData = normalizeTemplatePayload(payload);
  if (!templateData.title) throw httpError(400, 'title ist erforderlich.');

  const nodeId = Number(payload.nodeId);
  if (!Number.isInteger(nodeId)) throw httpError(400, 'nodeId ist erforderlich.');
  const node = await getNodeById(nodeId);
  if (!node || node.is_archived) throw httpError(404, 'Node nicht gefunden.');

  const scopeInfo = resolveTemplateScope({ requestedScope: payload.scope, userId, access });
  if (scopeInfo.scope === 'personal' && node.scope === 'personal' && node.owner_user_id !== String(userId)) {
    throw httpError(403, 'Personal node gehoert nicht zum Benutzer.');
  }

  await ensureTagCatalogEntries({
    userId,
    tagKeys: templateData.tags,
    official: hasPermission(access, 'tags.moderate') && scopeInfo.scope === 'official',
  });

  const templateUid = makeTemplateUid();
  const insertTemplate = await pool.query(
    `INSERT INTO template_records
       (template_uid, node_id, owner_user_id, scope, review_state, title, description, profile, prompt_mode, source_template_id, is_system)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)
     RETURNING id`,
    [
      templateUid,
      nodeId,
      scopeInfo.ownerUserId,
      scopeInfo.scope,
      scopeInfo.reviewState,
      templateData.title,
      templateData.description,
      templateData.profile,
      templateData.promptMode,
      payload.sourceTemplateDbId ? Number(payload.sourceTemplateDbId) : null,
    ]
  );
  const templateId = insertTemplate.rows[0].id;

  const taxonomyPath = templateData.taxonomyPath.length ? templateData.taxonomyPath : (await getNodePath(nodeId)).map((entry) => entry.display_name);
  const versionNo = 1;
  const insertVersion = await pool.query(
    `INSERT INTO template_versions
       (template_id, version_no, base_prompt, prompt_mode, taxonomy_path, required_base_fields, optional_base_fields, dynamic_fields, tags, change_note, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING id`,
    [
      templateId,
      versionNo,
      templateData.basePrompt,
      templateData.promptMode,
      JSON.stringify(taxonomyPath),
      JSON.stringify(templateData.requiredBaseFields),
      JSON.stringify(templateData.optionalBaseFields),
      JSON.stringify(templateData.dynamicFields),
      JSON.stringify(templateData.tags),
      templateData.changeNote || 'Initial version',
      userId,
    ]
  );

  await pool.query(
    `UPDATE template_records
     SET active_version_id = $1, updated_at = NOW()
     WHERE id = $2`,
    [insertVersion.rows[0].id, templateId]
  );

  return { ok: true, templateUid };
}

async function updateTemplateRecord({ userId, access, templateUid, payload = {} }) {
  const template = await getTemplateWithVersionByUid(templateUid);
  if (!template) throw httpError(404, 'Template nicht gefunden.');
  ensureTemplateMutationAllowed(template, { userId, access });

  const templateData = normalizeTemplatePayload(payload);
  await ensureTagCatalogEntries({
    userId,
    tagKeys: templateData.tags,
    official: hasPermission(access, 'tags.moderate') && template.scope === 'official',
  });

  const activeVersion = template.active_version_id ? await getTemplateVersionById(template.active_version_id) : null;
  const mergedRequiredBase = templateData.requiredBaseFields.length
    ? templateData.requiredBaseFields
    : normalizeBaseFieldList(parseJsonArray(activeVersion?.required_base_fields), ['fach', 'schulstufe', 'ziel']);
  const mergedOptionalBase = templateData.optionalBaseFields.length
    ? templateData.optionalBaseFields
    : normalizeBaseFieldList(parseJsonArray(activeVersion?.optional_base_fields), ['zeitrahmen', 'niveau', 'rahmen', 'ergebnisformat', 'ton', 'rueckfragen']);
  const mergedDynamicFields = templateData.dynamicFields.length
    ? templateData.dynamicFields
    : normalizeDynamicFields(parseJsonArray(activeVersion?.dynamic_fields));
  const mergedTags = templateData.tags.length
    ? templateData.tags
    : normalizeTagKeys(parseJsonArray(activeVersion?.tags));
  const mergedTaxonomyPath = templateData.taxonomyPath.length
    ? templateData.taxonomyPath
    : parseJsonArray(activeVersion?.taxonomy_path).map((entry) => asText(entry).trim()).filter(Boolean);
  const mergedPromptMode = templateData.basePrompt
    ? normalizePromptMode(templateData.promptMode, 'custom')
    : normalizePromptMode(templateData.promptMode, activeVersion?.prompt_mode || template.prompt_mode || 'schema');
  const mergedBasePrompt = templateData.basePrompt || asText(activeVersion?.base_prompt || '');

  const metadataFields = [];
  const metadataValues = [];
  let idx = 1;
  if (templateData.title) {
    metadataFields.push(`title = $${idx++}`);
    metadataValues.push(templateData.title);
  }
  if (typeof payload.description === 'string') {
    metadataFields.push(`description = $${idx++}`);
    metadataValues.push(templateData.description);
  }
  if (templateData.profile) {
    metadataFields.push(`profile = $${idx++}`);
    metadataValues.push(templateData.profile);
  }
  if (payload.nodeId) {
    const nodeId = Number(payload.nodeId);
    if (!Number.isInteger(nodeId)) throw httpError(400, 'Ungueltige nodeId.');
    metadataFields.push(`node_id = $${idx++}`);
    metadataValues.push(nodeId);
  }
  metadataFields.push(`prompt_mode = $${idx++}`);
  metadataValues.push(mergedPromptMode);
  metadataFields.push('updated_at = NOW()');
  metadataValues.push(template.id);

  await pool.query(
    `UPDATE template_records
     SET ${metadataFields.join(', ')}
     WHERE id = $${idx}`,
    metadataValues
  );

  const nextVersionResult = await pool.query(
    `SELECT COALESCE(MAX(version_no), 0) AS max_version
     FROM template_versions
     WHERE template_id = $1`,
    [template.id]
  );
  const nextVersionNo = Number(nextVersionResult.rows[0]?.max_version || 0) + 1;
  const newVersion = await pool.query(
    `INSERT INTO template_versions
       (template_id, version_no, base_prompt, prompt_mode, taxonomy_path, required_base_fields, optional_base_fields, dynamic_fields, tags, change_note, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING id`,
    [
      template.id,
      nextVersionNo,
      mergedBasePrompt,
      mergedPromptMode,
      JSON.stringify(mergedTaxonomyPath),
      JSON.stringify(mergedRequiredBase),
      JSON.stringify(mergedOptionalBase),
      JSON.stringify(mergedDynamicFields),
      JSON.stringify(mergedTags),
      templateData.changeNote || 'Template update',
      userId,
    ]
  );

  const reviewState = template.owner_user_id === String(userId) && template.review_state === 'submitted'
    ? 'draft'
    : template.review_state;

  await pool.query(
    `UPDATE template_records
     SET active_version_id = $1, review_state = $2, updated_at = NOW()
     WHERE id = $3`,
    [newVersion.rows[0].id, reviewState, template.id]
  );

  return { ok: true, templateUid };
}

async function submitTemplateForReview({ userId, access, templateUid, note = '' }) {
  if (!hasPermission(access, 'templates.submit_review')) {
    throw httpError(403, 'Keine Berechtigung fuer Review-Submit.');
  }
  const template = await getTemplateRecordByUid(templateUid);
  if (!template) throw httpError(404, 'Template nicht gefunden.');
  if (template.owner_user_id !== String(userId)) throw httpError(403, 'Nur eigene Templates koennen eingereicht werden.');
  if (template.scope !== 'personal') throw httpError(400, 'Nur persoenliche Templates koennen eingereicht werden.');
  if (template.review_state === 'submitted') throw httpError(400, 'Template ist bereits eingereicht.');

  await pool.query(
    `UPDATE template_records
     SET review_state = 'submitted', updated_at = NOW()
     WHERE id = $1`,
    [template.id]
  );
  await pool.query(
    `INSERT INTO template_review_events (template_id, from_state, to_state, note, acted_by)
     VALUES ($1,$2,'submitted',$3,$4)`,
    [template.id, template.review_state, asText(note), userId]
  );

  return { ok: true };
}

async function ensureScopePathFromNode(nodeId, targetScope) {
  const pathRows = await getNodePath(nodeId);
  if (!pathRows.length) throw httpError(404, 'Template-Pfad nicht gefunden.');

  let parentId = null;
  for (const node of pathRows) {
    const nodeKey = slugify(node.node_key || node.display_name || '');
    const existing = await pool.query(
      `SELECT id
       FROM template_nodes
       WHERE COALESCE(parent_id, 0) = COALESCE($1::bigint, 0)
         AND scope = $2
         AND COALESCE(owner_user_id, '') = ''
         AND node_key = $3
         AND is_archived = FALSE
       LIMIT 1`,
      [parentId, targetScope, nodeKey]
    );

    if (existing.rowCount) {
      parentId = existing.rows[0].id;
      continue;
    }

    const inserted = await pool.query(
      `INSERT INTO template_nodes
         (parent_id, owner_user_id, scope, review_state, node_type, node_key, display_name, description, is_system)
       VALUES ($1,NULL,$2,'approved',$3,$4,$5,$6,FALSE)
       RETURNING id`,
      [
        parentId,
        targetScope,
        node.node_type || 'subcategory',
        nodeKey || slugify(node.display_name),
        node.display_name,
        node.description || '',
      ]
    );
    parentId = inserted.rows[0].id;
  }

  return parentId;
}

async function reviewTemplateSubmission({ userId, access, templateUid, decision, note = '', targetScope = 'community' }) {
  if (!hasPermission(access, 'templates.review')) {
    throw httpError(403, 'Keine Berechtigung fuer Review.');
  }

  const template = await getTemplateRecordByUid(templateUid);
  if (!template) throw httpError(404, 'Template nicht gefunden.');
  if (template.review_state !== 'submitted' && !hasPermission(access, 'templates.official_manage')) {
    throw httpError(400, 'Template ist nicht in Review-Queue.');
  }

  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(normalizedDecision)) {
    throw httpError(400, 'decision muss approve oder reject sein.');
  }

  if (normalizedDecision === 'reject') {
    await pool.query(
      `UPDATE template_records
       SET review_state = 'rejected', scope = 'personal', updated_at = NOW()
       WHERE id = $1`,
      [template.id]
    );
    await pool.query(
      `INSERT INTO template_review_events (template_id, from_state, to_state, note, acted_by)
       VALUES ($1,$2,'rejected',$3,$4)`,
      [template.id, template.review_state, asText(note), userId]
    );
    return { ok: true, reviewState: 'rejected', scope: 'personal' };
  }

  const normalizedTargetScope = normalizeScope(targetScope, 'community');
  if (normalizedTargetScope === 'official' && !hasPermission(access, 'templates.official_manage')) {
    throw httpError(403, 'Nur Curators/Admins duerfen offiziell freigeben.');
  }
  if (normalizedTargetScope === 'community' && !hasPermission(access, 'templates.review')) {
    throw httpError(403, 'Keine Berechtigung fuer Community-Freigabe.');
  }

  const promotedNodeId = await ensureScopePathFromNode(template.node_id, normalizedTargetScope);
  await pool.query(
    `UPDATE template_records
     SET scope = $1, review_state = 'approved', node_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [normalizedTargetScope, promotedNodeId, template.id]
  );
  await pool.query(
    `INSERT INTO template_review_events (template_id, from_state, to_state, note, acted_by)
     VALUES ($1,$2,'approved',$3,$4)`,
    [template.id, template.review_state, asText(note), userId]
  );

  return { ok: true, reviewState: 'approved', scope: normalizedTargetScope };
}

async function cloneTemplateAsPersonal({ userId, access, templateUid, overrides = {}, titleSuffix = ' (Persoenliche Variante)' }) {
  if (!hasPermission(access, 'templates.manage_own')) {
    throw httpError(403, 'Keine Berechtigung fuer persoenliche Varianten.');
  }
  const source = await getTemplateWithVersionByUid(templateUid);
  if (!source) throw httpError(404, 'Quelltemplate nicht gefunden.');
  if (!canSeeTemplateRow(source, { userId, access, showCommunityTemplates: true })) {
    throw httpError(403, 'Template nicht sichtbar.');
  }

  const sourcePath = await getNodePath(source.node_id);
  const personalRootName = sourcePath[0]?.display_name || 'Meine Templates';
  let parentId = null;
  for (const node of sourcePath) {
    const desiredName = node.display_name || personalRootName;
    const nodeKey = slugify(node.node_key || desiredName);
    const existing = await pool.query(
      `SELECT id
       FROM template_nodes
       WHERE COALESCE(parent_id, 0) = COALESCE($1::bigint, 0)
         AND scope = 'personal'
         AND owner_user_id = $2
         AND node_key = $3
         AND is_archived = FALSE
       LIMIT 1`,
      [parentId, userId, nodeKey]
    );
    if (existing.rowCount) {
      parentId = existing.rows[0].id;
      continue;
    }
    const inserted = await pool.query(
      `INSERT INTO template_nodes
         (parent_id, owner_user_id, scope, review_state, node_type, node_key, display_name, description, is_system)
       VALUES ($1,$2,'personal','draft',$3,$4,$5,$6,FALSE)
       RETURNING id`,
      [
        parentId,
        userId,
        node.node_type || 'subcategory',
        nodeKey,
        desiredName,
        node.description || '',
      ]
    );
    parentId = inserted.rows[0].id;
  }

  const templateData = normalizeTemplatePayload({
    title: asText(overrides.title || source.title || '') + titleSuffix,
    description: overrides.description !== undefined ? overrides.description : source.description,
    profile: overrides.profile !== undefined ? overrides.profile : source.profile,
    promptMode: overrides.promptMode !== undefined ? overrides.promptMode : (source.version_prompt_mode || source.prompt_mode),
    basePrompt: overrides.basePrompt !== undefined ? overrides.basePrompt : source.base_prompt,
    requiredBaseFields: overrides.requiredBaseFields !== undefined ? overrides.requiredBaseFields : parseJsonArray(source.required_base_fields),
    optionalBaseFields: overrides.optionalBaseFields !== undefined ? overrides.optionalBaseFields : parseJsonArray(source.optional_base_fields),
    dynamicFields: overrides.dynamicFields !== undefined ? overrides.dynamicFields : parseJsonArray(source.dynamic_fields),
    tags: overrides.tags !== undefined ? overrides.tags : parseJsonArray(source.tags),
    taxonomyPath: overrides.taxonomyPath !== undefined ? overrides.taxonomyPath : parseJsonArray(source.taxonomy_path),
    changeNote: overrides.changeNote || 'Personal clone from source template',
  });

  const cloneResult = await createTemplateRecord({
    userId,
    access,
    payload: {
      ...templateData,
      nodeId: parentId,
      scope: 'personal',
      sourceTemplateDbId: source.id,
    },
  });

  return {
    ok: true,
    templateUid: cloneResult.templateUid,
  };
}

async function listTemplateTags({ includeInactive = false } = {}) {
  const result = await pool.query(
    `SELECT id, tag_key, display_name, description, is_official, is_active, created_by, created_at, updated_at
     FROM template_tag_catalog
     ${includeInactive ? '' : 'WHERE is_active = TRUE'}
     ORDER BY is_official DESC, tag_key ASC`
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    key: row.tag_key,
    displayName: row.display_name,
    description: row.description,
    isOfficial: Boolean(row.is_official),
    isActive: Boolean(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function createOrUpdateTag({ userId, access, key, displayName, description = '', official = false }) {
  const normalizedKey = normalizeTagKey(key);
  if (!normalizedKey) throw httpError(400, 'tag key ist erforderlich.');
  const wantsOfficial = Boolean(official);
  if (wantsOfficial && !hasPermission(access, 'tags.moderate')) {
    throw httpError(403, 'Keine Berechtigung fuer offizielle Tags.');
  }
  if (!wantsOfficial && !hasPermission(access, 'tags.manage_own') && !hasPermission(access, 'tags.moderate')) {
    throw httpError(403, 'Keine Berechtigung fuer Tags.');
  }

  await pool.query(
    `INSERT INTO template_tag_catalog
       (tag_key, display_name, description, is_official, created_by, is_active, updated_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,NOW())
     ON CONFLICT (tag_key)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       description = EXCLUDED.description,
       is_official = template_tag_catalog.is_official OR EXCLUDED.is_official,
       is_active = TRUE,
       updated_at = NOW()`,
    [
      normalizedKey,
      asText(displayName || normalizedKey),
      asText(description || ''),
      wantsOfficial,
      userId,
    ]
  );
  return { ok: true, key: normalizedKey };
}

async function rateTemplate({ userId, templateUid, rating }) {
  const normalized = Number(rating);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5) {
    throw httpError(400, 'rating muss zwischen 1 und 5 liegen.');
  }
  const template = await getTemplateRecordByUid(templateUid);
  if (!template) throw httpError(404, 'Template nicht gefunden.');

  await pool.query(
    `INSERT INTO template_ratings (template_id, user_id, rating)
     VALUES ($1,$2,$3)
     ON CONFLICT (template_id, user_id)
     DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
    [template.id, userId, normalized]
  );

  return { ok: true };
}

module.exports = {
  VALID_SCOPES,
  VALID_REVIEW_STATES,
  VALID_PROMPT_MODES,
  getTemplateCatalogForUser,
  getTemplateForGeneration,
  getVisibleTemplatesForUser,
  getVisibleTemplateNodes,
  createTemplateNode,
  updateTemplateNode,
  createTemplateRecord,
  updateTemplateRecord,
  submitTemplateForReview,
  reviewTemplateSubmission,
  cloneTemplateAsPersonal,
  listTemplateTags,
  createOrUpdateTag,
  rateTemplate,
  normalizeTagKeys,
  normalizeDynamicFields,
  normalizeBaseFieldList,
  httpError,
};
