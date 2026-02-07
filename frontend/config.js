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
};

export {
  DEFAULT_PRESET_OPTIONS,
  SETTINGS_DEFAULTS,
};
