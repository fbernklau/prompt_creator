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

function attachGeneratedTemplates(catalog) {
  Object.entries(catalog.categories || {}).forEach(([categoryName, category]) => {
    const dynamicFields = Array.isArray(category.dynamicFields) ? category.dynamicFields : [];
    const subcategories = Array.isArray(category.unterkategorien) ? category.unterkategorien : [];
    category.templates = {};
    subcategories.forEach((subcategoryName) => {
      category.templates[subcategoryName] = {
        id: `${slugify(categoryName)}-${slugify(subcategoryName)}`,
        basePrompt: `Du bist eine didaktisch versierte KI.\nHandlungsfeld: {{handlungsfeld}}\nUnterkategorie: {{unterkategorie}}\nSchulstufe: {{schulstufe}}\nFach: {{fach}}\nZiel: {{ziel}}\nErgebnisformat: {{ergebnisformat}}\nTon: {{ton}}\nTemplate-Felder:\n${dynamicFields.map((field) => `- ${field.label}: {{${field.id}}}`).join('\n') || '- keine'}`,
        variables: ['handlungsfeld', 'unterkategorie', 'schulstufe', 'fach', 'ziel', 'ergebnisformat', 'ton', ...dynamicFields.map((field) => field.id)],
      };
    });
  });
}

function getTemplateCatalog() {
  const catalog = clone(defaultTemplateCatalog);
  attachGeneratedTemplates(catalog);
  return catalog;
}

module.exports = { getTemplateCatalog };
