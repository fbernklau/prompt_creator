const { getTemplateCatalog } = require('../catalog/template-catalog');

const DEFAULT_REQUIRED_BASE_FIELDS = ['fach', 'schulstufe', 'ziel'];
const DEFAULT_OPTIONAL_BASE_FIELDS = ['zeitrahmen', 'niveau', 'rahmen', 'ergebnisformat', 'ton', 'rueckfragen'];
const BASE_FIELD_LABELS = {
  fach: 'Fach/Lernbereich',
  schulstufe: 'Schulstufe',
  ziel: 'Ziel der Aufgabe',
  zeitrahmen: 'Zeitrahmen',
  niveau: 'Niveau/Heterogenitaet',
  rahmen: 'Rahmenbedingungen',
  ergebnisformat: 'Ergebnisformat',
  ton: 'Tonalitaet',
  rueckfragen: 'Rueckfragen zuerst',
  handlungsfeld: 'Handlungsfeld',
  unterkategorie: 'Template',
};

function renderTemplate(basePrompt, context) {
  return basePrompt.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = context[key];
    if (value === null || value === undefined || value === '') return 'nicht angegeben';
    return String(value);
  });
}

function templateIdFor(categoryName, subcategoryName) {
  return `${categoryName}::${subcategoryName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeBoolean(value) {
  return value ? 'ja' : 'nein';
}

function hasValue(value) {
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

function toPromptValue(value) {
  if (typeof value === 'boolean') return normalizeBoolean(value);
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function humanizeFieldId(fieldId) {
  return String(fieldId || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function fieldLabelFor(fieldId, template) {
  const dynamicMatch = (template.dynamicFields || []).find((field) => field.id === fieldId);
  if (dynamicMatch?.label) return dynamicMatch.label;
  if (BASE_FIELD_LABELS[fieldId]) return BASE_FIELD_LABELS[fieldId];
  return humanizeFieldId(fieldId);
}

function buildFieldLines(fieldIds, template, values, { onlyProvided = false } = {}) {
  const lines = [];
  fieldIds.forEach((fieldId) => {
    const raw = values[fieldId];
    if (onlyProvided && typeof raw === 'boolean' && raw === false) return;
    if (onlyProvided && !hasValue(raw)) return;
    const label = fieldLabelFor(fieldId, template);
    const formatted = hasValue(raw) ? toPromptValue(raw) : 'nicht angegeben';
    lines.push(`- ${label} (${fieldId}): ${formatted}`);
  });
  return lines.length ? lines.join('\n') : '- keine';
}

function buildSchemaPrompt(template, values) {
  const taxonomyPath = Array.isArray(template.taxonomyPath) && template.taxonomyPath.length
    ? template.taxonomyPath
    : [template.categoryName, template.subcategoryName];
  const parentPath = taxonomyPath.length > 1 ? taxonomyPath.slice(0, -1) : [template.categoryName];
  const tags = Array.isArray(template.tags) && template.tags.length ? template.tags.join(', ') : 'keine';

  return `## Template-Kontext
- Kategorie-Pfad: ${taxonomyPath.join(' > ')}
- Parent-Kategorien: ${parentPath.join(' > ')}
- Zieltemplate: ${template.subcategoryName}
- Template-ID: ${template.id}
- Profil: ${template.profile || 'nicht angegeben'}
- Tags: ${tags}
- Beschreibung: ${template.description || 'keine Beschreibung'}

## Pflichtangaben
${buildFieldLines(template.requiredFields, template, values)}

## Optionale Angaben (nur falls angegeben)
${buildFieldLines(template.optionalFields, template, values, { onlyProvided: true })}

## Rueckfragen-Logik
{{rueckfragen_instructions}}

## Ziel fuer den finalen Handoff-Prompt
Der Handoff-Prompt soll von einer zweiten KI direkt ausfuehrbar sein, die eigentliche Aufgabe loesen und den gewuenschten Output liefern.
Der Handoff-Prompt muss klar, konkret, robust gegen Mehrdeutigkeit und ohne Erklaertexte ausserhalb des eigentlichen Prompt-Texts sein.`;
}

function buildPromptGenerationEnvelope(promptSpecification) {
  return `# Mission
Du bist ein spezialisierter Prompt-Engineer.
Deine einzige Aufgabe ist es, einen hochwertigen Handoff-Prompt fuer ein zweites KI-Modell zu erstellen.

## Harte Regeln
- Liefere NICHT die fachliche Loesung fuer die Aufgabe.
- Liefere AUSSCHLIESSLICH einen Handoff-Prompt, der von einer zweiten KI ausgefuehrt werden kann.
- Nutze alle Pflichtangaben und alle vorhandenen optionalen Angaben sinnvoll.
- Wenn Informationen fehlen, formuliere kurze, transparente Annahmen IM Handoff-Prompt.
- Schreibe den Handoff-Prompt auf Deutsch.
- Der Handoff-Prompt muss mit "Du bist" beginnen.
- Gib keine Erlaeuterungen ausserhalb des JSON-Ausgabeformats aus.

## Prompt-Spezifikation
${promptSpecification}

## Verbindliches Ausgabeformat (nur JSON, ohne Markdown-Codeblock)
{
  "handoff_prompt": "Du bist ..."
}`;
}

function normalizeTemplateDefinition(template, { categoryName, subcategoryName }) {
  const workingTemplate = template || {
    id: templateIdFor(categoryName, subcategoryName),
    description: '',
    profile: 'unterrichtsnah',
    requiredBaseFields: DEFAULT_REQUIRED_BASE_FIELDS,
    optionalBaseFields: DEFAULT_OPTIONAL_BASE_FIELDS,
    dynamicFields: [],
    tags: [],
    promptMode: 'schema',
    taxonomyPath: [categoryName, subcategoryName],
    basePrompt: '',
  };

  const dynamicFields = Array.isArray(workingTemplate.dynamicFields) ? workingTemplate.dynamicFields : [];
  const requiredDynamicFields = dynamicFields.filter((field) => field.required).map((field) => field.id);
  const optionalDynamicFields = dynamicFields.filter((field) => !field.required).map((field) => field.id);
  const requiredBaseFields = unique(
    Array.isArray(workingTemplate.requiredBaseFields) && workingTemplate.requiredBaseFields.length
      ? workingTemplate.requiredBaseFields
      : DEFAULT_REQUIRED_BASE_FIELDS
  );
  const optionalBaseFields = unique(
    Array.isArray(workingTemplate.optionalBaseFields)
      ? workingTemplate.optionalBaseFields
      : DEFAULT_OPTIONAL_BASE_FIELDS
  );
  const requiredFields = unique([...requiredBaseFields, ...requiredDynamicFields]);
  const optionalFields = unique([...optionalBaseFields, ...optionalDynamicFields])
    .filter((fieldId) => !requiredFields.includes(fieldId));
  const taxonomyPath = unique(
    (Array.isArray(workingTemplate.taxonomyPath) && workingTemplate.taxonomyPath.length ? workingTemplate.taxonomyPath : [categoryName, subcategoryName])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  );

  const hasCustomPrompt = typeof workingTemplate.basePrompt === 'string' && workingTemplate.basePrompt.trim() !== '';
  const promptMode = workingTemplate.promptMode === 'custom' || (!workingTemplate.promptMode && hasCustomPrompt)
    ? 'custom'
    : 'schema';

  return {
    ...workingTemplate,
    categoryName,
    subcategoryName,
    id: workingTemplate.id || templateIdFor(categoryName, subcategoryName),
    profile: workingTemplate.profile || 'unterrichtsnah',
    promptMode,
    requiredBaseFields,
    optionalBaseFields,
    requiredDynamicFields: unique(requiredDynamicFields),
    optionalDynamicFields: unique(optionalDynamicFields),
    requiredFields,
    optionalFields,
    taxonomyPath: taxonomyPath.length ? taxonomyPath : [categoryName, subcategoryName],
    basePrompt: workingTemplate.basePrompt || '',
  };
}

function buildMetapromptFromTemplate({ template, categoryName, subcategoryName, baseFields = {}, dynamicValues = {} }) {
  const resolvedTemplate = normalizeTemplateDefinition(template, { categoryName, subcategoryName });
  const merged = {
    handlungsfeld: categoryName,
    unterkategorie: subcategoryName,
    ...baseFields,
    ...dynamicValues,
  };

  const missing = resolvedTemplate.requiredFields.filter((field) => !hasValue(merged[field]));
  if (missing.length) {
    throw new Error(`Pflichtfelder fehlen: ${missing.join(', ')}`);
  }

  const providedOptionalBaseFields = DEFAULT_OPTIONAL_BASE_FIELDS.filter((fieldId) => (
    fieldId !== 'rueckfragen'
    && !resolvedTemplate.requiredFields.includes(fieldId)
    && hasValue(merged[fieldId])
  ));
  const templateForPrompt = {
    ...resolvedTemplate,
    optionalFields: unique([...resolvedTemplate.optionalFields, ...providedOptionalBaseFields]),
  };

  const promptSpecification = templateForPrompt.promptMode === 'custom' && templateForPrompt.basePrompt
    ? templateForPrompt.basePrompt
    : buildSchemaPrompt(templateForPrompt, merged);
  const promptTemplate = buildPromptGenerationEnvelope(promptSpecification);
  const taxonomyPath = Array.isArray(resolvedTemplate.taxonomyPath) ? resolvedTemplate.taxonomyPath : [categoryName, subcategoryName];

  const context = {
    ...Object.fromEntries(
      Object.entries(merged).map(([key, value]) => [key, toPromptValue(value)])
    ),
    taxonomy_path: taxonomyPath.join(' > '),
    taxonomy_parents: taxonomyPath.slice(0, -1).join(' > ') || categoryName,
    template_id: resolvedTemplate.id,
    template_profile: resolvedTemplate.profile || '',
    template_tags: Array.isArray(resolvedTemplate.tags) ? resolvedTemplate.tags.join(', ') : '',
    template_description: resolvedTemplate.description || '',
    required_fields_summary: buildFieldLines(resolvedTemplate.requiredFields, resolvedTemplate, merged),
    optional_fields_summary: buildFieldLines(templateForPrompt.optionalFields, templateForPrompt, merged, { onlyProvided: true }),
    rueckfragen_instructions: merged.rueckfragen
      ? 'Stelle zuerst 3 bis 7 klaerende Rueckfragen. Warte auf Antworten und erstelle danach die finale Loesung.'
      : 'Arbeite direkt mit 1 bis 2 transparenten Annahmen und liefere sofort eine umsetzbare Version.',
  };

  return {
    template: resolvedTemplate,
    metaprompt: renderTemplate(promptTemplate, context),
  };
}

function getTemplateDefinition(categoryName, subcategoryName) {
  const catalog = getTemplateCatalog();
  const category = catalog.categories[categoryName];
  if (!category) return null;

  const explicitTemplate = category.templates && category.templates[subcategoryName]
    ? category.templates[subcategoryName]
    : null;
  if (!explicitTemplate && (!Array.isArray(category.unterkategorien) || !category.unterkategorien.includes(subcategoryName))) {
    return null;
  }

  return normalizeTemplateDefinition(explicitTemplate, { categoryName, subcategoryName });
}

function buildMetaprompt({ categoryName, subcategoryName, baseFields = {}, dynamicValues = {} }) {
  const template = getTemplateDefinition(categoryName, subcategoryName);
  if (!template) {
    throw new Error('Template nicht gefunden. Bitte Handlungsfeld/Unterkategorie pruefen.');
  }
  return buildMetapromptFromTemplate({ template, categoryName, subcategoryName, baseFields, dynamicValues });
}

module.exports = {
  buildMetaprompt,
  buildMetapromptFromTemplate,
  getTemplateDefinition,
  normalizeTemplateDefinition,
};
