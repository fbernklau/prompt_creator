function createLibraryController({ state, el, api, getCategoryConfig }) {
  function prepareLibraryFilters() {
    const categoryConfig = getCategoryConfig();
    const categorySelect = el('lib-filter-category');
    categorySelect.innerHTML = `<option value="">Alle Kategorien</option>${Object.keys(categoryConfig)
      .map((name) => `<option value="${name}">${categoryConfig[name].title}</option>`)
      .join('')}`;

    const refreshSubcategories = () => {
      const selectedCategory = categorySelect.value;
      const options = selectedCategory ? categoryConfig[selectedCategory].unterkategorien : [];
      el('lib-filter-subcategory').innerHTML = `<option value="">Alle Unterkategorien</option>${options
        .map((option) => `<option value="${option}">${option}</option>`)
        .join('')}`;
    };

    categorySelect.addEventListener('change', refreshSubcategories);
    refreshSubcategories();
  }

  function renderLibraryList() {
    const list = el('library-list');
    const items = state.libraryMode === 'own' ? state.libraryOwn : state.libraryPublic;
    if (!items.length) {
      list.innerHTML = '<div class="panel tw-library-empty"><span class="hint">Keine Eintraege gefunden.</span></div>';
      return;
    }

    const renderStars = (score = 0) => {
      const rating = Math.max(0, Math.min(5, Number(score) || 0));
      const full = Math.floor(rating);
      const half = rating - full >= 0.5 ? 1 : 0;
      const empty = 5 - full - half;
      return `${'★'.repeat(full)}${half ? '☆' : ''}${'·'.repeat(Math.max(0, empty))}`;
    };

    list.innerHTML = items
      .map((item) => {
        const ratingOptions = [1, 2, 3, 4, 5]
          .map((value) => `<option value="${value}" ${item.myRating === value ? 'selected' : ''}>${value}</option>`)
          .join('');
        const modelBadge = String(item.providerKind || 'custom').toUpperCase();
        const levelBadge = item.handlungsfeld || 'all';
        const scopeBadge = item.isPublic ? 'Community' : 'Personal';
        const ownerLabel = item.userId || 'unbekannt';

        return `
        <article class="library-item tw-library-card" data-library-id="${item.id}">
          <div class="tw-library-card-head">
            <div class="tw-library-card-badges">
              <span class="tw-library-badge tw-library-badge-model">${modelBadge}</span>
              <span class="tw-library-badge">${levelBadge}</span>
              <span class="tw-library-badge">${scopeBadge}</span>
            </div>
            <button type="button" class="tw-library-card-fav" data-action="copy-lib" title="Prompt kopieren">♡</button>
          </div>
          <h3 class="tw-library-card-title">${item.title}</h3>
          <p class="tw-library-card-description">${item.promptText}</p>
          <div class="tw-library-rating-row">
            <span class="tw-library-stars">${renderStars(item.avgRating)}</span>
            <span class="tw-library-rating-value">${item.avgRating.toFixed(2)}</span>
            <span class="tw-library-rating-count">(${item.ratingCount || 0} reviews)</span>
          </div>
          <div class="tw-library-card-foot">
            <span class="tw-library-author">${ownerLabel}</span>
            <button type="button" class="tw-library-try-btn" data-action="copy-lib">Try Prompt</button>
          </div>
          <div class="tw-library-admin-row">
            <span class="library-meta">${item.handlungsfeld} | ${item.unterkategorie} | ${item.fach}</span>
            <label class="inline-actions">Rate:
              <select data-rate-for="${item.id}">
                <option value="">-</option>
                ${ratingOptions}
              </select>
              <button type="button" class="secondary small" data-action="rate-lib">Speichern</button>
            </label>
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
          <pre class="library-text">${item.promptText}</pre>
          <div class="tw-library-tags">
            ${(item.tags || []).slice(0, 5).map((tag) => `<span class="tw-library-tag-chip">${tag}</span>`).join('')}
          </div>
        </article>
      `;
      })
      .join('');
  }

  async function refreshLibrary() {
    const category = el('lib-filter-category').value;
    const subcategory = el('lib-filter-subcategory').value;
    const search = el('lib-filter-search').value.trim();
    if (state.libraryMode === 'own') {
      state.libraryOwn = await api('/api/library');
    } else {
      const params = new URLSearchParams();
      if (category) params.set('handlungsfeld', category);
      if (subcategory) params.set('unterkategorie', subcategory);
      if (search) params.set('search', search);
      state.libraryPublic = await api(`/api/library/public?${params.toString()}`);
    }
    renderLibraryList();
  }

  async function saveCurrentPromptToLibrary() {
    if (!state.generatedPrompt || !state.lastPromptContext) return;
    const payload = {
      title: el('library-title').value.trim() || `${state.lastPromptContext.unterkategorie} - ${state.lastPromptContext.fach}`,
      promptText: state.generatedPrompt,
      fach: state.lastPromptContext.fach,
      handlungsfeld: state.lastPromptContext.handlungsfeld,
      unterkategorie: state.lastPromptContext.unterkategorie,
      isPublic: el('library-public').checked,
      rating: el('library-rating').value ? Number(el('library-rating').value) : null,
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

  async function handleLibraryAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('[data-library-id]');
    if (!card) return;

    const libraryId = card.dataset.libraryId;
    const item = (state.libraryMode === 'own' ? state.libraryOwn : state.libraryPublic).find((entry) => String(entry.id) === String(libraryId));
    if (!item) return;

    if (button.dataset.action === 'copy-lib') {
      navigator.clipboard.writeText(item.promptText);
      return;
    }

    if (button.dataset.action === 'rate-lib') {
      const select = card.querySelector(`select[data-rate-for="${libraryId}"]`);
      if (!select.value) return;
      await api(`/api/library/${libraryId}/rating`, {
        method: 'PUT',
        body: JSON.stringify({ rating: Number(select.value) }),
      });
      await refreshLibrary();
      return;
    }

    if (state.libraryMode !== 'own') return;

    if (button.dataset.action === 'delete-lib') {
      const proceed = confirm('Eintrag wirklich loeschen?');
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
  };
}

export { createLibraryController };
