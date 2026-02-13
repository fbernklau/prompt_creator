function createHistoryController({ state, el, api }) {
  async function saveHistory(entry) {
    const response = await api('/api/history', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
    const savedEntry = response?.entry || { ...entry, date: new Date().toLocaleString('de-AT') };
    state.history.unshift(savedEntry);
    state.history = state.history.slice(0, 10);
    renderHistory();
  }

  function renderHistory() {
    const entries = Array.isArray(state.history) ? state.history : [];
    el('history-list').innerHTML = entries
      .map((item) => {
        const meta = [
          item.handlungsfeld,
          item.unterkategorie || '',
          item.providerModel ? `Modell: ${item.providerModel}` : '',
          item.generationMode === 'result' ? 'Direktes Ergebnis' : 'Prompt',
        ].filter(Boolean).join(' | ');
        const canReuse = Boolean(item.handlungsfeld && item.unterkategorie);
        return `
          <li>
            <span>
              <strong>${item.fach}</strong><br/>
              <small>${meta}<br/>${item.date || '-'}</small>
            </span>
            <button type="button" class="secondary small" data-history-reuse="${item.id || ''}" ${canReuse ? '' : 'disabled'} title="${canReuse ? 'Eintrag wiederverwenden' : 'Keine wiederverwendbaren Daten'}">
              Wiederverwenden
            </button>
          </li>
        `;
      })
      .join('');

    if (!entries.length) {
      el('history-list').innerHTML = '<li><span>Noch keine Verlaufseinträge.</span></li>';
    }
  }

  return {
    saveHistory,
    renderHistory,
  };
}

export { createHistoryController };
