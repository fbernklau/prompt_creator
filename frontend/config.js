const DEFAULT_PRESET_OPTIONS = {
  zeitrahmen: ['', '1 Stunde', '2 Stunden', 'Halbtag', 'Tag', 'Woche', 'Monat', '__custom__'],
  niveau: ['', 'Basis', 'Mittel', 'Erweitert', 'Heterogen', '__custom__'],
  rahmen: ['', 'DaZ', 'Teamteaching', 'Digital', 'Inklusiv', 'Pruefung', '__custom__'],
  ergebnisformat: ['', 'Liste', 'Tabelle', 'Ablaufplan', 'Rubric', 'Checkliste', '__custom__'],
  ton: ['', 'klar', 'sachlich', 'formal', 'praezise', 'motivierend', 'einfach', '__custom__'],
};

const SETTINGS_DEFAULTS = {
  theme: 'system',
  flowMode: null,
  navLayout: 'topbar',
  copyIncludeMetadata: false,
  advancedOpen: false,
  showCommunityTemplates: true,
  resultModeEnabled: false,
  metapromptProviderId: '',
  resultProviderId: '',
  hasSeenIntroduction: false,
  introTourVersion: 0,
};

const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  mistral: 'https://api.mistral.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

const PROVIDER_MODEL_CATALOG = {
  openai: [
    'gpt-5.2',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-5.2-codex',
    'gpt-5.2-pro',
  ],
  anthropic: [
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-opus-4-5',
  ],
  google: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
  ],
  mistral: [
    'mistral-large-2512',
    'mistral-medium-2508',
    'mistral-small-2506',
    'ministral-14b-2512',
    'ministral-8b-2512',
    'ministral-3b-2512',
    'codestral-2508',
    'devstral-2512',
  ],
};

export {
  DEFAULT_PRESET_OPTIONS,
  SETTINGS_DEFAULTS,
  PROVIDER_BASE_URLS,
  PROVIDER_MODEL_CATALOG,
};
