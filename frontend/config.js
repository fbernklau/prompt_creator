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
  copyIncludeMetadata: false,
  advancedOpen: false,
  showCommunityTemplates: true,
};

const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  mistral: 'https://api.mistral.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

export {
  DEFAULT_PRESET_OPTIONS,
  SETTINGS_DEFAULTS,
  PROVIDER_BASE_URLS,
};
