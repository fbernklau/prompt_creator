const DEFAULT_MODEL_PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'mistral', 'custom'];

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

  function setStatus(message = '', { pricing = false } = {}) {
    if (pricing) {
      const node = el('admin-pricing-status');
      if (node) node.textContent = message;
      return;
    }
    el('admin-status').textContent = message;
  }

  function setActiveAdminTab(tabKey) {
    const canManagePricing = hasPermission('pricing.manage');
    const requested = String(tabKey || '').trim();
    const nextTab = (!canManagePricing && requested === 'models') ? 'roles' : (requested || 'roles');
    adminState.activeTab = nextTab;

    const tabs = {
      roles: el('admin-tab-roles'),
      groups: el('admin-tab-groups'),
      models: el('admin-tab-models'),
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

    const pricingVisible = hasPermission('pricing.manage');
    document.querySelectorAll('#admin-tab-nav [data-admin-tab="models"]').forEach((button) => {
      button.classList.toggle('is-hidden', !pricingVisible);
    });
    if (!pricingVisible && adminState.activeTab === 'models') {
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
    el('admin-role-system').textContent = role.isSystem ? 'Systemrolle (nicht loeschbar)' : 'Benutzerdefinierte Rolle';
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
      container.innerHTML = '<p class="hint">Keine Berechtigung fuer Model Administration.</p>';
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
          <button type="button" class="secondary small" id="admin-model-new-for-provider">Neues Modell fuer ${escapeHtml(provider)}</button>
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
    : '<tr><td colspan="7">Noch keine Modelle fuer diesen Provider.</td></tr>'}
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

  async function loadAdminData() {
    if (!hasPermission('rbac.manage')) return;
    const requests = [
      api('/api/admin/permissions'),
      api('/api/admin/roles'),
      api('/api/admin/group-role-bindings'),
    ];
    if (hasPermission('pricing.manage')) {
      requests.push(api('/api/admin/model-pricing'));
    }
    const [permissions, roles, bindings, pricingEntries = []] = await Promise.all(requests);
    adminState = {
      permissions,
      roles,
      bindings,
      selectedRoleId: adminState.selectedRoleId || roles[0]?.id || null,
      pricingEntries: Array.isArray(pricingEntries)
        ? pricingEntries.map((entry) => ({ ...entry, id: String(entry.id) }))
        : [],
      selectedPricingId: adminState.selectedPricingId,
      activeTab: adminState.activeTab || 'roles',
      activeModelProvider: adminState.activeModelProvider || 'openai',
    };
    renderRoleSelect();
    renderRoleDetails();
    renderBindings();
    renderModelProviderTabs();
    renderPricingList();
    clearPricingForm();
    ensureAdminVisible();
    setActiveAdminTab(adminState.activeTab);
  }

  async function openAdminScreen() {
    if (!hasPermission('rbac.manage')) {
      alert('Keine Berechtigung fuer Administration.');
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
    setStatus('Rolle geloescht.');
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
    setStatus('Gruppenbindung geloescht.');
  }

  async function savePricingEntry() {
    if (!hasPermission('pricing.manage')) {
      alert('Keine Berechtigung fuer Model Administration.');
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
  }

  return {
    bindEvents,
    ensureAdminVisible,
    loadAdminData,
  };
}

export { createAdminController };
