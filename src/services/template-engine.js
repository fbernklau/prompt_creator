const { getTemplateCatalog } = require('../catalog/template-catalog');

function renderTemplate(basePrompt, context) {
  return basePrompt.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = context[key];
    if (value === null || value === undefined || value === '') return 'nicht angegeben';
    return String(value);
  });
}

function normalizeBoolean(value) {
  return value ? 'ja' : 'nein';
}

function templateIdFor(categoryName, subcategoryName) {
  return `${categoryName}::${subcategoryName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function getTemplateDefinition(categoryName, subcategoryName) {
  const catalog = getTemplateCatalog();
  const category = catalog.categories[categoryName];
  if (!category) return null;
  if (!Array.isArray(category.unterkategorien) || !category.unterkategorien.includes(subcategoryName)) {
    return null;
  }

  const dynamicFields = Array.isArray(category.dynamicFields) ? category.dynamicFields : [];
  const dynamicLines = dynamicFields
    .map((field) => `- ${field.label}: {{${field.id}}}`)
    .join('\n');

  const template = {
    id: templateIdFor(categoryName, subcategoryName),
    categoryName,
    subcategoryName,
    requiredFields: ['fach', 'schulstufe', 'ziel', ...dynamicFields.filter((f) => f.required).map((f) => f.id)],
    basePrompt: `# Finaler Prompt

Du bist eine didaktisch versierte KI fuer das oesterreichische Schulwesen.

## Template-Kontext
- Handlungsfeld: {{handlungsfeld}}
- Unterkategorie: {{unterkategorie}}
- Schulstufe: {{schulstufe}}
- Fach/Lernbereich: {{fach}}
- Zeitraum: {{zeitrahmen}}
- Niveau/Heterogenitaet: {{niveau}}
- Rahmenbedingungen: {{rahmen}}

## Template-Felder
${dynamicLines || '- keine spezifischen Felder'}

## Ziel der Aufgabe
{{ziel}}

## Ausgabeformat
{{ergebnisformat}}

## Tonalitaet
{{ton}}

## Rueckfragen-Logik
{{rueckfragen_instructions}}

## Qualitaet
Nutze klare Zwischenueberschriften, konkrete Schritte, Zeitbezug und umsetzbare Materialien.`,
  };

  return template;
}

function buildMetaprompt({ categoryName, subcategoryName, baseFields = {}, dynamicValues = {} }) {
  const template = getTemplateDefinition(categoryName, subcategoryName);
  if (!template) {
    throw new Error('Template nicht gefunden. Bitte Handlungsfeld/Unterkategorie pruefen.');
  }

  const merged = {
    handlungsfeld: categoryName,
    unterkategorie: subcategoryName,
    ...baseFields,
    ...dynamicValues,
  };

  const missing = template.requiredFields.filter((field) => {
    const value = merged[field];
    if (typeof value === 'boolean') return false;
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length) {
    throw new Error(`Pflichtfelder fehlen: ${missing.join(', ')}`);
  }

  const context = {
    ...Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, typeof value === 'boolean' ? normalizeBoolean(value) : String(value)])),
    rueckfragen_instructions: merged.rueckfragen
      ? 'Stelle zuerst 3 bis 7 klaerende Rueckfragen. Warte auf Antworten und erstelle danach die finale Loesung.'
      : 'Arbeite direkt mit 1 bis 2 transparenten Annahmen und liefere sofort eine umsetzbare Version.',
  };

  return {
    template,
    metaprompt: renderTemplate(template.basePrompt, context),
  };
}

module.exports = {
  buildMetaprompt,
  getTemplateDefinition,
};
