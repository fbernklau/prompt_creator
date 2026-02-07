function createHistoryController({ state, el, api }) {
  async function saveHistory(entry) {
    await api('/api/history', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
    state.history.unshift({ ...entry, date: new Date().toLocaleString('de-AT') });
    state.history = state.history.slice(0, 25);
    renderHistory();
  }

  function renderHistory() {
    el('history-list').innerHTML = state.history
      .map((item) => `<li><span><strong>${item.fach}</strong><br/><small>${item.handlungsfeld}<br/>${item.date}</small></span></li>`)
      .join('');
  }

  return {
    saveHistory,
    renderHistory,
  };
}

export { createHistoryController };
