const DEFAULT_MODEL_PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'mistral', 'custom'];
const SYSTEM_CUSTOM_MODEL = '__custom_model__';
const SYSTEM_PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
};

const PERMISSION_GROUPS = [
  {
    id: 'core',
    title: 'Core & Security',
    match: (key) => key === '*' || key.startsWith('app.') || key.startsWith('admin.') || key.startsWith('rbac.'),
  },
  {
    id: 'prompts',
    title: 'Prompts & Provider',
    match: (key) => key.startsWith('prompts.') || key.startsWith('providers.') || key.startsWith('history.') || key.startsWith('settings.') || key.startsWith('library.'),
  },
  {
    id: 'templates',
    title: 'Templates & Tags',
    match: (key) => key.startsWith('templates.') || key.startsWith('tags.'),
  },
  {
    id: 'pricing',
    title: 'Model Administration',
    match: (key) => key.startsWith('pricing.'),
  },
  {
    id: 'other',
    title: 'Weitere',
    match: () => true,
  },
];

function createAdminController({
  state,
  el,
  api,
  showScreen,
}) {
  let adminState = {
    permissions: [],
    roles: [],
    bindings: [],
    selectedRoleId: null,
    pricingEntries: [],
    selectedPricingId: null,
    systemKeys: [],
    selectedSystemKeyId: '',
    openSystemKeyId: '',
    expandedSystemKeyIds: [],
    expandedAssignmentIds: [],
    systemKeySearchQuery: '',
    systemKeyStatusFilter: 'all',
    systemKeyLevelFilter: 'all',
    showSystemKeyCreateForm: false,
    budgets: [],
    selectedBudgetId: null,
    systemKeysEnabled: true,
    activeTab: 'roles',
    activeModelProvider: 'openai',
  };

  function hasPermission(key) {
    const permissions = state.access?.permissions || [];
    return permissions.includes('*') || permissions.includes(key);
  }

  function escapeHtml(value = '') {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getPermissionGroup(permissionKey = '') {
    const key = String(permissionKey || '');
    const group = PERMISSION_GROUPS.find((entry) => entry.match(key));
    return group?.id || 'other';
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === '') return '-';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return numeric.toFixed(6);
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('de-AT');
  }

  function formatUsd(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '$0.0000';
    return `$${numeric.toFixed(4)}`;
  }

  function parseOptionalNonNegativeNumber(value) {
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) return Number.NaN;
    return numeric;
  }

  function getModelProviders() {
    const providers = new Set(DEFAULT_MODEL_PROVIDER_ORDER);
    adminState.pricingEntries.forEach((entry) => {
      providers.add(String(entry.providerKind || '').trim().toLowerCase());
    });
    return [...providers].filter(Boolean);
  }

  function setStatus(message = '', { pricing = false, systemKey = false, budget = false } = {}) {
    if (pricing) {
      const node = el('admin-pricing-status');
      if (node) node.textContent = message;
      return;
    }
    if (systemKey) {
      const node = el('admin-system-key-status');
      if (node) node.textContent = message;
      return;
    }
    if (budget) {
      const node = el('admin-budget-status');
      if (node) node.textContent = message;
      return;
    }
    el('admin-status').textContent = message;
  }

  function setActiveAdminTab(tabKey) {
    const canManageModelAdmin = hasPermission('pricing.manage');
    const canManageKeyAdmin = hasPermission('providers.system_keys.manage')
      || hasPermission('budgets.manage');
    const requested = String(tabKey || '').trim();
    let nextTab = requested || 'roles';
    if (!canManageModelAdmin && nextTab === 'models') nextTab = 'roles';
    if (!canManageKeyAdmin && nextTab === 'keys') nextTab = 'roles';
    adminState.activeTab = nextTab;

    const tabs = {
      roles: el('admin-tab-roles'),
      groups: el('admin-tab-groups'),
      models: el('admin-tab-models'),
      keys: el('admin-tab-keys'),
    };

    Object.entries(tabs).forEach(([key, node]) => {
      if (!node) return;
      node.classList.toggle('is-hidden', key !== nextTab);
    });

    document.querySelectorAll('#admin-tab-nav [data-admin-tab]').forEach((button) => {
      const isActive = button.dataset.adminTab === nextTab;
      button.classList.toggle('is-active', isActive);
    });
  }

  function ensureAdminVisible() {
    const visible = hasPermission('rbac.manage');
    el('btn-admin').classList.toggle('is-hidden', !visible);
    if (!visible && !el('screen-admin').classList.contains('is-hidden')) {
      showScreen('home');
    }

    const modelAdminVisible = hasPermission('pricing.manage');
    const keyAdminVisible = hasPermission('providers.system_keys.manage')
      || hasPermission('budgets.manage');
    document.querySelectorAll('#admin-tab-nav [data-admin-tab="models"]').forEach((button) => {
      button.classList.toggle('is-hidden', !modelAdminVisible);
    });
    document.querySelectorAll('#admin-tab-nav [data-admin-tab="keys"]').forEach((button) => {
      button.classList.toggle('is-hidden', !keyAdminVisible);
    });
    if (!modelAdminVisible && adminState.activeTab === 'models') {
      setActiveAdminTab('roles');
    }
    if (!keyAdminVisible && adminState.activeTab === 'keys') {
      setActiveAdminTab('roles');
    }
  }

  function togglePermissionGroup(groupId, checked) {
    const container = el('admin-role-permissions');
    container
      .querySelectorAll(`input[type="checkbox"][data-permission-group="${groupId}"]`)
      .forEach((node) => {
        node.checked = checked;
      });
  }

  function renderPermissionChecklist(selected = []) {
    const selectedSet = new Set(selected);
    const grouped = {};
    PERMISSION_GROUPS.forEach((group) => {
      grouped[group.id] = [];
    });
    adminState.permissions.forEach((permission) => {
      const groupId = getPermissionGroup(permission.key);
      if (!grouped[groupId]) grouped[groupId] = [];
      grouped[groupId].push(permission);
    });

    const container = el('admin-role-permissions');
    container.innerHTML = PERMISSION_GROUPS
      .map((group) => {
        const items = grouped[group.id] || [];
        if (!items.length) return '';
        return `
          <div class="admin-permission-group">
            <div class="admin-permission-group-head">
              <h4>${escapeHtml(group.title)}</h4>
              <span class="inline-actions">
                <button type="button" class="secondary small" data-admin-perm-group-all="${group.id}">Alle</button>
                <button type="button" class="secondary small" data-admin-perm-group-none="${group.id}">Keine</button>
              </span>
            </div>
            <div class="admin-permissions-grid">
              ${items.map((permission) => `
                <label class="checkbox">
                  <input type="checkbox" data-permission-group="${group.id}" value="${escapeHtml(permission.key)}" ${selectedSet.has(permission.key) ? 'checked' : ''} />
                  <span><strong>${escapeHtml(permission.key)}</strong> - ${escapeHtml(permission.description || '')}</span>
                </label>
              `).join('')}
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-admin-perm-group-all]').forEach((button) => {
      button.onclick = () => togglePermissionGroup(button.dataset.adminPermGroupAll, true);
    });
    container.querySelectorAll('[data-admin-perm-group-none]').forEach((button) => {
      button.onclick = () => togglePermissionGroup(button.dataset.adminPermGroupNone, false);
    });
  }

  function renderRoleSelect() {
    const select = el('admin-role-select');
    select.innerHTML = adminState.roles
      .map((role) => `<option value="${role.id}" ${role.id === adminState.selectedRoleId ? 'selected' : ''}>${escapeHtml(role.roleKey)}</option>`)
      .join('');

    if (!adminState.selectedRoleId && adminState.roles.length) {
      adminState.selectedRoleId = adminState.roles[0].id;
      select.value = String(adminState.selectedRoleId);
    }
  }

  function renderRoleDetails() {
    const role = adminState.roles.find((entry) => entry.id === adminState.selectedRoleId);
    if (!role) {
      el('admin-role-name').value = '';
      el('admin-role-description').value = '';
      renderPermissionChecklist([]);
      return;
    }
    el('admin-role-name').value = role.roleName;
    el('admin-role-description').value = role.description || '';
    renderPermissionChecklist(role.permissionKeys || []);
    el('admin-role-system').textContent = role.isSystem ? 'Systemrolle (nicht löschbar)' : 'Benutzerdefinierte Rolle';
  }

  function renderBindings() {
    const roleOptions = adminState.roles
      .map((role) => `<option value="${role.id}">${escapeHtml(role.roleKey)}</option>`)
      .join('');
    el('admin-binding-role').innerHTML = roleOptions;

    const list = el('admin-binding-list');
    list.innerHTML = adminState.bindings
      .map((binding) => `
        <li>
          <span><strong>${escapeHtml(binding.groupName)}</strong> -> ${escapeHtml(binding.roleKey)}</span>
          <button type="button" class="secondary small" data-delete-binding="${binding.id}">Loeschen</button>
        </li>
      `)
      .join('');

    list.querySelectorAll('[data-delete-binding]').forEach((button) => {
      button.onclick = () => removeBinding(button.dataset.deleteBinding).catch((error) => alert(error.message));
    });
  }

  function clearPricingForm() {
    adminState.selectedPricingId = null;
    const provider = adminState.activeModelProvider || 'openai';
    el('admin-pricing-provider-kind').value = provider;
    el('admin-pricing-model').value = '';
    el('admin-pricing-currency').value = 'USD';
    el('admin-pricing-input').value = '';
    el('admin-pricing-output').value = '';
    el('admin-pricing-active').value = 'true';
  }

  function clearSystemKeyForm() {
    adminState.selectedSystemKeyId = '';
    el('admin-system-key-id').value = '';
    el('admin-system-key-name').value = '';
    el('admin-system-key-provider-kind').value = 'openai';
    syncSystemKeyModelOptions();
    el('admin-system-key-model-custom').value = '';
    el('admin-system-key-base-url').value = SYSTEM_PROVIDER_BASE_URLS.openai;
    el('admin-system-key-api-key').value = '';
    el('admin-system-key-active').value = 'true';
  }

  function clearBudgetForm() {
    adminState.selectedBudgetId = null;
    if (!el('admin-budget-scope-type')) return;
    el('admin-budget-scope-type').value = 'user';
    el('admin-budget-scope-value').value = '';
    el('admin-budget-period').value = 'monthly';
    el('admin-budget-limit-usd').value = '';
    el('admin-budget-mode').value = 'hybrid';
    el('admin-budget-warning-ratio').value = '0.9';
    el('admin-budget-active').value = 'true';
    el('admin-budget-owner-user').value = '';
  }

  function getSystemProviderModels(providerKind = 'openai') {
    const normalized = String(providerKind || '').trim().toLowerCase();
    return adminState.pricingEntries
      .filter((entry) => String(entry.providerKind || '').trim().toLowerCase() === normalized)
      .map((entry) => String(entry.model || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  function getSelectedSystemKeyModelHint() {
    const selected = el('admin-system-key-model-select').value;
    if (selected === SYSTEM_CUSTOM_MODEL) {
      return String(el('admin-system-key-model-custom').value || '').trim();
    }
    return String(selected || '').trim();
  }

  function syncSystemKeyModelOptions(preferredValue = '') {
    const providerKind = String(el('admin-system-key-provider-kind').value || 'openai').trim().toLowerCase();
    const select = el('admin-system-key-model-select');
    const customWrap = el('admin-system-key-model-custom-wrap');
    const customInput = el('admin-system-key-model-custom');
    const models = getSystemProviderModels(providerKind);
    const normalizedPreferred = String(preferredValue || '').trim();
    select.innerHTML = [
      ...models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`),
      `<option value="${SYSTEM_CUSTOM_MODEL}">Custom...</option>`,
    ].join('');

    if (normalizedPreferred && models.includes(normalizedPreferred)) {
      select.value = normalizedPreferred;
      customInput.value = '';
      customWrap.classList.add('is-hidden');
      return;
    }
    if (normalizedPreferred) {
      select.value = SYSTEM_CUSTOM_MODEL;
      customInput.value = normalizedPreferred;
      customWrap.classList.remove('is-hidden');
      return;
    }
    if (models.length) {
      select.value = models[0];
      customInput.value = '';
      customWrap.classList.add('is-hidden');
      return;
    }
    select.value = SYSTEM_CUSTOM_MODEL;
    customInput.value = '';
    customWrap.classList.remove('is-hidden');
  }

  function syncSystemKeyBaseUrl() {
    const providerKind = String(el('admin-system-key-provider-kind').value || 'openai').trim().toLowerCase();
    const baseUrlInput = el('admin-system-key-base-url');
    const current = String(baseUrlInput.value || '').trim();
    const recommended = SYSTEM_PROVIDER_BASE_URLS[providerKind] || '';
    if (!recommended) return;
    if (!current || Object.values(SYSTEM_PROVIDER_BASE_URLS).includes(current)) {
      baseUrlInput.value = recommended;
    }
  }

  function getUsageState(usedUsd, limitUsd, isActive) {
    if (!isActive) return 'inactive';
    if (limitUsd === null || limitUsd === undefined || limitUsd === '') return 'active';
    const limit = Number(limitUsd);
    const used = Number(usedUsd || 0);
    if (!Number.isFinite(limit) || limit <= 0) return 'active';
    const ratio = used / limit;
    if (ratio >= 1) return 'danger';
    if (ratio >= 0.8) return 'warning';
    return 'active';
  }

  function getUsageStateLabel(state) {
    if (state === 'danger') return 'Über Budget';
    if (state === 'warning') return 'Warnung';
    if (state === 'inactive') return 'Inaktiv';
    return 'Aktiv';
  }

  function formatUsedTotalLabel({ usedUsd = 0, limitUsd = null }) {
    if (limitUsd === null || limitUsd === undefined || limitUsd === '') {
      return `${formatUsd(usedUsd)} / unbegrenzt`;
    }
    return `${formatUsd(usedUsd)} / ${formatUsd(limitUsd)}`;
  }

  function matchesTextSearch(haystackValues = [], query = '') {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) return true;
    return haystackValues.some((value) => String(value || '').toLowerCase().includes(normalized));
  }

  function renderSystemKeyList() {
    const container = el('admin-system-key-list');
    if (!container) return;
    if (!hasPermission('providers.system_keys.manage')) {
      container.innerHTML = '<p class="hint">Keine Berechtigung für systemweite API-Keys.</p>';
      return;
    }

    const keys = Array.isArray(adminState.systemKeys) ? adminState.systemKeys : [];
    const searchQuery = String(adminState.systemKeySearchQuery || '').trim();
    const statusFilter = String(adminState.systemKeyStatusFilter || 'all').trim();
    const levelFilter = String(adminState.systemKeyLevelFilter || 'all').trim();

    const totalUsedUsd = keys.reduce((sum, key) => sum + Number(key.usage?.spendUsd || 0), 0);
    const totalLimitValues = keys
      .map((key) => (key.budgetLimitUsd === null || key.budgetLimitUsd === undefined ? null : Number(key.budgetLimitUsd)))
      .filter((value) => Number.isFinite(value));
    const globalLimitUsd = totalLimitValues.length ? totalLimitValues.reduce((sum, value) => sum + value, 0) : null;
    const globalLabel = formatUsedTotalLabel({ usedUsd: totalUsedUsd, limitUsd: globalLimitUsd });

    const filteredKeys = keys.filter((key) => {
      const keyState = getUsageState(Number(key.usage?.spendUsd || 0), key.budgetLimitUsd, key.isActive);
      const assignments = Array.isArray(key.assignments) ? key.assignments : [];
      const keyTextValues = [key.name, key.systemKeyId, key.providerKind, key.modelHint, key.baseUrl];

      const matchingAssignments = assignments.filter((assignment) => {
        return matchesTextSearch([
          assignment.scopeType,
          assignment.scopeValue,
          assignment.budgetPeriod,
          assignment.budgetLimitUsd,
          assignment.perUserBudgetPeriod,
          assignment.perUserBudgetLimitUsd,
        ], searchQuery);
      });

      const matchingQuotas = assignments.filter((assignment) => {
        const hasPerUserLimit = assignment.perUserBudgetLimitUsd !== null && assignment.perUserBudgetLimitUsd !== undefined;
        return hasPerUserLimit && matchesTextSearch([
          assignment.scopeType,
          assignment.scopeValue,
          assignment.perUserBudgetPeriod,
          assignment.perUserBudgetLimitUsd,
        ], searchQuery);
      });

      const keyMatchesQuery = matchesTextSearch(keyTextValues, searchQuery);

      let levelMatches = false;
      if (levelFilter === 'keys') {
        levelMatches = keyMatchesQuery || !searchQuery;
      } else if (levelFilter === 'assignments') {
        levelMatches = matchingAssignments.length > 0 || (!searchQuery && assignments.length > 0);
      } else if (levelFilter === 'quotas') {
        levelMatches = matchingQuotas.length > 0 || (!searchQuery && assignments.some((assignment) => assignment.perUserBudgetLimitUsd !== null && assignment.perUserBudgetLimitUsd !== undefined));
      } else {
        levelMatches = keyMatchesQuery || matchingAssignments.length > 0 || matchingQuotas.length > 0 || !searchQuery;
      }
      if (!levelMatches) return false;

      if (statusFilter === 'all') return true;
      const assignmentStates = assignments.map((assignment) => getUsageState(
        Number(assignment.usage?.spendUsd || 0),
        assignment.budgetLimitUsd,
        assignment.isActive
      ));
      if (levelFilter === 'keys') return keyState === statusFilter;
      if (levelFilter === 'assignments' || levelFilter === 'quotas') return assignmentStates.some((state) => state === statusFilter);
      return keyState === statusFilter || assignmentStates.some((state) => state === statusFilter);
    });

    const globalState = getUsageState(totalUsedUsd, globalLimitUsd, adminState.systemKeysEnabled);
    const globalDotClass = globalState === 'danger'
      ? 'dot-danger'
      : globalState === 'warning'
        ? 'dot-warning'
        : globalState === 'inactive'
          ? 'dot-muted'
          : 'dot-active';

    container.innerHTML = `
      <div class="admin-key-shell">
        <div class="admin-key-toolbar">
          <label class="admin-key-search-wrap">
            <span class="material-icons-round">search</span>
            <input id="admin-system-key-search" placeholder="Suche nach Keys, Assignments oder Usern..." value="${escapeHtml(searchQuery)}" />
          </label>
          <label>Status
            <select id="admin-system-key-filter-status">
              <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
              <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option>
              <option value="warning" ${statusFilter === 'warning' ? 'selected' : ''}>Warning</option>
              <option value="danger" ${statusFilter === 'danger' ? 'selected' : ''}>Over Budget</option>
              <option value="inactive" ${statusFilter === 'inactive' ? 'selected' : ''}>Inactive</option>
            </select>
          </label>
          <label>Level
            <select id="admin-system-key-filter-level">
              <option value="all" ${levelFilter === 'all' ? 'selected' : ''}>All Levels</option>
              <option value="keys" ${levelFilter === 'keys' ? 'selected' : ''}>Keys</option>
              <option value="assignments" ${levelFilter === 'assignments' ? 'selected' : ''}>Assignments</option>
              <option value="quotas" ${levelFilter === 'quotas' ? 'selected' : ''}>User Quotas</option>
            </select>
          </label>
        </div>

        <div class="admin-global-budget-row admin-level-row">
          <div class="admin-level-left">
            <input type="checkbox" class="admin-row-check" />
            <span class="admin-state-dot ${globalDotClass}"></span>
            <span class="material-icons-round admin-row-icon">public</span>
            <div class="admin-key-ident">
              <strong>Global System Budget</strong>
              <small>${keys.length} Keys im Katalog</small>
            </div>
          </div>
          <div class="admin-level-right">
            <div class="admin-budget-input-wrap admin-budget-readonly">
              <span>Set Budget</span>
              <input type="text" value="aggregiert aus Key-Limits" readonly />
            </div>
            <small class="admin-used-total"><span>Used/Total:</span> <strong>${globalLabel}</strong></small>
            <label class="admin-toggle">
              <input id="admin-system-keys-enabled" type="checkbox" ${adminState.systemKeysEnabled ? 'checked' : ''} />
              <span class="admin-toggle-track"><span class="admin-toggle-thumb"></span></span>
              <span class="admin-toggle-text">${adminState.systemKeysEnabled ? 'On' : 'Off'}</span>
            </label>
            <button id="admin-system-keys-enabled-save" type="button" class="secondary small">Save</button>
          </div>
        </div>

        <div class="admin-key-list ${filteredKeys.length ? '' : 'is-empty'}">
          ${filteredKeys.length
            ? filteredKeys.map((key) => {
              const keyId = String(key.systemKeyId || '');
              const keyExpanded = (adminState.expandedSystemKeyIds || []).includes(keyId);
              const keyEditOpen = adminState.openSystemKeyId === keyId;
              const keyState = getUsageState(Number(key.usage?.spendUsd || 0), key.budgetLimitUsd, key.isActive);
              const keyDotClass = keyState === 'danger'
                ? 'dot-danger'
                : keyState === 'warning'
                  ? 'dot-warning'
                  : keyState === 'inactive'
                    ? 'dot-muted'
                    : 'dot-active';
              const keyUsageLabel = formatUsedTotalLabel({
                usedUsd: Number(key.usage?.spendUsd || 0),
                limitUsd: key.budgetLimitUsd,
              });
              const assignments = Array.isArray(key.assignments) ? key.assignments : [];

              return `
                <div class="admin-key-node admin-level-1">
                  <div class="admin-key-row admin-level-row">
                    <div class="admin-level-left">
                      <input type="checkbox" class="admin-row-check" />
                      <span class="admin-state-dot ${keyDotClass}"></span>
                      <button type="button" class="secondary small admin-collapse-btn" data-admin-toggle-key="${escapeHtml(keyId)}" aria-label="Key ein-/ausklappen">
                        <span class="material-icons-round">${keyExpanded ? 'expand_more' : 'chevron_right'}</span>
                      </button>
                      <span class="material-icons-round admin-row-icon">key</span>
                      <div class="admin-key-ident">
                        <strong>Key: ${escapeHtml(key.name || keyId)}</strong>
                        <small>${escapeHtml(key.systemKeyId)} | ${escapeHtml(key.providerKind)} | ${escapeHtml(key.modelHint || '-')}</small>
                      </div>
                    </div>
                    <div class="admin-level-right">
                      <div class="admin-budget-input-wrap">
                        <span>Set Budget</span>
                        <input type="number" min="0" step="0.000001" data-system-key-budget-limit="${escapeHtml(keyId)}" value="${key.budgetLimitUsd ?? ''}" placeholder="optional" />
                        <span class="admin-budget-unit">USD</span>
                        <select data-system-key-budget-period="${escapeHtml(keyId)}">
                          <option value="daily" ${key.budgetPeriod === 'daily' ? 'selected' : ''}>daily</option>
                          <option value="weekly" ${key.budgetPeriod === 'weekly' ? 'selected' : ''}>weekly</option>
                          <option value="monthly" ${(!key.budgetPeriod || key.budgetPeriod === 'monthly') ? 'selected' : ''}>monthly</option>
                        </select>
                      </div>
                      <small class="admin-used-total"><span>Used/Total:</span> <strong>${keyUsageLabel}</strong></small>
                      <label class="admin-toggle">
                        <input type="checkbox" data-system-key-active="${escapeHtml(keyId)}" ${key.isActive ? 'checked' : ''} />
                        <span class="admin-toggle-track"><span class="admin-toggle-thumb"></span></span>
                        <span class="admin-toggle-text">${key.isActive ? 'On' : 'Off'}</span>
                      </label>
                      <span class="inline-actions">
                        <button type="button" class="secondary small" data-toggle-system-key-details="${escapeHtml(keyId)}">${keyEditOpen ? 'Editor schließen' : 'Edit key'}</button>
                        <button type="button" class="secondary small" data-save-system-key-row="${escapeHtml(keyId)}">Speichern</button>
                      </span>
                    </div>
                  </div>

                  <div class="admin-key-content ${keyExpanded ? '' : 'is-hidden'}" data-system-key-collapse="${escapeHtml(keyId)}">
                    <div class="admin-key-edit-grid ${keyEditOpen ? '' : 'is-hidden'}" data-system-key-details="${escapeHtml(keyId)}">
                      <label>Name
                        <input type="text" data-system-key-name="${escapeHtml(keyId)}" value="${escapeHtml(key.name || '')}" />
                      </label>
                      <label>Provider
                        <select data-system-key-provider-kind="${escapeHtml(keyId)}">
                          <option value="openai" ${key.providerKind === 'openai' ? 'selected' : ''}>openai</option>
                          <option value="anthropic" ${key.providerKind === 'anthropic' ? 'selected' : ''}>anthropic</option>
                          <option value="google" ${key.providerKind === 'google' ? 'selected' : ''}>google</option>
                          <option value="mistral" ${key.providerKind === 'mistral' ? 'selected' : ''}>mistral</option>
                          <option value="custom" ${key.providerKind === 'custom' ? 'selected' : ''}>custom</option>
                        </select>
                      </label>
                      <label>Modell-Hinweis
                        <input type="text" data-system-key-model-hint="${escapeHtml(keyId)}" value="${escapeHtml(key.modelHint || '')}" placeholder="z. B. gpt-4.1" />
                      </label>
                      <label>Base URL
                        <input type="text" data-system-key-base-url="${escapeHtml(keyId)}" value="${escapeHtml(key.baseUrl || '')}" placeholder="optional" />
                      </label>
                      <label>API-Key (optional)
                        <input type="password" data-system-key-api-key="${escapeHtml(keyId)}" placeholder="leer = vorhandenen Key behalten" />
                      </label>
                    </div>

                    <div class="admin-assignment-group">
                      ${assignments.length
                        ? assignments.map((assignment) => {
                          const assignmentRef = `${keyId}:${assignment.id}`;
                          const assignmentExpanded = (adminState.expandedAssignmentIds || []).includes(assignmentRef);
                          const assignmentState = getUsageState(
                            Number(assignment.usage?.spendUsd || 0),
                            assignment.budgetLimitUsd,
                            assignment.isActive
                          );
                          const assignmentDotClass = assignmentState === 'danger'
                            ? 'dot-danger'
                            : assignmentState === 'warning'
                              ? 'dot-warning'
                              : assignmentState === 'inactive'
                                ? 'dot-muted'
                                : 'dot-active';
                          const assignmentUsageLabel = formatUsedTotalLabel({
                            usedUsd: Number(assignment.usage?.spendUsd || 0),
                            limitUsd: assignment.budgetLimitUsd,
                          });
                          const assignmentScopeLabel = assignment.scopeType === 'global'
                            ? 'global'
                            : `${assignment.scopeType}:${assignment.scopeValue}`;

                          return `
                            <div class="admin-assignment-node admin-level-2">
                              <div class="admin-assignment-head admin-level-row">
                                <div class="admin-level-left">
                                  <input type="checkbox" class="admin-row-check" />
                                  <span class="admin-state-dot ${assignmentDotClass}"></span>
                                  <button type="button" class="secondary small admin-collapse-btn" data-admin-toggle-assignment="${escapeHtml(assignmentRef)}" aria-label="Assignment ein-/ausklappen">
                                    <span class="material-icons-round">${assignmentExpanded ? 'expand_more' : 'chevron_right'}</span>
                                  </button>
                                  <span class="material-icons-round admin-row-icon">assignment</span>
                                  <div class="admin-key-ident">
                                    <strong>Assignment: ${escapeHtml(assignmentScopeLabel)}</strong>
                                    <small>${escapeHtml(getUsageStateLabel(assignmentState))}</small>
                                  </div>
                                </div>
                                <div class="admin-level-right">
                                  <div class="admin-budget-input-wrap">
                                    <span>Set Budget</span>
                                    <input type="number" min="0" step="0.000001" data-assignment-budget-limit="${escapeHtml(assignmentRef)}" value="${assignment.budgetLimitUsd ?? ''}" placeholder="optional" />
                                    <span class="admin-budget-unit">USD</span>
                                    <select data-assignment-budget-period="${escapeHtml(assignmentRef)}">
                                      <option value="daily" ${assignment.budgetPeriod === 'daily' ? 'selected' : ''}>daily</option>
                                      <option value="weekly" ${assignment.budgetPeriod === 'weekly' ? 'selected' : ''}>weekly</option>
                                      <option value="monthly" ${(!assignment.budgetPeriod || assignment.budgetPeriod === 'monthly') ? 'selected' : ''}>monthly</option>
                                    </select>
                                  </div>
                                  <small class="admin-used-total"><span>Used/Total:</span> <strong>${assignmentUsageLabel}</strong></small>
                                  <label class="admin-toggle">
                                    <input type="checkbox" data-assignment-active="${escapeHtml(assignmentRef)}" ${assignment.isActive ? 'checked' : ''} />
                                    <span class="admin-toggle-track"><span class="admin-toggle-thumb"></span></span>
                                    <span class="admin-toggle-text">${assignment.isActive ? 'On' : 'Off'}</span>
                                  </label>
                                  <span class="inline-actions">
                                    <button type="button" class="secondary small" data-save-system-key-assignment="${escapeHtml(assignmentRef)}">Speichern</button>
                                    <button type="button" class="secondary small" data-delete-system-key-assignment="${escapeHtml(assignmentRef)}">Löschen</button>
                                  </span>
                                </div>
                              </div>

                              <div class="admin-quota-row admin-level-3 ${assignmentExpanded ? '' : 'is-hidden'}" data-assignment-collapse="${escapeHtml(assignmentRef)}">
                                <div class="admin-level-left">
                                  <span class="admin-state-dot dot-active"></span>
                                  <span class="material-icons-round admin-row-icon">person</span>
                                  <div class="admin-key-ident">
                                    <strong>Per User Quota</strong>
                                    <small>Gilt pro User innerhalb dieser Zuweisung</small>
                                  </div>
                                </div>
                                <div class="admin-level-right">
                                  <div class="admin-budget-input-wrap">
                                    <span>Set Budget</span>
                                    <input type="number" min="0" step="0.000001" data-assignment-per-user-budget-limit="${escapeHtml(assignmentRef)}" value="${assignment.perUserBudgetLimitUsd ?? ''}" placeholder="optional" />
                                    <span class="admin-budget-unit">USD</span>
                                    <select data-assignment-per-user-budget-period="${escapeHtml(assignmentRef)}">
                                      <option value="daily" ${assignment.perUserBudgetPeriod === 'daily' ? 'selected' : ''}>daily</option>
                                      <option value="weekly" ${assignment.perUserBudgetPeriod === 'weekly' ? 'selected' : ''}>weekly</option>
                                      <option value="monthly" ${(!assignment.perUserBudgetPeriod || assignment.perUserBudgetPeriod === 'monthly') ? 'selected' : ''}>monthly</option>
                                    </select>
                                  </div>
                                  <small class="admin-used-total"><span>Limit/User:</span> <strong>${assignment.perUserBudgetLimitUsd !== null && assignment.perUserBudgetLimitUsd !== undefined ? formatUsd(assignment.perUserBudgetLimitUsd) : 'unbegrenzt'}</strong></small>
                                  <button type="button" class="secondary small" data-save-system-key-assignment="${escapeHtml(assignmentRef)}">Speichern</button>
                                </div>
                              </div>
                            </div>
                          `;
                        }).join('')
                        : '<p class="hint">Keine Zuweisungen vorhanden.</p>'
                      }

                      <div class="admin-add-row admin-level-2">
                        <select data-system-key-assign-type="${escapeHtml(keyId)}">
                          <option value="global">global</option>
                          <option value="user">user</option>
                          <option value="role">role</option>
                          <option value="group">group</option>
                        </select>
                        <span data-system-key-assign-value-wrap="${escapeHtml(keyId)}">
                          <input data-system-key-assign-value="${escapeHtml(keyId)}" placeholder="z. B. teachers oder username" />
                        </span>
                        <button type="button" class="secondary small" data-add-system-key-assignment="${escapeHtml(keyId)}">Add Assignment</button>
                      </div>
                    </div>
                    <small class="hint top-space" data-system-key-row-status="${escapeHtml(keyId)}"></small>
                  </div>
                </div>
              `;
            }).join('')
            : '<p class="hint admin-empty-state">Keine Treffer für die aktuellen Filter.</p>'
          }
        </div>
      </div>
    `;

    const searchInput = el('admin-system-key-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        adminState.systemKeySearchQuery = String(searchInput.value || '');
        renderSystemKeyList();
      });
    }

    const statusSelect = el('admin-system-key-filter-status');
    if (statusSelect) {
      statusSelect.addEventListener('change', () => {
        adminState.systemKeyStatusFilter = String(statusSelect.value || 'all');
        renderSystemKeyList();
      });
    }

    const levelSelect = el('admin-system-key-filter-level');
    if (levelSelect) {
      levelSelect.addEventListener('change', () => {
        adminState.systemKeyLevelFilter = String(levelSelect.value || 'all');
        renderSystemKeyList();
      });
    }

    container.querySelectorAll('[data-admin-toggle-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const keyId = String(button.getAttribute('data-admin-toggle-key') || '').trim();
        if (!keyId) return;
        const expanded = new Set(adminState.expandedSystemKeyIds || []);
        if (expanded.has(keyId)) expanded.delete(keyId);
        else expanded.add(keyId);
        adminState.expandedSystemKeyIds = Array.from(expanded);
        renderSystemKeyList();
      });
    });

    container.querySelectorAll('[data-admin-toggle-assignment]').forEach((button) => {
      button.addEventListener('click', () => {
        const assignmentRef = String(button.getAttribute('data-admin-toggle-assignment') || '').trim();
        if (!assignmentRef) return;
        const expanded = new Set(adminState.expandedAssignmentIds || []);
        if (expanded.has(assignmentRef)) expanded.delete(assignmentRef);
        else expanded.add(assignmentRef);
        adminState.expandedAssignmentIds = Array.from(expanded);
        renderSystemKeyList();
      });
    });

    container.querySelectorAll('[data-save-system-key-row]').forEach((button) => {
      button.onclick = () => saveSystemKeyRow(button.dataset.saveSystemKeyRow).catch((error) => alert(error.message));
    });

    container.querySelectorAll('[data-toggle-system-key-details]').forEach((button) => {
      button.onclick = () => {
        const keyId = String(button.dataset.toggleSystemKeyDetails || '').trim();
        if (!keyId) return;
        adminState.openSystemKeyId = adminState.openSystemKeyId === keyId ? '' : keyId;
        renderSystemKeyList();
      };
    });

    container.querySelectorAll('[data-add-system-key-assignment]').forEach((button) => {
      button.onclick = () => addSystemKeyAssignment(button.dataset.addSystemKeyAssignment).catch((error) => alert(error.message));
    });

    container.querySelectorAll('[data-system-key-assign-type]').forEach((selectNode) => {
      const keyId = String(selectNode.getAttribute('data-system-key-assign-type') || '').trim();
      const updateVisibility = () => {
        const wrap = container.querySelector(`[data-system-key-assign-value-wrap="${keyId}"]`);
        if (!wrap) return;
        wrap.classList.toggle('is-hidden', String(selectNode.value || '') === 'global');
      };
      selectNode.addEventListener('change', updateVisibility);
      updateVisibility();
    });

    container.querySelectorAll('[data-save-system-key-assignment]').forEach((button) => {
      button.onclick = () => {
        const [systemKeyId, assignmentId] = String(button.dataset.saveSystemKeyAssignment || '').split(':');
        if (!systemKeyId || !assignmentId) return;
        saveSystemKeyAssignment(systemKeyId, assignmentId).catch((error) => alert(error.message));
      };
    });

    container.querySelectorAll('[data-delete-system-key-assignment]').forEach((button) => {
      button.onclick = () => {
        const [systemKeyId, assignmentId] = String(button.dataset.deleteSystemKeyAssignment || '').split(':');
        if (!systemKeyId || !assignmentId) return;
        removeSystemKeyAssignment(systemKeyId, assignmentId).catch((error) => alert(error.message));
      };
    });

    container.querySelectorAll('input[data-system-key-active], input[data-assignment-active]').forEach((toggleNode) => {
      const label = toggleNode.closest('.admin-toggle');
      const textNode = label?.querySelector('.admin-toggle-text');
      const syncLabel = () => {
        if (!textNode) return;
        textNode.textContent = toggleNode.checked ? 'On' : 'Off';
      };
      toggleNode.addEventListener('change', syncLabel);
      syncLabel();
    });

    container.querySelectorAll('input[data-system-key-name], input[data-system-key-model-hint], input[data-system-key-base-url], input[data-system-key-api-key], input[data-system-key-budget-limit], input[data-assignment-budget-limit], input[data-assignment-per-user-budget-limit]').forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const keyId = input.getAttribute('data-system-key-name')
          || input.getAttribute('data-system-key-model-hint')
          || input.getAttribute('data-system-key-base-url')
          || input.getAttribute('data-system-key-api-key')
          || input.getAttribute('data-system-key-budget-limit');
        if (keyId) {
          saveSystemKeyRow(keyId).catch((error) => alert(error.message));
          return;
        }
        const assignmentRef = input.getAttribute('data-assignment-budget-limit')
          || input.getAttribute('data-assignment-per-user-budget-limit');
        if (!assignmentRef) return;
        const [systemKeyId, assignmentId] = String(assignmentRef).split(':');
        if (!systemKeyId || !assignmentId) return;
        saveSystemKeyAssignment(systemKeyId, assignmentId).catch((error) => alert(error.message));
      });
    });

    const globalToggle = el('admin-system-keys-enabled');
    if (globalToggle) {
      globalToggle.addEventListener('change', () => {
        const textNode = globalToggle.closest('.admin-toggle')?.querySelector('.admin-toggle-text');
        if (textNode) textNode.textContent = globalToggle.checked ? 'On' : 'Off';
      });
    }

    const globalSave = el('admin-system-keys-enabled-save');
    if (globalSave) {
      globalSave.addEventListener('click', () => saveSystemKeysGlobalConfig().catch((error) => alert(error.message)));
    }
  }
  function renderBudgetList() {
    const container = el('admin-budget-list');
    if (!container) return;
    if (!hasPermission('budgets.manage')) {
      container.innerHTML = '<p class="hint">Keine Berechtigung für Budget-Policies.</p>';
      return;
    }
    const budgets = Array.isArray(adminState.budgets) ? adminState.budgets : [];
    if (!budgets.length) {
      container.innerHTML = '<p class="hint">Noch keine Budget-Policies vorhanden.</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Periode</th>
              <th>Limit USD</th>
              <th>Modus</th>
              <th>Warnung</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            ${budgets.map((entry) => `
              <tr>
                <td><strong>${escapeHtml(entry.scopeType)}</strong>: ${escapeHtml(entry.scopeValue)}</td>
                <td>${escapeHtml(entry.period)}</td>
                <td>${Number(entry.limitUsd || 0).toFixed(4)}</td>
                <td>${escapeHtml(entry.mode || 'hybrid')}</td>
                <td>${Number(entry.warningRatio || 0.9).toFixed(2)}</td>
                <td>${entry.isActive ? 'aktiv' : 'inaktiv'}</td>
                <td>${escapeHtml(entry.ownerUserId || '-')}</td>
                <td>
                  <div class="inline-actions">
                    <button type="button" class="secondary small" data-edit-budget="${entry.id}">Bearbeiten</button>
                    <button type="button" class="secondary small" data-deactivate-budget="${entry.id}">${entry.isActive ? 'Deaktivieren' : 'Aktivieren'}</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.querySelectorAll('[data-edit-budget]').forEach((button) => {
      button.onclick = () => {
        const budgetId = Number(button.dataset.editBudget);
        const entry = budgets.find((row) => Number(row.id) === budgetId);
        if (!entry) return;
        adminState.selectedBudgetId = budgetId;
        el('admin-budget-scope-type').value = entry.scopeType || 'user';
        el('admin-budget-scope-value').value = entry.scopeValue || '';
        el('admin-budget-period').value = entry.period || 'monthly';
        el('admin-budget-limit-usd').value = String(entry.limitUsd ?? '');
        el('admin-budget-mode').value = entry.mode || 'hybrid';
        el('admin-budget-warning-ratio').value = String(entry.warningRatio ?? 0.9);
        el('admin-budget-active').value = entry.isActive ? 'true' : 'false';
        el('admin-budget-owner-user').value = entry.ownerUserId || '';
        setStatus(`Budget-Policy ${budgetId} geladen.`, { budget: true });
      };
    });
    container.querySelectorAll('[data-deactivate-budget]').forEach((button) => {
      button.onclick = () => deactivateBudget(Number(button.dataset.deactivateBudget)).catch((error) => alert(error.message));
    });
  }

  function renderModelProviderTabs() {
    const container = el('admin-model-provider-tabs');
    if (!container) return;

    const providers = getModelProviders();
    if (!providers.includes(adminState.activeModelProvider)) {
      adminState.activeModelProvider = providers[0] || 'openai';
    }

    container.innerHTML = providers
      .map((providerKind) => `
        <button type="button" class="chip ${providerKind === adminState.activeModelProvider ? 'is-active' : ''}" data-admin-model-provider="${providerKind}">
          ${escapeHtml(providerKind)}
        </button>
      `)
      .join('');

    container.querySelectorAll('[data-admin-model-provider]').forEach((button) => {
      button.onclick = () => {
        adminState.activeModelProvider = button.dataset.adminModelProvider;
        el('admin-pricing-provider-kind').value = adminState.activeModelProvider;
        clearPricingForm();
        renderModelProviderTabs();
        renderPricingList();
      };
    });
  }

  function renderPricingList() {
    const container = el('admin-model-provider-groups');
    if (!container) return;
    if (!hasPermission('pricing.manage')) {
      container.innerHTML = '<p class="hint">Keine Berechtigung für Model Administration.</p>';
      return;
    }

    const provider = adminState.activeModelProvider || 'openai';
    const rows = adminState.pricingEntries
      .filter((entry) => String(entry.providerKind || '').trim().toLowerCase() === provider)
      .sort((a, b) => String(a.model || '').localeCompare(String(b.model || '')));

    container.innerHTML = `
      <div class="admin-model-provider-card">
        <div class="admin-model-provider-head">
          <h4>${escapeHtml(provider)} (${rows.length})</h4>
          <button type="button" class="secondary small" id="admin-model-new-for-provider">Neues Modell für ${escapeHtml(provider)}</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Modell</th>
                <th>Input USD / 1M</th>
                <th>Output USD / 1M</th>
                <th>Waehrung</th>
                <th>Status</th>
                <th>Aktualisiert</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length
    ? rows.map((entry) => `
                    <tr>
                      <td><strong>${escapeHtml(entry.model)}</strong></td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.000001"
                          class="admin-row-price-input"
                          data-pricing-row-input="${entry.id}"
                          value="${entry.inputPricePerMillion ?? ''}"
                          placeholder="optional"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.000001"
                          class="admin-row-price-input"
                          data-pricing-row-output="${entry.id}"
                          value="${entry.outputPricePerMillion ?? ''}"
                          placeholder="optional"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          class="admin-row-currency-input"
                          data-pricing-row-currency="${entry.id}"
                          value="${escapeHtml(entry.currency || 'USD')}"
                        />
                      </td>
                      <td>
                        <label class="admin-toggle">
                          <input
                            type="checkbox"
                            data-pricing-row-active="${entry.id}"
                            ${entry.isActive ? 'checked' : ''}
                          />
                          <span class="admin-toggle-track"><span class="admin-toggle-thumb"></span></span>
                          <span class="admin-toggle-text" data-pricing-row-active-text="${entry.id}">${entry.isActive ? 'Aktiv' : 'Inaktiv'}</span>
                        </label>
                      </td>
                      <td><small class="hint">${formatDateTime(entry.updatedAt)}</small></td>
                      <td>
                        <div class="inline-actions">
                          <button type="button" class="secondary small" data-save-pricing-row="${entry.id}">Speichern</button>
                        </div>
                        <small class="hint" data-pricing-row-status="${entry.id}"></small>
                      </td>
                    </tr>
                  `).join('')
    : '<tr><td colspan="7">Noch keine Modelle für diesen Provider.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const createButton = el('admin-model-new-for-provider');
    if (createButton) {
      createButton.onclick = () => {
        adminState.selectedPricingId = null;
        el('admin-pricing-provider-kind').value = provider;
        el('admin-pricing-model').focus();
        setStatus('Neues Modell erfassen.', { pricing: true });
      };
    }

    container.querySelectorAll('[data-pricing-row-active]').forEach((input) => {
      input.addEventListener('change', () => {
        const rowId = input.dataset.pricingRowActive;
        const textNode = container.querySelector(`[data-pricing-row-active-text="${rowId}"]`);
        if (textNode) {
          textNode.textContent = input.checked ? 'Aktiv' : 'Inaktiv';
        }
      });
    });
    container.querySelectorAll('[data-save-pricing-row]').forEach((button) => {
      button.onclick = () => savePricingRow(button.dataset.savePricingRow).catch((error) => alert(error.message));
    });

    container
      .querySelectorAll('[data-pricing-row-input], [data-pricing-row-output], [data-pricing-row-currency]')
      .forEach((input) => {
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const rowId = input.getAttribute('data-pricing-row-input')
            || input.getAttribute('data-pricing-row-output')
            || input.getAttribute('data-pricing-row-currency');
          if (!rowId) return;
          savePricingRow(rowId).catch((error) => alert(error.message));
        });
      });
  }

  async function savePricingRow(pricingId) {
    const rowId = String(pricingId ?? '').trim();
    if (!rowId) return;

    const entry = adminState.pricingEntries.find((row) => String(row.id) === rowId);
    if (!entry) {
      setStatus('Modelleintrag konnte nicht geladen werden.', { pricing: true });
      return;
    }

    const scope = el('admin-model-provider-groups');
    const saveButton = scope.querySelector(`[data-save-pricing-row="${rowId}"]`);
    const rowStatus = scope.querySelector(`[data-pricing-row-status="${rowId}"]`);
    const inputNode = scope.querySelector(`[data-pricing-row-input="${rowId}"]`);
    const outputNode = scope.querySelector(`[data-pricing-row-output="${rowId}"]`);
    const currencyNode = scope.querySelector(`[data-pricing-row-currency="${rowId}"]`);
    const activeNode = scope.querySelector(`[data-pricing-row-active="${rowId}"]`);
    if (!inputNode || !outputNode || !currencyNode || !activeNode || !saveButton) return;

    const inputPrice = parseOptionalNonNegativeNumber(inputNode.value);
    const outputPrice = parseOptionalNonNegativeNumber(outputNode.value);
    if (Number.isNaN(inputPrice) || Number.isNaN(outputPrice)) {
      alert('Input/Output Preis muss leer oder >= 0 sein.');
      return;
    }

    saveButton.disabled = true;
    if (rowStatus) rowStatus.textContent = 'Speichere...';
    try {
      await api(`/api/admin/model-pricing/${encodeURIComponent(rowId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          inputPricePerMillion: inputPrice,
          outputPricePerMillion: outputPrice,
          currency: (currencyNode.value || 'USD').trim() || 'USD',
          isActive: activeNode.checked,
        }),
      });
      await loadAdminData();
      setStatus(`Modelleintrag ${entry.providerKind}/${entry.model} gespeichert.`, { pricing: true });
    } finally {
      saveButton.disabled = false;
      if (rowStatus) rowStatus.textContent = '';
    }
  }

  async function saveSystemKey() {
    if (!hasPermission('providers.system_keys.manage')) {
      alert('Keine Berechtigung für systemweite API-Keys.');
      return;
    }

    const systemKeyIdInput = String(el('admin-system-key-id').value || '').trim();
    const payload = {
      systemKeyId: systemKeyIdInput || undefined,
      name: String(el('admin-system-key-name').value || '').trim(),
      providerKind: String(el('admin-system-key-provider-kind').value || '').trim().toLowerCase(),
      modelHint: getSelectedSystemKeyModelHint(),
      baseUrl: String(el('admin-system-key-base-url').value || '').trim(),
      apiKey: String(el('admin-system-key-api-key').value || '').trim(),
      isActive: el('admin-system-key-active').value === 'true',
    };
    if (!payload.name || !payload.providerKind) {
      alert('Name und Provider sind erforderlich.');
      return;
    }

    if (adminState.selectedSystemKeyId) {
      const targetId = adminState.selectedSystemKeyId;
      await api(`/api/admin/system-provider-keys/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setStatus(`System-Key ${targetId} gespeichert.`, { systemKey: true });
    } else {
      if (!payload.apiKey) {
        alert('Beim Anlegen ist ein API-Key erforderlich.');
        return;
      }
      await api('/api/admin/system-provider-keys', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatus('System-Key angelegt.', { systemKey: true });
    }
    clearSystemKeyForm();
    adminState.showSystemKeyCreateForm = false;
    await loadAdminData();
  }

  async function saveSystemKeysGlobalConfig() {
    const enabled = !!el('admin-system-keys-enabled')?.checked;
    await api('/api/admin/system-provider-keys/config', {
      method: 'PUT',
      body: JSON.stringify({ systemKeysEnabled: enabled }),
    });
    adminState.systemKeysEnabled = enabled;
    setStatus(`System-Keys global ${enabled ? 'aktiviert' : 'deaktiviert'}.`, { systemKey: true });
    await loadAdminData();
  }

  async function saveSystemKeyRow(systemKeyId) {
    const keyId = String(systemKeyId || '').trim();
    if (!keyId) return;
    const scope = el('admin-system-key-list');
    const rowStatus = scope.querySelector(`[data-system-key-row-status="${keyId}"]`);
    const keyData = (adminState.systemKeys || []).find((entry) => String(entry.systemKeyId || '').trim() === keyId) || {};
    const nameNode = scope.querySelector(`[data-system-key-name="${keyId}"]`);
    const providerNode = scope.querySelector(`[data-system-key-provider-kind="${keyId}"]`);
    const modelNode = scope.querySelector(`[data-system-key-model-hint="${keyId}"]`);
    const baseNode = scope.querySelector(`[data-system-key-base-url="${keyId}"]`);
    const apiKeyNode = scope.querySelector(`[data-system-key-api-key="${keyId}"]`);
    const activeNode = scope.querySelector(`[data-system-key-active="${keyId}"]`);
    const budgetLimitNode = scope.querySelector(`[data-system-key-budget-limit="${keyId}"]`);
    const budgetPeriodNode = scope.querySelector(`[data-system-key-budget-period="${keyId}"]`);
    if (!activeNode || !budgetLimitNode || !budgetPeriodNode) return;

    const budgetLimitRaw = budgetLimitNode ? budgetLimitNode.value : keyData.budgetLimitUsd;
    const budgetLimitUsd = parseOptionalNonNegativeNumber(budgetLimitRaw);
    const budgetIsActive = budgetLimitUsd !== null;

    const payload = {
      name: String(nameNode?.value ?? keyData.name ?? '').trim(),
      providerKind: String(providerNode?.value ?? keyData.providerKind ?? '').trim().toLowerCase(),
      modelHint: String(modelNode?.value ?? keyData.modelHint ?? '').trim(),
      baseUrl: String(baseNode?.value ?? keyData.baseUrl ?? '').trim(),
      apiKey: String(apiKeyNode?.value || '').trim(),
      isActive: activeNode.checked,
      budgetIsActive,
      budgetLimitUsd,
      budgetPeriod: String(budgetPeriodNode?.value ?? keyData.budgetPeriod ?? 'monthly').trim(),
      budgetMode: 'hybrid',
      budgetWarningRatio: 0.9,
    };
    if (!payload.name || !payload.providerKind) {
      alert('Name und Provider sind erforderlich.');
      return;
    }
    if (Number.isNaN(budgetLimitUsd)) {
      alert('Budget-Limit muss leer oder >= 0 sein.');
      return;
    }
    if (rowStatus) rowStatus.textContent = 'Speichere...';
    await api(`/api/admin/system-provider-keys/${encodeURIComponent(keyId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (rowStatus) rowStatus.textContent = 'Gespeichert.';
    await loadAdminData();
  }

  async function addSystemKeyAssignment(systemKeyIdOverride = '') {
    if (!hasPermission('providers.system_keys.manage')) return;
    const keyId = String(systemKeyIdOverride || adminState.selectedSystemKeyId || el('admin-system-key-id').value || '').trim();
    const scope = el('admin-system-key-list');
    const typeNode = systemKeyIdOverride
      ? scope.querySelector(`[data-system-key-assign-type="${keyId}"]`)
      : el('admin-system-key-assign-type');
    const valueNode = systemKeyIdOverride
      ? scope.querySelector(`[data-system-key-assign-value="${keyId}"]`)
      : el('admin-system-key-assign-value');
    const systemKeyId = keyId;
    if (!systemKeyId) {
      alert('Bitte zuerst einen System-Key auswählen oder die ID eintragen.');
      return;
    }
    const scopeType = String(typeNode?.value || '').trim();
    const scopeValue = String(valueNode?.value || '').trim();
    if (!scopeType || (scopeType !== 'global' && !scopeValue)) {
      alert('Zuweisungstyp und -wert sind erforderlich.');
      return;
    }
    await api(`/api/admin/system-provider-keys/${encodeURIComponent(systemKeyId)}/assignments`, {
      method: 'POST',
      body: JSON.stringify({
        scopeType,
        scopeValue: scopeType === 'global' ? '*' : scopeValue,
        isActive: true,
        budgetIsActive: false,
        budgetLimitUsd: null,
        budgetPeriod: 'monthly',
        budgetMode: 'hybrid',
        budgetWarningRatio: 0.9,
        perUserBudgetLimitUsd: null,
        perUserBudgetPeriod: 'monthly',
      }),
    });
    if (valueNode) valueNode.value = '';
    setStatus(`Zuweisung für ${systemKeyId} gespeichert.`, { systemKey: true });
    await loadAdminData();
  }

  async function saveSystemKeyAssignment(systemKeyId, assignmentId) {
    const keyId = String(systemKeyId || '').trim();
    const assignment = String(assignmentId || '').trim();
    if (!keyId || !assignment) return;
    const scope = el('admin-system-key-list');
    const activeNode = scope.querySelector(`[data-assignment-active="${keyId}:${assignment}"]`);
    const budgetLimitNode = scope.querySelector(`[data-assignment-budget-limit="${keyId}:${assignment}"]`);
    const budgetPeriodNode = scope.querySelector(`[data-assignment-budget-period="${keyId}:${assignment}"]`);
    const perUserBudgetLimitNode = scope.querySelector(`[data-assignment-per-user-budget-limit="${keyId}:${assignment}"]`);
    const perUserBudgetPeriodNode = scope.querySelector(`[data-assignment-per-user-budget-period="${keyId}:${assignment}"]`);
    if (!activeNode || !budgetLimitNode || !budgetPeriodNode || !perUserBudgetLimitNode || !perUserBudgetPeriodNode) return;
    const budgetLimitUsd = parseOptionalNonNegativeNumber(budgetLimitNode.value);
    const perUserBudgetLimitUsd = parseOptionalNonNegativeNumber(perUserBudgetLimitNode.value);
    if (Number.isNaN(budgetLimitUsd)) {
      alert('Budget-Limit muss leer oder >= 0 sein.');
      return;
    }
    if (Number.isNaN(perUserBudgetLimitUsd)) {
      alert('Pro-Nutzer-Budget muss leer oder >= 0 sein.');
      return;
    }
    await api(`/api/admin/system-provider-keys/${encodeURIComponent(keyId)}/assignments/${encodeURIComponent(assignment)}`, {
      method: 'PUT',
      body: JSON.stringify({
        isActive: activeNode.checked,
        budgetIsActive: budgetLimitUsd !== null,
        budgetLimitUsd,
        budgetPeriod: String(budgetPeriodNode.value || 'monthly').trim(),
        budgetMode: 'hybrid',
        budgetWarningRatio: 0.9,
        perUserBudgetLimitUsd,
        perUserBudgetPeriod: String(perUserBudgetPeriodNode.value || budgetPeriodNode.value || 'monthly').trim(),
      }),
    });
    setStatus(`Zuweisung aktualisiert (${keyId}).`, { systemKey: true });
    await loadAdminData();
  }

  async function removeSystemKeyAssignment(systemKeyId, assignmentId) {
    await api(`/api/admin/system-provider-keys/${encodeURIComponent(systemKeyId)}/assignments/${encodeURIComponent(assignmentId)}`, {
      method: 'DELETE',
    });
    setStatus(`Zuweisung entfernt (${systemKeyId}).`, { systemKey: true });
    await loadAdminData();
  }

  async function saveBudgetPolicy() {
    if (!hasPermission('budgets.manage')) {
      alert('Keine Berechtigung für Budget-Policies.');
      return;
    }
    const payload = {
      scopeType: String(el('admin-budget-scope-type').value || '').trim(),
      scopeValue: String(el('admin-budget-scope-value').value || '').trim(),
      period: String(el('admin-budget-period').value || '').trim(),
      limitUsd: parseOptionalNonNegativeNumber(el('admin-budget-limit-usd').value),
      mode: String(el('admin-budget-mode').value || 'hybrid').trim(),
      warningRatio: parseOptionalNonNegativeNumber(el('admin-budget-warning-ratio').value),
      isActive: el('admin-budget-active').value === 'true',
      ownerUserId: String(el('admin-budget-owner-user').value || '').trim() || null,
    };
    if (!payload.scopeType || !payload.scopeValue || !payload.period || Number.isNaN(payload.limitUsd) || payload.limitUsd === null) {
      alert('Scope, Wert, Periode und Limit sind erforderlich.');
      return;
    }
    if (payload.warningRatio === null || Number.isNaN(payload.warningRatio)) {
      payload.warningRatio = 0.9;
    }

    if (adminState.selectedBudgetId) {
      await api(`/api/admin/budgets/${encodeURIComponent(String(adminState.selectedBudgetId))}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setStatus(`Budget-Policy ${adminState.selectedBudgetId} gespeichert.`, { budget: true });
    } else {
      await api('/api/admin/budgets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatus('Budget-Policy angelegt.', { budget: true });
    }
    clearBudgetForm();
    await loadAdminData();
  }

  async function deactivateBudget(budgetId) {
    if (!Number.isInteger(budgetId)) return;
    await api(`/api/admin/budgets/${encodeURIComponent(String(budgetId))}`, {
      method: 'DELETE',
    });
    setStatus(`Budget-Policy ${budgetId} deaktiviert.`, { budget: true });
    await loadAdminData();
  }

  async function loadAdminData() {
    if (!hasPermission('rbac.manage')) return;
    const requests = [
      api('/api/admin/permissions'),
      api('/api/admin/roles'),
      api('/api/admin/group-role-bindings'),
    ];
    const canManagePricing = hasPermission('pricing.manage');
    const canManageSystemKeys = hasPermission('providers.system_keys.manage');
    const canManageBudgets = hasPermission('budgets.manage');

    if (canManagePricing) {
      requests.push(api('/api/admin/model-pricing'));
    }
    if (canManageSystemKeys) {
      requests.push(api('/api/admin/system-provider-keys'));
      requests.push(api('/api/admin/system-provider-keys/config'));
    }
    if (canManageBudgets) {
      requests.push(api('/api/admin/budgets'));
    }
    const responses = await Promise.all(requests);
    const [permissions, roles, bindings] = responses;
    let cursor = 3;
    const pricingEntries = canManagePricing ? (responses[cursor++] || []) : [];
    const systemKeysPayload = canManageSystemKeys ? (responses[cursor++] || {}) : {};
    const systemKeysConfig = canManageSystemKeys ? (responses[cursor++] || {}) : {};
    const budgets = canManageBudgets ? (responses[cursor++] || []) : [];
    adminState = {
      permissions,
      roles,
      bindings,
      selectedRoleId: adminState.selectedRoleId || roles[0]?.id || null,
      pricingEntries: Array.isArray(pricingEntries)
        ? pricingEntries.map((entry) => ({ ...entry, id: String(entry.id) }))
        : [],
      selectedPricingId: adminState.selectedPricingId,
      systemKeys: Array.isArray(systemKeysPayload?.keys) ? systemKeysPayload.keys : (Array.isArray(systemKeysPayload) ? systemKeysPayload : []),
      selectedSystemKeyId: adminState.selectedSystemKeyId || '',
      openSystemKeyId: adminState.openSystemKeyId || '',
      expandedSystemKeyIds: Array.isArray(adminState.expandedSystemKeyIds) ? adminState.expandedSystemKeyIds : [],
      expandedAssignmentIds: Array.isArray(adminState.expandedAssignmentIds) ? adminState.expandedAssignmentIds : [],
      systemKeySearchQuery: adminState.systemKeySearchQuery || '',
      systemKeyStatusFilter: adminState.systemKeyStatusFilter || 'all',
      systemKeyLevelFilter: adminState.systemKeyLevelFilter || 'all',
      showSystemKeyCreateForm: !!adminState.showSystemKeyCreateForm,
      budgets: Array.isArray(budgets) ? budgets : [],
      selectedBudgetId: adminState.selectedBudgetId,
      systemKeysEnabled: systemKeysConfig?.systemKeysEnabled ?? systemKeysPayload?.systemKeysEnabled ?? true,
      activeTab: adminState.activeTab || 'roles',
      activeModelProvider: adminState.activeModelProvider || 'openai',
    };
    renderRoleSelect();
    renderRoleDetails();
    renderBindings();
    renderModelProviderTabs();
    renderPricingList();
    renderSystemKeyList();
    renderBudgetList();
    clearPricingForm();
    clearSystemKeyForm();
    const systemKeyCreateForm = el('admin-system-key-create-form');
    if (systemKeyCreateForm) {
      systemKeyCreateForm.classList.toggle('is-hidden', !adminState.showSystemKeyCreateForm);
    }
    const systemKeyCreateActions = el('admin-system-key-create-actions');
    if (systemKeyCreateActions) {
      systemKeyCreateActions.classList.toggle('is-hidden', !adminState.showSystemKeyCreateForm);
    }
    const systemKeyCreateToggle = el('admin-system-key-create-toggle');
    if (systemKeyCreateToggle) {
      const iconNode = systemKeyCreateToggle.querySelector('.material-icons-round');
      const labelNode = systemKeyCreateToggle.querySelector('.admin-create-label');
      if (iconNode) iconNode.textContent = adminState.showSystemKeyCreateForm ? 'remove_circle_outline' : 'add_circle';
      if (labelNode) labelNode.textContent = adminState.showSystemKeyCreateForm ? 'Create form schließen' : 'Add New API Key';
    }
    const globalToggle = el('admin-system-keys-enabled');
    if (globalToggle) globalToggle.checked = !!adminState.systemKeysEnabled;
    clearBudgetForm();
    ensureAdminVisible();
    setActiveAdminTab(adminState.activeTab);
  }

  async function openAdminScreen() {
    if (!hasPermission('rbac.manage')) {
      alert('Keine Berechtigung für Administration.');
      return;
    }
    await loadAdminData();
    showScreen('admin');
  }

  async function createRole() {
    const roleKey = el('admin-new-role-key').value.trim();
    const roleName = el('admin-new-role-name').value.trim();
    const description = el('admin-new-role-description').value.trim();
    if (!roleKey || !roleName) {
      alert('Role Key und Role Name sind erforderlich.');
      return;
    }
    await api('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({ roleKey, roleName, description }),
    });
    el('admin-new-role-key').value = '';
    el('admin-new-role-name').value = '';
    el('admin-new-role-description').value = '';
    await loadAdminData();
    setStatus('Rolle angelegt.');
  }

  async function createPermission() {
    const key = el('admin-new-permission-key').value.trim();
    const description = el('admin-new-permission-description').value.trim();
    if (!key) {
      alert('Permission Key ist erforderlich.');
      return;
    }
    await api('/api/admin/permissions', {
      method: 'POST',
      body: JSON.stringify({ key, description }),
    });
    el('admin-new-permission-key').value = '';
    el('admin-new-permission-description').value = '';
    await loadAdminData();
    setStatus('Berechtigung angelegt.');
  }

  async function saveRoleMeta() {
    const roleId = Number(el('admin-role-select').value);
    const roleName = el('admin-role-name').value.trim();
    const description = el('admin-role-description').value.trim();
    await api(`/api/admin/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify({ roleName, description }),
    });
    await loadAdminData();
    setStatus('Rolle aktualisiert.');
  }

  async function saveRolePermissions() {
    const roleId = Number(el('admin-role-select').value);
    const keys = [...el('admin-role-permissions').querySelectorAll('input[type="checkbox"]:checked')]
      .map((node) => node.value);
    await api(`/api/admin/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissionKeys: keys }),
    });
    await loadAdminData();
    setStatus('Berechtigungen gespeichert.');
  }

  async function deleteSelectedRole() {
    const roleId = Number(el('admin-role-select').value);
    if (!roleId) return;
    await api(`/api/admin/roles/${roleId}`, { method: 'DELETE' });
    adminState.selectedRoleId = null;
    await loadAdminData();
    setStatus('Rolle gelöscht.');
  }

  async function addBinding() {
    const groupName = el('admin-binding-group').value.trim();
    const roleId = Number(el('admin-binding-role').value);
    if (!groupName || !roleId) {
      alert('Gruppe und Rolle sind erforderlich.');
      return;
    }
    await api('/api/admin/group-role-bindings', {
      method: 'POST',
      body: JSON.stringify({ groupName, roleId }),
    });
    el('admin-binding-group').value = '';
    await loadAdminData();
    setStatus('Gruppenbindung gespeichert.');
  }

  async function removeBinding(bindingId) {
    await api(`/api/admin/group-role-bindings/${encodeURIComponent(bindingId)}`, { method: 'DELETE' });
    await loadAdminData();
    setStatus('Gruppenbindung gelöscht.');
  }

  async function savePricingEntry() {
    if (!hasPermission('pricing.manage')) {
      alert('Keine Berechtigung für Model Administration.');
      return;
    }

    const inputPrice = parseOptionalNonNegativeNumber(el('admin-pricing-input').value);
    const outputPrice = parseOptionalNonNegativeNumber(el('admin-pricing-output').value);
    if (Number.isNaN(inputPrice) || Number.isNaN(outputPrice)) {
      alert('Input/Output Preis muss leer oder >= 0 sein.');
      return;
    }

    const payload = {
      providerKind: el('admin-pricing-provider-kind').value,
      model: el('admin-pricing-model').value.trim(),
      currency: el('admin-pricing-currency').value.trim() || 'USD',
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
      isActive: el('admin-pricing-active').value === 'true',
    };
    if (!payload.model) {
      alert('Modell ist erforderlich.');
      return;
    }

    await api('/api/admin/model-pricing', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStatus('Modelleintrag gespeichert.', { pricing: true });
    clearPricingForm();
    await loadAdminData();
  }

  function bindEvents() {
    el('btn-admin').addEventListener('click', () => openAdminScreen().catch((error) => alert(error.message)));
    el('btn-back-home-from-admin').addEventListener('click', () => showScreen('home'));

    document.querySelectorAll('#admin-tab-nav [data-admin-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setActiveAdminTab(button.dataset.adminTab);
      });
    });

    el('admin-role-select').addEventListener('change', () => {
      adminState.selectedRoleId = Number(el('admin-role-select').value);
      renderRoleDetails();
    });
    el('admin-create-role').addEventListener('click', () => createRole().catch((error) => alert(error.message)));
    el('admin-create-permission').addEventListener('click', () => createPermission().catch((error) => alert(error.message)));
    el('admin-save-role').addEventListener('click', () => saveRoleMeta().catch((error) => alert(error.message)));
    el('admin-save-permissions').addEventListener('click', () => saveRolePermissions().catch((error) => alert(error.message)));
    el('admin-delete-role').addEventListener('click', () => deleteSelectedRole().catch((error) => alert(error.message)));
    el('admin-add-binding').addEventListener('click', () => addBinding().catch((error) => alert(error.message)));

    if (el('admin-pricing-provider-kind')) {
      el('admin-pricing-provider-kind').addEventListener('change', () => {
        adminState.activeModelProvider = el('admin-pricing-provider-kind').value;
        renderModelProviderTabs();
        renderPricingList();
      });
    }
    if (el('admin-pricing-save')) {
      el('admin-pricing-save').addEventListener('click', () => savePricingEntry().catch((error) => alert(error.message)));
    }
    if (el('admin-pricing-clear')) {
      el('admin-pricing-clear').addEventListener('click', clearPricingForm);
    }
    if (el('admin-system-key-save')) {
      el('admin-system-key-save').addEventListener('click', () => saveSystemKey().catch((error) => alert(error.message)));
    }
    if (el('admin-system-key-create-toggle')) {
      el('admin-system-key-create-toggle').addEventListener('click', () => {
        adminState.showSystemKeyCreateForm = !adminState.showSystemKeyCreateForm;
        if (adminState.showSystemKeyCreateForm) {
          clearSystemKeyForm();
        }
        const systemKeyCreateForm = el('admin-system-key-create-form');
        if (systemKeyCreateForm) {
          systemKeyCreateForm.classList.toggle('is-hidden', !adminState.showSystemKeyCreateForm);
        }
        const systemKeyCreateActions = el('admin-system-key-create-actions');
        if (systemKeyCreateActions) {
          systemKeyCreateActions.classList.toggle('is-hidden', !adminState.showSystemKeyCreateForm);
        }
        const systemKeyCreateToggle = el('admin-system-key-create-toggle');
        if (systemKeyCreateToggle) {
          const iconNode = systemKeyCreateToggle.querySelector('.material-icons-round');
          const labelNode = systemKeyCreateToggle.querySelector('.admin-create-label');
          if (iconNode) iconNode.textContent = adminState.showSystemKeyCreateForm ? 'remove_circle_outline' : 'add_circle';
          if (labelNode) labelNode.textContent = adminState.showSystemKeyCreateForm ? 'Create form schließen' : 'Add New API Key';
        }
      });
    }
    if (el('admin-system-key-provider-kind')) {
      el('admin-system-key-provider-kind').addEventListener('change', () => {
        syncSystemKeyModelOptions();
        syncSystemKeyBaseUrl();
      });
    }
    if (el('admin-system-key-model-select')) {
      el('admin-system-key-model-select').addEventListener('change', () => {
        const customWrap = el('admin-system-key-model-custom-wrap');
        if (!customWrap) return;
        customWrap.classList.toggle('is-hidden', el('admin-system-key-model-select').value !== SYSTEM_CUSTOM_MODEL);
      });
    }
    if (el('admin-system-key-clear')) {
      el('admin-system-key-clear').addEventListener('click', clearSystemKeyForm);
    }
    if (el('admin-budget-save')) {
      el('admin-budget-save').addEventListener('click', () => saveBudgetPolicy().catch((error) => alert(error.message)));
    }
    if (el('admin-budget-clear')) {
      el('admin-budget-clear').addEventListener('click', clearBudgetForm);
    }
  }

  return {
    bindEvents,
    ensureAdminVisible,
    loadAdminData,
  };
}

export { createAdminController };
