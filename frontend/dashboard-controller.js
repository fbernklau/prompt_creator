function createDashboardController({
  state,
  el,
  api,
  showScreen,
}) {
  state.usage = {
    windowDays: 30,
    summary: null,
  };
  state.dashboard = state.dashboard || {
    activeTab: 'providers',
    providerStage: 'metaprompt',
  };

  function renderSummary() {
    const summary = state.usage.summary || {};
    el('usage-total-requests').textContent = String(summary.totalRequests || 0);
    el('usage-success-rate').textContent = `${Number(summary.successRate || 0).toFixed(1)}%`;
    el('usage-avg-latency').textContent = `${Number(summary.avgLatencyMs || 0)} ms`;
    el('usage-total-tokens').textContent = String(Math.round(Number(summary.totalTokens || 0)));
    el('usage-total-cost').textContent = `$${Number(summary.totalCostUsd || 0).toFixed(4)}`;

    const providerRows = Array.isArray(summary.byProvider) ? summary.byProvider : [];
    el('usage-provider-body').innerHTML = providerRows.length
      ? providerRows
        .map((provider) => {
          const lastError = provider.lastError?.errorType
            ? `${provider.lastError.errorType}`
            : '-';
          return `
            <tr>
              <td><strong>${provider.providerId}</strong><br/><small>${provider.providerKind}</small></td>
              <td>${provider.totalRequests}</td>
              <td>${Number(provider.successRate || 0).toFixed(1)}%</td>
              <td>${Number(provider.avgLatencyMs || 0)} ms</td>
              <td>${Math.round(Number(provider.totalTokens || 0))}</td>
              <td>$${Number(provider.totalCostUsd || 0).toFixed(4)}</td>
              <td>${lastError}</td>
            </tr>
          `;
        })
        .join('')
      : '<tr><td colspan="7">Noch keine Nutzungsdaten verfuegbar.</td></tr>';

    const byKey = Array.isArray(summary.byKeyFingerprints) ? summary.byKeyFingerprints : [];
    el('usage-key-list').innerHTML = byKey.length
      ? byKey
        .map((entry) => `
          <li>
            <span>
              <strong>${entry.keyFingerprint}</strong><br/>
              <small>${entry.totalRequests} Requests | ${Math.round(Number(entry.totalTokens || 0))} Tokens | $${Number(entry.totalCostUsd || 0).toFixed(4)}</small>
            </span>
          </li>
        `)
        .join('')
      : '<li><span>Noch keine key-bezogenen Nutzungsdaten verfuegbar.</span></li>';

    const topTemplates = Array.isArray(summary.topTemplates) ? summary.topTemplates : [];
    el('usage-template-list').innerHTML = topTemplates.length
      ? topTemplates
        .map((entry) => `<li><span><strong>${entry.templateId}</strong><br/><small>${entry.totalRequests} Requests | ${Number(entry.successRate || 0).toFixed(1)}% Erfolg | ${Math.round(Number(entry.totalTokens || 0))} Tokens | $${Number(entry.totalCostUsd || 0).toFixed(4)}</small></span></li>`)
        .join('')
      : '<li><span>Noch keine Template-Nutzung im gewaehlten Zeitraum.</span></li>';
  }

  async function refreshSummary() {
    const days = Number(el('usage-window-days').value || 30);
    state.usage.windowDays = Number.isInteger(days) ? days : 30;
    el('usage-status').textContent = 'Lade...';
    state.usage.summary = await api(`/api/usage/summary?days=${encodeURIComponent(state.usage.windowDays)}`);
    renderSummary();
    el('usage-status').textContent = `Aktualisiert (${new Date().toLocaleTimeString('de-AT')})`;
  }

  function renderDashboardTabs() {
    const activeTab = state.dashboard.activeTab;
    const panels = ['providers', 'usage', 'options'];
    panels.forEach((name) => {
      const panel = el(`dashboard-tab-${name}`);
      if (panel) panel.classList.toggle('is-hidden', name !== activeTab);
    });
    document.querySelectorAll('[data-dashboard-tab]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.dashboardTab === activeTab);
    });
  }

  function renderProviderStageTabs() {
    const stage = state.dashboard.providerStage === 'result' ? 'result' : 'metaprompt';
    state.dashboard.providerStage = stage;
    document.querySelectorAll('[data-provider-stage]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.providerStage === stage);
    });
    const hint = el('dashboard-provider-stage-hint');
    if (hint) {
      hint.textContent = stage === 'result'
        ? 'Diese Zuordnung wird gespeichert und fuer den optionalen Result-Modus verwendet.'
        : 'Diese Zuordnung wird fuer die Metaprompt-Generierung verwendet.';
    }
  }

  function emitProviderStageChange() {
    document.dispatchEvent(new CustomEvent('dashboard:provider-stage-change', {
      detail: { stage: state.dashboard.providerStage },
    }));
  }

  async function setDashboardTab(tabName, { refreshUsage = false } = {}) {
    const normalized = ['providers', 'usage', 'options'].includes(tabName) ? tabName : 'providers';
    state.dashboard.activeTab = normalized;
    renderDashboardTabs();
    if (normalized === 'usage' && refreshUsage) {
      await refreshSummary();
    }
  }

  async function openDashboard(tabName = 'providers') {
    await setDashboardTab(tabName, { refreshUsage: tabName === 'usage' });
    showScreen('dashboard');
  }

  function bindEvents() {
    el('btn-dashboard').addEventListener('click', () => openDashboard('usage').catch((error) => alert(error.message)));
    el('btn-back-home-from-dashboard').addEventListener('click', () => showScreen('home'));
    document.querySelectorAll('[data-dashboard-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setDashboardTab(button.dataset.dashboardTab, { refreshUsage: button.dataset.dashboardTab === 'usage' })
          .catch((error) => alert(error.message));
      });
    });
    document.querySelectorAll('[data-provider-stage]').forEach((button) => {
      button.addEventListener('click', () => {
        state.dashboard.providerStage = button.dataset.providerStage === 'result' ? 'result' : 'metaprompt';
        renderProviderStageTabs();
        emitProviderStageChange();
      });
    });
    el('usage-refresh').addEventListener('click', () => refreshSummary().catch((error) => alert(error.message)));
    el('usage-window-days').addEventListener('change', () => refreshSummary().catch((error) => alert(error.message)));
    renderDashboardTabs();
    renderProviderStageTabs();
    emitProviderStageChange();
  }

  return {
    bindEvents,
    refreshSummary,
    openDashboard,
    setDashboardTab,
    getProviderStage: () => state.dashboard.providerStage,
  };
}

export { createDashboardController };
