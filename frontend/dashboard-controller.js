function createDashboardController({
  state,
  el,
  api,
  notify = null,
  showScreen,
}) {
  let openHistoryHandler = null;
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

  function emitNotice(message = '', type = 'info') {
    const text = String(message || '').trim();
    if (!text || typeof notify !== 'function') return;
    notify(text, { type });
  }

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
        .join('')
      : '<li><span>Noch keine Verlaufseinträge. Generiere zuerst einen Prompt und speichere ihn im Verlauf.</span></li>';
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
    if (!el('usage-budget-global-limit')) return;
    el('usage-budget-global-limit').value = '';
    el('usage-budget-global-period').value = 'monthly';
    el('usage-budget-global-active').checked = false;
  }

  function renderOwnBudgetPolicies() {
    const panel = el('usage-budget-panel');
    if (!panel) return;
    const visible = hasPermission('budgets.manage_own');
    panel.classList.toggle('is-hidden', !visible);
    if (!visible) return;

    const personalList = el('usage-budget-personal-list');
    const assignedList = el('usage-budget-assigned-list');
    const globalUsed = el('usage-budget-global-used');
    const globalLimitNode = el('usage-budget-global-limit');
    const globalPeriodNode = el('usage-budget-global-period');
    const globalActiveNode = el('usage-budget-global-active');
    const own = Array.isArray(state.usage.budgets?.ownPolicies) ? state.usage.budgets.ownPolicies : [];
    const findPolicy = (scopeType, scopeValue) => {
      const normalizedScopeValue = String(scopeValue || '').trim();
      const matches = own.filter((entry) => {
        if (entry.scopeType !== scopeType) return false;
        const entryValue = String(entry.scopeValue || '').trim();
        if (scopeType === 'user') return entryValue.toLowerCase() === normalizedScopeValue.toLowerCase();
        return entryValue === normalizedScopeValue;
      });
      if (!matches.length) return null;
      return matches.find((entry) => entry.period === 'monthly')
        || matches.find((entry) => entry.period === 'weekly')
        || matches.find((entry) => entry.period === 'daily')
        || matches[0];
    };

    const globalPolicy = findPolicy('user', state.currentUser);
    const totalCost = Number(state.usage.summary?.totalCostUsd || 0);
    if (globalUsed) {
      const totalLabel = globalPolicy ? `$${Number(globalPolicy.limitUsd || 0).toFixed(4)}` : 'kein Limit';
      globalUsed.textContent = `Used / Total: $${totalCost.toFixed(4)} / ${totalLabel}`;
    }
    if (globalLimitNode && globalPeriodNode && globalActiveNode) {
      globalLimitNode.value = globalPolicy ? Number(globalPolicy.limitUsd || 0).toString() : '';
      globalPeriodNode.value = globalPolicy?.period || 'monthly';
      globalActiveNode.checked = !!globalPolicy?.isActive;
    }

    const usageByFingerprint = new Map(
      (Array.isArray(state.usage.summary?.byKeyFingerprints) ? state.usage.summary.byKeyFingerprints : [])
        .map((entry) => [String(entry.keyFingerprint || ''), entry])
    );

    const providers = Array.isArray(state.providers) ? state.providers : [];
    const personalRowsByFingerprint = new Map();
    providers
      .filter((provider) => !provider.systemKeyId)
      .forEach((provider) => {
        const keyFingerprint = String(provider.ownKeyFingerprint || '').trim();
        if (!keyFingerprint || personalRowsByFingerprint.has(keyFingerprint)) return;
        personalRowsByFingerprint.set(keyFingerprint, {
          rowId: `personal:${provider.id}:${keyFingerprint}`,
          keyFingerprint,
          name: provider.name,
          providerKind: provider.kind,
          model: provider.model,
          sourceLabel: 'persönlich',
        });
      });

    const assignedRowsByKey = new Map();
    const assignedSystemKeys = Array.isArray(state.assignedSystemKeys) ? state.assignedSystemKeys : [];
    assignedSystemKeys.forEach((entry) => {
      const keyId = String(entry.systemKeyId || '').trim();
      if (!keyId || assignedRowsByKey.has(keyId)) return;
      const assignmentBudgets = (Array.isArray(entry.assignments) ? entry.assignments : [])
        .filter((assignment) => assignment?.budgetIsActive && assignment?.budgetLimitUsd !== null && assignment?.budgetLimitUsd !== undefined);
      assignmentBudgets.sort((a, b) => {
        const priority = { user: 0, role: 1, group: 2, global: 3 };
        const aPriority = priority[String(a.scopeType || '').toLowerCase()] ?? 9;
        const bPriority = priority[String(b.scopeType || '').toLowerCase()] ?? 9;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return Number(a.budgetLimitUsd || 0) - Number(b.budgetLimitUsd || 0);
      });
      const assignedBudget = assignmentBudgets[0] || null;
      assignedRowsByKey.set(keyId, {
        rowId: `assigned:${keyId}:${String(entry.keyFingerprint || '').trim()}`,
        keyFingerprint: String(entry.keyFingerprint || '').trim(),
        name: entry.name || keyId,
        providerKind: entry.providerKind || '',
        model: entry.modelHint || '',
        sourceLabel: 'zugewiesen',
        assignedBudget,
      });
    });
    providers
      .filter((provider) => !!provider.systemKeyId)
      .forEach((provider) => {
        const keyId = String(provider.systemKeyId || '').trim();
        if (!keyId) return;
        const existing = assignedRowsByKey.get(keyId);
        if (existing) {
          if (!existing.keyFingerprint && provider.systemKeyFingerprint) {
            existing.keyFingerprint = String(provider.systemKeyFingerprint || '').trim();
            existing.rowId = `assigned:${keyId}:${existing.keyFingerprint}`;
          }
          if (!existing.model && provider.model) existing.model = provider.model;
          return;
        }
        assignedRowsByKey.set(keyId, {
          rowId: `assigned:${keyId}:${String(provider.systemKeyFingerprint || '').trim()}`,
          keyFingerprint: String(provider.systemKeyFingerprint || '').trim(),
          name: provider.name || keyId,
          providerKind: provider.kind || '',
          model: provider.model || '',
          sourceLabel: 'zugewiesen',
          assignedBudget: null,
        });
      });

    const renderRows = (rows) => rows.length
      ? rows.map((row) => {
        const keyFingerprint = String(row.keyFingerprint || '').trim();
        const usage = keyFingerprint ? (usageByFingerprint.get(keyFingerprint) || {}) : {};
        const policy = keyFingerprint ? findPolicy('key', keyFingerprint) : null;
        const canSave = Boolean(keyFingerprint);
        const assignedBudget = row.sourceLabel === 'zugewiesen' ? row.assignedBudget : null;
        const assignedBudgetLabel = assignedBudget
          ? `$${Number(assignedBudget.budgetLimitUsd || 0).toFixed(4)} (${assignedBudget.budgetPeriod || 'monthly'})`
          : 'kein explizites Zuweisungsbudget';
        return `
          <li class="provider-budget-row">
            <div class="provider-budget-left">
              <span class="admin-state-dot ${policy?.isActive ? 'dot-active' : 'dot-muted'}"></span>
              <div class="provider-budget-meta">
                <strong>${row.name}</strong>
                <small>${row.providerKind || '-'} | ${row.model || '-'} | ${row.sourceLabel}</small>
                <small>Used / Total: $${Number(usage.totalCostUsd || 0).toFixed(4)} / ${policy ? `$${Number(policy.limitUsd || 0).toFixed(4)}` : 'kein Limit'}</small>
                ${row.sourceLabel === 'zugewiesen' ? `<small>Zuweisungsbudget: ${assignedBudgetLabel}</small>` : ''}
                <small class="hint">Fingerprint: ${keyFingerprint || 'nicht verfügbar'}</small>
              </div>
            </div>
            <div class="provider-budget-right">
              <div class="admin-budget-input-wrap">
                <span>Set Budget</span>
                <input type="number" min="0" step="0.000001" data-usage-key-budget-limit="${row.rowId}" value="${policy ? Number(policy.limitUsd || 0) : ''}" placeholder="optional" ${canSave ? '' : 'disabled'} />
                <span class="admin-budget-unit">USD</span>
                <select data-usage-key-budget-period="${row.rowId}" ${canSave ? '' : 'disabled'}>
                  <option value="daily" ${policy?.period === 'daily' ? 'selected' : ''}>daily</option>
                  <option value="weekly" ${policy?.period === 'weekly' ? 'selected' : ''}>weekly</option>
                  <option value="monthly" ${(!policy?.period || policy.period === 'monthly') ? 'selected' : ''}>monthly</option>
                </select>
              </div>
              <label class="admin-toggle">
                <input type="checkbox" data-usage-key-budget-active="${row.rowId}" ${policy?.isActive ? 'checked' : ''} ${canSave ? '' : 'disabled'} />
                <span class="admin-toggle-track"><span class="admin-toggle-thumb"></span></span>
                <span class="admin-toggle-text">${policy?.isActive ? 'On' : 'Off'}</span>
              </label>
              <span class="inline-actions">
                <button type="button" class="secondary small" data-save-usage-key-budget="${row.rowId}" data-usage-key-fingerprint="${keyFingerprint}" ${canSave ? '' : 'disabled'}>Speichern</button>
                ${policy ? `<button type="button" class="secondary small" data-delete-own-budget="${policy.id}">Löschen</button>` : ''}
              </span>
            </div>
          </li>
        `;
      }).join('')
      : '<li><span>Keine Einträge.</span></li>';

    personalList.innerHTML = renderRows(Array.from(personalRowsByFingerprint.values()));
    assignedList.innerHTML = renderRows(Array.from(assignedRowsByKey.values()));

    panel.querySelectorAll('[data-delete-own-budget]').forEach((button) => {
      button.addEventListener('click', () => {
        const budgetId = Number(button.dataset.deleteOwnBudget);
        if (!Number.isInteger(budgetId)) return;
        deleteOwnBudgetPolicy(budgetId).catch((error) => emitNotice(error.message, 'error'));
      });
    });
    panel.querySelectorAll('[data-save-usage-key-budget]').forEach((button) => {
      button.addEventListener('click', () => {
        const keyFingerprint = String(button.dataset.usageKeyFingerprint || '').trim();
        const rowId = String(button.dataset.saveUsageKeyBudget || '').trim();
        if (!keyFingerprint || !rowId) return;
        saveOwnKeyBudgetPolicy(rowId, keyFingerprint).catch((error) => emitNotice(error.message, 'error'));
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
    const [payload, summary, providers, assignedKeysPayload] = await Promise.all([
      api('/api/usage/budgets'),
      api('/api/usage/summary?days=30'),
      api('/api/providers').catch(() => state.providers),
      api('/api/providers/assigned-system-keys').catch(() => ({ enabled: state.systemKeysEnabled !== false, keys: state.assignedSystemKeys || [] })),
    ]);
    state.usage.budgets = {
      ownPolicies: Array.isArray(payload?.ownPolicies) ? payload.ownPolicies : [],
      effectivePolicies: Array.isArray(payload?.effectivePolicies) ? payload.effectivePolicies : [],
    };
    state.usage.summary = summary || state.usage.summary;
    if (Array.isArray(providers)) {
      state.providers = providers;
    }
    if (assignedKeysPayload && typeof assignedKeysPayload === 'object') {
      state.systemKeysEnabled = assignedKeysPayload.enabled !== false;
      state.assignedSystemKeys = Array.isArray(assignedKeysPayload.keys) ? assignedKeysPayload.keys : [];
    }
    renderOwnBudgetPolicies();
  }

  async function saveOwnGlobalBudgetPolicy() {
    const limitUsd = Number(String(el('usage-budget-global-limit').value || '').trim().replace(',', '.'));
    if (!Number.isFinite(limitUsd) || limitUsd < 0) {
      emitNotice('Bitte ein gültiges Limit in USD angeben.', 'error');
      return;
    }
    const payload = {
      scopeType: 'user',
      scopeValue: state.currentUser,
      period: el('usage-budget-global-period').value,
      limitUsd,
      mode: 'hybrid',
      warningRatio: 0.9,
      isActive: !!el('usage-budget-global-active').checked,
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

  async function saveOwnKeyBudgetPolicy(rowId, keyFingerprint) {
    const limitNode = el('usage-budget-panel').querySelector(`[data-usage-key-budget-limit="${rowId}"]`);
    const periodNode = el('usage-budget-panel').querySelector(`[data-usage-key-budget-period="${rowId}"]`);
    const activeNode = el('usage-budget-panel').querySelector(`[data-usage-key-budget-active="${rowId}"]`);
    if (!limitNode || !periodNode || !activeNode) return;

    const limitUsd = Number(String(limitNode.value || '').trim().replace(',', '.'));
    if (!Number.isFinite(limitUsd) || limitUsd < 0) {
      emitNotice('Bitte ein gültiges Limit in USD angeben.', 'error');
      return;
    }
    await api('/api/usage/budgets', {
      method: 'PUT',
      body: JSON.stringify({
        scopeType: 'key',
        scopeValue: keyFingerprint,
        period: String(periodNode.value || 'monthly'),
        limitUsd,
        mode: 'hybrid',
        warningRatio: 0.9,
        isActive: !!activeNode.checked,
      }),
    });
    el('usage-budget-status').textContent = 'Gespeichert.';
    await refreshOwnBudgets();
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
    if (normalized === 'providers') {
      await refreshOwnBudgets();
    } else if (normalized === 'usage' && refreshUsage) {
      await refreshSummary();
    } else if (normalized === 'usage') {
      renderSummary();
    }
    if (normalized === 'history') {
      await refreshHistory();
    }
  }

  async function openDashboard(tabName = 'providers') {
    await setDashboardTab(tabName, { refreshUsage: tabName === 'usage' });
    showScreen('dashboard');
  }

  function setOpenHistoryHandler(handler) {
    openHistoryHandler = typeof handler === 'function' ? handler : null;
  }

  function handleHistoryReuse(event) {
    const button = event.target.closest('button[data-history-reuse]');
    if (!button) return;
    const entryId = String(button.dataset.historyReuse || '').trim();
    if (!entryId) return;
    const entry = (Array.isArray(state.history) ? state.history : []).find((item) => String(item.id || '') === entryId);
    if (!entry) return;
    if (typeof openHistoryHandler !== 'function') {
      emitNotice('Wiederverwenden ist aktuell nicht verfügbar.', 'error');
      return;
    }
    const opened = openHistoryHandler(entry);
    if (opened !== false) {
      showScreen('form');
    }
  }

  function bindEvents() {
    el('btn-dashboard').addEventListener('click', () => openDashboard('usage').catch((error) => emitNotice(error.message, 'error')));
    el('btn-back-home-from-dashboard').addEventListener('click', () => showScreen('home'));
    document.querySelectorAll('[data-dashboard-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setDashboardTab(button.dataset.dashboardTab, { refreshUsage: button.dataset.dashboardTab === 'usage' })
          .catch((error) => emitNotice(error.message, 'error'));
      });
    });
    document.querySelectorAll('[data-provider-stage]').forEach((button) => {
      button.addEventListener('click', () => {
        state.dashboard.providerStage = button.dataset.providerStage === 'result' ? 'result' : 'metaprompt';
        renderProviderStageTabs();
        emitProviderStageChange();
      });
    });
    el('usage-refresh').addEventListener('click', () => refreshSummary().catch((error) => emitNotice(error.message, 'error')));
    el('usage-window-days').addEventListener('change', () => refreshSummary().catch((error) => emitNotice(error.message, 'error')));
    if (el('usage-budget-global-save')) {
      el('usage-budget-global-save').addEventListener('click', () => saveOwnGlobalBudgetPolicy().catch((error) => emitNotice(error.message, 'error')));
    }
    if (el('history-list')) {
      el('history-list').addEventListener('click', handleHistoryReuse);
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
    setOpenHistoryHandler,
    getProviderStage: () => state.dashboard.providerStage,
  };
}

export { createDashboardController };
