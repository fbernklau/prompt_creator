function createLibraryController({
  state,
  el,
  api,
  notify = null,
  getCategoryConfig,
  showScreen,
  onOpenTemplateFromLibrary = null,
}) {
  let openLibraryHandler = typeof onOpenTemplateFromLibrary === 'function'
    ? onOpenTemplateFromLibrary
    : null;
  let filterEventsBound = false;
  let detailEventsBound = false;
  let searchDebounceTimer = null;

  state.libraryDetail = state.libraryDetail || {
    entryId: null,
    artifact: 'metaprompt',
    descriptionEdit: false,
    status: '',
    view: 'page',
  };

  function emitNotice(message = '', type = 'info') {
    const text = String(message || '').trim();
    if (!text || typeof notify !== 'function') return;
    notify(text, { type });
  }

  function escapeHtml(value = '') {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getLibraryDetailView() {
    return state.settings?.libraryDetailView === 'modal' ? 'modal' : 'page';
  }

  function getActiveItems() {
    return state.libraryMode === 'own' ? state.libraryOwn : state.libraryPublic;
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
      refreshLibrary().catch((error) => emitNotice(error.message, 'error'));
    });
    el('lib-filter-subcategory').addEventListener('change', () => {
      renderTemplateFilterOptions();
      refreshLibrary().catch((error) => emitNotice(error.message, 'error'));
    });
    el('lib-filter-template').addEventListener('change', () => {
      refreshLibrary().catch((error) => emitNotice(error.message, 'error'));
    });
    el('lib-filter-mode').addEventListener('change', () => {
      refreshLibrary().catch((error) => emitNotice(error.message, 'error'));
    });
    el('lib-filter-search').addEventListener('input', () => {
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(() => {
        refreshLibrary().catch((error) => emitNotice(error.message, 'error'));
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

  function updateEntryInCollections(entryId, updater) {
    state.libraryOwn = state.libraryOwn.map((item) => (String(item.id) === String(entryId) ? updater(item) : item));
    state.libraryPublic = state.libraryPublic.map((item) => (String(item.id) === String(entryId) ? updater(item) : item));
  }

  function resolveArtifactText(item, artifact = 'metaprompt') {
    if (artifact === 'result') return String(item.resultText || '').trim();
    return String(item.metapromptText || item.promptText || '').trim();
  }

  function resolveDescription(item = {}) {
    return String(item.descriptionText || '').trim() || 'Keine Beschreibung hinterlegt.';
  }

  function readFollowupRawSnapshot(item = {}) {
    const snapshot = item?.formSnapshot;
    if (!snapshot || typeof snapshot !== 'object') return null;
    const raw = snapshot.__followupRaw;
    if (!raw || typeof raw !== 'object') return null;
    const initialOutput = String(raw.initialOutput || '').trim();
    const rounds = Array.isArray(raw.rounds)
      ? raw.rounds
        .map((entry) => ({
          action: String(entry?.action || 'ask').trim().toLowerCase() === 'final' ? 'final' : 'ask',
          round: Number(entry?.round) || 0,
          rawOutput: String(entry?.rawOutput || '').trim(),
          capturedAt: String(entry?.capturedAt || '').trim(),
        }))
        .filter((entry) => entry.rawOutput)
      : [];
    if (!initialOutput && !rounds.length) return null;
    return { initialOutput, rounds };
  }

  function formatFollowupRawSnapshot(raw = null) {
    if (!raw) return '';
    const lines = [];
    if (raw.initialOutput) {
      lines.push('Initiale Ausgabe');
      lines.push(raw.initialOutput);
      lines.push('');
    }
    (raw.rounds || []).forEach((entry, index) => {
      lines.push(`Runde ${entry.round || index + 1} (${entry.action === 'final' ? 'final' : 'ask'})${entry.capturedAt ? ` – ${entry.capturedAt}` : ''}`);
      lines.push(entry.rawOutput);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function findLibraryEntry(libraryId) {
    return getActiveItems().find((entry) => String(entry.id) === String(libraryId)) || null;
  }

  function setDetailStatus(text = '') {
    state.libraryDetail.status = text;
  }

  function closeLibraryDetailModal() {
    const modal = el('library-entry-modal');
    if (modal) modal.classList.add('is-hidden');
  }

  function closeLibraryDetail() {
    state.libraryDetail.entryId = null;
    state.libraryDetail.descriptionEdit = false;
    state.libraryDetail.artifact = 'metaprompt';
    state.libraryDetail.status = '';
    closeLibraryDetailModal();
    const page = el('library-entry-page-content');
    const modalBody = el('library-entry-modal-content');
    if (page) page.innerHTML = '';
    if (modalBody) modalBody.innerHTML = '';
  }

  function buildLibraryDetailMarkup(entry = {}) {
    const canEditDescription = String(entry.userId || '') === String(state.currentUser || '');
    const artifact = state.libraryDetail.artifact === 'result' && entry.hasResult ? 'result' : 'metaprompt';
    const descriptionEditable = canEditDescription && state.libraryDetail.descriptionEdit;
    const content = resolveArtifactText(entry, artifact) || '(kein Inhalt gespeichert)';
    const metaLine = [
      entry.handlungsfeld,
      entry.unterkategorie,
      entry.fach,
      entry.providerModel ? `Modell: ${entry.providerModel}` : null,
    ].filter(Boolean).join(' | ');
    const showResultTab = entry.hasResult ? '' : 'is-hidden';
    const publicToggleLabel = entry.isPublic ? 'Privat setzen' : 'Public setzen';
    const followupRaw = readFollowupRawSnapshot(entry);
    const followupRawText = formatFollowupRawSnapshot(followupRaw);
    const followupRawMarkup = followupRawText
      ? `
        <details class="top-space tw-library-debug-details">
          <summary>Technikdetails (Rückfragen-Rohdaten)</summary>
          <pre class="library-text top-space">${escapeHtml(followupRawText)}</pre>
        </details>
      `
      : '';

    return `
      <div class="panel tw-library-detail-card" data-library-detail-id="${entry.id}">
        <div class="tw-library-detail-head">
          <div class="tw-library-card-badges">
            <span class="tw-library-badge tw-library-badge-model">${escapeHtml(String(entry.providerKind || 'custom').toUpperCase())}</span>
            <span class="tw-library-badge">${escapeHtml(entry.handlungsfeld || '-')}</span>
            <span class="tw-library-badge">${escapeHtml(entry.isPublic ? 'Community' : 'Personal')}</span>
            <span class="tw-library-badge">${escapeHtml(entry.generationMode === 'result' ? 'Result' : 'Prompt')}</span>
          </div>
          <h3>${escapeHtml(entry.title || 'Library-Eintrag')}</h3>
          <small class="hint">${escapeHtml(metaLine)}</small>
          <small class="hint">Erstellt: ${escapeHtml(new Date(entry.createdAt || Date.now()).toLocaleString('de-AT'))}</small>
        </div>
        <label class="top-space">Beschreibung
          <textarea data-detail-description rows="4" ${descriptionEditable ? '' : 'readonly'}>${escapeHtml(String(entry.descriptionText || ''))}</textarea>
        </label>
        <div class="inline-actions top-space">
          ${canEditDescription && !descriptionEditable ? '<button type="button" class="secondary" data-detail-action="edit-description">Beschreibung bearbeiten</button>' : ''}
          ${canEditDescription && descriptionEditable ? '<button type="button" data-detail-action="save-description">Beschreibung speichern</button>' : ''}
          ${canEditDescription && descriptionEditable ? '<button type="button" class="secondary" data-detail-action="cancel-edit-description">Abbrechen</button>' : ''}
          <small class="hint" data-detail-status>${escapeHtml(state.libraryDetail.status || '')}</small>
        </div>

        <div class="inline-actions top-space tw-library-artifact-tabs tw-library-detail-tabs">
          <button type="button" class="secondary small ${artifact === 'metaprompt' ? 'is-active' : ''}" data-detail-action="artifact-tab" data-artifact="metaprompt">Metaprompt</button>
          <button type="button" class="secondary small ${artifact === 'result' ? 'is-active' : ''} ${showResultTab}" data-detail-action="artifact-tab" data-artifact="result">Ergebnis</button>
        </div>

        <pre class="library-text top-space tw-library-detail-text">${escapeHtml(content)}</pre>
        ${followupRawMarkup}

        <div class="inline-actions top-space tw-library-detail-actions">
          <button type="button" data-detail-action="reuse">Wiederverwenden</button>
          <button type="button" class="secondary" data-detail-action="copy">Inhalt kopieren</button>
          ${canEditDescription ? `<button type="button" class="secondary" data-detail-action="toggle-public">${publicToggleLabel}</button>` : ''}
          ${canEditDescription ? '<button type="button" class="secondary" data-detail-action="delete">Löschen</button>' : ''}
        </div>
      </div>
    `;
  }

  function renderLibraryDetail() {
    const entry = findLibraryEntry(state.libraryDetail.entryId);
    if (!entry) {
      closeLibraryDetail();
      return;
    }
    const view = getLibraryDetailView();
    state.libraryDetail.view = view;
    const pageHost = el('library-entry-page-content');
    const modalHost = el('library-entry-modal-content');
    const modal = el('library-entry-modal');

    const markup = buildLibraryDetailMarkup(entry);
    if (view === 'modal') {
      if (modalHost) modalHost.innerHTML = markup;
      if (pageHost) pageHost.innerHTML = '';
      if (modal) modal.classList.remove('is-hidden');
      if (typeof showScreen === 'function') showScreen('library');
      return;
    }

    if (pageHost) pageHost.innerHTML = markup;
    if (modalHost) modalHost.innerHTML = '';
    closeLibraryDetailModal();
    if (typeof showScreen === 'function') showScreen('library-entry');
  }

  function openLibraryDetail(entry, { editDescription = false } = {}) {
    if (!entry) return;
    state.libraryDetail.entryId = entry.id;
    state.libraryDetail.artifact = entry.hasResult ? 'result' : 'metaprompt';
    state.libraryDetail.descriptionEdit = Boolean(editDescription);
    state.libraryDetail.status = '';
    renderLibraryDetail();
  }

  function copyToClipboard(content = '') {
    const normalized = String(content || '').trim();
    if (!normalized) return;
    navigator.clipboard.writeText(normalized);
  }

  function bindDetailEvents() {
    if (detailEventsBound) return;
    detailEventsBound = true;

    const pageHost = el('library-entry-page-content');
    const modalHost = el('library-entry-modal-content');
    const modalClose = el('library-entry-modal-close');

    const clickHandler = (event) => {
      handleDetailAction(event).catch((error) => emitNotice(error.message, 'error'));
    };

    if (pageHost) pageHost.addEventListener('click', clickHandler);
    if (modalHost) modalHost.addEventListener('click', clickHandler);
    if (modalClose) {
      modalClose.addEventListener('click', () => {
        closeLibraryDetailModal();
      });
    }
  }

  async function openLibraryTemplate(libraryId) {
    const entry = await api(`/api/library/${encodeURIComponent(libraryId)}/open`);
    if (typeof openLibraryHandler !== 'function') {
      emitNotice('Wiederverwenden ist aktuell nicht verfügbar.', 'error');
      return;
    }
    const opened = openLibraryHandler(entry);
    if (opened !== false) {
      closeLibraryDetail();
      state.libraryMode = 'own';
      el('lib-tab-own')?.classList.add('is-active');
      el('lib-tab-public')?.classList.remove('is-active');
    }
  }

  async function handleDetailAction(event) {
    const button = event.target.closest('button[data-detail-action]');
    if (!button) return;

    const entry = findLibraryEntry(state.libraryDetail.entryId);
    if (!entry) return;
    const action = button.dataset.detailAction;

    if (action === 'artifact-tab') {
      const nextArtifact = button.dataset.artifact === 'result' ? 'result' : 'metaprompt';
      if (nextArtifact === 'result' && !entry.hasResult) return;
      state.libraryDetail.artifact = nextArtifact;
      renderLibraryDetail();
      return;
    }

    if (action === 'edit-description') {
      state.libraryDetail.descriptionEdit = true;
      setDetailStatus('');
      renderLibraryDetail();
      const host = state.libraryDetail.view === 'modal' ? el('library-entry-modal-content') : el('library-entry-page-content');
      const input = host?.querySelector('[data-detail-description]');
      if (input) input.focus();
      return;
    }

    if (action === 'cancel-edit-description') {
      state.libraryDetail.descriptionEdit = false;
      setDetailStatus('');
      renderLibraryDetail();
      return;
    }

    if (action === 'save-description') {
      const host = state.libraryDetail.view === 'modal' ? el('library-entry-modal-content') : el('library-entry-page-content');
      const input = host?.querySelector('[data-detail-description]');
      const descriptionText = String(input?.value || '').trim();
      await api(`/api/library/${encodeURIComponent(String(entry.id))}`, {
        method: 'PUT',
        body: JSON.stringify({ descriptionText }),
      });
      state.libraryOwn = state.libraryOwn.map((row) => (row.id === entry.id ? { ...row, descriptionText } : row));
      state.libraryPublic = state.libraryPublic.map((row) => (row.id === entry.id ? { ...row, descriptionText } : row));
      state.libraryDetail.descriptionEdit = false;
      setDetailStatus('Beschreibung gespeichert.');
      renderLibraryList();
      renderLibraryDetail();
      return;
    }

    if (action === 'reuse') {
      await openLibraryTemplate(entry.id);
      return;
    }

    if (action === 'copy') {
      copyToClipboard(resolveArtifactText(entry, state.libraryDetail.artifact));
      setDetailStatus('Inhalt kopiert.');
      renderLibraryDetail();
      return;
    }

    if (action === 'toggle-public') {
      await api(`/api/library/${encodeURIComponent(String(entry.id))}`, {
        method: 'PUT',
        body: JSON.stringify({ isPublic: !entry.isPublic }),
      });
      await refreshLibrary();
      const updated = findLibraryEntry(entry.id) || { ...entry, isPublic: !entry.isPublic };
      openLibraryDetail(updated);
      return;
    }

    if (action === 'delete') {
      const proceed = confirm('Eintrag wirklich löschen?');
      if (!proceed) return;
      await api(`/api/library/${encodeURIComponent(String(entry.id))}`, { method: 'DELETE' });
      closeLibraryDetail();
      await refreshLibrary();
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

  function renderLibraryList() {
    const list = el('library-list');
    const items = getActiveItems();
    if (!items.length) {
      list.innerHTML = `
        <div class="empty-state-card">
          <strong>Noch keine Einträge gefunden.</strong>
          <small class="hint">Speichere einen generierten Prompt in der Bibliothek, um ihn hier wiederzuverwenden.</small>
          <span class="inline-actions">
            <button type="button" class="secondary small" data-library-empty-action="new-task">Neue Aufgabe starten</button>
          </span>
        </div>
      `;
      const openButton = list.querySelector('[data-library-empty-action="new-task"]');
      if (openButton && typeof showScreen === 'function') {
        openButton.addEventListener('click', () => showScreen('home'));
      }
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
        const descriptionText = resolveDescription(item);
        return `
        <article class="library-item tw-library-card clickable-card" data-library-id="${item.id}" data-active-artifact="${activeArtifact}" role="button" tabindex="0" aria-label="Library-Eintrag ${escapeHtml(item.title)} öffnen">
          <div class="tw-library-card-head">
            <div class="tw-library-card-badges">
              <span class="tw-library-badge tw-library-badge-model">${escapeHtml(modelBadge)}</span>
              <span class="tw-library-badge">${escapeHtml(levelBadge)}</span>
              <span class="tw-library-badge">${escapeHtml(scopeBadge)}</span>
              <span class="tw-library-badge">${escapeHtml(modeBadge)}</span>
            </div>
            <button type="button" class="tw-library-card-fav" data-action="favorite-lib" title="${item.isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}">${item.isFavorite ? '★' : '☆'}</button>
          </div>
          <h3 class="tw-library-card-title">${escapeHtml(item.title)}</h3>
          <p class="tw-library-card-description">${escapeHtml(descriptionText)}</p>
          <div class="tw-library-rating-row">
            <span class="tw-library-stars">${renderStars(item.avgRating)}</span>
            <span class="tw-library-rating-value">${Number(item.avgRating || 0).toFixed(2)}</span>
            <span class="tw-library-rating-count">(${item.ratingCount || 0} reviews)</span>
          </div>
          <div class="tw-library-admin-row">
            <span class="library-meta">${escapeHtml(item.handlungsfeld)} | ${escapeHtml(item.unterkategorie)} | ${escapeHtml(item.fach)} | Modell: ${escapeHtml(item.providerModel || '-')}</span>
            <label class="inline-actions">Rate:
              <select data-rate-for="${item.id}" data-no-open="true">
                <option value="">-</option>
                ${ratingOptions}
              </select>
              <button type="button" class="secondary small" data-action="rate-lib" data-no-open="true">Speichern</button>
            </label>
          </div>
          <div class="inline-actions tw-library-artifact-tabs">
            <button type="button" class="secondary small ${activeArtifact === 'metaprompt' ? 'is-active' : ''}" data-action="artifact-tab" data-artifact="metaprompt">Metaprompt</button>
            <button type="button" class="secondary small ${activeArtifact === 'result' ? 'is-active' : ''} ${item.hasResult ? '' : 'is-hidden'}" data-action="artifact-tab" data-artifact="result">Ergebnis</button>
          </div>
          <pre class="library-text" data-library-artifact-content>${escapeHtml(artifactText)}</pre>
          <div class="tw-library-tags">
            ${(item.tags || []).slice(0, 5).map((tag) => `<span class="tw-library-tag-chip">${escapeHtml(tag)}</span>`).join('')}
          </div>
          <div class="tw-library-card-foot">
            <span class="tw-library-author">${escapeHtml(ownerLabel)}</span>
            <div class="inline-actions">
              <button type="button" class="tw-library-try-btn" data-action="reuse-lib" data-no-open="true">Wiederverwenden</button>
            </div>
          </div>
          ${
            state.libraryMode === 'own'
              ? `
            <div class="inline-actions tw-library-owner-actions">
              <button type="button" class="secondary small" data-action="edit-lib" data-no-open="true">Bearbeiten</button>
              <button type="button" class="secondary small" data-action="toggle-public" data-no-open="true">${item.isPublic ? 'Privat setzen' : 'Public setzen'}</button>
              <button type="button" class="secondary small" data-action="delete-lib" data-no-open="true">Löschen</button>
            </div>
          `
              : ''
          }
        </article>
      `;
      })
      .join('');

    list.querySelectorAll('[data-library-id]').forEach((card) => {
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target.closest('button,select,input,textarea,label,a')) return;
        event.preventDefault();
        const entry = findLibraryEntry(card.dataset.libraryId);
        if (entry) openLibraryDetail(entry);
      });
    });
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
    if (state.libraryDetail.entryId) {
      const current = findLibraryEntry(state.libraryDetail.entryId);
      if (current) renderLibraryDetail();
      else closeLibraryDetail();
    }
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
    const formSnapshot = (() => {
      const snapshot = state.lastGenerationFormSnapshot && typeof state.lastGenerationFormSnapshot === 'object'
        ? JSON.parse(JSON.stringify(state.lastGenerationFormSnapshot))
        : {};
      if (generationMode !== 'result') return snapshot;
      const raw = state.resultFollowup?.rawTranscript;
      if (!raw || typeof raw !== 'object') return snapshot;
      const initialOutput = String(raw.initialOutput || '').trim();
      const rounds = Array.isArray(raw.rounds)
        ? raw.rounds
          .map((entry) => ({
            action: String(entry?.action || 'ask').trim().toLowerCase() === 'final' ? 'final' : 'ask',
            round: Number(entry?.round) || 0,
            rawOutput: String(entry?.rawOutput || '').trim(),
            capturedAt: String(entry?.capturedAt || '').trim(),
          }))
          .filter((entry) => entry.rawOutput)
        : [];
      if (!initialOutput && !rounds.length) return snapshot;
      snapshot.__followupRaw = { initialOutput, rounds };
      return snapshot;
    })();
    const payload = {
      title: el('library-title').value.trim() || `${state.lastPromptContext.unterkategorie} - ${state.lastPromptContext.fach}`,
      descriptionText: '',
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
      formSnapshot,
      metapromptText: state.generatedMetaPrompt || state.generatedPrompt,
      resultText: state.generatedResult || '',
      hasResult: Boolean(state.generatedResult),
    };

    const statusNode = el('save-library-status');
    if (statusNode) statusNode.textContent = 'Speichere...';
    try {
      await api('/api/library', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (statusNode) statusNode.textContent = 'Gespeichert.';
      emitNotice('Bibliothekseintrag gespeichert.', 'ok');
      setTimeout(() => {
        if (statusNode?.textContent === 'Gespeichert.') statusNode.textContent = '';
      }, 1600);
    } catch (error) {
      if (statusNode) statusNode.textContent = `Fehler: ${error.message}`;
      throw error;
    }
  }

  function shouldTreatAsCardOpen(event) {
    if (event.target.closest('button,select,input,textarea,label,a')) return false;
    return true;
  }

  async function handleLibraryAction(event) {
    const card = event.target.closest('[data-library-id]');
    if (!card) return;

    const libraryId = card.dataset.libraryId;
    const item = findLibraryEntry(libraryId);
    if (!item) return;

    const button = event.target.closest('button[data-action]');
    const interactiveTarget = event.target.closest('button,select,input,textarea,label,a,[data-no-open="true"]');
    if (!button) {
      if (interactiveTarget) return;
      if (!shouldTreatAsCardOpen(event)) return;
      openLibraryDetail(item);
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (button.dataset.action === 'artifact-tab') {
      switchArtifactTab(card, item, button.dataset.artifact);
      return;
    }

    if (button.dataset.action === 'reuse-lib') {
      await openLibraryTemplate(libraryId);
      return;
    }

    if (button.dataset.action === 'favorite-lib') {
      const nextFavorite = !item.isFavorite;
      await api(`/api/library/${encodeURIComponent(String(libraryId))}/favorite`, {
        method: 'PUT',
        body: JSON.stringify({ isFavorite: nextFavorite }),
      });
      updateEntryInCollections(libraryId, (entry) => ({ ...entry, isFavorite: nextFavorite }));
      renderLibraryList();
      if (state.libraryDetail.entryId && String(state.libraryDetail.entryId) === String(libraryId)) {
        renderLibraryDetail();
      }
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
      if (state.libraryDetail.entryId === item.id) closeLibraryDetail();
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
      openLibraryDetail(item, { editDescription: true });
    }
  }

  function bindEvents() {
    bindDetailEvents();
  }

  return {
    bindEvents,
    prepareLibraryFilters,
    refreshLibrary,
    saveCurrentPromptToLibrary,
    handleLibraryAction,
    setOpenLibraryHandler,
    closeLibraryDetail,
  };
}

export { createLibraryController };
