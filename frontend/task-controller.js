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

  state.templateDiscovery = state.templateDiscovery || {
    templates: [],
    search: '',
    activeTag: '',
  };
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

  function updateBaseFieldRequirements(template) {
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

    updateBaseFieldHints(template);
  }

  function setupPresetSelect(selectId, customId, values) {
    const select = el(selectId);
    select.innerHTML = values
      .map((value) => {
        if (!value) return '<option value="">Bitte waehlen...</option>';
        if (value === '__custom__') return '<option value="__custom__">Custom...</option>';
        return `<option value="${value}">${value}</option>`;
      })
      .join('');

    const syncCustomState = () => {
      const isCustom = select.value === '__custom__';
      el(customId).disabled = !isCustom;
      if (!isCustom && !el(customId).value) {
        el(customId).placeholder = 'Nur bei Custom aktiv';
      }
    };

    select.addEventListener('change', syncCustomState);
    syncCustomState();
  }

  function resolveSelectOrCustom(selectId, customId, fallback = 'nicht angegeben') {
    const selectValue = el(selectId).value;
    const customValue = el(customId).value.trim();
    if (customValue) return customValue;
    if (!selectValue || selectValue === '__custom__') return fallback;
    return selectValue;
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
    const categoryConfig = getCategoryConfig();
    const grid = el('category-grid');
    const categoryNames = Object.keys(categoryConfig);
    grid.innerHTML = categoryNames
      .map((categoryName) => {
        const cfg = categoryConfig[categoryName];
        return `
        <button type="button" class="category-card" data-category="${categoryName}">
          <span class="category-kicker">${cfg.short}</span>
          <strong>${cfg.title}</strong>
          <span class="hint">${cfg.description}</span>
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
          <div class="list-card quick-template-card clickable-card" data-open-template="${template.templateUid}" role="button" tabindex="0" aria-label="Template ${template.title} verwenden">
            <div class="quick-template-head">
              <span class="quick-template-title-wrap">
                <span class="mini-icon">${short}</span>
                <strong>${template.title}</strong>
              </span>
              <button type="button" class="text-btn small" data-fav-template="${template.templateUid}" data-fav-state="${template.isFavorite ? '1' : '0'}">${template.isFavorite ? '★' : '☆'}</button>
            </div>
            <small class="hint">${template.categoryName} -> ${template.subcategoryName}</small>
            <small class="hint">${recentHint}</small>
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
      `<button type="button" class="chip ${!active ? 'is-active' : ''}" data-tag-chip="">Alle</button>`,
      ...topTags.map(([tag, count]) => `<button type="button" class="chip ${active === tag ? 'is-active' : ''}" data-tag-chip="${tag}">${tag} (${count})</button>`),
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

  function populateSubcategorySelect(categoryName, selected) {
    const categoryConfig = getCategoryConfig();
    const select = el('unterkategorie-select');
    const options = categoryConfig[categoryName].unterkategorien;
    select.innerHTML = options.map((item) => `<option value="${item}">${item}</option>`).join('');
    select.value = selected || options[0];
  }

  function renderDynamicFields() {
    const template = getTemplateConfig();
    const container = el('dynamic-fields');
    container.innerHTML = '';

    const fields = Array.isArray(template?.dynamicFields) ? template.dynamicFields : [];
    fields.forEach((field) => {
      const wrap = document.createElement('label');
      wrap.className = field.type === 'checkbox' ? 'checkbox span-2' : '';
      if (field.type !== 'checkbox') wrap.textContent = field.label;

      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        input.innerHTML = `<option value="">Bitte waehlen...</option>${field.options.map((opt) => `<option value="${opt}">${opt}</option>`).join('')}`;
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
        input.innerHTML = field.options.map((opt) => `<option value="${opt}">${opt}</option>`).join('');
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
        const optionHint = Array.isArray(field.options) && field.options.length
          ? `Optionen: ${field.options.join(', ')}`
          : '';
        const requiredHint = field.required ? 'Pflichtfeld.' : 'Optional.';
        const placeholderHint = field.placeholder ? ` Beispiel: ${field.placeholder}` : '';
        hint.textContent = `${requiredHint}${optionHint ? ` ${optionHint}` : ''}${placeholderHint}`;
        wrap.appendChild(hint);
      }

      container.appendChild(wrap);
    });

    updateBaseFieldRequirements(template);
    const requiredDynamic = fields.filter((field) => field.required).map((field) => field.id);
    const requiredBase = Array.isArray(template?.requiredBaseFields) && template.requiredBaseFields.length
      ? template.requiredBaseFields
      : DEFAULT_REQUIRED_BASE_FIELDS;
    const required = [...requiredBase, ...requiredDynamic];
    el('validation-hint').textContent = required.length
      ? `Pflichtfelder fuer ${state.selectedSubcategory}: ${required.join(', ')}`
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
      else if (field.type === 'multiselect') values[field.id] = [...node.selectedOptions].map((opt) => opt.value).join(', ');
      else values[field.id] = node.value.trim();
    });
    return values;
  }

  function validateDynamicValues(values) {
    const template = getTemplateConfig();
    const fields = Array.isArray(template?.dynamicFields) ? template.dynamicFields : [];
    const requiredDynamic = fields.filter((field) => field.required).map((field) => field.id);
    const missing = requiredDynamic.filter((fieldName) => !values[fieldName]);
    if (missing.length) {
      alert(`Bitte Pflichtfelder ausfuellen: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }

  function updateSelectedSubcategory() {
    state.selectedSubcategory = el('unterkategorie-select').value;
    el('form-subcategory-title').textContent = state.selectedSubcategory;
    renderDynamicFields();
  }

  function collectOneOffOverridePayload() {
    if (!el('oneoff-enable').checked) {
      return {
        templateOverride: null,
        saveOverrideAsPersonal: false,
        saveOverrideTitleSuffix: '',
      };
    }

    const override = {};
    const description = el('oneoff-description').value.trim();
    const profile = el('oneoff-profile').value.trim();
    const promptMode = el('oneoff-prompt-mode').value;
    const basePrompt = el('oneoff-base-prompt').value.trim();
    const tags = csvToArray(el('oneoff-tags').value);

    if (description) override.description = description;
    if (profile) override.profile = profile;
    if (promptMode) override.promptMode = promptMode;
    if (basePrompt) override.basePrompt = basePrompt;
    if (tags.length) override.tags = tags;

    return {
      templateOverride: Object.keys(override).length ? override : null,
      saveOverrideAsPersonal: !!el('oneoff-save-personal').checked,
      saveOverrideTitleSuffix: el('oneoff-save-suffix').value.trim(),
    };
  }

  function collectGenerationContext({ validate = true } = {}) {
    const dynamicValues = collectDynamicValues();
    if (validate && !validateDynamicValues(dynamicValues)) return null;

    updateSelectedSubcategory();
    const template = getTemplateConfig();
    const baseFields = {
      fach: el('fach').value.trim(),
      schulstufe: el('schulstufe').value.trim(),
      handlungsfeld: state.selectedCategory,
      unterkategorie: state.selectedSubcategory,
      ziel: el('ziel').value.trim(),
      zeitrahmen: resolveSelectOrCustom('zeitrahmen-select', 'zeitrahmen-custom'),
      niveau: resolveSelectOrCustom('niveau-select', 'niveau-custom'),
      rahmen: resolveSelectOrCustom('rahmen-select', 'rahmen-custom', 'keine besonderen Angaben'),
      ergebnisformat: resolveSelectOrCustom('ergebnisformat-select', 'ergebnisformat-custom', 'strukturierte Liste'),
      ton: resolveSelectOrCustom('ton-select', 'ton-custom', 'klar'),
      rueckfragen: el('rueckfragen').checked,
    };

    const requiredBase = Array.isArray(template?.requiredBaseFields) && template.requiredBaseFields.length
      ? template.requiredBaseFields
      : DEFAULT_REQUIRED_BASE_FIELDS;
    const missingBase = requiredBase.filter((fieldId) => {
      const value = baseFields[fieldId];
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (validate && missingBase.length) {
      alert(`Bitte Pflichtfelder ausfuellen: ${missingBase.join(', ')}`);
      return null;
    }

    const oneoff = collectOneOffOverridePayload();
    return {
      template,
      baseFields,
      dynamicValues,
      oneoff,
    };
  }

  async function previewMetaprompt() {
    const context = collectGenerationContext({ validate: true });
    if (!context) return;

    setPreviewStatus('Erstelle serverseitige Metaprompt-Vorschau...', 'info');
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

    populateSubcategorySelect(categoryName, subcategoryName);
    renderDynamicFields();
    showScreen('form');
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

    setGenerating(true, `Metaprompt wird erstellt und an ${activeProvider.name} gesendet...`);
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
    setupPresetSelect('zeitrahmen-select', 'zeitrahmen-custom', presetOptions.zeitrahmen);
    setupPresetSelect('niveau-select', 'niveau-custom', presetOptions.niveau);
    setupPresetSelect('rahmen-select', 'rahmen-custom', presetOptions.rahmen);
    setupPresetSelect('ergebnisformat-select', 'ergebnisformat-custom', presetOptions.ergebnisformat);
    setupPresetSelect('ton-select', 'ton-custom', presetOptions.ton);
  }

  function bindEvents() {
    el('unterkategorie-select').addEventListener('change', updateSelectedSubcategory);

    el('oneoff-enable').addEventListener('change', () => {
      el('oneoff-fields').classList.toggle('is-hidden', !el('oneoff-enable').checked);
    });

    el('btn-preview-metaprompt').addEventListener('click', () => previewMetaprompt().catch((error) => {
      setPreviewStatus(`Fehler: ${error.message}`, 'error');
      alert(error.message);
    }));

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
    updateSelectedSubcategory,
    generatePrompt,
    previewMetaprompt,
    copyPromptClean,
    copyPromptWithMetadata,
    toggleComparePanel,
    exportPrompt,
    setupAdvancedPresets,
  };
}

export { createTaskController };
