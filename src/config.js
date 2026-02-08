function parseCsv(value = '') {
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const config = {
  port: process.env.PORT || 8080,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://prompt:prompt@postgres:5432/prompt_creator',
  authRequired: process.env.AUTH_REQUIRED === 'true',
  requiredGroup: process.env.OIDC_REQUIRED_GROUP || '',
  keyEncryptionSecret: process.env.KEY_ENCRYPTION_SECRET || 'insecure-dev-key-change-me',
  providerRequestTimeoutMs: Math.max(Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 45000), 5000),
  googleTestApiKey: process.env.GOOGLE_TEST_API_KEY || '',
  googleTestAllowedUsers: parseCsv(process.env.GOOGLE_TEST_ALLOWED_USERS || ''),
  googleTestAllowedGroups: parseCsv(process.env.GOOGLE_TEST_ALLOWED_GROUPS || ''),
  settingsDefaults: {
    theme: 'system',
    flowMode: null,
    copyIncludeMetadata: false,
    advancedOpen: false,
    showCommunityTemplates: true,
  },
};

module.exports = { config };
