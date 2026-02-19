function createTaskController({
  state,
  el,
  api,
  apiStream,
  getCategoryConfig,
  getPresetOptions,
  showScreen,
  saveHistory,
  notify = null,
}) {
  const DEFAULT_REQUIRED_BASE_FIELDS = ['fach', 'schulstufe', 'ziel'];
  const BASE_FIELD_LABELS = {
    fach: 'Fach',
    schulstufe: 'Schulstufe',
    ziel: 'Ziel der Aufgabe',
  };
  const BASE_FIELD_HINTS = {
    fach: 'Beispiel: Mathematik, Physik, Deutsch, Geschichte.',
    schulstufe: 'Beispiel: 7. Schulstufe, Sek II, Berufsschule.',
    ziel: 'Formuliere ein konkretes Ergebnis (z. B. Rubric, Stundenbild, Elternbrief).',
  };
  const BASE_FIELD_ORDER = ['fach', 'schulstufe', 'ziel'];
  const CATEGORY_ICONS = {
    'Pädagogische Planung': 'auto_stories',
    Jahresplanung: 'calendar_month',
    Unterrichtsvorbereitung: 'construction',
    'Individualisierung & Differenzierung': 'track_changes',
    'Barrierefreiheit & Inklusion': 'diversity_3',
    'Elternkontakte & Kommunikation': 'forum',
    'Leistungsbeurteilung & Feedback': 'assignment_turned_in',
    Administration: 'folder',
    Organisation: 'hub',
    'Schulentwicklung & Teamarbeit': 'psychology',
  };
  const CATEGORY_ICON_TONES = {
    'Pädagogische Planung': 'bg-blue-50 text-blue-600',
    'Elternkontakte & Kommunikation': 'bg-pink-50 text-pink-600',
    Organisation: 'bg-amber-50 text-amber-600',
    Administration: 'bg-emerald-50 text-emerald-600',
    'Schulentwicklung & Teamarbeit': 'bg-indigo-50 text-indigo-600',
    'Leistungsbeurteilung & Feedback': 'bg-violet-50 text-violet-600',
    'Barrierefreiheit & Inklusion': 'bg-cyan-50 text-cyan-600',
    'Individualisierung & Differenzierung': 'bg-orange-50 text-orange-600',
  };

  state.templateDiscovery = state.templateDiscovery || {
    templates: [],
    search: '',
    activeTags: [],
    tagPickerOpen: false,
  };
  if (!Array.isArray(state.templateDiscovery.activeTags)) {
    const legacyTag = typeof state.templateDiscovery.activeTag === 'string'
      ? state.templateDiscovery.activeTag.trim()
      : '';
    state.templateDiscovery.activeTags = legacyTag ? [legacyTag] : [];
  }
  state.templateDiscovery.tagPickerOpen = Boolean(state.templateDiscovery.tagPickerOpen);
  state.templateCoverageAudit = state.templateCoverageAudit || { issues: [] };
  state.previousGeneratedPrompt = state.previousGeneratedPrompt || '';
  state.generatedResult = state.generatedResult || '';
  state.generatedMetaPrompt = state.generatedMetaPrompt || '';
  state.generatedMetaDetails = state.generatedMetaDetails || null;
  state.lastGenerationPayload = state.lastGenerationPayload || null;
  state.lastGenerationFormSnapshot = state.lastGenerationFormSnapshot || null;
  state.compactFlow = state.compactFlow || {
    editingCategory: false,
    editingTemplate: false,
  };
  state.subcategoryViewMode = state.subcategoryViewMode || 'grid';

  const SNAPSHOT_TRANSIENT_IDS = new Set([
    'metaprompt-preview',
    'flow-category-select',
    'flow-template-select',
  ]);

  function shouldIgnoreSnapshotField(id = '') {
    return SNAPSHOT_TRANSIENT_IDS.has(String(id || '').trim());
  }

  function emitNotice(message = '', type = 'info') {
    const text = String(message || '').trim();
    if (!text || typeof notify !== 'function') return;
    notify(text, { type });
  }

  function normalizeUiText(value = '') {
    let text = String(value ?? '');
    if (!text) return text;
    const replacements = [
      [/\bArbeitsauftraege\b/g, 'Arbeitsaufträge'],
      [/\bFoerderplaene\b/g, 'Förderpläne'],
      [/\bFoerdermassnahmen\b/g, 'Fördermaßnahmen'],
      [/\bRueckmeldung\b/g, 'Rückmeldung'],
      [/\bRueckfragen\b/g, 'Rückfragen'],
      [/\brueckfragen\b/g, 'rückfragen'],
      [/\bPruefungs\b/g, 'Prüfungs'],
      [/\bPruefung\b/g, 'Prüfung'],
      [/\bLoesung\b/g, 'Lösung'],
      [/\bloesung\b/g, 'lösung'],
      [/\bAusfaelle\b/g, 'Ausfälle'],
      [/\bGespraeche\b/g, 'Gespräche'],
      [/\bAblaeufe\b/g, 'Abläufe'],
      [/\bPrioritaeten\b/g, 'Prioritäten'],
      [/\bEngpaesse\b/g, 'Engpässe'],
      [/\bTonalitaet\b/g, 'Tonalität'],
      [/\bHeterogenitaet\b/g, 'Heterogenität'],
      [/\bWaehlen\b/g, 'Wählen'],
      [/\bwaehlen\b/g, 'wählen'],
      [/\bWaehle\b/g, 'Wähle'],
      [/\bwaehle\b/g, 'wähle'],
      [/\bKoennen\b/g, 'Können'],
      [/\bkoennen\b/g, 'können'],
      [/\bMoeglich\b/g, 'Möglich'],
      [/\bmoeglich\b/g, 'möglich'],
      [/\bFuer\b/g, 'Für'],
      [/\bfuer\b/g, 'für'],
      [/\bUeber\b/g, 'Über'],
      [/\bueber\b/g, 'über'],
      [/\bbuendelt\b/g, 'bündelt'],
      [/\bgewuenscht\b/g, 'gewünscht'],
      [/\bbenoetigte\b/g, 'benötigte'],
    ];
    replacements.forEach(([pattern, replacement]) => {
      text = text.replace(pattern, replacement);
    });
    return text;
  }

  function dedupeDisplayOptions(values = []) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter((entry) => {
      const raw = String(entry ?? '').trim();
      const displayKey = normalizeUiText(raw).toLowerCase();
      if (seen.has(displayKey)) return false;
      seen.add(displayKey);
      return true;
    });
  }

  function getFlowMode() {
    return state.settings.flowMode || 'step';
  }

  function isCompactFlowMode() {
    return getFlowMode() === 'single';
  }

  function csvToArray(value = '') {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function normalizeTagList(values = []) {
    const source = Array.isArray(values) ? values : [values];
    return [...new Set(
      source
        .flatMap((entry) => String(entry || '').split(','))
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )];
  }

  function getTemplateConfig(categoryName = state.selectedCategory, subcategoryName = state.selectedSubcategory) {
    const categoryConfig = getCategoryConfig();
    const category = categoryConfig[categoryName];
    if (!category) return null;

    const explicitTemplate = category.templates && category.templates[subcategoryName]
      ? category.templates[subcategoryName]
      : null;
    if (explicitTemplate) return explicitTemplate;

    return {
      id: `${categoryName}:${subcategoryName}`,
      description: category.description || '',
      requiredBaseFields: DEFAULT_REQUIRED_BASE_FIELDS,
      optionalBaseFields: [],
      dynamicFields: Array.isArray(category.dynamicFields) ? category.dynamicFields : [],
      basePrompt: '',
      tags: [],
      promptMode: 'schema',
      taxonomyPath: [categoryName, subcategoryName],
      profile: 'unterrichtsnah',
    };
  }

  function auditTemplateCoverageOnce() {
    const issues = [];
    const categoryConfig = getCategoryConfig();
    Object.entries(categoryConfig).forEach(([categoryName, category]) => {
      Object.entries(category?.templates || {}).forEach(([subcategoryName, template]) => {
        const requiredBase = Array.isArray(template?.requiredBaseFields) && template.requiredBaseFields.length
          ? template.requiredBaseFields
          : DEFAULT_REQUIRED_BASE_FIELDS;
        const dynamicIds = new Set(
          (Array.isArray(template?.dynamicFields) ? template.dynamicFields : [])
            .map((field) => String(field?.id || '').trim())
            .filter(Boolean)
        );
        const unresolved = requiredBase.filter((fieldId) => !BASE_FIELD_LABELS[fieldId] && !dynamicIds.has(fieldId));
        if (unresolved.length) {
          issues.push({
            categoryName,
            subcategoryName,
            unresolved,
          });
        }
      });
    });

    state.templateCoverageAudit = { issues };
    if (issues.length) {
      console.warn('Template coverage audit: unresolved required fields found', issues);
    }
  }

  function updateBaseFieldHints(template) {
    const required = Array.isArray(template?.requiredBaseFields) && template.requiredBaseFields.length
      ? template.requiredBaseFields
      : DEFAULT_REQUIRED_BASE_FIELDS;
    const contextHint = `Template-Pflichtfelder: ${required.join(', ')}`;

    ['fach', 'schulstufe', 'ziel'].forEach((fieldId) => {
      const node = el(`hint-${fieldId}`);
      if (!node) return;
      node.textContent = `${BASE_FIELD_HINTS[fieldId]} ${contextHint}`;
    });
  }

  function updateBaseFieldRequirements(template, requiredContainer, optionalContainer) {
    const requiredSet = new Set(
      Array.isArray(template?.requiredBaseFields) && template.requiredBaseFields.length
        ? template.requiredBaseFields
        : DEFAULT_REQUIRED_BASE_FIELDS
    );

    Object.entries(BASE_FIELD_LABELS).forEach(([fieldId, labelText]) => {
      const labelNode = el(`label-${fieldId}`);
      const inputNode = el(fieldId);
      if (!inputNode) return;
      const required = requiredSet.has(fieldId);
      inputNode.required = required;
      if (labelNode) labelNode.textContent = required ? `${labelText} *` : `${labelText} (optional)`;
    });
    const wrappers = BASE_FIELD_ORDER
      .map((fieldId) => ({ fieldId, node: el(`wrap-${fieldId}`) }))
      .filter((entry) => !!entry.node);

    wrappers.forEach(({ fieldId, node }) => {
      const target = requiredSet.has(fieldId) ? requiredContainer : optionalContainer;
      if (target) target.appendChild(node);
    });

    updateBaseFieldHints(template);
    return requiredSet;
  }

  function parkBaseFieldWrappers() {
    const pool = el('base-fields-pool');
    if (!pool) return;
    BASE_FIELD_ORDER.forEach((fieldId) => {
      const wrapper = el(`wrap-${fieldId}`);
      if (!wrapper) return;
      if (wrapper.parentElement !== pool) pool.appendChild(wrapper);
    });
  }

  function hasNonEmptyValue(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return true;
    return String(value).trim() !== '';
  }

  function getRequiredTemplateFields(template) {
    const requiredBase = Array.isArray(template?.requiredBaseFields) && template.requiredBaseFields.length
      ? template.requiredBaseFields
      : DEFAULT_REQUIRED_BASE_FIELDS;
    const requiredDynamic = (Array.isArray(template?.dynamicFields) ? template.dynamicFields : [])
      .filter((field) => field.required)
      .map((field) => field.id);
    return [...new Set([...requiredBase, ...requiredDynamic].map((entry) => String(entry || '').trim()).filter(Boolean))];
  }

  function setupPresetSelect(selectId, customId, values, { includeRange = false } = {}) {
    const select = el(selectId);
    const customInput = el(customId);
    const customWrap = customInput?.closest('label') || null;
    if (!select) return;
    const options = dedupeDisplayOptions(Array.isArray(values) ? [...values] : []);
    if (!options.includes('__custom__')) options.push('__custom__');
    if (includeRange && !options.includes('__range__')) {
      const customIndex = options.indexOf('__custom__');
      if (customIndex >= 0) options.splice(customIndex, 0, '__range__');
      else options.push('__range__');
    }

    select.innerHTML = options
      .map((value) => {
        if (!value) return '<option value="">Bitte wählen...</option>';
        if (value === '__range__') return '<option value="__range__">Von - bis</option>';
        if (value === '__custom__') return '<option value="__custom__">Custom...</option>';
        return `<option value="${value}">${normalizeUiText(value)}</option>`;
      })
      .join('');

    const rangeWrap = includeRange ? el('zeitrahmen-range-wrap') : null;
    const rangeStart = includeRange ? el('zeitrahmen-range-start') : null;
    const rangeEnd = includeRange ? el('zeitrahmen-range-end') : null;

    const syncCustomState = ({ shouldFocus = false } = {}) => {
      const isCustom = select.value === '__custom__';
      const isRange = includeRange && select.value === '__range__';
      if (customWrap) customWrap.classList.toggle('is-hidden', !isCustom || !!isRange);
      if (customInput) {
        customInput.disabled = !isCustom || !!isRange;
        customInput.required = isCustom;
        customInput.placeholder = isCustom
          ? 'Eigener Wert'
          : 'Nur bei Custom aktiv';
        if (isCustom && shouldFocus) {
          window.requestAnimationFrame(() => customInput.focus());
        }
      }

      if (includeRange && rangeWrap && rangeStart && rangeEnd) {
        rangeWrap.classList.toggle('is-hidden', !isRange);
        rangeStart.disabled = !isRange;
        rangeEnd.disabled = !isRange;
        rangeStart.required = isRange;
        rangeEnd.required = isRange;
      }
    };

    select.addEventListener('change', () => syncCustomState({ shouldFocus: true }));
    if (customInput) {
      customInput.addEventListener('input', () => {
        const hasValue = customInput.value.trim().length > 0;
        if (!hasValue) return;
        if (select.value !== '__custom__') {
          select.value = '__custom__';
          syncCustomState();
        }
      });
    }
    syncCustomState();
  }

  function resolveSelectOrCustom(selectId, customId, fallback = '') {
    const selectNode = el(selectId);
    const customNode = el(customId);
    const selectValue = selectNode ? selectNode.value : '';
    const customValue = customNode && typeof customNode.value === 'string' ? customNode.value.trim() : '';
    if (selectValue === '__custom__') return customValue || fallback;
    if (selectValue) return selectValue;
    return fallback;
  }

  function formatDateForPrompt(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const parsed = new Date(normalized.includes('T') ? normalized : `${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return normalized;
    if (normalized.includes('T')) {
      return parsed.toLocaleString('de-AT', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return parsed.toLocaleDateString('de-AT');
  }

  function resolveZeitrahmenValue() {
    const mode = String(el('zeitrahmen-select')?.value || '').trim();
    if (mode === '__range__') {
      const start = readValue('zeitrahmen-range-start');
      const end = readValue('zeitrahmen-range-end');
      const startLabel = formatDateForPrompt(start);
      const endLabel = formatDateForPrompt(end);
      if (startLabel && endLabel) return `von ${startLabel} bis ${endLabel}`;
      if (startLabel) return `ab ${startLabel}`;
      if (endLabel) return `bis ${endLabel}`;
      return '';
    }
    return resolveSelectOrCustom('zeitrahmen-select', 'zeitrahmen-custom');
  }

  function readValue(id) {
    const node = el(id);
    if (!node || typeof node.value !== 'string') return '';
    return node.value.trim();
  }

  function readChecked(id) {
    const node = el(id);
    return !!node?.checked;
  }

  function readRawValue(id) {
    const node = el(id);
    if (!node || typeof node.value !== 'string') return '';
    return node.value;
  }

  function dynamicFieldDefaultHelp(field = {}) {
    const type = String(field.type || 'text').toLowerCase();
    if (type === 'textarea') return 'Nutze Stichpunkte oder kurze Sätze mit konkreten Angaben.';
    if (type === 'select') return 'Wähle eine Option oder nutze einen eigenen Wert.';
    if (type === 'multiselect') return 'Mehrere Optionen möglich; eigene Werte können ergänzt werden.';
    if (type === 'checkbox') return 'Aktivieren, wenn für den Prompt relevant.';
    return 'Kurze, konkrete Angabe für den Prompt-Kontext.';
  }

  function allowsCustomDynamicValue(field = {}) {
    const type = String(field.type || '').toLowerCase();
    if (type !== 'select' && type !== 'multiselect') return false;
    if (field.allowCustom === false) return false;
    return true;
  }

  function supportsPlaceholderMode(field = {}) {
    const type = String(field.type || '').toLowerCase();
    if (type !== 'text' && type !== 'textarea') return false;
    if (field.allowPlaceholder === false) return false;
    if (field.allowPlaceholder === true) return true;
    const haystack = `${field.id || ''} ${field.label || ''}`.toLowerCase();
    const keywords = [
      'ausgangstext',
      'originaltext',
      'rohtext',
      'quelltext',
      'vorlagetext',
      'textvorlage',
      'textpassage',
      'textausschnitt',
      'umformulieren',
      'umschreiben',
      'rewrite',
    ];
    return keywords.some((keyword) => haystack.includes(keyword));
  }

  function placeholderTokenForField(fieldId = '') {
    const raw = String(fieldId || 'text')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `[${raw || 'TEXT'}]`;
  }

  function placeholderPromptHint(token = '[TEXT]') {
    return `${token} (Platzhalter verwenden. Den echten Inhalt erst im finalen Handoff direkt einsetzen.)`;
  }

  function setHomeDiscoveryStatus(text = '') {
    el('home-discovery-status').textContent = text;
  }

  function setGenerationStatus(text = '', type = 'info') {
    const node = el('generation-status');
    if (!node) return;
    node.textContent = text;
    node.dataset.type = type;
  }

  function escapeHtml(value = '') {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function clearFieldValidationMarks() {
    document.querySelectorAll('#prompt-form .field-invalid').forEach((node) => {
      node.classList.remove('field-invalid');
    });
  }

  function markFieldInvalidByNode(node) {
    if (!node) return;
    node.classList.add('field-invalid');
    const wrap = node.closest('label');
    if (wrap) wrap.classList.add('field-invalid');
  }

  function clearGenerationValidation() {
    const panel = el('generation-validation');
    if (!panel) return;
    panel.classList.add('is-hidden');
    panel.innerHTML = '';
    clearFieldValidationMarks();
  }

  function setGenerationValidation(items = [], title = 'Bitte Eingaben prüfen') {
    const panel = el('generation-validation');
    if (!panel) return;
    const messages = Array.isArray(items)
      ? items.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    if (!messages.length) {
      clearGenerationValidation();
      return;
    }
    panel.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <ul>${messages.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>
    `;
    panel.classList.remove('is-hidden');
  }

  function resolveRequiredFieldLabel(template, fieldId) {
    const normalized = String(fieldId || '').trim();
    if (!normalized) return 'Pflichtfeld';
    if (BASE_FIELD_LABELS[normalized]) return BASE_FIELD_LABELS[normalized];
    const dynamicField = (Array.isArray(template?.dynamicFields) ? template.dynamicFields : [])
      .find((entry) => String(entry?.id || '').trim() === normalized);
    if (dynamicField?.label) return dynamicField.label;
    return normalized;
  }

  function resolveRequiredFieldNode(template, fieldId) {
    const normalized = String(fieldId || '').trim();
    if (!normalized) return null;
    if (BASE_FIELD_LABELS[normalized]) return el(normalized);

    const dynamicField = (Array.isArray(template?.dynamicFields) ? template.dynamicFields : [])
      .find((entry) => String(entry?.id || '').trim() === normalized);
    const dynamicNode = el(`dyn-${normalized}`);
    if (dynamicField && dynamicNode && allowsCustomDynamicValue(dynamicField)) {
      if (String(dynamicNode.value || '').trim() === '__custom__') {
        return el(`dyn-${normalized}-custom`) || dynamicNode;
      }
    }
    return dynamicNode || el(`dyn-extra-${normalized}`) || null;
  }

  function setResultReadyBanner(text = '', stateType = 'ok') {
    const node = el('result-ready-banner');
    if (!node) return;
    const normalized = String(text || '').trim();
    node.textContent = normalized;
    node.dataset.state = stateType;
    node.classList.toggle('is-hidden', !normalized);
  }

  function setProgressBarValue(nodeId, percent = 0) {
    const node = el(nodeId);
    if (!node) return;
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    node.style.width = `${clamped}%`;
    node.dataset.progress = String(clamped);
  }

  function setProgressLabel(nodeId, text = '', type = 'info') {
    const node = el(nodeId);
    if (!node) return;
    node.textContent = text;
    node.dataset.type = type;
  }

  function updateResultProgress(stage = '', statusText = '', runMode = 'prompt') {
    const normalizedStage = String(stage || '').trim();
    const normalizedMode = runMode === 'result' ? 'result' : 'prompt';
    const directRow = el('result-progress-direct-row');
    if (directRow) directRow.classList.toggle('is-hidden', normalizedMode !== 'result');

    if (!normalizedStage) return;
    const metaStageMap = {
      input: { percent: 8, label: 'Eingaben werden geprüft…' },
      metaprompt: { percent: 18, label: 'Metaprompt wird vorbereitet…' },
      provider_call: { percent: 42, label: 'Metaprompt wird erzeugt…' },
      postprocess: { percent: normalizedMode === 'result' ? 68 : 82, label: 'Metaprompt wird finalisiert…' },
      finalize: { percent: normalizedMode === 'result' ? 92 : 100, label: normalizedMode === 'result' ? 'Abschluss läuft…' : 'Metaprompt fertig.' },
    };
    const directStageMap = {
      result_provider_call: { percent: 62, label: 'Direktes Ergebnis wird erzeugt…' },
      finalize: { percent: 100, label: 'Direktes Ergebnis fertig.' },
    };

    if (metaStageMap[normalizedStage]) {
      const entry = metaStageMap[normalizedStage];
      setProgressBarValue('result-progress-meta-bar', entry.percent);
      setProgressLabel('result-progress-meta-status', statusText || entry.label, normalizedStage === 'finalize' ? 'ok' : 'info');
    } else if (normalizedStage === 'budget') {
      setProgressLabel('result-progress-meta-status', statusText || 'Budget-Hinweis erkannt.', 'info');
    } else if (normalizedStage === 'error') {
      setProgressLabel('result-progress-meta-status', statusText || 'Fehler bei der Metaprompt-Generierung.', 'error');
    }

    if (normalizedMode === 'result') {
      if (directStageMap[normalizedStage]) {
        const entry = directStageMap[normalizedStage];
        setProgressBarValue('result-progress-direct-bar', entry.percent);
        setProgressLabel('result-progress-direct-status', statusText || entry.label, normalizedStage === 'finalize' ? 'ok' : 'info');
      } else if (normalizedStage === 'budget') {
        setProgressLabel('result-progress-direct-status', statusText || 'Budget-Hinweis erkannt.', 'info');
      } else if (normalizedStage === 'error') {
        setProgressLabel('result-progress-direct-status', statusText || 'Fehler bei der Result-Generierung.', 'error');
      }
    }
  }

  function resetResultProgress(runMode = 'prompt') {
    const normalizedMode = runMode === 'result' ? 'result' : 'prompt';
    const directRow = el('result-progress-direct-row');
    if (directRow) directRow.classList.toggle('is-hidden', normalizedMode !== 'result');
    setProgressBarValue('result-progress-meta-bar', 0);
    setProgressBarValue('result-progress-direct-bar', 0);
    setProgressLabel('result-progress-meta-status', 'wartet', 'info');
    setProgressLabel('result-progress-direct-status', 'wartet', 'info');
    setResultReadyBanner('', 'ok');
  }

  function getGlobalGenerationMode() {
    return state.settings?.resultModeEnabled ? 'result' : 'prompt';
  }

  function getRunGenerationMode() {
    return readChecked('run-mode-result-toggle') ? 'result' : 'prompt';
  }

  function setRunModeToggle(mode = 'prompt') {
    const node = el('run-mode-result-toggle');
    if (!node) return;
    node.checked = mode === 'result';
    syncRunModeUi();
  }

  function syncRunModeUi() {
    const button = el('generate-submit');
    const runModeToggle = el('run-mode-result-toggle');
    if (!button || !runModeToggle) return;
    button.textContent = runModeToggle.checked ? 'Direktes Ergebnis generieren' : 'Prompt generieren';
  }

  function resetRunModeOverride() {
    setRunModeToggle(getGlobalGenerationMode());
  }

  function setGenerating(isGenerating, text = '') {
    const button = el('generate-submit');
    if (button) {
      button.disabled = !!isGenerating;
      button.classList.toggle('is-loading', !!isGenerating);
      button.textContent = isGenerating
        ? 'Generiere...'
        : (getRunGenerationMode() === 'result' ? 'Direktes Ergebnis generieren' : 'Prompt generieren');
    }
    const runModeToggle = el('run-mode-result-toggle');
    if (runModeToggle) runModeToggle.disabled = !!isGenerating;
    setGenerationStatus(text, isGenerating ? 'info' : 'ok');
  }

  function formatTokenCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return '-';
    return Math.round(numeric).toLocaleString('de-AT');
  }

  function formatCost(value, currency = 'USD') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return '-';
    const safeCurrency = String(currency || 'USD').trim().toUpperCase() || 'USD';
    try {
      return new Intl.NumberFormat('de-AT', {
        style: 'currency',
        currency: safeCurrency,
        minimumFractionDigits: 6,
        maximumFractionDigits: 6,
      }).format(numeric);
    } catch (_error) {
      return `${numeric.toFixed(6)} ${safeCurrency}`;
    }
  }

  function setUsageSummary(prefix = 'result', usage = null) {
    const summaryNode = el(`${prefix}-usage-summary`);
    const inputNode = el(`${prefix}-usage-input`);
    const outputNode = el(`${prefix}-usage-output`);
    const totalNode = el(`${prefix}-usage-total`);
    if (!summaryNode || !inputNode || !outputNode || !totalNode) return;

    const promptTokens = Number(usage?.promptTokens);
    const completionTokens = Number(usage?.completionTokens);
    const totalTokens = Number(usage?.totalTokens);
    const hasUsage = Number.isFinite(promptTokens) || Number.isFinite(completionTokens) || Number.isFinite(totalTokens);

    inputNode.textContent = formatTokenCount(promptTokens);
    outputNode.textContent = formatTokenCount(completionTokens);
    totalNode.textContent = formatTokenCount(totalTokens);
    summaryNode.classList.toggle('is-hidden', !hasUsage);
  }

  function setCostSummary(prefix = 'result', cost = null) {
    const summaryNode = el(`${prefix}-cost-summary`);
    const inputNode = el(`${prefix}-cost-input`);
    const outputNode = el(`${prefix}-cost-output`);
    const totalNode = el(`${prefix}-cost-total`);
    if (!summaryNode || !inputNode || !outputNode || !totalNode) return;

    const inputCost = Number(cost?.inputCostUsd);
    const outputCost = Number(cost?.outputCostUsd);
    const totalCost = Number(cost?.totalCostUsd);
    const currency = String(cost?.pricingCurrency || 'USD').trim().toUpperCase() || 'USD';
    const hasCost = Number.isFinite(inputCost) || Number.isFinite(outputCost) || Number.isFinite(totalCost);

    inputNode.textContent = formatCost(inputCost, currency);
    outputNode.textContent = formatCost(outputCost, currency);
    totalNode.textContent = formatCost(totalCost, currency);
    summaryNode.classList.toggle('is-hidden', !hasCost);
  }

  function setResultUsageSummary(usage = null) {
    setUsageSummary('result', usage);
  }

  function setResultCostSummary(cost = null) {
    setCostSummary('result', cost);
  }

  function setPreviewStatus(text = '', type = 'info') {
    const node = el('metaprompt-preview-status');
    node.textContent = text;
    node.dataset.type = type;
  }

  function renderCategoryGrid(filteredTemplates = null) {
    auditTemplateCoverageOnce();
    const categoryConfig = getCategoryConfig();
    const grid = el('category-grid');
    const visibleCategorySet = Array.isArray(filteredTemplates)
      ? new Set(filteredTemplates.map((entry) => String(entry?.categoryName || '').trim()).filter(Boolean))
      : null;
    const categoryNames = Object.keys(categoryConfig)
      .filter((categoryName) => !visibleCategorySet || visibleCategorySet.has(categoryName));
    if (!categoryNames.length) {
      grid.innerHTML = '<div class="hint panel panel-soft">Keine passenden Kategorien für die aktuelle Suche/Tag-Auswahl.</div>';
      return;
    }
    grid.innerHTML = categoryNames
      .map((categoryName) => {
        const cfg = categoryConfig[categoryName];
        const icon = CATEGORY_ICONS[categoryName] || 'article';
        const tone = CATEGORY_ICON_TONES[categoryName] || 'bg-slate-100 text-slate-600';
        return `
        <button type="button" class="tw-home-category-card group" data-category="${categoryName}">
          <div class="tw-home-category-head">
            <span class="tw-home-category-icon ${tone}" aria-hidden="true">
              <span class="material-icons-round text-2xl">${icon}</span>
            </span>
            <span class="tw-home-category-kicker">${cfg.short}</span>
          </div>
          <strong class="tw-home-category-title group-hover:text-primary transition-colors">${normalizeUiText(cfg.title)}</strong>
          <span class="tw-home-category-desc">${normalizeUiText(cfg.description)}</span>
        </button>
      `;
      })
      .join('');

    grid.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => handleCategorySelection(button.dataset.category));
    });
  }

  function getCategoryShort(categoryName) {
    const categoryConfig = getCategoryConfig();
    const short = categoryConfig?.[categoryName]?.short;
    if (typeof short === 'string' && short.trim()) return short.trim().slice(0, 3).toUpperCase();
    return 'TPL';
  }

  function renderQuickTemplateList(containerId, templates, emptyText) {
    const node = el(containerId);
    if (!templates.length) {
      node.innerHTML = `<div class="hint">${emptyText}</div>`;
      return;
    }

    node.innerHTML = templates
      .map((template) => {
        const recentHint = template.recentUsedAt
          ? `Zuletzt: ${new Date(template.recentUsedAt).toLocaleString('de-AT')}`
          : 'Noch nicht genutzt';
        const short = getCategoryShort(template.categoryName);
        return `
          <div class="tw-home-discovery-item" data-open-template="${template.templateUid}" role="button" tabindex="0" aria-label="Template ${template.title} verwenden">
            <div class="tw-home-discovery-item-head">
              <span class="tw-home-discovery-item-title-wrap">
                <span class="tw-home-mini-badge">${short}</span>
                <strong>${template.title}</strong>
              </span>
              <button type="button" class="tw-home-fav-btn" data-fav-template="${template.templateUid}" data-fav-state="${template.isFavorite ? '1' : '0'}">${template.isFavorite ? '★' : '☆'}</button>
            </div>
            <small class="tw-home-item-meta">${template.categoryName} -> ${template.subcategoryName}</small>
            <small class="tw-home-item-time">${recentHint}</small>
          </div>
        `;
      })
      .join('');

    node.querySelectorAll('[data-open-template]').forEach((card) => {
      const openTemplate = () => openTemplateFromDiscovery(card.dataset.openTemplate);
      card.addEventListener('click', openTemplate);
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openTemplate();
      });
    });
    node.querySelectorAll('[data-fav-template]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        const favorite = button.dataset.favState === '1';
        toggleTemplateFavorite(button.dataset.favTemplate, !favorite).catch((error) => emitNotice(error.message, 'error'));
      });
    });
  }

  function renderHomeSearchResults(templates = [], { active = false } = {}) {
    const section = el('home-search-results-section');
    const list = el('home-search-results');
    const status = el('home-search-results-status');
    if (!section || !list || !status) return;

    if (!active) {
      section.classList.add('is-hidden');
      list.innerHTML = '';
      status.textContent = '';
      return;
    }

    if (!templates.length) {
      const hasSearch = Boolean(state.templateDiscovery.search);
      const searchLabel = hasSearch
        ? `Keine Treffer für "${state.templateDiscovery.search}".`
        : 'Keine Treffer für die aktuelle Filterauswahl.';
      status.textContent = searchLabel;
      list.innerHTML = `
        <div class="empty-state-card tw-home-search-empty-state">
          <strong>${searchLabel}</strong>
          <small class="hint">Passe Suche oder Tags an, oder starte mit allen Templates neu.</small>
          <span class="inline-actions">
            <button type="button" class="secondary small" data-home-search-reset-inline>Filter zurücksetzen</button>
          </span>
        </div>
      `;
      const resetInlineButton = list.querySelector('[data-home-search-reset-inline]');
      if (resetInlineButton) {
        resetInlineButton.addEventListener('click', () => {
          el('home-template-search').value = '';
          refreshTemplateDiscovery({ search: '', tags: [] }).catch((error) => emitNotice(error.message, 'error'));
        });
      }
      section.classList.remove('is-hidden');
      return;
    }

    const grouped = templates.reduce((acc, template) => {
      const categoryName = String(template?.categoryName || 'Weitere').trim() || 'Weitere';
      if (!acc.has(categoryName)) acc.set(categoryName, []);
      acc.get(categoryName).push(template);
      return acc;
    }, new Map());

    list.innerHTML = [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'de'))
      .map(([categoryName, entries]) => `
        <div class="tw-home-search-group">
          <h4>${categoryName} <small>(${entries.length})</small></h4>
          <div class="tw-home-search-group-list">
            ${entries.map((template) => `
              <button
                type="button"
                class="tw-home-search-result-card"
                data-open-template="${template.templateUid}"
              >
                <strong>${template.title}</strong>
                <small>${template.subcategoryName}</small>
              </button>
            `).join('')}
          </div>
        </div>
      `)
      .join('');

    list.querySelectorAll('[data-open-template]').forEach((button) => {
      button.addEventListener('click', () => openTemplateFromDiscovery(button.dataset.openTemplate));
    });

    const searchSuffix = state.templateDiscovery.search ? `für "${state.templateDiscovery.search}"` : 'über Tags';
    status.textContent = `${templates.length} Treffer ${searchSuffix}.`;
    section.classList.remove('is-hidden');
  }

  function renderTagChips(templates = []) {
    const counts = new Map();
    templates.forEach((template) => {
      (template.tags || []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    const selectedTags = normalizeTagList(state.templateDiscovery.activeTags || []);
    const topTags = [...counts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0], 'de');
      })
      .map(([tag]) => tag);

    selectedTags.forEach((tag) => {
      if (!topTags.includes(tag)) topTags.unshift(tag);
    });

    const visibleTags = selectedTags.length ? topTags : topTags.slice(0, 20);
    const chips = [
      `<button type="button" class="tw-home-chip ${!selectedTags.length ? 'tw-home-chip-active' : ''}" data-tag-chip="">Alle</button>`,
      ...visibleTags.map((tag) => `<button type="button" class="tw-home-chip ${selectedTags.includes(tag) ? 'tw-home-chip-active' : ''}" data-tag-chip="${tag}">${tag} (${counts.get(tag) || 0})</button>`),
    ];

    el('home-tag-chips').innerHTML = chips.join('');
    syncTagChipVisibility();
    el('home-tag-chips').querySelectorAll('[data-tag-chip]').forEach((button) => {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        const tag = button.dataset.tagChip || '';
        if (!tag) {
          refreshTemplateDiscovery({ tags: [] }).catch((error) => emitNotice(error.message, 'error'));
          return;
        }
        const nextTags = new Set(selectedTags);
        if (nextTags.has(tag)) nextTags.delete(tag);
        else nextTags.add(tag);
        refreshTemplateDiscovery({ tags: [...nextTags] }).catch((error) => emitNotice(error.message, 'error'));
      });
    });
  }

  function shouldShowTagChips() {
    const inputFocused = document.activeElement === el('home-template-search');
    const chipWrap = el('home-tag-chips');
    const chipsFocused = chipWrap?.contains(document.activeElement);
    const selectedTagCount = normalizeTagList(state.templateDiscovery.activeTags || []).length;
    return inputFocused || chipsFocused || state.templateDiscovery.tagPickerOpen || selectedTagCount > 0;
  }

  function syncTagChipVisibility() {
    const chipWrap = el('home-tag-chips');
    chipWrap.classList.toggle('is-hidden', !shouldShowTagChips());
  }

  function renderTemplateDiscovery() {
    const templates = Array.isArray(state.templateDiscovery.templates)
      ? state.templateDiscovery.templates
      : [];
    const selectedTags = normalizeTagList(state.templateDiscovery.activeTags || []);
    const hasFilterMode = Boolean(state.templateDiscovery.search) || selectedTags.length > 0;

    const recommended = templates.slice(0, 3);
    const recent = templates
      .filter((template) => template.isRecent)
      .sort((a, b) => {
        const aTime = a.recentUsedAt ? new Date(a.recentUsedAt).getTime() : 0;
        const bTime = b.recentUsedAt ? new Date(b.recentUsedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 3);
    const favorites = templates
      .filter((template) => template.isFavorite)
      .slice(0, 3);

    renderTagChips(templates);
    renderQuickTemplateList(
      'home-recommended-list',
      recommended,
      hasFilterMode ? 'Keine Treffer für Suche/Tags.' : 'Noch keine Empfehlungen verfügbar.'
    );
    renderQuickTemplateList('home-recent-list', recent, 'Noch keine zuletzt genutzten Templates.');
    renderQuickTemplateList('home-favorites-list', favorites, 'Noch keine Favoriten markiert.');
    renderHomeSearchResults(templates, { active: hasFilterMode });

    renderCategoryGrid(hasFilterMode ? templates : null);

    const tagSuffix = selectedTags.length ? ` | Tags: ${selectedTags.join(', ')}` : '';
    const searchSuffix = state.templateDiscovery.search ? ` | Suche: "${state.templateDiscovery.search}"` : '';
    setHomeDiscoveryStatus(`${templates.length} sichtbare Templates geladen${searchSuffix}${tagSuffix}.`);
  }

  async function refreshTemplateDiscovery({
    search = state.templateDiscovery.search,
    tags = state.templateDiscovery.activeTags,
  } = {}) {
    const params = new URLSearchParams();
    const normalizedSearch = String(search || '').trim();
    const normalizedTags = normalizeTagList(tags || []);
    if (normalizedSearch) params.set('search', normalizedSearch);
    if (normalizedTags.length) params.set('tags', normalizedTags.join(','));

    setHomeDiscoveryStatus('Lade Template-Discovery...');
    const payload = await api(`/api/templates${params.toString() ? `?${params.toString()}` : ''}`);
    state.templateDiscovery.templates = Array.isArray(payload.templates) ? payload.templates : [];
    state.templateDiscovery.search = normalizedSearch;
    state.templateDiscovery.activeTags = normalizedTags;
    state.templateDiscovery.activeTag = normalizedTags[0] || '';
    renderTemplateDiscovery();
  }

  function findTemplateInDiscovery(templateUid) {
    return (state.templateDiscovery.templates || []).find((entry) => entry.templateUid === templateUid) || null;
  }

  async function toggleTemplateFavorite(templateUid, favorite) {
    await api(`/api/templates/${encodeURIComponent(templateUid)}/favorite`, {
      method: 'PUT',
      body: JSON.stringify({ favorite }),
    });
    await refreshTemplateDiscovery();
  }

  function openTemplateFromDiscovery(templateUid) {
    const entry = findTemplateInDiscovery(templateUid);
    if (!entry) {
      emitNotice('Template nicht gefunden. Bitte Discovery aktualisieren.', 'error');
      return;
    }
    openForm(entry.categoryName, entry.subcategoryName);
  }

  function renderSubcategoryList(categoryName) {
    const categoryConfig = getCategoryConfig();
    const cfg = categoryConfig[categoryName];
    el('selected-category-title').textContent = normalizeUiText(cfg.title);
    el('selected-category-desc').textContent = normalizeUiText(cfg.description);
    el('subcategory-list').innerHTML = cfg.unterkategorien
      .map(
        (subcategory) => {
          const template = getTemplateConfig(categoryName, subcategory);
          const discoveryEntry = (state.templateDiscovery.templates || []).find((entry) => (
            entry.categoryName === categoryName && entry.subcategoryName === subcategory
          ));
          const short = getCategoryShort(categoryName);
          const favorite = Boolean(discoveryEntry?.isFavorite);
          const badge = (template?.tags || [])[0] || 'template';
          return `
            <div class="tw-subcat-card clickable-card" data-subcategory="${subcategory}" role="button" tabindex="0" aria-label="${subcategory} auswählen">
              <div class="tw-subcat-card-head">
                <span class="tw-subcat-card-meta">
                  <span class="tw-subcat-badge">${short}</span>
                  <span class="tw-subcat-tag">${badge}</span>
                </span>
                <button type="button" class="tw-subcat-fav" data-fav-template="${discoveryEntry?.templateUid || ''}" data-fav-state="${favorite ? '1' : '0'}">${favorite ? '★' : '☆'}</button>
              </div>
              <strong class="tw-subcat-card-title">${normalizeUiText(subcategory)}</strong>
              <span class="tw-subcat-card-desc">${normalizeUiText(template?.description || cfg.description)}</span>
              <div class="tw-subcat-card-cta">
                Konfigurieren
                <span class="material-icons-round">chevron_right</span>
              </div>
            </div>
          `;
        }
      )
      .join('');
    if (el('subcategory-count')) {
      el('subcategory-count').textContent = `${cfg.unterkategorien.length} Vorlagen in dieser Kategorie gefunden.`;
    }
    applySubcategoryViewMode();

    el('subcategory-list').querySelectorAll('[data-subcategory]').forEach((card) => {
      const openSubcategory = () => openForm(categoryName, card.dataset.subcategory);
      card.addEventListener('click', openSubcategory);
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openSubcategory();
      });
    });
    el('subcategory-list').querySelectorAll('[data-fav-template]').forEach((button) => {
      const templateUid = button.dataset.favTemplate;
      if (!templateUid) {
        button.disabled = true;
        return;
      }
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        const favorite = button.dataset.favState === '1';
        toggleTemplateFavorite(templateUid, !favorite).catch((error) => emitNotice(error.message, 'error'));
      });
    });
  }

  function applySubcategoryViewMode() {
    const mode = state.subcategoryViewMode === 'list' ? 'list' : 'grid';
    const listNode = el('subcategory-list');
    const gridButton = el('subcat-view-grid');
    const listButton = el('subcat-view-list');
    if (listNode) listNode.classList.toggle('is-list', mode === 'list');
    if (gridButton) gridButton.classList.toggle('is-active', mode === 'grid');
    if (listButton) listButton.classList.toggle('is-active', mode === 'list');
  }

  function setSubcategoryViewMode(mode) {
    state.subcategoryViewMode = mode === 'list' ? 'list' : 'grid';
    applySubcategoryViewMode();
  }

  function setFormSectionsVisibility(visible) {
    ['form-required-panel', 'form-optional-panel', 'form-advanced-panel', 'form-oneoff-panel', 'form-right-rail']
      .forEach((id) => {
        const node = el(id);
        if (!node) return;
        node.classList.toggle('is-hidden', !visible);
      });
  }

  function updateFormHeaderForSelection() {
    const categoryConfig = getCategoryConfig();
    const cfg = categoryConfig[state.selectedCategory];
    el('form-category-title').textContent = normalizeUiText(cfg?.title || '');
    el('form-subcategory-title').textContent = normalizeUiText(state.selectedSubcategory || (isCompactFlowMode() ? 'Bitte Template wählen' : ''));
    const template = state.selectedCategory && state.selectedSubcategory
      ? getTemplateConfig(state.selectedCategory, state.selectedSubcategory)
      : null;
    const description = normalizeUiText((template?.longDescription || template?.description || '').trim());
    const descriptionNode = el('form-template-description');
    if (descriptionNode) descriptionNode.textContent = description;
  }

  function setCompactStepCollapsed(stepNode, collapsed) {
    if (!stepNode) return;
    stepNode.classList.toggle('is-collapsed', !!collapsed);
  }

  function renderCompactFlowPanel() {
    const panel = el('compact-flow-panel');
    if (!panel) return;

    const compact = isCompactFlowMode();
    panel.classList.toggle('is-hidden', !compact);
    if (!compact) {
      setFormSectionsVisibility(true);
      updateFormHeaderForSelection();
      return;
    }

    const categoryConfig = getCategoryConfig();
    const categorySelect = el('flow-category-select');
    const templateSelect = el('flow-template-select');
    const categoryStep = el('flow-step-category');
    const templateStep = el('flow-step-template');
    const editCategoryBtn = el('flow-edit-category');
    const editTemplateBtn = el('flow-edit-template');
    const categorySummary = el('flow-category-summary');
    const templateSummary = el('flow-template-summary');

    const categories = Object.entries(categoryConfig);
    categorySelect.innerHTML = [
      '<option value="">Bitte Handlungsfeld wählen...</option>',
      ...categories.map(([categoryName, cfg]) => `<option value="${categoryName}">${normalizeUiText(cfg.title)}</option>`),
    ].join('');
    categorySelect.value = state.selectedCategory || '';

    const categorySelected = !!state.selectedCategory && !!categoryConfig[state.selectedCategory];
    if (categorySelected) {
      const category = categoryConfig[state.selectedCategory];
      templateStep.classList.remove('is-hidden');
      templateSelect.innerHTML = [
        '<option value="">Bitte Template wählen...</option>',
        ...(category.unterkategorien || []).map((entry) => `<option value="${entry}">${normalizeUiText(entry)}</option>`),
      ].join('');
      templateSelect.value = state.selectedSubcategory || '';
    } else {
      templateStep.classList.add('is-hidden');
      templateSelect.innerHTML = '<option value="">Bitte Template wählen...</option>';
      state.selectedSubcategory = null;
    }

    const categoryCollapsed = categorySelected && !state.compactFlow.editingCategory;
    setCompactStepCollapsed(categoryStep, categoryCollapsed);
    editCategoryBtn.classList.toggle('is-hidden', !categoryCollapsed);
    categorySummary.classList.toggle('is-hidden', !categoryCollapsed);
    categorySummary.textContent = categoryCollapsed
      ? `Ausgewählt: ${normalizeUiText(categoryConfig[state.selectedCategory]?.title || state.selectedCategory)}`
      : '';

    const templateSelected = !!state.selectedSubcategory;
    const templateCollapsed = templateSelected && !state.compactFlow.editingTemplate;
    setCompactStepCollapsed(templateStep, templateCollapsed);
    editTemplateBtn.classList.toggle('is-hidden', !templateCollapsed);
    templateSummary.classList.toggle('is-hidden', !templateCollapsed);
    templateSummary.textContent = templateCollapsed ? `Ausgewählt: ${normalizeUiText(state.selectedSubcategory)}` : '';

    const formReady = templateSelected;
    setFormSectionsVisibility(formReady);
    if (!formReady) {
      setGenerationStatus('Bitte zuerst ein Template in der Kompaktansicht wählen.', 'info');
    } else {
      setGenerationStatus('', 'ok');
    }
    updateFormHeaderForSelection();
  }

  function setCompactCategory(categoryName, { collapseCategory = true, focusTemplate = true } = {}) {
    const categoryConfig = getCategoryConfig();
    if (!categoryName || !categoryConfig[categoryName]) {
      state.selectedCategory = null;
      state.selectedSubcategory = null;
      state.compactFlow.editingCategory = true;
      state.compactFlow.editingTemplate = false;
      renderCompactFlowPanel();
      return;
    }

    state.selectedCategory = categoryName;
    state.selectedSubcategory = null;
    state.compactFlow.editingCategory = !collapseCategory;
    state.compactFlow.editingTemplate = !!focusTemplate;
    renderCompactFlowPanel();
    const templateSelect = el('flow-template-select');
    if (focusTemplate && templateSelect) templateSelect.focus();
  }

  function setCompactTemplate(subcategoryName, { collapse = true } = {}) {
    if (!state.selectedCategory) return;
    const categoryConfig = getCategoryConfig();
    const cfg = categoryConfig[state.selectedCategory];
    const valid = (cfg?.unterkategorien || []).includes(subcategoryName);
    if (!valid) {
      state.selectedSubcategory = null;
      state.compactFlow.editingTemplate = true;
      renderCompactFlowPanel();
      return;
    }

    state.selectedSubcategory = subcategoryName;
    state.compactFlow.editingTemplate = !collapse;
    renderCompactFlowPanel();
    renderDynamicFields();
  }

  function syncFlowModeUi() {
    state.compactFlow.editingCategory = false;
    state.compactFlow.editingTemplate = false;
    renderCompactFlowPanel();
  }

  function renderDynamicFields() {
    if (isCompactFlowMode() && !state.selectedSubcategory) {
      return;
    }
    updateFormHeaderForSelection();
    const template = getTemplateConfig();
    const requiredContainer = el('required-fields-grid');
    const optionalContainer = el('optional-fields-grid');
    if (!requiredContainer || !optionalContainer) return;

    parkBaseFieldWrappers();
    if (requiredContainer) requiredContainer.innerHTML = '';
    if (optionalContainer) optionalContainer.innerHTML = '';

    const templateTitle = normalizeUiText(state.selectedSubcategory || 'Template');
    const requiredTitle = el('required-panel-title');
    const optionalTitle = el('optional-panel-title');
    if (requiredTitle) requiredTitle.textContent = `${templateTitle} - Pflichtfelder`;
    if (optionalTitle) optionalTitle.textContent = `${templateTitle} - Optionale Felder`;

    const requiredBaseSet = updateBaseFieldRequirements(template, requiredContainer, optionalContainer);

    const fields = Array.isArray(template?.dynamicFields) ? template.dynamicFields : [];
    fields.forEach((field) => {
      const wrap = document.createElement('label');
      wrap.className = field.type === 'checkbox' ? 'checkbox span-2' : '';
      if (field.type !== 'checkbox') wrap.textContent = normalizeUiText(field.label);
      const allowCustom = allowsCustomDynamicValue(field);
      const placeholderSupported = supportsPlaceholderMode(field);
      let customInput = null;

      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        const options = dedupeDisplayOptions(Array.isArray(field.options) ? [...field.options] : []);
        if (allowCustom && !options.includes('__custom__')) options.push('__custom__');
        const selectPlaceholder = normalizeUiText(String(field.placeholder || '').trim() || 'Bitte wählen...');
        input.innerHTML = `<option value="">${selectPlaceholder}</option>${options
          .map((opt) => {
            if (opt === '__custom__') return '<option value="__custom__">Custom...</option>';
            return `<option value="${opt}">${normalizeUiText(opt)}</option>`;
          })
          .join('')}`;
      } else if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 2;
        input.placeholder = normalizeUiText(field.placeholder || '');
      } else if (field.type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        const span = document.createElement('span');
        span.textContent = normalizeUiText(field.label);
        wrap.appendChild(input);
        wrap.appendChild(span);
      } else if (field.type === 'multiselect') {
        input = document.createElement('select');
        input.multiple = true;
        const options = dedupeDisplayOptions(Array.isArray(field.options) ? [...field.options] : []);
        if (allowCustom && !options.includes('__custom__')) options.push('__custom__');
        input.innerHTML = options
          .map((opt) => {
            if (opt === '__custom__') return '<option value="__custom__">Custom...</option>';
            return `<option value="${opt}">${normalizeUiText(opt)}</option>`;
          })
          .join('');
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = normalizeUiText(field.placeholder || '');
      }

      input.id = `dyn-${field.id}`;
      if (field.required) input.required = true;
      if (field.type !== 'checkbox') wrap.appendChild(input);

      const hoverHelpBase = normalizeUiText(String(field.hoverHelp || field.helpText || dynamicFieldDefaultHelp(field) || '').trim());
      const optionHelpMap = field.optionHelp && typeof field.optionHelp === 'object'
        ? field.optionHelp
        : null;
      const applyFieldHoverHelp = () => {
        let hoverText = hoverHelpBase;
        if (optionHelpMap && (field.type === 'select' || field.type === 'multiselect')) {
          if (field.type === 'select') {
            const selected = String(input.value || '').trim();
            if (selected && optionHelpMap[selected]) hoverText = normalizeUiText(String(optionHelpMap[selected] || '').trim()) || hoverText;
          } else {
            const selectedValues = [...input.selectedOptions].map((option) => String(option.value || '').trim()).filter(Boolean);
            const selectedHelp = selectedValues
              .map((value) => normalizeUiText(String(optionHelpMap[value] || '').trim()))
              .filter(Boolean)
              .join(' | ');
            if (selectedHelp) hoverText = selectedHelp;
          }
        }
        if (hoverText) {
          wrap.title = hoverText;
          input.title = hoverText;
        } else {
          wrap.removeAttribute('title');
          input.removeAttribute('title');
        }
      };
      applyFieldHoverHelp();
      if (field.type === 'select' || field.type === 'multiselect') {
        input.addEventListener('change', applyFieldHoverHelp);
      }

      if (field.type !== 'checkbox') {
        const hint = document.createElement('small');
        hint.className = 'hint';
        const explanation = normalizeUiText((field.helpText || '').trim() || dynamicFieldDefaultHelp(field));
        let optionHint = '';
        if (Array.isArray(field.options) && field.options.length) {
          if (field.optionHelp && typeof field.optionHelp === 'object') {
            optionHint = 'Optionen im Dropdown (Kurzinfo per Hover).';
          } else if (field.options.length <= 5) {
            optionHint = `Optionen: ${field.options.map((entry) => normalizeUiText(entry)).join(', ')}`;
          } else {
            optionHint = 'Mehrere Optionen im Dropdown verfügbar.';
          }
        }
        const requiredHint = field.required ? 'Pflichtfeld.' : 'Optional.';
        const placeholderHint = field.placeholder ? ` Beispiel: ${normalizeUiText(field.placeholder)}` : '';
        const customHint = allowCustom
          ? (field.type === 'multiselect'
            ? ' Eigene Werte (kommagetrennt) sind zusätzlich möglich.'
            : ' Eigener Wert ist alternativ möglich.')
          : '';
        hint.textContent = `${requiredHint} ${explanation}${optionHint ? ` ${optionHint}` : ''}${placeholderHint}${customHint}`;
        wrap.appendChild(hint);
      }

      if (allowCustom && field.type !== 'checkbox') {
        customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.id = `dyn-${field.id}-custom`;
        customInput.disabled = true;
        customInput.classList.add('is-hidden');
        customInput.placeholder = field.customPlaceholder
          ? normalizeUiText(field.customPlaceholder)
          : (field.type === 'select'
            ? 'Eigener Wert'
            : (field.type === 'multiselect'
            ? 'Weitere Werte (kommagetrennt, optional)'
            : 'Eigener Wert (optional)'));
        wrap.appendChild(customInput);

        const syncCustomVisibility = ({ shouldFocus = false } = {}) => {
          let isCustomSelected = false;
          if (field.type === 'select') {
            isCustomSelected = input.value === '__custom__';
          } else if (field.type === 'multiselect') {
            isCustomSelected = [...input.selectedOptions].some((option) => option.value === '__custom__');
          }
          customInput.classList.toggle('is-hidden', !isCustomSelected);
          customInput.disabled = !isCustomSelected;
          customInput.required = Boolean(field.required && field.type === 'select' && isCustomSelected);
          if (!isCustomSelected) customInput.value = '';
          if (isCustomSelected && shouldFocus) {
            window.requestAnimationFrame(() => customInput.focus());
          }
        };
        input.addEventListener('change', () => syncCustomVisibility({ shouldFocus: true }));
        customInput.addEventListener('input', () => {
          const hasValue = customInput.value.trim().length > 0;
          if (!hasValue) return;
          if (field.type === 'select' && input.value !== '__custom__') {
            input.value = '__custom__';
            syncCustomVisibility();
          } else if (field.type === 'multiselect') {
            const customOption = [...input.options].find((option) => option.value === '__custom__');
            if (customOption && !customOption.selected) {
              customOption.selected = true;
              syncCustomVisibility();
            }
          }
        });
        syncCustomVisibility();
      }

      if (placeholderSupported && field.type !== 'checkbox') {
        const placeholderToggleWrap = document.createElement('div');
        placeholderToggleWrap.className = 'checkbox top-space';
        const placeholderToggle = document.createElement('input');
        placeholderToggle.type = 'checkbox';
        placeholderToggle.id = `dyn-${field.id}-placeholder-use`;
        const placeholderToggleLabel = document.createElement('span');
        placeholderToggleLabel.textContent = 'Platzhalter statt Originaltext verwenden';
        placeholderToggleWrap.appendChild(placeholderToggle);
        placeholderToggleWrap.appendChild(placeholderToggleLabel);
        placeholderToggleWrap.addEventListener('click', (event) => {
          if (event.target === placeholderToggle) return;
          placeholderToggle.checked = !placeholderToggle.checked;
          placeholderToggle.dispatchEvent(new Event('change'));
        });
        wrap.appendChild(placeholderToggleWrap);

        const placeholderTokenWrap = document.createElement('div');
        placeholderTokenWrap.className = 'top-space is-hidden';
        const placeholderTokenLabel = document.createElement('small');
        placeholderTokenLabel.className = 'hint';
        placeholderTokenLabel.textContent = 'Platzhalter-Token im finalen Handoff';
        const placeholderTokenInput = document.createElement('input');
        placeholderTokenInput.type = 'text';
        placeholderTokenInput.id = `dyn-${field.id}-placeholder-token`;
        placeholderTokenInput.value = placeholderTokenForField(field.id);
        placeholderTokenInput.placeholder = placeholderTokenForField(field.id);
        placeholderTokenInput.disabled = true;
        placeholderTokenWrap.appendChild(placeholderTokenLabel);
        placeholderTokenWrap.appendChild(placeholderTokenInput);
        wrap.appendChild(placeholderTokenWrap);

        const placeholderHint = document.createElement('small');
        placeholderHint.className = 'hint';
        placeholderHint.textContent = 'Empfohlen bei sensiblen Inhalten: Die KI sieht nur den Platzhalter, nicht den eigentlichen Text.';
        wrap.appendChild(placeholderHint);

        const syncPlaceholderMode = () => {
          const active = placeholderToggle.checked;
          placeholderTokenWrap.classList.toggle('is-hidden', !active);
          placeholderTokenInput.disabled = !active;
          input.disabled = active;
          if (active) {
            input.required = false;
            if (customInput) {
              customInput.disabled = true;
              customInput.required = false;
            }
          } else {
            input.required = !!field.required;
            if (customInput && input.value === '__custom__') {
              customInput.disabled = false;
              customInput.required = !!field.required;
            }
          }
        };
        placeholderToggle.addEventListener('change', syncPlaceholderMode);
        syncPlaceholderMode();
      }

      const target = field.required ? requiredContainer : optionalContainer;
      if (target) target.appendChild(wrap);
    });

    const dynamicFieldIds = new Set(
      fields.map((field) => String(field?.id || '').trim()).filter(Boolean)
    );
    const unresolvedRequiredFields = [...requiredBaseSet].filter(
      (fieldId) => !BASE_FIELD_LABELS[fieldId] && !dynamicFieldIds.has(fieldId)
    );
    unresolvedRequiredFields.forEach((fieldId) => {
      const wrap = document.createElement('label');
      wrap.textContent = `${fieldId} *`;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = `dyn-extra-${fieldId}`;
      input.required = true;
      input.dataset.extraRequiredField = fieldId;
      input.placeholder = `${fieldId} eingeben`;
      wrap.appendChild(input);
      const hint = document.createElement('small');
      hint.className = 'hint';
      hint.textContent = `Pflichtfeld aus Template-Konfiguration (${fieldId}).`;
      wrap.appendChild(hint);
      requiredContainer.appendChild(wrap);
    });

    // Prioritize contextual lead-in fields (e.g. "anlass") at the top of required fields.
    const priorityRequiredIds = ['anlass'];
    [...priorityRequiredIds].reverse().forEach((fieldId) => {
      const node = el(`dyn-${fieldId}`);
      const wrap = node?.closest('label');
      if (!wrap || wrap.parentElement !== requiredContainer) return;
      requiredContainer.insertBefore(wrap, requiredContainer.firstChild);
    });

    if (requiredContainer && !requiredContainer.children.length) {
      requiredContainer.innerHTML = '<small class="hint span-2">Dieses Template hat keine Pflicht-Parameter.</small>';
    }
    if (optionalContainer && !optionalContainer.children.length) {
      optionalContainer.innerHTML = '<small class="hint span-2">Keine optionalen Template-Parameter.</small>';
    }

    const requiredDynamic = fields.filter((field) => field.required).map((field) => field.id);
    const required = [...requiredBaseSet, ...requiredDynamic];
    el('validation-hint').textContent = required.length
      ? `Pflichtfelder für ${templateTitle}: ${required.join(', ')}`
      : '';
  }

  function collectDynamicValues() {
    const template = getTemplateConfig();
    const values = {};
    const fields = Array.isArray(template?.dynamicFields) ? template.dynamicFields : [];

    fields.forEach((field) => {
      const node = el(`dyn-${field.id}`);
      if (!node) return;

      if (field.type === 'checkbox') values[field.id] = node.checked;
      else if (field.type === 'multiselect') {
        const rawSelected = [...node.selectedOptions].map((opt) => opt.value).filter(Boolean);
        const customEnabled = rawSelected.includes('__custom__');
        const selected = rawSelected.filter((value) => value !== '__custom__');
        const customValues = allowsCustomDynamicValue(field) && customEnabled
          ? csvToArray(readValue(`dyn-${field.id}-custom`))
          : [];
        values[field.id] = [...new Set([...selected, ...customValues])].join(', ');
      } else if (field.type === 'select') {
        const selectedValue = String(node.value || '').trim();
        if (allowsCustomDynamicValue(field) && selectedValue === '__custom__') {
          values[field.id] = readValue(`dyn-${field.id}-custom`);
        } else {
          values[field.id] = selectedValue;
        }
      } else {
        const placeholderActive = supportsPlaceholderMode(field) && readChecked(`dyn-${field.id}-placeholder-use`);
        if (placeholderActive) {
          const token = readValue(`dyn-${field.id}-placeholder-token`) || placeholderTokenForField(field.id);
          values[field.id] = placeholderPromptHint(token);
        } else {
          values[field.id] = node.value.trim();
        }
      }
    });
    return values;
  }

  function collectExtraRequiredValues() {
    const values = {};
    document.querySelectorAll('[data-extra-required-field]').forEach((node) => {
      const fieldId = String(node.dataset.extraRequiredField || '').trim();
      if (!fieldId) return;
      if (typeof node.value !== 'string') return;
      values[fieldId] = node.value.trim();
    });
    return values;
  }

  function validateTemplateRequiredValues(template, values) {
    const missing = getRequiredTemplateFields(template).filter((fieldName) => !hasNonEmptyValue(values[fieldName]));
    if (missing.length) {
      missing.forEach((fieldName) => {
        markFieldInvalidByNode(resolveRequiredFieldNode(template, fieldName));
      });
      const missingLabels = missing.map((fieldName) => `${resolveRequiredFieldLabel(template, fieldName)} ist erforderlich.`);
      setGenerationValidation(missingLabels, 'Pflichtfelder fehlen');
      setGenerationStatus('Bitte Pflichtfelder ergänzen.', 'error');
      emitNotice('Bitte Pflichtfelder ergänzen.', 'error');
      return false;
    }
    return true;
  }

  function collectOneOffOverridePayload() {
    if (!readChecked('oneoff-enable')) {
      return {
        templateOverride: null,
        saveOverrideAsPersonal: false,
        saveOverrideTitleSuffix: '',
      };
    }

    const override = {};
    const description = readValue('oneoff-description');
    const profile = readValue('oneoff-profile');
    const promptMode = el('oneoff-prompt-mode')?.value || '';
    const basePrompt = readValue('oneoff-base-prompt');
    const tags = csvToArray(readValue('oneoff-tags'));

    if (description) override.description = description;
    if (profile) override.profile = profile;
    if (promptMode) override.promptMode = promptMode;
    if (basePrompt) override.basePrompt = basePrompt;
    if (tags.length) override.tags = tags;

    return {
      templateOverride: Object.keys(override).length ? override : null,
      saveOverrideAsPersonal: readChecked('oneoff-save-personal'),
      saveOverrideTitleSuffix: readValue('oneoff-save-suffix'),
    };
  }

  function collectGenerationContext({ validate = true } = {}) {
    if (validate) clearGenerationValidation();
    if (!state.selectedCategory || !state.selectedSubcategory) {
      if (validate) {
        setGenerationValidation(['Bitte zuerst Handlungsfeld und Template auswählen.'], 'Generierung nicht möglich');
        setGenerationStatus('Bitte zuerst Kategorie und Template auswählen.', 'error');
        emitNotice('Bitte zuerst Kategorie und Template auswählen.', 'error');
      }
      return null;
    }
    const dynamicValues = collectDynamicValues();
    const extraRequiredValues = collectExtraRequiredValues();
    const mergedDynamicValues = { ...dynamicValues, ...extraRequiredValues };
    const template = getTemplateConfig();
    const baseFields = {
      fach: readValue('fach'),
      schulstufe: readValue('schulstufe'),
      handlungsfeld: state.selectedCategory,
      unterkategorie: state.selectedSubcategory,
      ziel: readValue('ziel'),
      zeitrahmen: resolveZeitrahmenValue(),
      niveau: resolveSelectOrCustom('niveau-select', 'niveau-custom'),
      rahmen: resolveSelectOrCustom('rahmen-select', 'rahmen-custom'),
      ergebnisformat: resolveSelectOrCustom('ergebnisformat-select', 'ergebnisformat-custom'),
      ton: resolveSelectOrCustom('ton-select', 'ton-custom'),
      rueckfragen: readChecked('rueckfragen'),
    };

    if (validate && !validateTemplateRequiredValues(template, { ...baseFields, ...mergedDynamicValues })) {
      return null;
    }

    const oneoff = collectOneOffOverridePayload();
    const usePreviewMetaprompt = readChecked('use-preview-metaprompt');
    const metapromptOverride = usePreviewMetaprompt ? readRawValue('metaprompt-preview').trim() : '';
    if (validate && usePreviewMetaprompt && !metapromptOverride) {
      markFieldInvalidByNode(el('metaprompt-preview'));
      setGenerationValidation(
        ['Metaprompt-Vorschau ist leer. Bitte zuerst aktualisieren oder die Direktverwendung deaktivieren.'],
        'Generierung nicht möglich'
      );
      setGenerationStatus('Metaprompt-Vorschau fehlt.', 'error');
      emitNotice('Metaprompt-Vorschau fehlt.', 'error');
      return null;
    }
    return {
      template,
      baseFields,
      dynamicValues: mergedDynamicValues,
      oneoff,
      metapromptOverride,
    };
  }

  function snapshotPromptFormValues() {
    const form = el('prompt-form');
    if (!form) return { values: {}, activeId: null };

    const values = {};
    form.querySelectorAll('input, select, textarea').forEach((node) => {
      const id = node.id;
      if (!id || shouldIgnoreSnapshotField(id)) return;
      if (node.tagName === 'SELECT' && node.multiple) {
        values[id] = { kind: 'multi', value: [...node.selectedOptions].map((opt) => opt.value) };
        return;
      }
      if (node.type === 'checkbox' || node.type === 'radio') {
        values[id] = { kind: 'checked', value: node.checked };
        return;
      }
      values[id] = { kind: 'value', value: node.value };
    });

    return {
      values,
      activeId: document.activeElement?.id || null,
    };
  }

  function restorePromptFormValues(snapshot = {}) {
    const values = snapshot.values || {};
    Object.entries(values).forEach(([id, meta]) => {
      if (shouldIgnoreSnapshotField(id)) return;
      const node = el(id);
      if (!node || !meta) return;
      if (meta.kind === 'multi' && node.tagName === 'SELECT' && node.multiple) {
        const set = new Set(Array.isArray(meta.value) ? meta.value : []);
        [...node.options].forEach((opt) => {
          opt.selected = set.has(opt.value);
        });
        return;
      }
      if (meta.kind === 'checked') {
        node.checked = !!meta.value;
        return;
      }
      if (meta.kind === 'value' && typeof meta.value === 'string') {
        node.value = meta.value;
      }
    });

    const form = el('prompt-form');
    if (form) {
      form.querySelectorAll('select').forEach((node) => {
        if (shouldIgnoreSnapshotField(node.id)) return;
        node.dispatchEvent(new Event('change'));
      });
    }
    ['zeitrahmen-select', 'niveau-select', 'rahmen-select', 'ergebnisformat-select', 'ton-select'].forEach((id) => {
      const select = el(id);
      if (select) {
        select.dispatchEvent(new Event('change'));
      }
    });
    const oneoffFields = el('oneoff-fields');
    if (oneoffFields) {
      oneoffFields.classList.toggle('is-hidden', !readChecked('oneoff-enable'));
    }

    if (snapshot.activeId) {
      const activeNode = el(snapshot.activeId);
      if (activeNode?.focus) activeNode.focus();
    }
  }

  async function previewMetaprompt() {
    const formSnapshot = snapshotPromptFormValues();
    const context = collectGenerationContext({ validate: true });
    if (!context) return;

    setPreviewStatus('Erstelle serverseitige Metaprompt-Vorschau...', 'info');
    try {
      const preview = await api('/api/generate/preview', {
        method: 'POST',
        body: JSON.stringify({
          templateId: context.template?.id,
          categoryName: context.baseFields.handlungsfeld,
          subcategoryName: context.baseFields.unterkategorie,
          baseFields: context.baseFields,
          dynamicValues: context.dynamicValues,
          templateOverride: context.oneoff.templateOverride,
        }),
      });

      el('metaprompt-preview').value = preview.metaprompt || '';
      setPreviewStatus('Vorschau aktualisiert.', 'ok');
    } finally {
      restorePromptFormValues(formSnapshot);
    }
  }

  function resetTaskState() {
    state.selectedCategory = null;
    state.selectedSubcategory = null;
    state.compactFlow.editingCategory = true;
    state.compactFlow.editingTemplate = false;
    state.generatedPrompt = '';
    state.generatedMeta = '';
    state.lastPromptContext = null;
    el('prompt-form').reset();
    if (el('rueckfragen')) el('rueckfragen').checked = false;
    el('result').value = '';
    if (el('result-direct-output')) el('result-direct-output').value = '';
    el('result-meta').textContent = '';
    if (el('result-direct-meta')) el('result-direct-meta').textContent = '';
    if (el('result-direct-panel')) el('result-direct-panel').classList.add('is-hidden');
    if (el('result-metadata-panel')) el('result-metadata-panel').classList.add('is-hidden');
    if (el('result-metadata-list')) el('result-metadata-list').innerHTML = '';
    el('library-title').value = '';
    el('library-rating').value = '';
    el('library-public').checked = false;
    el('save-library-status').textContent = '';
    el('metaprompt-preview').value = '';
    el('metaprompt-preview-status').textContent = '';
    el('use-preview-metaprompt').checked = false;
    el('generation-status').textContent = '';
    clearGenerationValidation();
    el('result-compare-panel').classList.add('is-hidden');
    el('result-variant-status').textContent = '';
    el('btn-open-templates-from-result').classList.add('is-hidden');
    if (el('result-detail-handlungsfeld')) el('result-detail-handlungsfeld').textContent = '-';
    if (el('result-detail-unterkategorie')) el('result-detail-unterkategorie').textContent = '-';
    if (el('result-detail-fach')) el('result-detail-fach').textContent = '-';
    if (el('result-detail-schulstufe')) el('result-detail-schulstufe').textContent = '-';
    if (el('form-template-description')) el('form-template-description').textContent = '';
    state.generatedResult = '';
    state.generatedMetaPrompt = '';
    state.generatedMetaDetails = null;
    state.lastGenerationPayload = null;
    state.lastGenerationFormSnapshot = null;
    setResultUsageSummary(null);
    setResultCostSummary(null);
    setUsageSummary('result-direct', null);
    setCostSummary('result-direct', null);
    resetResultProgress(getRunGenerationMode());
    resetRunModeOverride();
    renderCompactFlowPanel();
    showScreen('home');
  }

  function handleCategorySelection(categoryName) {
    const categoryConfig = getCategoryConfig();
    state.selectedCategory = categoryName;
    if (isCompactFlowMode()) {
      state.selectedSubcategory = null;
      state.compactFlow.editingCategory = false;
      state.compactFlow.editingTemplate = true;
      showScreen('form');
      setCompactCategory(categoryName, { collapseCategory: true, focusTemplate: true });
      return;
    }
    renderSubcategoryList(categoryName);
    showScreen('subcategory');
  }

  function openForm(categoryName, subcategoryName) {
    state.selectedCategory = categoryName;
    state.selectedSubcategory = subcategoryName;
    state.compactFlow.editingCategory = false;
    state.compactFlow.editingTemplate = false;

    clearGenerationValidation();
    renderCompactFlowPanel();
    updateFormHeaderForSelection();
    renderDynamicFields();
    resetRunModeOverride();
    showScreen('form');
  }

  function resolveTemplateSelectionFromEntry(entry = {}) {
    const categoryConfig = getCategoryConfig();
    const categoryName = String(entry.handlungsfeld || '').trim();
    const subcategoryName = String(entry.unterkategorie || '').trim();
    const templateId = String(entry.templateId || '').trim();

    const hasDirectMapping = !!categoryName
      && !!subcategoryName
      && !!categoryConfig[categoryName]
      && (categoryConfig[categoryName].unterkategorien || []).includes(subcategoryName);
    if (hasDirectMapping) {
      return { categoryName, subcategoryName };
    }

    if (!templateId) return null;
    for (const [candidateCategory, cfg] of Object.entries(categoryConfig)) {
      for (const candidateSubcategory of (cfg?.unterkategorien || [])) {
        const template = cfg?.templates?.[candidateSubcategory];
        const candidateId = String(template?.id || `${candidateCategory}:${candidateSubcategory}`).trim();
        if (candidateId === templateId) {
          return {
            categoryName: candidateCategory,
            subcategoryName: candidateSubcategory,
          };
        }
      }
    }
    return null;
  }

  function openLibraryEntry(entry = {}) {
    const resolvedSelection = resolveTemplateSelectionFromEntry(entry);
    if (!resolvedSelection) {
      emitNotice('Der gespeicherte Bibliothekseintrag kann nicht mehr auf ein vorhandenes Template gemappt werden.', 'error');
      return false;
    }
    const { categoryName, subcategoryName } = resolvedSelection;

    openForm(categoryName, subcategoryName);
    const snapshot = entry.formSnapshot && typeof entry.formSnapshot === 'object'
      ? (entry.formSnapshot.values ? entry.formSnapshot : { values: entry.formSnapshot, activeId: null })
      : null;
    if (snapshot) {
      restorePromptFormValues(snapshot);
    } else {
      if (el('fach')) el('fach').value = String(entry.fach || '');
      if (el('schulstufe')) el('schulstufe').value = String(entry.schulstufe || '');
      if (el('ziel')) el('ziel').value = String(entry.ziel || '');
    }
    setRunModeToggle(entry.generationMode === 'result' ? 'result' : getGlobalGenerationMode());
    setGenerationStatus('Template aus Bibliothek geladen. Eingaben prüfen und neu generieren.', 'ok');
    return true;
  }

  function openHistoryEntry(entry = {}) {
    const resolvedSelection = resolveTemplateSelectionFromEntry(entry);
    if (!resolvedSelection) {
      emitNotice('Der Verlaufseintrag enthält kein gültiges Template-Mapping.', 'error');
      return false;
    }
    const { categoryName, subcategoryName } = resolvedSelection;

    openForm(categoryName, subcategoryName);
    const snapshot = entry.formSnapshot && typeof entry.formSnapshot === 'object'
      ? (entry.formSnapshot.values ? entry.formSnapshot : { values: entry.formSnapshot, activeId: null })
      : null;
    if (snapshot && Object.keys(snapshot.values || {}).length) {
      restorePromptFormValues(snapshot);
    } else {
      if (el('fach')) el('fach').value = String(entry.fach || '');
      if (el('schulstufe')) el('schulstufe').value = String(entry.schulstufe || '');
      if (el('ziel')) el('ziel').value = String(entry.ziel || '');
    }
    setRunModeToggle(entry.generationMode === 'result' ? 'result' : getGlobalGenerationMode());
    setGenerationStatus('Verlaufseintrag geladen. Eingaben prüfen und neu generieren.', 'ok');
    return true;
  }

  function buildHistoryEntryPayload(context, generation = {}, formSnapshot = null) {
    const metapromptProvider = generation?.providers?.metaprompt || generation?.provider || null;
    const mode = String(generation?.mode || getRunGenerationMode()).trim() === 'result' ? 'result' : 'prompt';
    const snapshot = formSnapshot && typeof formSnapshot === 'object'
      ? formSnapshot
      : snapshotPromptFormValues();
    const metapromptText = String(generation?.metaprompt || '').trim() || state.generatedMetaPrompt || '';
    const resultText = String(generation?.resultOutput || '').trim() || state.generatedResult || '';
    return {
      fach: context.baseFields.fach,
      handlungsfeld: context.baseFields.handlungsfeld,
      unterkategorie: context.baseFields.unterkategorie,
      schulstufe: context.baseFields.schulstufe || '',
      ziel: context.baseFields.ziel || '',
      templateId: context.template?.id || generation?.templateId || null,
      providerKind: metapromptProvider?.kind || null,
      providerModel: metapromptProvider?.model || null,
      generationMode: mode,
      formSnapshot: snapshot,
      metapromptText,
      resultText,
      hasResult: mode === 'result' && Boolean(resultText.trim()),
    };
  }

  function syncAdvancedSectionUi() {
    const area = el('advanced-fields');
    const button = el('toggle-advanced');
    const hint = el('advanced-section-hint');
    if (!area || !button) return;
    const expanded = !area.classList.contains('is-hidden');
    button.textContent = expanded ? '▲ Optionen ausblenden' : '▼ Optionen einblenden';
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (hint) {
      hint.textContent = expanded
        ? 'Diese Sektion ist aktuell eingeblendet.'
        : 'Diese Sektion ist aktuell ausgeblendet. Klicke auf "Optionen einblenden".';
    }
  }

  function toggleAdvancedSection() {
    const area = el('advanced-fields');
    if (!area) return;
    area.classList.toggle('is-hidden');
    syncAdvancedSectionUi();
  }

  function buildGenerationRequestPayload(context, providerId, generationMode) {
    const mode = generationMode === 'result' ? 'result' : 'prompt';
    const configuredResultProviderId = String(state.settings?.resultProviderId || '').trim();
    const effectiveResultProviderId = configuredResultProviderId || providerId;
    return {
      providerId,
      resultProviderId: effectiveResultProviderId,
      generationMode: mode,
      templateId: context.template?.id,
      categoryName: context.baseFields.handlungsfeld,
      subcategoryName: context.baseFields.unterkategorie,
      baseFields: context.baseFields,
      dynamicValues: context.dynamicValues,
      metapromptOverride: context.metapromptOverride || undefined,
      templateOverride: context.oneoff.templateOverride,
      saveOverrideAsPersonal: context.oneoff.saveOverrideAsPersonal,
      saveOverrideTitleSuffix: context.oneoff.saveOverrideTitleSuffix,
    };
  }

  function buildResultMetadataEntries(generation = {}) {
    const mode = String(generation?.mode || 'prompt').trim() || 'prompt';
    const metapromptProvider = generation?.providers?.metaprompt || generation?.provider || null;
    const resultProvider = generation?.providers?.result || null;
    const entries = [];

    if (metapromptProvider) {
      entries.push({
        label: 'Metaprompt-Provider',
        value: `${metapromptProvider.name} (${metapromptProvider.kind}, ${metapromptProvider.model})`,
      });
      entries.push({
        label: 'Metaprompt Key-Quelle',
        value: metapromptProvider.keySource || '-',
      });
    }
    entries.push({
      label: 'Template-ID',
      value: generation.templateId || '-',
    });
    entries.push({
      label: 'Generierungsmodus',
      value: mode === 'result' ? 'Direktes Ergebnis' : 'Prompt',
    });

    if (mode === 'result' && resultProvider) {
      entries.push({
        label: 'Result-Provider',
        value: `${resultProvider.name} (${resultProvider.kind}, ${resultProvider.model})`,
      });
      entries.push({
        label: 'Result Key-Quelle',
        value: resultProvider.keySource || '-',
      });
    }

    const budgetWarnings = Array.isArray(generation?.budget?.warnings) ? generation.budget.warnings : [];
    if (budgetWarnings.length) {
      entries.push({
        label: 'Budget-Hinweise',
        value: `${budgetWarnings.length} Hinweis(e) im Lauf`,
      });
    }
    return entries;
  }

  function renderResultMetadataPanel(generation = {}) {
    const panel = el('result-metadata-panel');
    const list = el('result-metadata-list');
    if (!panel || !list) return;
    const entries = buildResultMetadataEntries(generation);
    if (!entries.length) {
      panel.classList.add('is-hidden');
      list.innerHTML = '';
      return;
    }
    list.innerHTML = entries
      .map((entry) => `<li><strong>${entry.label}:</strong> <span>${entry.value}</span></li>`)
      .join('');
    panel.classList.remove('is-hidden');
  }

  function applyGenerationResult(generation, context, { priorPrompt = null, formSnapshot = null } = {}) {
    const mode = String(generation?.mode || '').trim() || 'prompt';
    const metapromptProvider = generation?.providers?.metaprompt || generation.provider;
    const resultProvider = generation?.providers?.result || null;
    const handoffPrompt = String(generation?.handoffPrompt || generation?.output || '').trim();
    const directResult = String(generation?.resultOutput || '').trim();
    const providerMeta = metapromptProvider
      ? `Metaprompt-Provider: ${metapromptProvider.name} (${metapromptProvider.kind}, ${metapromptProvider.model}) | Key-Quelle: ${metapromptProvider.keySource} | Template: ${generation.templateId}`
      : `Template: ${generation.templateId}`;
    const resultMeta = resultProvider
      ? `Result-Provider: ${resultProvider.name} (${resultProvider.kind}, ${resultProvider.model}) | Key-Quelle: ${resultProvider.keySource}`
      : '';

    const previousPromptValue = priorPrompt !== null ? String(priorPrompt || '') : (state.generatedPrompt || '');
    state.previousGeneratedPrompt = previousPromptValue;
    state.generatedMetaPrompt = String(generation?.metaprompt || '').trim();
    state.generatedPrompt = handoffPrompt;
    state.generatedResult = directResult;
    state.generatedMeta = providerMeta;
    state.generatedMetaDetails = {
      mode,
      templateId: generation.templateId,
      providers: generation.providers || null,
      provider: generation.provider || null,
      budget: generation.budget || null,
    };
    state.lastGenerationPayload = generation;
    state.lastGenerationFormSnapshot = formSnapshot || snapshotPromptFormValues();
    state.lastPromptContext = {
      fach: context.baseFields.fach,
      handlungsfeld: context.baseFields.handlungsfeld,
      unterkategorie: context.baseFields.unterkategorie,
      schulstufe: context.baseFields.schulstufe,
      ziel: context.baseFields.ziel,
    };

    el('result').value = handoffPrompt;
    el('result-meta').textContent = providerMeta;
    setResultUsageSummary(generation?.usageStages?.metaprompt || generation.usage || null);
    setResultCostSummary(generation?.costStages?.metaprompt || generation.cost || null);
    const directPanel = el('result-direct-panel');
    if (directPanel) directPanel.classList.toggle('is-hidden', !(mode === 'result' && directResult));
    if (el('result-direct-output')) el('result-direct-output').value = directResult;
    if (el('result-direct-meta')) el('result-direct-meta').textContent = resultMeta;
    setUsageSummary('result-direct', generation?.usageStages?.result || null);
    setCostSummary('result-direct', generation?.costStages?.result || null);
    if (el('result-detail-handlungsfeld')) el('result-detail-handlungsfeld').textContent = normalizeUiText(context.baseFields.handlungsfeld || '-');
    if (el('result-detail-unterkategorie')) el('result-detail-unterkategorie').textContent = normalizeUiText(context.baseFields.unterkategorie || '-');
    if (el('result-detail-fach')) el('result-detail-fach').textContent = context.baseFields.fach || '-';
    if (el('result-detail-schulstufe')) el('result-detail-schulstufe').textContent = context.baseFields.schulstufe || '-';
    renderResultMetadataPanel(generation);
    setProgressBarValue('result-progress-meta-bar', 100);
    setProgressLabel('result-progress-meta-status', 'Metaprompt abgeschlossen.', 'ok');
    if (mode === 'result') {
      setProgressBarValue('result-progress-direct-bar', 100);
      setProgressLabel('result-progress-direct-status', 'Direktes Ergebnis abgeschlossen.', 'ok');
      setResultReadyBanner('Metaprompt und direktes Ergebnis sind bereit.', 'ok');
    } else {
      setResultReadyBanner('Dein KI-Prompt ist bereit.', 'ok');
    }
    el('library-title').value = `${normalizeUiText(context.baseFields.unterkategorie)} - ${context.baseFields.fach}`;
    el('save-library-status').textContent = '';
    el('result-compare-panel').classList.add('is-hidden');
    el('result-compare-current').value = state.generatedPrompt || '';
    el('result-compare-previous').value = state.previousGeneratedPrompt || 'Keine vorherige Generation vorhanden.';

    if (generation.savedVariantTemplateId) {
      el('result-variant-status').textContent = `Template-Variante gespeichert: ${generation.savedVariantTemplateId}`;
      el('btn-open-templates-from-result').classList.remove('is-hidden');
    } else {
      el('result-variant-status').textContent = '';
      el('btn-open-templates-from-result').classList.add('is-hidden');
    }
  }

  async function generatePromptLegacy(context, activeProvider, formSnapshot = null) {
    const priorPrompt = state.generatedPrompt || '';
    const runMode = getRunGenerationMode();
    let stage = 'metaprompt';
    resetResultProgress(runMode);
    setGenerating(
      true,
      context.metapromptOverride
        ? `Schritt 1/${runMode === 'result' ? '5' : '4'}: Bearbeitete Metaprompt wird vorbereitet...`
        : `Schritt 1/${runMode === 'result' ? '5' : '4'}: Metaprompt wird aus Template-Daten erstellt...`
    );
    updateResultProgress('metaprompt', 'Metaprompt wird vorbereitet…', runMode);

    try {
      stage = 'provider_call';
      setGenerationStatus(
        `Schritt 2/${runMode === 'result' ? '5' : '4'}: Anfrage an ${activeProvider.name} (${activeProvider.model}) wird gesendet...`,
        'info'
      );
      updateResultProgress(stage, `Anfrage an ${activeProvider.name} wird gesendet…`, runMode);
      const generation = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify(buildGenerationRequestPayload(context, activeProvider.id, runMode)),
      });

      stage = 'postprocess';
      setGenerationStatus(`Schritt ${runMode === 'result' ? '4/5' : '3/4'}: Provider-Antwort wird verarbeitet und Ergebnis aufbereitet...`, 'info');
      updateResultProgress(stage, 'Metaprompt wird finalisiert…', runMode);
      applyGenerationResult(generation, context, { priorPrompt, formSnapshot });

      stage = 'finalize';
      setGenerationStatus(`Schritt ${runMode === 'result' ? '5/5' : '4/4'}: Verlauf und Discovery werden aktualisiert...`, 'info');
      updateResultProgress(stage, 'Abschluss läuft…', runMode);
      await saveHistory(buildHistoryEntryPayload(context, generation, formSnapshot));
      await refreshTemplateDiscovery();
      setGenerating(false, 'Generierung abgeschlossen.');
      resetRunModeOverride();
      showScreen('result');
    } catch (error) {
      const stageLabel = {
        input: 'Eingabe',
        metaprompt: 'Metaprompt-Aufbau',
        provider_call: 'Provider-Aufruf',
        postprocess: 'Antwortverarbeitung',
        finalize: 'Abschluss',
      }[stage] || 'Generierung';
      updateResultProgress('error', `Fehler: ${error.message}`, runMode);
      setResultReadyBanner('', 'error');
      setGenerating(false, `Fehler (${stageLabel}): ${error.message}`);
      resetRunModeOverride();
      throw error;
    }
  }

  async function generatePrompt(event) {
    event.preventDefault();
    const context = collectGenerationContext({ validate: true });
    if (!context) return;
    const generationFormSnapshot = snapshotPromptFormValues();
    const runMode = getRunGenerationMode();

    const metapromptProviderId = String(state.settings?.metapromptProviderId || state.activeId || '').trim();
    const activeProvider = state.providers.find((provider) => provider.id === metapromptProviderId)
      || state.providers.find((provider) => provider.id === state.activeId);
    if (!activeProvider) {
      setGenerationValidation(
        ['Kein aktiver Provider ausgewählt. Bitte im Dashboard unter API-Provider einen Key aktivieren.'],
        'Generierung nicht möglich'
      );
      setGenerationStatus('Bitte zuerst einen aktiven Provider auswählen.', 'error');
      emitNotice('Bitte zuerst einen aktiven Provider auswählen.', 'error');
      return;
    }
    state.activeId = activeProvider.id;

    if (typeof apiStream !== 'function') {
      await generatePromptLegacy(context, activeProvider, generationFormSnapshot);
      return;
    }

    const priorPrompt = state.generatedPrompt || '';
    let streamError = null;
    let stage = 'metaprompt';
    let streamDonePayload = null;
    let streamHandoffDraft = '';
    let streamResultDraft = '';

    clearGenerationValidation();
    setGenerating(true, `Schritt 1/${runMode === 'result' ? '5' : '4'}: Metaprompt wird vorbereitet...`);
    showScreen('result');
    resetResultProgress(runMode);
    updateResultProgress('metaprompt', 'Metaprompt wird vorbereitet…', runMode);
    state.generatedPrompt = '';
    state.generatedResult = '';
    state.generatedMetaPrompt = '';
    state.generatedMetaDetails = null;
    state.lastGenerationPayload = null;
    el('result').value = '';
    if (el('result-direct-output')) el('result-direct-output').value = '';
    el('result-meta').textContent = 'Generierung gestartet...';
    if (el('result-direct-meta')) el('result-direct-meta').textContent = runMode === 'result'
      ? 'Direktes Ergebnis wird vorbereitet...'
      : '';
    if (el('result-direct-panel')) el('result-direct-panel').classList.toggle('is-hidden', runMode !== 'result');
    setResultUsageSummary(null);
    setResultCostSummary(null);
    setUsageSummary('result-direct', null);
    setCostSummary('result-direct', null);
    el('result-variant-status').textContent = '';
    el('btn-open-templates-from-result').classList.add('is-hidden');
    el('save-library-status').textContent = '';
    if (el('result-metadata-panel')) el('result-metadata-panel').classList.add('is-hidden');
    if (el('result-metadata-list')) el('result-metadata-list').innerHTML = '';

    try {
      await apiStream('/api/generate/stream', {
        method: 'POST',
        body: JSON.stringify(buildGenerationRequestPayload(context, activeProvider.id, runMode)),
        onEvent: (payload) => {
          const eventName = String(payload?.event || '').trim();
          if (!eventName) return;

          if (eventName === 'status') {
            stage = String(payload.stage || stage || '').trim() || stage;
            const statusMessage = String(payload.message || '').trim();
            setGenerationStatus(statusMessage, 'info');
            updateResultProgress(stage, statusMessage, runMode);
            if (statusMessage) {
              if (stage === 'result_provider_call' && el('result-direct-meta')) {
                el('result-direct-meta').textContent = statusMessage;
              } else {
                el('result-meta').textContent = statusMessage;
              }
            }
            return;
          }

          if (eventName === 'handoff_delta' || eventName === 'output_delta') {
            const delta = typeof payload.delta === 'string' ? payload.delta : '';
            if (!delta) return;
            streamHandoffDraft += delta;
            const resultNode = el('result');
            resultNode.value = streamHandoffDraft;
            resultNode.scrollTop = resultNode.scrollHeight;
            const metaBar = el('result-progress-meta-bar');
            const currentProgress = Number(metaBar?.dataset.progress || 0);
            if (Number.isFinite(currentProgress) && currentProgress < 86) {
              setProgressBarValue('result-progress-meta-bar', Math.min(86, currentProgress + 1));
            }
            return;
          }

          if (eventName === 'handoff_replace' || eventName === 'output_replace') {
            const output = typeof payload.output === 'string' ? payload.output : '';
            streamHandoffDraft = output;
            el('result').value = output;
            return;
          }

          if (eventName === 'result_delta') {
            const delta = typeof payload.delta === 'string' ? payload.delta : '';
            if (!delta) return;
            streamResultDraft += delta;
            const resultNode = el('result-direct-output');
            if (!resultNode) return;
            resultNode.value = streamResultDraft;
            resultNode.scrollTop = resultNode.scrollHeight;
            const directBar = el('result-progress-direct-bar');
            const currentProgress = Number(directBar?.dataset.progress || 0);
            if (Number.isFinite(currentProgress) && currentProgress < 95) {
              setProgressBarValue('result-progress-direct-bar', Math.min(95, currentProgress + 1));
            }
            return;
          }

          if (eventName === 'result_replace') {
            const output = typeof payload.output === 'string' ? payload.output : '';
            streamResultDraft = output;
            if (el('result-direct-output')) el('result-direct-output').value = output;
            return;
          }

          if (eventName === 'done') {
            streamDonePayload = payload;
            return;
          }

          if (eventName === 'error') {
            streamError = new Error(String(payload.message || 'Unbekannter Streaming-Fehler.'));
            const streamStage = String(payload.stage || stage || '').trim();
            if (streamStage) streamError.stage = streamStage;
          }
        },
      });
      if (streamError) throw streamError;
      if (!streamDonePayload) {
        throw new Error('Streaming-Antwort unvollständig. Bitte erneut versuchen.');
      }

      stage = 'postprocess';
      applyGenerationResult(streamDonePayload, context, {
        priorPrompt,
        formSnapshot: generationFormSnapshot,
      });

      stage = 'finalize';
      await saveHistory(buildHistoryEntryPayload(context, streamDonePayload, generationFormSnapshot));
      await refreshTemplateDiscovery();
      setGenerating(false, 'Generierung abgeschlossen.');
      resetRunModeOverride();
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      const missingStreamEndpoint = Number(error?.status) === 404
        || message.includes('cannot post /api/generate/stream')
        || message.includes('not found');
      if (missingStreamEndpoint && stage === 'metaprompt') {
        setGenerationStatus('Streaming-Endpunkt nicht verfügbar, wechsle auf Standard-Generierung...', 'info');
        await generatePromptLegacy(context, activeProvider, generationFormSnapshot);
        return;
      }

      const stageLabel = {
        input: 'Eingabe',
        metaprompt: 'Metaprompt-Aufbau',
        provider_call: 'Provider-Aufruf',
        result_provider_call: 'Result-Provider-Aufruf',
        postprocess: 'Antwortverarbeitung',
        finalize: 'Abschluss',
      }[stage] || 'Generierung';
      updateResultProgress('error', `Fehler: ${error.message}`, runMode);
      setResultReadyBanner('', 'error');
      setGenerating(false, `Fehler (${stageLabel}): ${error.message}`);
      resetRunModeOverride();
      throw error;
    }
  }

  function buildCopyText(includeMetadata) {
    if (!includeMetadata || !state.generatedMeta) return state.generatedPrompt;
    const entries = buildResultMetadataEntries(state.lastGenerationPayload || {});
    if (!entries.length) {
      return `${state.generatedPrompt}\n\n---\n${state.generatedMeta}`;
    }
    const details = entries
      .map((entry) => `- ${entry.label}: ${entry.value}`)
      .join('\n');
    return `${state.generatedPrompt}\n\n---\nMetadata (technischer Laufkontext, kein Inhaltsteil des Prompts):\n${details}`;
  }

  function copyTextWithFeedback(text, buttonId) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const button = el(buttonId);
      const original = button.textContent;
      button.textContent = 'Kopiert';
      setTimeout(() => {
        button.textContent = original;
      }, 1100);
    });
  }

  function copyPromptClean() {
    copyTextWithFeedback(buildCopyText(false), 'copy-prompt-clean');
  }

  function copyPromptWithMetadata() {
    copyTextWithFeedback(buildCopyText(true), 'copy-prompt-meta');
  }

  function copyDirectResult() {
    const content = readRawValue('result-direct-output').trim();
    if (!content) return;
    copyTextWithFeedback(content, 'copy-result-direct');
  }

  function copyMetapromptPreview() {
    const content = readRawValue('metaprompt-preview').trim();
    if (!content) return;
    copyTextWithFeedback(content, 'copy-metaprompt-preview');
  }

  function toggleComparePanel() {
    const panel = el('result-compare-panel');
    const willShow = panel.classList.contains('is-hidden');
    panel.classList.toggle('is-hidden', !willShow);
    el('result-compare-current').value = state.generatedPrompt || '';
    el('result-compare-previous').value = state.previousGeneratedPrompt || 'Keine vorherige Generation vorhanden.';
  }

  function exportPrompt(kind) {
    const content = state.generatedPrompt;
    if (!content) return;
    const extension = kind === 'md' ? 'md' : 'txt';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `prompt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(anchor.href);
  }

  function setupAdvancedPresets() {
    const presetOptions = getPresetOptions();
    setupPresetSelect('zeitrahmen-select', 'zeitrahmen-custom', presetOptions.zeitrahmen, { includeRange: true });
    setupPresetSelect('niveau-select', 'niveau-custom', presetOptions.niveau);
    setupPresetSelect('rahmen-select', 'rahmen-custom', presetOptions.rahmen);
    setupPresetSelect('ergebnisformat-select', 'ergebnisformat-custom', presetOptions.ergebnisformat);
    setupPresetSelect('ton-select', 'ton-custom', presetOptions.ton);
  }

  function bindEvents() {
    const promptForm = el('prompt-form');
    if (promptForm) {
      promptForm.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        target.classList.remove('field-invalid');
        const wrap = target.closest('label');
        if (wrap) wrap.classList.remove('field-invalid');
      });
      promptForm.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        target.classList.remove('field-invalid');
        const wrap = target.closest('label');
        if (wrap) wrap.classList.remove('field-invalid');
      });
    }

    const flowCategorySelect = el('flow-category-select');
    const flowTemplateSelect = el('flow-template-select');
    const flowEditCategory = el('flow-edit-category');
    const flowEditTemplate = el('flow-edit-template');

    if (flowCategorySelect) {
      flowCategorySelect.addEventListener('change', () => {
        setCompactCategory(flowCategorySelect.value, { collapseCategory: true, focusTemplate: true });
      });
    }
    if (flowTemplateSelect) {
      flowTemplateSelect.addEventListener('change', () => {
        setCompactTemplate(flowTemplateSelect.value, { collapse: true });
      });
    }
    if (flowEditCategory) {
      flowEditCategory.addEventListener('click', () => {
        state.compactFlow.editingCategory = true;
        state.compactFlow.editingTemplate = false;
        renderCompactFlowPanel();
        const node = el('flow-category-select');
        if (node) node.focus();
      });
    }
    if (flowEditTemplate) {
      flowEditTemplate.addEventListener('click', () => {
        state.compactFlow.editingTemplate = true;
        renderCompactFlowPanel();
        const node = el('flow-template-select');
        if (node) node.focus();
      });
    }

    el('oneoff-enable').addEventListener('change', () => {
      el('oneoff-fields').classList.toggle('is-hidden', !el('oneoff-enable').checked);
    });

    el('toggle-advanced').addEventListener('click', toggleAdvancedSection);
    syncAdvancedSectionUi();

    el('btn-preview-metaprompt').addEventListener('click', () => previewMetaprompt().catch((error) => {
      setPreviewStatus(`Fehler: ${error.message}`, 'error');
      emitNotice(error.message, 'error');
    }));
    el('copy-metaprompt-preview').addEventListener('click', copyMetapromptPreview);

    el('copy-prompt-clean').addEventListener('click', copyPromptClean);
    el('copy-prompt-meta').addEventListener('click', copyPromptWithMetadata);
    if (el('copy-result-direct')) {
      el('copy-result-direct').addEventListener('click', copyDirectResult);
    }
    el('btn-compare-last').addEventListener('click', toggleComparePanel);

    el('home-template-search-btn').addEventListener('click', () => {
      const search = el('home-template-search').value.trim();
      refreshTemplateDiscovery({ search }).catch((error) => emitNotice(error.message, 'error'));
    });
    el('home-template-reset-btn').addEventListener('click', () => {
      el('home-template-search').value = '';
      refreshTemplateDiscovery({ search: '', tags: [] }).catch((error) => emitNotice(error.message, 'error'));
    });
    el('home-template-search').addEventListener('focus', () => {
      state.templateDiscovery.tagPickerOpen = true;
      syncTagChipVisibility();
    });
    el('home-template-search').addEventListener('blur', () => {
      window.setTimeout(() => {
        state.templateDiscovery.tagPickerOpen = false;
        syncTagChipVisibility();
      }, 100);
    });
    el('home-template-search').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const search = el('home-template-search').value.trim();
      refreshTemplateDiscovery({ search }).catch((error) => emitNotice(error.message, 'error'));
    });
    if (el('subcat-view-grid')) {
      el('subcat-view-grid').addEventListener('click', () => setSubcategoryViewMode('grid'));
    }
    if (el('subcat-view-list')) {
      el('subcat-view-list').addEventListener('click', () => setSubcategoryViewMode('list'));
    }
    if (el('run-mode-result-toggle')) {
      el('run-mode-result-toggle').addEventListener('change', syncRunModeUi);
    }

    syncFlowModeUi();
    applySubcategoryViewMode();
    resetRunModeOverride();
  }

  return {
    bindEvents,
    renderCategoryGrid,
    refreshTemplateDiscovery,
    resetTaskState,
    generatePrompt,
    previewMetaprompt,
    copyPromptClean,
    copyPromptWithMetadata,
    toggleComparePanel,
    exportPrompt,
    setupAdvancedPresets,
    syncAdvancedSectionUi,
    syncFlowModeUi,
    openLibraryEntry,
    openHistoryEntry,
  };
}

export { createTaskController };
