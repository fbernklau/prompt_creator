function createTemplateStudioController({
  state,
  el,
  api,
  showScreen,
  reloadCatalog,
}) {
  state.templateStudio = {
    templates: [],
    nodes: [],
    tags: [],
    selectedTemplateUid: null,
  };

  function hasPermission(key) {
    const permissions = state.access?.permissions || [];
    return permissions.includes('*') || permissions.includes(key);
  }

  function hasAnyPermission(keys = []) {
    return keys.some((key) => hasPermission(key));
  }

  function setStatus(text) {
    el('template-studio-status').textContent = text;
    if (!text) return;
    setTimeout(() => {
      if (el('template-studio-status').textContent === text) {
        el('template-studio-status').textContent = '';
      }
    }, 1800);
  }

  function splitCsv(value = '') {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function parseDynamicJson(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Dynamic Fields muessen ein JSON-Array sein.');
      return parsed;
    } catch (error) {
      throw new Error(`Dynamic Fields JSON ist ungueltig: ${error.message}`);
    }
  }

  function ensureVisible() {
    const visible = hasPermission('templates.read');
    el('btn-templates').classList.toggle('is-hidden', !visible);
    if (!visible && !el('screen-templates').classList.contains('is-hidden')) {
      showScreen('home');
    }
  }

  function selectedTemplate() {
    const uid = state.templateStudio.selectedTemplateUid;
    if (!uid) return null;
    return state.templateStudio.templates.find((entry) => entry.templateUid === uid) || null;
  }

  function renderNodeOptions() {
    const baseOptions = ['<option value="">(kein Parent)</option>'];
    const nodeOptions = ['<option value="">Bitte waehlen...</option>'];
    state.templateStudio.nodes.forEach((node) => {
      const prefix = node.parentId ? '↳ ' : '';
      const suffix = ` [${node.scope}]`;
      baseOptions.push(`<option value="${node.id}">${prefix}${node.displayName}${suffix}</option>`);
      nodeOptions.push(`<option value="${node.id}">${prefix}${node.displayName}${suffix}</option>`);
    });
    el('template-node-parent').innerHTML = baseOptions.join('');
    el('template-form-node').innerHTML = nodeOptions.join('');
  }

  function renderTagCatalog() {
    const options = ['<option value="">(auswaehlen)</option>'];
    state.templateStudio.tags.forEach((tag) => {
      const suffix = tag.isOfficial ? ' [official]' : '';
      options.push(`<option value="${tag.key}">${tag.key}${suffix}</option>`);
    });
    el('template-tag-catalog').innerHTML = options.join('');
  }

  function clearEditorSelection() {
    state.templateStudio.selectedTemplateUid = null;
    el('template-selected-id').textContent = 'Ausgewaehlt: -';
    el('template-form-title').value = '';
    el('template-form-description').value = '';
    el('template-form-profile').value = '';
    el('template-form-required-base').value = '';
    el('template-form-optional-base').value = '';
    el('template-form-tags').value = '';
    el('template-form-prompt-mode').value = 'schema';
    el('template-form-taxonomy-path').value = '';
    el('template-form-dynamic-fields').value = '';
    el('template-form-base-prompt').value = '';
    el('template-form-change-note').value = '';
    el('template-form-review-note').value = '';
  }

  function fillEditorFromTemplate(template) {
    if (!template) {
      clearEditorSelection();
      return;
    }
    state.templateStudio.selectedTemplateUid = template.templateUid;
    el('template-selected-id').textContent = `Ausgewaehlt: ${template.templateUid} (${template.scope}/${template.reviewState})`;
    el('template-form-title').value = template.title || '';
    el('template-form-description').value = template.description || '';
    el('template-form-profile').value = template.profile || '';
    el('template-form-required-base').value = (template.requiredBaseFields || []).join(',');
    el('template-form-optional-base').value = (template.optionalBaseFields || []).join(',');
    el('template-form-tags').value = (template.tags || []).join(',');
    el('template-form-prompt-mode').value = template.promptMode || 'schema';
    el('template-form-taxonomy-path').value = (template.taxonomyPath || []).join(',');
    el('template-form-dynamic-fields').value = JSON.stringify(template.dynamicFields || [], null, 2);
    el('template-form-base-prompt').value = template.basePrompt || '';
    el('template-form-scope').value = template.scope || 'personal';
    if (template.nodeId) el('template-form-node').value = String(template.nodeId);
  }

  function renderTemplateList() {
    const selectedUid = state.templateStudio.selectedTemplateUid;
    const list = el('template-list');
    list.innerHTML = state.templateStudio.templates
      .map((template) => {
        const selectedClass = template.templateUid === selectedUid ? 'is-active' : '';
        const tags = (template.tags || []).join(', ') || 'keine';
        const meta = `${template.scope} | ${template.reviewState} | v${template.versionNo || 1} | Rating ${Number(template.avgRating || 0).toFixed(2)} (${template.ratingCount || 0})`;
        return `
          <button type="button" class="list-card ${selectedClass}" data-template-uid="${template.templateUid}">
            <strong>${template.title}</strong>
            <span class="hint">${template.categoryName} -> ${template.subcategoryName}</span>
            <span class="hint">${meta}</span>
            <span class="hint">Tags: ${tags}</span>
          </button>
        `;
      })
      .join('');

    list.querySelectorAll('[data-template-uid]').forEach((button) => {
      button.addEventListener('click', () => {
        const uid = button.dataset.templateUid;
        const template = state.templateStudio.templates.find((entry) => entry.templateUid === uid);
        fillEditorFromTemplate(template);
        renderTemplateList();
      });
    });
  }

  async function loadData() {
    const params = new URLSearchParams();
    const search = el('template-filter-search').value.trim();
    const tag = el('template-filter-tag').value.trim();
    const scope = el('template-filter-scope').value;
    const reviewState = el('template-filter-review').value;
    if (search) params.set('search', search);
    if (tag) params.set('tag', tag);
    if (scope) params.set('scope', scope);
    if (reviewState) params.set('reviewState', reviewState);

    const [templatesPayload, nodes, tags] = await Promise.all([
      api(`/api/templates${params.toString() ? `?${params.toString()}` : ''}`),
      api('/api/templates/nodes'),
      api('/api/templates/tags'),
    ]);

    state.templateStudio.templates = Array.isArray(templatesPayload.templates) ? templatesPayload.templates : [];
    state.templateStudio.nodes = Array.isArray(nodes) ? nodes : [];
    state.templateStudio.tags = Array.isArray(tags) ? tags : [];
    renderNodeOptions();
    renderTagCatalog();

    const selected = selectedTemplate();
    if (selected) fillEditorFromTemplate(selected);
    else clearEditorSelection();
    renderTemplateList();
  }

  function buildTemplatePayloadFromForm() {
    const dynamicFields = parseDynamicJson(el('template-form-dynamic-fields').value);
    return {
      title: el('template-form-title').value.trim(),
      description: el('template-form-description').value.trim(),
      profile: el('template-form-profile').value.trim() || 'unterrichtsnah',
      scope: el('template-form-scope').value || 'personal',
      nodeId: Number(el('template-form-node').value),
      promptMode: el('template-form-prompt-mode').value || 'schema',
      basePrompt: el('template-form-base-prompt').value,
      taxonomyPath: splitCsv(el('template-form-taxonomy-path').value),
      requiredBaseFields: splitCsv(el('template-form-required-base').value),
      optionalBaseFields: splitCsv(el('template-form-optional-base').value),
      tags: splitCsv(el('template-form-tags').value),
      dynamicFields,
      changeNote: el('template-form-change-note').value.trim(),
    };
  }

  async function openScreenAndLoad() {
    if (!hasPermission('templates.read')) {
      alert('Keine Berechtigung fuer Template Studio.');
      return;
    }
    await loadData();
    showScreen('templates');
  }

  async function createNode() {
    const payload = {
      parentId: el('template-node-parent').value ? Number(el('template-node-parent').value) : null,
      nodeType: el('template-node-type').value,
      scope: el('template-node-scope').value,
      displayName: el('template-node-name').value.trim(),
      description: el('template-node-description').value.trim(),
    };
    await api('/api/templates/nodes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    el('template-node-name').value = '';
    el('template-node-description').value = '';
    setStatus('Node erstellt.');
    await loadData();
  }

  async function createTag() {
    const payload = {
      key: el('template-new-tag-key').value.trim(),
      displayName: el('template-new-tag-name').value.trim() || el('template-new-tag-key').value.trim(),
      description: el('template-new-tag-description').value.trim(),
      official: el('template-new-tag-official').checked,
    };
    await api('/api/templates/tags', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    el('template-new-tag-key').value = '';
    el('template-new-tag-name').value = '';
    el('template-new-tag-description').value = '';
    el('template-new-tag-official').checked = false;
    setStatus('Tag gespeichert.');
    await loadData();
  }

  async function createTemplate() {
    const payload = buildTemplatePayloadFromForm();
    await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStatus('Template erstellt.');
    await loadData();
    if (typeof reloadCatalog === 'function') await reloadCatalog();
  }

  async function updateTemplate() {
    const selected = selectedTemplate();
    if (!selected) {
      alert('Bitte zuerst ein Template auswaehlen.');
      return;
    }
    const payload = buildTemplatePayloadFromForm();
    await api(`/api/templates/${encodeURIComponent(selected.templateUid)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    setStatus('Neue Version gespeichert.');
    await loadData();
    if (typeof reloadCatalog === 'function') await reloadCatalog();
  }

  async function submitTemplate() {
    const selected = selectedTemplate();
    if (!selected) {
      alert('Bitte zuerst ein Template auswaehlen.');
      return;
    }
    await api(`/api/templates/${encodeURIComponent(selected.templateUid)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ note: el('template-form-review-note').value.trim() }),
    });
    setStatus('Template zur Review eingereicht.');
    await loadData();
    if (typeof reloadCatalog === 'function') await reloadCatalog();
  }

  async function reviewSelected(decision) {
    const selected = selectedTemplate();
    if (!selected) {
      alert('Bitte zuerst ein Template auswaehlen.');
      return;
    }
    await api(`/api/templates/${encodeURIComponent(selected.templateUid)}/review`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        note: el('template-form-review-note').value.trim(),
        targetScope: el('template-form-scope').value || 'community',
      }),
    });
    setStatus(`Template ${decision === 'approve' ? 'freigegeben' : 'abgelehnt'}.`);
    await loadData();
    if (typeof reloadCatalog === 'function') await reloadCatalog();
  }

  async function cloneAsPersonal() {
    const selected = selectedTemplate();
    if (!selected) {
      alert('Bitte zuerst ein Template auswaehlen.');
      return;
    }
    const payload = buildTemplatePayloadFromForm();
    await api(`/api/templates/${encodeURIComponent(selected.templateUid)}/clone-personal`, {
      method: 'POST',
      body: JSON.stringify({
        titleSuffix: ' (Persoenliche Variante)',
        overrides: payload,
      }),
    });
    setStatus('Persoenliche Variante gespeichert.');
    await loadData();
    if (typeof reloadCatalog === 'function') await reloadCatalog();
  }

  async function saveRating() {
    const selected = selectedTemplate();
    if (!selected) {
      alert('Bitte zuerst ein Template auswaehlen.');
      return;
    }
    const rating = Number(el('template-rating-value').value);
    await api(`/api/templates/${encodeURIComponent(selected.templateUid)}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ rating }),
    });
    setStatus('Bewertung gespeichert.');
    await loadData();
  }

  function bindEvents() {
    el('btn-templates').addEventListener('click', () => openScreenAndLoad().catch((error) => alert(error.message)));
    el('btn-back-home-from-templates').addEventListener('click', () => showScreen('home'));

    el('template-refresh').addEventListener('click', () => loadData().catch((error) => alert(error.message)));
    el('template-clear-selection').addEventListener('click', () => {
      clearEditorSelection();
      renderTemplateList();
    });
    el('template-filter-search').addEventListener('change', () => loadData().catch((error) => alert(error.message)));
    el('template-filter-tag').addEventListener('change', () => loadData().catch((error) => alert(error.message)));
    el('template-filter-scope').addEventListener('change', () => loadData().catch((error) => alert(error.message)));
    el('template-filter-review').addEventListener('change', () => loadData().catch((error) => alert(error.message)));
    el('template-tag-catalog').addEventListener('change', () => {
      const value = el('template-tag-catalog').value;
      if (!value) return;
      const existing = splitCsv(el('template-form-tags').value);
      if (!existing.includes(value)) {
        el('template-form-tags').value = [...existing, value].join(',');
      }
    });

    el('template-node-create').addEventListener('click', () => createNode().catch((error) => alert(error.message)));
    el('template-tag-create').addEventListener('click', () => createTag().catch((error) => alert(error.message)));
    el('template-create').addEventListener('click', () => createTemplate().catch((error) => alert(error.message)));
    el('template-update').addEventListener('click', () => updateTemplate().catch((error) => alert(error.message)));
    el('template-submit').addEventListener('click', () => submitTemplate().catch((error) => alert(error.message)));
    el('template-clone').addEventListener('click', () => cloneAsPersonal().catch((error) => alert(error.message)));
    el('template-approve').addEventListener('click', () => reviewSelected('approve').catch((error) => alert(error.message)));
    el('template-reject').addEventListener('click', () => reviewSelected('reject').catch((error) => alert(error.message)));
    el('template-rate').addEventListener('click', () => saveRating().catch((error) => alert(error.message)));
  }

  return {
    bindEvents,
    ensureVisible,
    loadData,
  };
}

export { createTemplateStudioController };
