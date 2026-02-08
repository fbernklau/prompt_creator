const { defaultTemplateCatalog } = require('./default-template-catalog');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeTemplate(categoryName, subcategoryName, template = {}, category = {}) {
  const dynamicFields = Array.isArray(template.dynamicFields)
    ? template.dynamicFields
    : Array.isArray(category.dynamicFields) ? category.dynamicFields : [];
  const requiredBaseFields = Array.isArray(template.requiredBaseFields) && template.requiredBaseFields.length
    ? template.requiredBaseFields
    : ['fach', 'schulstufe', 'ziel'];
  const optionalBaseFields = Array.isArray(template.optionalBaseFields)
    ? template.optionalBaseFields
    : ['zeitrahmen', 'niveau', 'rahmen', 'ergebnisformat', 'ton', 'rueckfragen'];
  const taxonomyPath = Array.isArray(template.taxonomyPath) && template.taxonomyPath.length
    ? template.taxonomyPath
    : [categoryName, subcategoryName];
  const normalizedTaxonomyPath = taxonomyPath
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const hasCustomPrompt = typeof template.basePrompt === 'string' && template.basePrompt.trim() !== '';
  const promptMode = template.promptMode === 'custom' || (!template.promptMode && hasCustomPrompt)
    ? 'custom'
    : 'schema';

  return {
    id: template.id || `${slugify(categoryName)}-${slugify(subcategoryName)}`,
    description: template.description || category.description || '',
    profile: template.profile || 'unterrichtsnah',
    requiredBaseFields: unique(requiredBaseFields),
    optionalBaseFields: unique(optionalBaseFields),
    dynamicFields,
    tags: Array.isArray(template.tags) ? unique(template.tags) : [],
    promptMode,
    taxonomyPath: normalizedTaxonomyPath.length ? normalizedTaxonomyPath : [categoryName, subcategoryName],
    basePrompt: template.basePrompt || '',
  };
}

function normalizeCategory(categoryName, category = {}) {
  const templates = {};
  const explicitTemplates = category.templates && typeof category.templates === 'object'
    ? category.templates
    : {};

  for (const [subcategoryName, template] of Object.entries(explicitTemplates)) {
    templates[subcategoryName] = normalizeTemplate(categoryName, subcategoryName, template, category);
  }

  if (!Object.keys(templates).length && Array.isArray(category.unterkategorien)) {
    for (const subcategoryName of category.unterkategorien) {
      templates[subcategoryName] = normalizeTemplate(categoryName, subcategoryName, {}, category);
    }
  }

  const unterkategorien = Array.isArray(category.unterkategorien) && category.unterkategorien.length
    ? category.unterkategorien
    : Object.keys(templates);

  const firstTemplate = templates[unterkategorien[0]];

  return {
    title: category.title || categoryName,
    short: category.short || slugify(categoryName).slice(0, 2).toUpperCase(),
    description: category.description || '',
    unterkategorien,
    templates,
    // Backward compatibility for older frontend code paths.
    dynamicFields: Array.isArray(category.dynamicFields)
      ? category.dynamicFields
      : (firstTemplate?.dynamicFields || []),
  };
}

function getTemplateCatalog() {
  const catalog = clone(defaultTemplateCatalog);
  const normalizedCategories = {};

  for (const [categoryName, category] of Object.entries(catalog.categories || {})) {
    normalizedCategories[categoryName] = normalizeCategory(categoryName, category);
  }

  return {
    ...catalog,
    categories: normalizedCategories,
  };
}

module.exports = { getTemplateCatalog };
