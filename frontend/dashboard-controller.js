function createDashboardController({
  state,
  el,
  api,
  showScreen,
}) {
  state.usage = {
    windowDays: 30,
    summary: null,
    budgets: {
      ownPolicies: [],
      effectivePolicies: [],
    },
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
    el('usage-prompt-tokens').textContent = String(Math.round(Number(summary.promptTokens || 0)));
    el('usage-completion-tokens').textContent = String(Math.round(Number(summary.completionTokens || 0)));
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
              <td>${Math.round(Number(provider.promptTokens || 0))}</td>
              <td>${Math.round(Number(provider.completionTokens || 0))}</td>
              <td>${Math.round(Number(provider.totalTokens || 0))}</td>
              <td>$${Number(provider.totalCostUsd || 0).toFixed(4)}</td>
              <td>${lastError}</td>
            </tr>
          `;
        })
        .join('')
      : '<tr><td colspan="9">Noch keine Nutzungsdaten verfügbar.</td></tr>';

    const byKey = Array.isArray(summary.byKeyFingerprints) ? summary.byKeyFingerprints : [];
    el('usage-key-list').innerHTML = byKey.length
      ? byKey
        .map((entry) => `
          <li>
            <span>
              <strong>${entry.keyFingerprint}</strong><br/>
              <small>${entry.totalRequests} Requests | In: ${Math.round(Number(entry.promptTokens || 0))} | Out: ${Math.round(Number(entry.completionTokens || 0))} | ${Math.round(Number(entry.totalTokens || 0))} Tokens | $${Number(entry.totalCostUsd || 0).toFixed(4)}</small>
            </span>
          </li>
        `)
        .join('')
      : '<li><span>Noch keine key-bezogenen Nutzungsdaten verfügbar.</span></li>';

    const topTemplates = Array.isArray(summary.topTemplates) ? summary.topTemplates : [];
    el('usage-template-list').innerHTML = topTemplates.length
      ? topTemplates
        .map((entry) => `<li><span><strong>${entry.templateId}</strong><br/><small>${entry.totalRequests} Requests | ${Number(entry.successRate || 0).toFixed(1)}% Erfolg | In: ${Math.round(Number(entry.promptTokens || 0))} | Out: ${Math.round(Number(entry.completionTokens || 0))} | ${Math.round(Number(entry.totalTokens || 0))} Tokens | $${Number(entry.totalCostUsd || 0).toFixed(4)}</small></span></li>`)
        .join('')
      : '<li><span>Noch keine Template-Nutzung im gewählten Zeitraum.</span></li>';
  }

  function renderHistory() {
    const list = el('history-list');
    if (!list) return;
    const entries = Array.isArray(state.history) ? state.history : [];
    list.innerHTML = entries.length
      ? entries
        .map((item) => `<li><span><strong>${item.fach}</strong><br/><small>${item.handlungsfeld}<br/>${item.date}</small></span></li>`)
        .join('')
      : '<li><span>Noch keine Verlaufseinträge.</span></li>';
  }

  async function refreshHistory() {
    state.history = await api('/api/history');
    renderHistory();
  }

  function hasPermission(key) {
    const permissions = Array.isArray(state.access?.permissions) ? state.access.permissions : [];
    return permissions.includes('*') || permissions.includes(key);
  }

  function clearOwnBudgetForm() {
    if (!el('usage-budget-scope-type')) return;
    el('usage-budget-scope-type').value = 'user';
    el('usage-budget-scope-value').value = '';
    el('usage-budget-period').value = 'monthly';
    el('usage-budget-limit-usd').value = '';
    el('usage-budget-mode').value = 'hybrid';
    el('usage-budget-warning-ratio').value = '0.9';
    el('usage-budget-active').value = 'true';
  }

  function renderOwnBudgetPolicies() {
    const panel = el('usage-budget-panel');
    if (!panel) return;
    const visible = hasPermission('budgets.manage_own');
    panel.classList.toggle('is-hidden', !visible);
    if (!visible) return;

    const ownList = el('usage-budget-own-list');
    const effectiveList = el('usage-budget-effective-list');
    const own = Array.isArray(state.usage.budgets?.ownPolicies) ? state.usage.budgets.ownPolicies : [];
    const effective = Array.isArray(state.usage.budgets?.effectivePolicies) ? state.usage.budgets.effectivePolicies : [];

    ownList.innerHTML = own.length
      ? own.map((entry) => `
          <li>
            <span>
              <strong>${entry.scopeType}:${entry.scopeValue}</strong><br/>
              <small>${entry.period} | ${entry.mode} | Limit: $${Number(entry.limitUsd || 0).toFixed(4)} | Warnung: ${Number(entry.warningRatio || 0.9).toFixed(2)}</small>
            </span>
            <button type="button" class="secondary small" data-delete-own-budget="${entry.id}">Löschen</button>
          </li>
        `).join('')
      : '<li><span>Noch keine eigenen Budget-Policies.</span></li>';

    effectiveList.innerHTML = effective.length
      ? effective.map((entry) => `
          <li>
            <span>
              <strong>${entry.scopeType}:${entry.scopeValue}</strong><br/>
              <small>${entry.period} | ${entry.mode} | Limit: $${Number(entry.limitUsd || 0).toFixed(4)} | aktiv: ${entry.isActive ? 'ja' : 'nein'}</small>
            </span>
          </li>
        `).join('')
      : '<li><span>Keine effektiven Policies.</span></li>';

    ownList.querySelectorAll('[data-delete-own-budget]').forEach((button) => {
      button.addEventListener('click', () => {
        const budgetId = Number(button.dataset.deleteOwnBudget);
        if (!Number.isInteger(budgetId)) return;
        deleteOwnBudgetPolicy(budgetId).catch((error) => alert(error.message));
      });
    });
  }

  async function refreshSummary() {
    const days = Number(el('usage-window-days').value || 30);
    state.usage.windowDays = Number.isInteger(days) ? days : 30;
    el('usage-status').textContent = 'Lade...';
    state.usage.summary = await api(`/api/usage/summary?days=${encodeURIComponent(state.usage.windowDays)}`);
    renderSummary();
    el('usage-status').textContent = `Aktualisiert (${new Date().toLocaleTimeString('de-AT')})`;
  }

  async function refreshOwnBudgets() {
    if (!hasPermission('budgets.manage_own')) return;
    const payload = await api('/api/usage/budgets');
    state.usage.budgets = {
      ownPolicies: Array.isArray(payload?.ownPolicies) ? payload.ownPolicies : [],
      effectivePolicies: Array.isArray(payload?.effectivePolicies) ? payload.effectivePolicies : [],
    };
    renderOwnBudgetPolicies();
  }

  async function saveOwnBudgetPolicy() {
    const limitUsd = Number(String(el('usage-budget-limit-usd').value || '').trim().replace(',', '.'));
    const warningRatio = Number(String(el('usage-budget-warning-ratio').value || '').trim().replace(',', '.'));
    if (!Number.isFinite(limitUsd) || limitUsd < 0) {
      alert('Bitte ein gültiges Limit in USD angeben.');
      return;
    }
    const scopeType = el('usage-budget-scope-type').value;
    const scopeValueInput = String(el('usage-budget-scope-value').value || '').trim();
    const scopeValue = scopeType === 'user' ? state.currentUser : scopeValueInput;
    if (!scopeValue) {
      alert('Bitte Scope-Wert angeben.');
      return;
    }
    const payload = {
      scopeType,
      scopeValue,
      period: el('usage-budget-period').value,
      limitUsd,
      mode: el('usage-budget-mode').value,
      warningRatio: Number.isFinite(warningRatio) ? warningRatio : 0.9,
      isActive: el('usage-budget-active').value === 'true',
    };
    el('usage-budget-status').textContent = 'Speichere...';
    await api('/api/usage/budgets', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    clearOwnBudgetForm();
    await refreshOwnBudgets();
    el('usage-budget-status').textContent = 'Gespeichert.';
  }

  async function deleteOwnBudgetPolicy(budgetId) {
    await api(`/api/usage/budgets/${encodeURIComponent(String(budgetId))}`, { method: 'DELETE' });
    await refreshOwnBudgets();
    el('usage-budget-status').textContent = 'Gelöscht.';
  }

  function renderDashboardTabs() {
    const activeTab = state.dashboard.activeTab;
    const panels = ['providers', 'usage', 'history', 'options'];
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
    const resultModeEnabled = !!state.settings?.resultModeEnabled;
    if (hint) {
      hint.textContent = stage === 'result'
        ? (resultModeEnabled
          ? 'Diese Zuordnung wird im aktivierten Result-Modus verwendet.'
          : 'Result-Modus ist aktuell deaktiviert (Optionen). Die Zuordnung wird bereits gespeichert.')
        : 'Diese Zuordnung wird für die Metaprompt-Generierung verwendet.';
    }
  }

  function emitProviderStageChange() {
    document.dispatchEvent(new CustomEvent('dashboard:provider-stage-change', {
      detail: { stage: state.dashboard.providerStage },
    }));
  }

  async function setDashboardTab(tabName, { refreshUsage = false } = {}) {
    const normalized = ['providers', 'usage', 'history', 'options'].includes(tabName) ? tabName : 'providers';
    state.dashboard.activeTab = normalized;
    renderDashboardTabs();
    if (normalized === 'usage' && refreshUsage) {
      await refreshSummary();
      await refreshOwnBudgets();
    } else if (normalized === 'usage') {
      renderOwnBudgetPolicies();
    }
    if (normalized === 'history') {
      await refreshHistory();
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
    if (el('usage-budget-save')) {
      el('usage-budget-save').addEventListener('click', () => saveOwnBudgetPolicy().catch((error) => alert(error.message)));
    }
    if (el('usage-budget-clear')) {
      el('usage-budget-clear').addEventListener('click', () => {
        clearOwnBudgetForm();
        el('usage-budget-status').textContent = '';
      });
    }
    renderDashboardTabs();
    renderProviderStageTabs();
    renderHistory();
    renderOwnBudgetPolicies();
    clearOwnBudgetForm();
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
