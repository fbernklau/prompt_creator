function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function clampRating(value) {
  const asNumber = Number(value);
  if (!Number.isInteger(asNumber)) return null;
  if (asNumber < 1 || asNumber > 5) return null;
  return asNumber;
}

function normalizeLibraryRow(row) {
  let snapshot = {};
  if (row.form_snapshot_json && typeof row.form_snapshot_json === 'object') {
    snapshot = row.form_snapshot_json;
  } else if (typeof row.form_snapshot_json === 'string') {
    try {
      snapshot = JSON.parse(row.form_snapshot_json);
    } catch (_error) {
      snapshot = {};
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    descriptionText: row.description_text || '',
    promptText: row.prompt_text,
    fach: row.fach,
    handlungsfeld: row.handlungsfeld,
    unterkategorie: row.unterkategorie,
    templateId: row.template_id || null,
    providerKind: row.provider_kind || null,
    providerModel: row.provider_model || null,
    generationMode: row.generation_mode || 'prompt',
    formSnapshot: snapshot,
    metapromptText: row.metaprompt_text || row.prompt_text,
    resultText: row.result_text || '',
    hasResult: Boolean(row.has_result),
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    avgRating: Number(row.avg_rating || 0),
    ratingCount: Number(row.rating_count || 0),
    myRating: row.my_rating ? Number(row.my_rating) : null,
    isFavorite: Boolean(row.is_favorite),
  };
}

function sanitizeSettings(input = {}) {
  const output = {};
  if (typeof input.theme === 'string' && ['system', 'light', 'dark'].includes(input.theme)) {
    output.theme = input.theme;
  }
  if (typeof input.flowMode === 'string' && ['step', 'single'].includes(input.flowMode)) {
    output.flowMode = input.flowMode;
  }
  if (typeof input.navLayout === 'string' && ['topbar', 'sidebar'].includes(input.navLayout)) {
    output.navLayout = input.navLayout;
  }
  if (typeof input.copyIncludeMetadata === 'boolean') {
    output.copyIncludeMetadata = input.copyIncludeMetadata;
  }
  if (typeof input.advancedOpen === 'boolean') {
    output.advancedOpen = input.advancedOpen;
  }
  if (typeof input.showCommunityTemplates === 'boolean') {
    output.showCommunityTemplates = input.showCommunityTemplates;
  }
  if (typeof input.resultModeEnabled === 'boolean') {
    output.resultModeEnabled = input.resultModeEnabled;
  }
  if (typeof input.metapromptProviderId === 'string') {
    output.metapromptProviderId = input.metapromptProviderId.trim();
  }
  if (typeof input.resultProviderId === 'string') {
    output.resultProviderId = input.resultProviderId.trim();
  }
  if (typeof input.libraryDetailView === 'string' && ['page', 'modal'].includes(input.libraryDetailView)) {
    output.libraryDetailView = input.libraryDetailView;
  }
  if (typeof input.hasSeenIntroduction === 'boolean') {
    output.hasSeenIntroduction = input.hasSeenIntroduction;
  }
  if (input.introTourVersion !== undefined && input.introTourVersion !== null && input.introTourVersion !== '') {
    const parsed = Number(input.introTourVersion);
    if (Number.isInteger(parsed) && parsed >= 0) {
      output.introTourVersion = parsed;
    }
  }
  return output;
}

module.exports = {
  asyncHandler,
  clampRating,
  normalizeLibraryRow,
  sanitizeSettings,
};
