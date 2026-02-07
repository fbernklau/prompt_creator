function createTaskController({
  state,
  el,
  api,
  getCategoryConfig,
  getPresetOptions,
  showScreen,
  saveHistory,
}) {
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

  function renderSubcategoryList(categoryName) {
    const categoryConfig = getCategoryConfig();
    const cfg = categoryConfig[categoryName];
    el('selected-category-title').textContent = cfg.title;
    el('selected-category-desc').textContent = cfg.description;
    el('subcategory-list').innerHTML = cfg.unterkategorien
      .map(
        (subcategory) => `
        <button type="button" class="list-card" data-subcategory="${subcategory}">
          <strong>${subcategory}</strong>
          <span class="hint">${cfg.description}</span>
        </button>
      `
      )
      .join('');

    el('subcategory-list').querySelectorAll('[data-subcategory]').forEach((button) => {
      button.addEventListener('click', () => openForm(categoryName, button.dataset.subcategory));
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
    const categoryConfig = getCategoryConfig();
    const cfg = categoryConfig[state.selectedCategory];
    const container = el('dynamic-fields');
    container.innerHTML = '';

    cfg.dynamicFields.forEach((field) => {
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
      container.appendChild(wrap);
    });

    const requiredDynamic = (cfg.dynamicFields || []).filter((field) => field.required).map((field) => field.id);
    const requiredBase = ['fach', 'schulstufe', 'ziel'];
    const required = [...requiredBase, ...requiredDynamic];
    el('validation-hint').textContent = required.length
      ? `Pflichtfelder fuer ${cfg.title}: ${required.join(', ')}`
      : '';
  }

  function collectDynamicValues() {
    const categoryConfig = getCategoryConfig();
    const values = {};
    const cfg = categoryConfig[state.selectedCategory];

    cfg.dynamicFields.forEach((field) => {
      const node = el(`dyn-${field.id}`);
      if (!node) return;

      if (field.type === 'checkbox') values[field.id] = node.checked;
      else if (field.type === 'multiselect') values[field.id] = [...node.selectedOptions].map((opt) => opt.value).join(', ');
      else values[field.id] = node.value.trim();
    });
    return values;
  }

  function validateDynamicValues(values) {
    const categoryConfig = getCategoryConfig();
    const cfg = categoryConfig[state.selectedCategory];
    const requiredDynamic = (cfg.dynamicFields || []).filter((field) => field.required).map((field) => field.id);
    const missing = requiredDynamic.filter((fieldName) => !values[fieldName]);
    if (missing.length) {
      alert(`Bitte Pflichtfelder ausfuellen: ${missing.join(', ')}`);
      return false;
    }
    return true;
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

  function updateSelectedSubcategory() {
    state.selectedSubcategory = el('unterkategorie-select').value;
    el('form-subcategory-title').textContent = state.selectedSubcategory;
  }

  async function generatePrompt(event) {
    event.preventDefault();
    const dynamicValues = collectDynamicValues();
    if (!validateDynamicValues(dynamicValues)) return;

    updateSelectedSubcategory();
    const activeProvider = state.providers.find((provider) => provider.id === state.activeId);
    const data = {
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

    if (!data.fach || !data.schulstufe || !data.ziel) {
      alert('Bitte Fach, Schulstufe und Ziel ausfuellen.');
      return;
    }

    if (!activeProvider) {
      alert('Bitte zuerst einen aktiven Provider auswaehlen.');
      return;
    }

    const generation = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        providerId: activeProvider.id,
        categoryName: data.handlungsfeld,
        subcategoryName: data.unterkategorie,
        baseFields: data,
        dynamicValues,
      }),
    });
    const providerMeta = `Aktiver Provider: ${generation.provider.name} (${generation.provider.kind}, ${generation.provider.model}) | Key-Quelle: ${generation.provider.keySource} | Template: ${generation.templateId}`;

    state.generatedPrompt = generation.output;
    state.generatedMeta = providerMeta;
    state.lastPromptContext = {
      fach: data.fach,
      handlungsfeld: data.handlungsfeld,
      unterkategorie: data.unterkategorie,
    };

    el('result').value = generation.output;
    el('result-meta').textContent = providerMeta;
    el('library-title').value = `${data.unterkategorie} - ${data.fach}`;
    el('save-library-status').textContent = '';

    await saveHistory({ fach: data.fach, handlungsfeld: data.handlungsfeld });
    showScreen('result');
  }

  function buildCopyText(includeMetadata) {
    if (!includeMetadata || !state.generatedMeta) return state.generatedPrompt;
    return `${state.generatedPrompt}\n\n---\n${state.generatedMeta}`;
  }

  function copyPrompt() {
    const text = buildCopyText(el('copy-include-metadata').checked);
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      const button = el('copy-prompt');
      const original = button.textContent;
      button.textContent = 'Kopiert';
      setTimeout(() => {
        button.textContent = original;
      }, 1100);
    });
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

  return {
    renderCategoryGrid,
    resetTaskState,
    updateSelectedSubcategory,
    generatePrompt,
    copyPrompt,
    exportPrompt,
    setupAdvancedPresets,
  };
}

export { createTaskController };
