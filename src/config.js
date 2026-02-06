const config = {
  port: process.env.PORT || 8080,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://prompt:prompt@postgres:5432/prompt_creator',
  authRequired: process.env.AUTH_REQUIRED === 'true',
  requiredGroup: process.env.OIDC_REQUIRED_GROUP || '',
  settingsDefaults: {
    theme: 'system',
    flowMode: null,
    copyIncludeMetadata: false,
    advancedOpen: false,
  },
};

module.exports = { config };
