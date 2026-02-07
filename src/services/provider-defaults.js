const PROVIDER_DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  mistral: 'https://api.mistral.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

function getRecommendedBaseUrl(kind) {
  return PROVIDER_DEFAULT_BASE_URLS[kind] || '';
}

module.exports = {
  PROVIDER_DEFAULT_BASE_URLS,
  getRecommendedBaseUrl,
};
