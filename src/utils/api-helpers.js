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
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    promptText: row.prompt_text,
    fach: row.fach,
    handlungsfeld: row.handlungsfeld,
    unterkategorie: row.unterkategorie,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    avgRating: Number(row.avg_rating || 0),
    ratingCount: Number(row.rating_count || 0),
    myRating: row.my_rating ? Number(row.my_rating) : null,
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
  if (typeof input.copyIncludeMetadata === 'boolean') {
    output.copyIncludeMetadata = input.copyIncludeMetadata;
  }
  if (typeof input.advancedOpen === 'boolean') {
    output.advancedOpen = input.advancedOpen;
  }
  if (typeof input.showCommunityTemplates === 'boolean') {
    output.showCommunityTemplates = input.showCommunityTemplates;
  }
  return output;
}

module.exports = {
  asyncHandler,
  clampRating,
  normalizeLibraryRow,
  sanitizeSettings,
};
