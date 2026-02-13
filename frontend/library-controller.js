function createLibraryController({
  state,
  el,
  api,
  getCategoryConfig,
  onOpenTemplateFromLibrary = null,
}) {
  let openLibraryHandler = typeof onOpenTemplateFromLibrary === 'function'
    ? onOpenTemplateFromLibrary
    : null;
  let filterEventsBound = false;
  let searchDebounceTimer = null;

  function escapeHtml(value = '') {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function setOpenLibraryHandler(handler) {
    openLibraryHandler = typeof handler === 'function' ? handler : null;
  }

  function getAllTemplateFilterEntries() {
    const categoryConfig = getCategoryConfig();
    const entries = [];
    Object.entries(categoryConfig).forEach(([categoryName, category]) => {
      Object.entries(category?.templates || {}).forEach(([subcategoryName, template]) => {
        const templateId = String(template?.id || `${categoryName}:${subcategoryName}`).trim();
        entries.push({
          templateId,
          categoryName,
          subcategoryName,
          label: `${categoryName} -> ${subcategoryName}`,
        });
      });
    });
    return entries;
  }

  function renderSubcategoryFilterOptions() {
    const categoryConfig = getCategoryConfig();
    const categorySelect = el('lib-filter-category');
    const subcategorySelect = el('lib-filter-subcategory');
    const selectedCategory = String(categorySelect?.value || '').trim();
    const selectedSubcategory = String(subcategorySelect?.value || '').trim();
    const options = selectedCategory ? (categoryConfig[selectedCategory]?.unterkategorien || []) : [];
    subcategorySelect.innerHTML = `<option value="">Alle Unterkategorien</option>${options
      .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
      .join('')}`;
    if (selectedSubcategory && options.includes(selectedSubcategory)) {
      subcategorySelect.value = selectedSubcategory;
    } else {
      subcategorySelect.value = '';
    }
  }

  function renderTemplateFilterOptions() {
    const category = String(el('lib-filter-category')?.value || '').trim();
    const subcategory = String(el('lib-filter-subcategory')?.value || '').trim();
    const templateSelect = el('lib-filter-template');
    const currentValue = String(templateSelect?.value || '').trim();
    const allEntries = getAllTemplateFilterEntries();
    const visibleEntries = allEntries.filter((entry) => {
      if (category && entry.categoryName !== category) return false;
      if (subcategory && entry.subcategoryName !== subcategory) return false;
      return true;
    });

    templateSelect.innerHTML = `<option value="">Alle Templates</option>${visibleEntries
      .map((entry) => `<option value="${escapeHtml(entry.templateId)}">${escapeHtml(entry.label)}</option>`)
      .join('')}`;
    if (currentValue && visibleEntries.some((entry) => entry.templateId === currentValue)) {
      templateSelect.value = currentValue;
    } else {
      templateSelect.value = '';
    }
  }

  function prepareLibraryFilters() {
    const categoryConfig = getCategoryConfig();
    const categorySelect = el('lib-filter-category');
    if (!categorySelect) return;
    const selectedCategory = String(categorySelect.value || '').trim();
    categorySelect.innerHTML = `<option value="">Alle Kategorien</option>${Object.keys(categoryConfig)
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(categoryConfig[name].title || name)}</option>`)
      .join('')}`;
    if (selectedCategory && categoryConfig[selectedCategory]) {
      categorySelect.value = selectedCategory;
    } else {
      categorySelect.value = '';
    }

    renderSubcategoryFilterOptions();
    renderTemplateFilterOptions();

    if (filterEventsBound) return;
    filterEventsBound = true;

    categorySelect.addEventListener('change', () => {
      renderSubcategoryFilterOptions();
      renderTemplateFilterOptions();
      refreshLibrary().catch((error) => alert(error.message));
    });
    el('lib-filter-subcategory').addEventListener('change', () => {
      renderTemplateFilterOptions();
      refreshLibrary().catch((error) => alert(error.message));
    });
    el('lib-filter-template').addEventListener('change', () => {
      refreshLibrary().catch((error) => alert(error.message));
    });
    el('lib-filter-mode').addEventListener('change', () => {
      refreshLibrary().catch((error) => alert(error.message));
    });
    el('lib-filter-search').addEventListener('input', () => {
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(() => {
        refreshLibrary().catch((error) => alert(error.message));
      }, 220);
    });
  }

  function buildLibraryQuery() {
    const category = String(el('lib-filter-category')?.value || '').trim();
    const subcategory = String(el('lib-filter-subcategory')?.value || '').trim();
    const templateId = String(el('lib-filter-template')?.value || '').trim();
    const generationMode = String(el('lib-filter-mode')?.value || '').trim();
    const search = String(el('lib-filter-search')?.value || '').trim();
    const params = new URLSearchParams();
    if (category) params.set('handlungsfeld', category);
    if (subcategory) params.set('unterkategorie', subcategory);
    if (templateId) params.set('templateId', templateId);
    if (generationMode) params.set('generationMode', generationMode);
    if (search) params.set('search', search);
    return params;
  }

  function renderStars(score = 0) {
    const rating = Math.max(0, Math.min(5, Number(score) || 0));
    const full = Math.floor(rating);
    const half = rating - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return `${'★'.repeat(full)}${half ? '☆' : ''}${'·'.repeat(Math.max(0, empty))}`;
  }

  function resolveArtifactText(item, artifact = 'metaprompt') {
    if (artifact === 'result') return String(item.resultText || '').trim();
    return String(item.metapromptText || item.promptText || '').trim();
  }

  function renderLibraryList() {
    const list = el('library-list');
    const items = state.libraryMode === 'own' ? state.libraryOwn : state.libraryPublic;
    if (!items.length) {
      list.innerHTML = '<div class="panel tw-library-empty"><span class="hint">Keine Eintraege gefunden.</span></div>';
      return;
    }

    list.innerHTML = items
      .map((item) => {
        const ratingOptions = [1, 2, 3, 4, 5]
          .map((value) => `<option value="${value}" ${item.myRating === value ? 'selected' : ''}>${value}</option>`)
          .join('');
        const modelBadge = String(item.providerKind || 'custom').toUpperCase();
        const levelBadge = item.handlungsfeld || 'all';
        const scopeBadge = item.isPublic ? 'Community' : 'Personal';
        const ownerLabel = item.userId || 'unbekannt';
        const modeBadge = item.generationMode === 'result' ? 'Result' : 'Prompt';
        const activeArtifact = item.hasResult ? 'result' : 'metaprompt';
        const artifactText = resolveArtifactText(item, activeArtifact);
        return `
        <article class="library-item tw-library-card" data-library-id="${item.id}" data-active-artifact="${activeArtifact}">
          <div class="tw-library-card-head">
            <div class="tw-library-card-badges">
              <span class="tw-library-badge tw-library-badge-model">${escapeHtml(modelBadge)}</span>
              <span class="tw-library-badge">${escapeHtml(levelBadge)}</span>
              <span class="tw-library-badge">${escapeHtml(scopeBadge)}</span>
              <span class="tw-library-badge">${escapeHtml(modeBadge)}</span>
            </div>
            <button type="button" class="tw-library-card-fav" data-action="copy-lib" title="Aktiven Tab kopieren">♡</button>
          </div>
          <h3 class="tw-library-card-title">${escapeHtml(item.title)}</h3>
          <p class="tw-library-card-description">${escapeHtml(item.promptText)}</p>
          <div class="tw-library-rating-row">
            <span class="tw-library-stars">${renderStars(item.avgRating)}</span>
            <span class="tw-library-rating-value">${Number(item.avgRating || 0).toFixed(2)}</span>
            <span class="tw-library-rating-count">(${item.ratingCount || 0} reviews)</span>
          </div>
          <div class="tw-library-card-foot">
            <span class="tw-library-author">${escapeHtml(ownerLabel)}</span>
            <div class="inline-actions">
              <button type="button" class="tw-library-try-btn" data-action="open-lib">Öffnen</button>
              <button type="button" class="tw-library-try-btn" data-action="try-lib">Try Prompt</button>
            </div>
          </div>
          <div class="tw-library-admin-row">
            <span class="library-meta">${escapeHtml(item.handlungsfeld)} | ${escapeHtml(item.unterkategorie)} | ${escapeHtml(item.fach)} | Modell: ${escapeHtml(item.providerModel || '-')}</span>
            <label class="inline-actions">Rate:
              <select data-rate-for="${item.id}">
                <option value="">-</option>
                ${ratingOptions}
              </select>
              <button type="button" class="secondary small" data-action="rate-lib">Speichern</button>
            </label>
          </div>
          <div class="inline-actions tw-library-artifact-tabs">
            <button type="button" class="secondary small ${activeArtifact === 'metaprompt' ? 'is-active' : ''}" data-action="artifact-tab" data-artifact="metaprompt">Metaprompt</button>
            <button type="button" class="secondary small ${activeArtifact === 'result' ? 'is-active' : ''} ${item.hasResult ? '' : 'is-hidden'}" data-action="artifact-tab" data-artifact="result">Ergebnis</button>
          </div>
          ${
            state.libraryMode === 'own'
              ? `
            <div class="inline-actions tw-library-owner-actions">
              <button type="button" class="secondary small" data-action="edit-lib">Bearbeiten</button>
              <button type="button" class="secondary small" data-action="toggle-public">${item.isPublic ? 'Privat setzen' : 'Public setzen'}</button>
              <button type="button" class="secondary small" data-action="delete-lib">Loeschen</button>
            </div>
          `
              : ''
          }
          <pre class="library-text" data-library-artifact-content>${escapeHtml(artifactText)}</pre>
          <div class="tw-library-tags">
            ${(item.tags || []).slice(0, 5).map((tag) => `<span class="tw-library-tag-chip">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </article>
      `;
      })
      .join('');
  }

  async function refreshLibrary() {
    const params = buildLibraryQuery();
    const query = params.toString();
    if (state.libraryMode === 'own') {
      state.libraryOwn = await api(`/api/library${query ? `?${query}` : ''}`);
    } else {
      state.libraryPublic = await api(`/api/library/public${query ? `?${query}` : ''}`);
    }
    renderLibraryList();
  }

  function resolveLastGenerationProvider() {
    const payload = state.lastGenerationPayload || {};
    if (payload.mode === 'result' && payload.providers?.result) return payload.providers.result;
    return payload.providers?.metaprompt || payload.provider || null;
  }

  async function saveCurrentPromptToLibrary() {
    if (!state.generatedPrompt || !state.lastPromptContext) return;
    const provider = resolveLastGenerationProvider();
    const generationMode = state.lastGenerationPayload?.mode === 'result' ? 'result' : 'prompt';
    const payload = {
      title: el('library-title').value.trim() || `${state.lastPromptContext.unterkategorie} - ${state.lastPromptContext.fach}`,
      promptText: state.generatedPrompt,
      fach: state.lastPromptContext.fach,
      handlungsfeld: state.lastPromptContext.handlungsfeld,
      unterkategorie: state.lastPromptContext.unterkategorie,
      isPublic: el('library-public').checked,
      rating: el('library-rating').value ? Number(el('library-rating').value) : null,
      templateId: state.lastGenerationPayload?.templateId || null,
      providerKind: provider?.kind || null,
      providerModel: provider?.model || null,
      generationMode,
      formSnapshot: state.lastGenerationFormSnapshot || {},
      metapromptText: state.generatedMetaPrompt || state.generatedPrompt,
      resultText: state.generatedResult || '',
      hasResult: Boolean(state.generatedResult),
    };

    await api('/api/library', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    el('save-library-status').textContent = 'Gespeichert.';
    setTimeout(() => {
      el('save-library-status').textContent = '';
    }, 1400);
  }

  async function openLibraryTemplate(libraryId) {
    const entry = await api(`/api/library/${encodeURIComponent(libraryId)}/open`);
    if (typeof openLibraryHandler !== 'function') {
      alert('Öffnen ist aktuell nicht verfügbar.');
      return;
    }
    const opened = openLibraryHandler(entry);
    if (opened !== false) {
      state.libraryMode = 'own';
      el('lib-tab-own')?.classList.add('is-active');
      el('lib-tab-public')?.classList.remove('is-active');
    }
  }

  function switchArtifactTab(card, item, artifact) {
    const normalized = artifact === 'result' ? 'result' : 'metaprompt';
    const contentNode = card.querySelector('[data-library-artifact-content]');
    if (!contentNode) return;
    const text = resolveArtifactText(item, normalized);
    contentNode.textContent = text || '(kein Inhalt gespeichert)';
    card.dataset.activeArtifact = normalized;
    card.querySelectorAll('[data-action="artifact-tab"]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.artifact === normalized);
    });
  }

  async function handleLibraryAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('[data-library-id]');
    if (!card) return;

    const libraryId = card.dataset.libraryId;
    const item = (state.libraryMode === 'own' ? state.libraryOwn : state.libraryPublic)
      .find((entry) => String(entry.id) === String(libraryId));
    if (!item) return;

    if (button.dataset.action === 'artifact-tab') {
      switchArtifactTab(card, item, button.dataset.artifact);
      return;
    }

    if (button.dataset.action === 'open-lib' || button.dataset.action === 'try-lib') {
      await openLibraryTemplate(libraryId);
      return;
    }

    if (button.dataset.action === 'copy-lib') {
      const activeArtifact = card.dataset.activeArtifact || 'metaprompt';
      const content = resolveArtifactText(item, activeArtifact);
      if (!content) return;
      navigator.clipboard.writeText(content);
      return;
    }

    if (button.dataset.action === 'rate-lib') {
      const select = card.querySelector(`select[data-rate-for="${libraryId}"]`);
      if (!select || !select.value) return;
      await api(`/api/library/${libraryId}/rating`, {
        method: 'PUT',
        body: JSON.stringify({ rating: Number(select.value) }),
      });
      await refreshLibrary();
      return;
    }

    if (state.libraryMode !== 'own') return;

    if (button.dataset.action === 'delete-lib') {
      const proceed = confirm('Eintrag wirklich löschen?');
      if (!proceed) return;
      await api(`/api/library/${libraryId}`, { method: 'DELETE' });
      await refreshLibrary();
      return;
    }

    if (button.dataset.action === 'toggle-public') {
      await api(`/api/library/${libraryId}`, {
        method: 'PUT',
        body: JSON.stringify({ isPublic: !item.isPublic }),
      });
      await refreshLibrary();
      return;
    }

    if (button.dataset.action === 'edit-lib') {
      const newTitle = prompt('Neuer Titel', item.title);
      if (!newTitle) return;
      const newPrompt = prompt('Prompt-Inhalt bearbeiten', item.promptText);
      if (!newPrompt) return;
      await api(`/api/library/${libraryId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle, promptText: newPrompt }),
      });
      await refreshLibrary();
    }
  }

  return {
    prepareLibraryFilters,
    refreshLibrary,
    saveCurrentPromptToLibrary,
    handleLibraryAction,
    setOpenLibraryHandler,
  };
}

export { createLibraryController };
