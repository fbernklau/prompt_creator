function sanitizeExternalErrorMessage(message = '', { fallback = 'Externer API-Fehler.' } = {}) {
  let text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;

  text = text.replace(
    /((?:api|x-api)[-\s_]?key(?:\s+provided)?\s*[:=]\s*)([^,\s;]+)/ig,
    '$1[redacted-key]'
  );

  text = text.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{6,}\b/g, '[redacted-key]');
  text = text.replace(/\b[A-Za-z0-9]{6,}\*{2,}[A-Za-z0-9]{0,}\b/g, '[redacted-key]');
  text = text.replace(/\b[A-Za-z0-9]{24,}\b/g, '[redacted-token]');

  return text || fallback;
}

module.exports = {
  sanitizeExternalErrorMessage,
};
