import { DEFAULT_PRESET_OPTIONS } from './config.js';

function normalizeTemplateCatalog(payload = {}) {
  const categories = payload.categories && typeof payload.categories === 'object' ? payload.categories : {};
  const catalogPresets = payload.presetOptions && typeof payload.presetOptions === 'object' ? payload.presetOptions : {};
  const mergedPresets = { ...DEFAULT_PRESET_OPTIONS };

  Object.keys(DEFAULT_PRESET_OPTIONS).forEach((key) => {
    if (Array.isArray(catalogPresets[key]) && catalogPresets[key].length) {
      mergedPresets[key] = catalogPresets[key];
    }
  });

  return { categories, presetOptions: mergedPresets };
}

async function loadTemplateCatalog(apiFn) {
  const catalog = await apiFn('/api/template-catalog');
  const normalized = normalizeTemplateCatalog(catalog);
  if (!Object.keys(normalized.categories).length) {
    throw new Error('Template-Katalog ist leer.');
  }
  return normalized;
}

export {
  normalizeTemplateCatalog,
  loadTemplateCatalog,
};
