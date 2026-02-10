function createTaskController({
  state,
  el,
  api,
  getCategoryConfig,
  getPresetOptions,
  showScreen,
  saveHistory,
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
    activeTag: '',
  };
  state.templateCoverageAudit = state.templateCoverageAudit || { issues: [] };
  state.previousGeneratedPrompt = state.previousGeneratedPrompt || '';

  function csvToArray(value = '') {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
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
    const options = Array.isArray(values) ? [...values] : [];
    if (!options.includes('__custom__')) options.push('__custom__');
    if (includeRange && !options.includes('__range__')) {
      const customIndex = options.indexOf('__custom__');
      if (customIndex >= 0) options.splice(customIndex, 0, '__range__');
      else options.push('__range__');
    }

    select.innerHTML = options
      .map((value) => {
        if (!value) return '<option value="">Bitte waehlen...</option>';
        if (value === '__range__') return '<option value="__range__">Von - bis</option>';
        if (value === '__custom__') return '<option value="__custom__">Custom...</option>';
        return `<option value="${value}">${value}</option>`;
      })
      .join('');

    const rangeWrap = includeRange ? el('zeitrahmen-range-wrap') : null;
    const rangeStart = includeRange ? el('zeitrahmen-range-start') : null;
    const rangeEnd = includeRange ? el('zeitrahmen-range-end') : null;

    const syncCustomState = () => {
      const isCustom = select.value === '__custom__';
      const isRange = includeRange && select.value === '__range__';
      if (customWrap) customWrap.classList.toggle('is-hidden', !isCustom || !!isRange);
      if (customInput) {
        customInput.disabled = !isCustom || !!isRange;
        customInput.required = isCustom;
        customInput.placeholder = isCustom
          ? 'Eigener Wert'
          : 'Nur bei Custom aktiv';
      }

      if (includeRange && rangeWrap && rangeStart && rangeEnd) {
        rangeWrap.classList.toggle('is-hidden', !isRange);
        rangeStart.disabled = !isRange;
        rangeEnd.disabled = !isRange;
        rangeStart.required = isRange;
        rangeEnd.required = isRange;
      }
    };

    select.addEventListener('change', syncCustomState);
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
    if (type === 'textarea') return 'Nutze Stichpunkte oder kurze Saetze mit konkreten Angaben.';
    if (type === 'select') return 'Waehle eine Option oder nutze einen eigenen Wert.';
    if (type === 'multiselect') return 'Mehrere Optionen moeglich; eigene Werte koennen ergaenzt werden.';
    if (type === 'checkbox') return 'Aktivieren, wenn fuer den Prompt relevant.';
    return 'Kurze, konkrete Angabe fuer den Prompt-Kontext.';
  }

  function allowsCustomDynamicValue(field = {}) {
    const type = String(field.type || '').toLowerCase();
    if (type !== 'select' && type !== 'multiselect') return false;
    if (field.allowCustom === false) return false;
    return true;
  }

  function setHomeDiscoveryStatus(text = '') {
    el('home-discovery-status').textContent = text;
  }

  function setGenerationStatus(text = '', type = 'info') {
    const node = el('generation-status');
    node.textContent = text;
    node.dataset.type = type;
  }

  function setGenerating(isGenerating, text = '') {
    const button = el('generate-submit');
    button.disabled = isGenerating;
    button.textContent = isGenerating ? 'Generiere...' : 'Prompt generieren';
    setGenerationStatus(text, isGenerating ? 'info' : 'ok');
  }

  function setPreviewStatus(text = '', type = 'info') {
    const node = el('metaprompt-preview-status');
    node.textContent = text;
    node.dataset.type = type;
  }

  function renderCategoryGrid() {
    auditTemplateCoverageOnce();
    const categoryConfig = getCategoryConfig();
    const grid = el('category-grid');
    const categoryNames = Object.keys(categoryConfig);
    grid.innerHTML = categoryNames
      .map((categoryName) => {
        const cfg = categoryConfig[categoryName];
        const icon = CATEGORY_ICONS[categoryName] || 'article';
        const tone = CATEGORY_ICON_TONES[categoryName] || 'bg-slate-100 text-slate-600';
        return `
        <button type="button" class="tw-home-category-card group" data-category="${categoryName}">
          <div class="tw-home-category-head">
            <span class="tw-home-category-icon ${tone}" aria-hidden="true">
              <span class="material-icons-round text-3xl">${icon}</span>
            </span>
            <span class="tw-home-category-kicker">${cfg.short}</span>
          </div>
          <strong class="tw-home-category-title group-hover:text-primary transition-colors">${cfg.title}</strong>
          <span class="tw-home-category-desc">${cfg.description}</span>
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
        toggleTemplateFavorite(button.dataset.favTemplate, !favorite).catch((error) => alert(error.message));
      });
    });
  }

  function renderTagChips(templates = []) {
    const counts = new Map();
    templates.forEach((template) => {
      (template.tags || []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    const topTags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);

    const active = state.templateDiscovery.activeTag;
    const chips = [
      `<button type="button" class="tw-home-chip ${!active ? 'tw-home-chip-active' : ''}" data-tag-chip="">Alle</button>`,
      ...topTags.map(([tag, count]) => `<button type="button" class="tw-home-chip ${active === tag ? 'tw-home-chip-active' : ''}" data-tag-chip="${tag}">${tag} (${count})</button>`),
    ];

    el('home-tag-chips').innerHTML = chips.join('');
    el('home-tag-chips').querySelectorAll('[data-tag-chip]').forEach((button) => {
      button.addEventListener('click', () => {
        const tag = button.dataset.tagChip || '';
        refreshTemplateDiscovery({ tag }).catch((error) => alert(error.message));
      });
    });
  }

  function renderTemplateDiscovery() {
    const templates = Array.isArray(state.templateDiscovery.templates)
      ? state.templateDiscovery.templates
      : [];

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
    renderQuickTemplateList('home-recommended-list', recommended, 'Noch keine Empfehlungen verfuegbar.');
    renderQuickTemplateList('home-recent-list', recent, 'Noch keine zuletzt genutzten Templates.');
    renderQuickTemplateList('home-favorites-list', favorites, 'Noch keine Favoriten markiert.');
    setHomeDiscoveryStatus(`${templates.length} sichtbare Templates geladen.`);
  }

  async function refreshTemplateDiscovery({
    search = state.templateDiscovery.search,
    tag = state.templateDiscovery.activeTag,
  } = {}) {
    const params = new URLSearchParams();
    const normalizedSearch = String(search || '').trim();
    const normalizedTag = String(tag || '').trim();
    if (normalizedSearch) params.set('search', normalizedSearch);
    if (normalizedTag) params.set('tag', normalizedTag);

    setHomeDiscoveryStatus('Lade Template-Discovery...');
    const payload = await api(`/api/templates${params.toString() ? `?${params.toString()}` : ''}`);
    state.templateDiscovery.templates = Array.isArray(payload.templates) ? payload.templates : [];
    state.templateDiscovery.search = normalizedSearch;
    state.templateDiscovery.activeTag = normalizedTag;
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
      alert('Template nicht gefunden. Bitte Discovery aktualisieren.');
      return;
    }
    openForm(entry.categoryName, entry.subcategoryName);
  }

  function renderSubcategoryList(categoryName) {
    const categoryConfig = getCategoryConfig();
    const cfg = categoryConfig[categoryName];
    el('selected-category-title').textContent = cfg.title;
    el('selected-category-desc').textContent = cfg.description;
    el('subcategory-list').innerHTML = cfg.unterkategorien
      .map(
        (subcategory) => {
          const template = getTemplateConfig(categoryName, subcategory);
          const discoveryEntry = (state.templateDiscovery.templates || []).find((entry) => (
            entry.categoryName === categoryName && entry.subcategoryName === subcategory
          ));
          const short = getCategoryShort(categoryName);
          return `
            <div class="list-card subcategory-card-item clickable-card" data-subcategory="${subcategory}" role="button" tabindex="0" aria-label="${subcategory} auswaehlen">
              <div class="quick-template-head">
                <span class="quick-template-title-wrap">
                  <span class="mini-icon">${short}</span>
                  <strong>${subcategory}</strong>
                </span>
                <button type="button" class="text-btn small" data-fav-template="${discoveryEntry?.templateUid || ''}" data-fav-state="${discoveryEntry?.isFavorite ? '1' : '0'}">${discoveryEntry?.isFavorite ? '★' : '☆'}</button>
              </div>
              <span class="hint">${template?.description || cfg.description}</span>
            </div>
          `;
        }
      )
      .join('');

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
        toggleTemplateFavorite(templateUid, !favorite).catch((error) => alert(error.message));
      });
    });
  }

  function renderDynamicFields() {
    const template = getTemplateConfig();
    const requiredContainer = el('required-fields-grid');
    const optionalContainer = el('optional-fields-grid');
    if (!requiredContainer || !optionalContainer) return;

    parkBaseFieldWrappers();
    if (requiredContainer) requiredContainer.innerHTML = '';
    if (optionalContainer) optionalContainer.innerHTML = '';

    const templateTitle = state.selectedSubcategory || 'Template';
    const requiredTitle = el('required-panel-title');
    const optionalTitle = el('optional-panel-title');
    if (requiredTitle) requiredTitle.textContent = `${templateTitle} - Pflichtfelder`;
    if (optionalTitle) optionalTitle.textContent = `${templateTitle} - Optionale Felder`;

    const requiredBaseSet = updateBaseFieldRequirements(template, requiredContainer, optionalContainer);

    const fields = Array.isArray(template?.dynamicFields) ? template.dynamicFields : [];
    fields.forEach((field) => {
      const wrap = document.createElement('label');
      wrap.className = field.type === 'checkbox' ? 'checkbox span-2' : '';
      if (field.type !== 'checkbox') wrap.textContent = field.label;
      const allowCustom = allowsCustomDynamicValue(field);

      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        const options = Array.isArray(field.options) ? [...field.options] : [];
        if (allowCustom && !options.includes('__custom__')) options.push('__custom__');
        input.innerHTML = `<option value="">Bitte waehlen...</option>${options
          .map((opt) => {
            if (opt === '__custom__') return '<option value="__custom__">Custom...</option>';
            return `<option value="${opt}">${opt}</option>`;
          })
          .join('')}`;
      } else if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 2;
        input.placeholder = field.placeholder || '';
      } else if (field.type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        const span = document.createElement('span');
        span.textContent = field.label;
        wrap.appendChild(input);
        wrap.appendChild(span);
      } else if (field.type === 'multiselect') {
        input = document.createElement('select');
        input.multiple = true;
        const options = Array.isArray(field.options) ? [...field.options] : [];
        if (allowCustom && !options.includes('__custom__')) options.push('__custom__');
        input.innerHTML = options
          .map((opt) => {
            if (opt === '__custom__') return '<option value="__custom__">Custom...</option>';
            return `<option value="${opt}">${opt}</option>`;
          })
          .join('');
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = field.placeholder || '';
      }

      input.id = `dyn-${field.id}`;
      if (field.required) input.required = true;
      if (field.type !== 'checkbox') wrap.appendChild(input);

      if (field.type !== 'checkbox') {
        const hint = document.createElement('small');
        hint.className = 'hint';
        const explanation = (field.helpText || '').trim() || dynamicFieldDefaultHelp(field);
        const optionHint = Array.isArray(field.options) && field.options.length
          ? `Optionen: ${field.options.join(', ')}`
          : '';
        const requiredHint = field.required ? 'Pflichtfeld.' : 'Optional.';
        const placeholderHint = field.placeholder ? ` Beispiel: ${field.placeholder}` : '';
        const customHint = allowCustom
          ? (field.type === 'multiselect'
            ? ' Eigene Werte (kommagetrennt) sind zusaetzlich moeglich.'
            : ' Eigener Wert ist alternativ moeglich.')
          : '';
        hint.textContent = `${requiredHint} ${explanation}${optionHint ? ` ${optionHint}` : ''}${placeholderHint}${customHint}`;
        wrap.appendChild(hint);
      }

      if (allowCustom && field.type !== 'checkbox') {
        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.id = `dyn-${field.id}-custom`;
        customInput.disabled = true;
        customInput.classList.add('is-hidden');
        customInput.placeholder = field.customPlaceholder
          || (field.type === 'select'
            ? 'Eigener Wert'
            : (field.type === 'multiselect'
            ? 'Weitere Werte (kommagetrennt, optional)'
            : 'Eigener Wert (optional)'));
        wrap.appendChild(customInput);

        const syncCustomVisibility = () => {
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
        };
        input.addEventListener('change', syncCustomVisibility);
        syncCustomVisibility();
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
      ? `Pflichtfelder fuer ${templateTitle}: ${required.join(', ')}`
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
        values[field.id] = node.value.trim();
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
      alert(`Bitte Pflichtfelder ausfuellen: ${missing.join(', ')}`);
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
      alert('Bitte zuerst die Metaprompt-Vorschau erstellen oder die Direktverwendung deaktivieren.');
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
      if (!id || id === 'metaprompt-preview') return;
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
    state.generatedPrompt = '';
    state.generatedMeta = '';
    state.lastPromptContext = null;
    el('prompt-form').reset();
    el('result').value = '';
    el('result-meta').textContent = '';
    el('library-title').value = '';
    el('library-rating').value = '';
    el('library-public').checked = false;
    el('save-library-status').textContent = '';
    el('metaprompt-preview').value = '';
    el('metaprompt-preview-status').textContent = '';
    el('use-preview-metaprompt').checked = false;
    el('generation-status').textContent = '';
    el('result-compare-panel').classList.add('is-hidden');
    el('result-variant-status').textContent = '';
    el('btn-open-templates-from-result').classList.add('is-hidden');
    showScreen('home');
  }

  function handleCategorySelection(categoryName) {
    const categoryConfig = getCategoryConfig();
    state.selectedCategory = categoryName;
    if ((state.settings.flowMode || 'step') === 'single') {
      const defaultSubcategory = categoryConfig[categoryName].unterkategorien[0];
      openForm(categoryName, defaultSubcategory);
      return;
    }
    renderSubcategoryList(categoryName);
    showScreen('subcategory');
  }

  function openForm(categoryName, subcategoryName) {
    const categoryConfig = getCategoryConfig();
    state.selectedCategory = categoryName;
    state.selectedSubcategory = subcategoryName;

    const cfg = categoryConfig[categoryName];
    el('form-category-title').textContent = cfg.title;
    el('form-subcategory-title').textContent = subcategoryName;

    renderDynamicFields();
    showScreen('form');
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

  async function generatePrompt(event) {
    event.preventDefault();
    const context = collectGenerationContext({ validate: true });
    if (!context) return;

    const activeProvider = state.providers.find((provider) => provider.id === state.activeId);
    if (!activeProvider) {
      alert('Bitte zuerst einen aktiven Provider auswaehlen.');
      return;
    }

    setGenerating(
      true,
      context.metapromptOverride
        ? `Bearbeitete Metaprompt wird an ${activeProvider.name} gesendet...`
        : `Metaprompt wird erstellt und an ${activeProvider.name} gesendet...`
    );
    try {
      const generation = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          providerId: activeProvider.id,
          templateId: context.template?.id,
          categoryName: context.baseFields.handlungsfeld,
          subcategoryName: context.baseFields.unterkategorie,
          baseFields: context.baseFields,
          dynamicValues: context.dynamicValues,
          metapromptOverride: context.metapromptOverride || undefined,
          templateOverride: context.oneoff.templateOverride,
          saveOverrideAsPersonal: context.oneoff.saveOverrideAsPersonal,
          saveOverrideTitleSuffix: context.oneoff.saveOverrideTitleSuffix,
        }),
      });

      const providerMeta = `Aktiver Provider: ${generation.provider.name} (${generation.provider.kind}, ${generation.provider.model}) | Key-Quelle: ${generation.provider.keySource} | Template: ${generation.templateId}`;

      state.previousGeneratedPrompt = state.generatedPrompt || '';
      state.generatedPrompt = generation.output;
      state.generatedMeta = providerMeta;
      state.lastPromptContext = {
        fach: context.baseFields.fach,
        handlungsfeld: context.baseFields.handlungsfeld,
        unterkategorie: context.baseFields.unterkategorie,
      };

      el('result').value = generation.output;
      el('result-meta').textContent = providerMeta;
      el('library-title').value = `${context.baseFields.unterkategorie} - ${context.baseFields.fach}`;
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

      await saveHistory({ fach: context.baseFields.fach, handlungsfeld: context.baseFields.handlungsfeld });
      await refreshTemplateDiscovery();
      setGenerating(false, 'Generierung abgeschlossen.');
      showScreen('result');
    } catch (error) {
      setGenerating(false, `Fehler: ${error.message}`);
      throw error;
    }
  }

  function buildCopyText(includeMetadata) {
    if (!includeMetadata || !state.generatedMeta) return state.generatedPrompt;
    return `${state.generatedPrompt}\n\n---\n${state.generatedMeta}`;
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
    el('oneoff-enable').addEventListener('change', () => {
      el('oneoff-fields').classList.toggle('is-hidden', !el('oneoff-enable').checked);
    });

    el('toggle-advanced').addEventListener('click', toggleAdvancedSection);
    syncAdvancedSectionUi();

    el('btn-preview-metaprompt').addEventListener('click', () => previewMetaprompt().catch((error) => {
      setPreviewStatus(`Fehler: ${error.message}`, 'error');
      alert(error.message);
    }));
    el('copy-metaprompt-preview').addEventListener('click', copyMetapromptPreview);

    el('copy-prompt-clean').addEventListener('click', copyPromptClean);
    el('copy-prompt-meta').addEventListener('click', copyPromptWithMetadata);
    el('btn-compare-last').addEventListener('click', toggleComparePanel);

    el('home-template-search-btn').addEventListener('click', () => {
      const search = el('home-template-search').value.trim();
      refreshTemplateDiscovery({ search }).catch((error) => alert(error.message));
    });
    el('home-template-reset-btn').addEventListener('click', () => {
      el('home-template-search').value = '';
      refreshTemplateDiscovery({ search: '', tag: '' }).catch((error) => alert(error.message));
    });
    el('home-template-search').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const search = el('home-template-search').value.trim();
      refreshTemplateDiscovery({ search }).catch((error) => alert(error.message));
    });
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
  };
}

export { createTaskController };
