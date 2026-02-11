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
  };

  function hasPermission(key) {
    const permissions = state.access?.permissions || [];
    return permissions.includes('*') || permissions.includes(key);
  }

  function ensureAdminVisible() {
    const visible = hasPermission('rbac.manage');
    el('btn-admin').classList.toggle('is-hidden', !visible);
    if (!visible && !el('screen-admin').classList.contains('is-hidden')) {
      showScreen('home');
    }
    if (el('admin-pricing-panel')) {
      el('admin-pricing-panel').classList.toggle('is-hidden', !hasPermission('pricing.manage'));
    }
  }

  function renderPermissionChecklist(selected = []) {
    const selectedSet = new Set(selected);
    const container = el('admin-role-permissions');
    container.innerHTML = adminState.permissions
      .map((permission) => `
        <label class="checkbox">
          <input type="checkbox" value="${permission.key}" ${selectedSet.has(permission.key) ? 'checked' : ''} />
          <span><strong>${permission.key}</strong> - ${permission.description || ''}</span>
        </label>
      `)
      .join('');
  }

  function renderRoleSelect() {
    const select = el('admin-role-select');
    select.innerHTML = adminState.roles
      .map((role) => `<option value="${role.id}" ${role.id === adminState.selectedRoleId ? 'selected' : ''}>${role.roleKey}</option>`)
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
      .map((role) => `<option value="${role.id}">${role.roleKey}</option>`)
      .join('');
    el('admin-binding-role').innerHTML = roleOptions;

    const list = el('admin-binding-list');
    list.innerHTML = adminState.bindings
      .map((binding) => `
        <li>
          <span><strong>${binding.groupName}</strong> -> ${binding.roleKey}</span>
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
    el('admin-pricing-provider-kind').value = 'openai';
    el('admin-pricing-model').value = '';
    el('admin-pricing-currency').value = 'USD';
    el('admin-pricing-input').value = '';
    el('admin-pricing-output').value = '';
    el('admin-pricing-active').value = 'true';
  }

  function renderPricingList() {
    const list = el('admin-pricing-list');
    if (!hasPermission('pricing.manage')) {
      list.innerHTML = '<li><span>Keine Berechtigung fuer Preisverwaltung.</span></li>';
      return;
    }

    const rows = Array.isArray(adminState.pricingEntries) ? adminState.pricingEntries : [];
    list.innerHTML = rows.length
      ? rows
        .map((entry) => `
          <li>
            <span>
              <strong>${entry.providerKind} | ${entry.model}</strong><br/>
              <small>Input: ${Number(entry.inputPricePerMillion).toFixed(6)} | Output: ${Number(entry.outputPricePerMillion).toFixed(6)} ${entry.currency} | ${entry.isActive ? 'aktiv' : 'inaktiv'}</small>
            </span>
            <span class="inline-actions">
              <button type="button" class="secondary small" data-edit-pricing="${entry.id}">Bearbeiten</button>
              <button type="button" class="secondary small" data-delete-pricing="${entry.id}">Deaktivieren</button>
            </span>
          </li>
        `)
        .join('')
      : '<li><span>Noch keine Pricing-Eintraege vorhanden.</span></li>';

    list.querySelectorAll('[data-edit-pricing]').forEach((button) => {
      button.onclick = () => {
        const pricingId = Number(button.dataset.editPricing);
        const entry = adminState.pricingEntries.find((item) => item.id === pricingId);
        if (!entry) return;
        adminState.selectedPricingId = pricingId;
        el('admin-pricing-provider-kind').value = entry.providerKind;
        el('admin-pricing-model').value = entry.model;
        el('admin-pricing-currency').value = entry.currency || 'USD';
        el('admin-pricing-input').value = entry.inputPricePerMillion;
        el('admin-pricing-output').value = entry.outputPricePerMillion;
        el('admin-pricing-active').value = entry.isActive ? 'true' : 'false';
      };
    });
    list.querySelectorAll('[data-delete-pricing]').forEach((button) => {
      button.onclick = () => deletePricingEntry(button.dataset.deletePricing).catch((error) => alert(error.message));
    });
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
      pricingEntries,
      selectedPricingId: adminState.selectedPricingId,
    };
    renderRoleSelect();
    renderRoleDetails();
    renderBindings();
    renderPricingList();
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
    el('admin-status').textContent = 'Rolle angelegt.';
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
    el('admin-status').textContent = 'Berechtigung angelegt.';
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
    el('admin-status').textContent = 'Rolle aktualisiert.';
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
    el('admin-status').textContent = 'Berechtigungen gespeichert.';
  }

  async function deleteSelectedRole() {
    const roleId = Number(el('admin-role-select').value);
    if (!roleId) return;
    await api(`/api/admin/roles/${roleId}`, { method: 'DELETE' });
    adminState.selectedRoleId = null;
    await loadAdminData();
    el('admin-status').textContent = 'Rolle geloescht.';
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
    el('admin-status').textContent = 'Gruppenbindung gespeichert.';
  }

  async function removeBinding(bindingId) {
    await api(`/api/admin/group-role-bindings/${encodeURIComponent(bindingId)}`, { method: 'DELETE' });
    await loadAdminData();
    el('admin-status').textContent = 'Gruppenbindung geloescht.';
  }

  async function savePricingEntry() {
    if (!hasPermission('pricing.manage')) {
      alert('Keine Berechtigung fuer Preisverwaltung.');
      return;
    }

    const payload = {
      providerKind: el('admin-pricing-provider-kind').value,
      model: el('admin-pricing-model').value.trim(),
      currency: el('admin-pricing-currency').value.trim() || 'USD',
      inputPricePerMillion: Number(el('admin-pricing-input').value),
      outputPricePerMillion: Number(el('admin-pricing-output').value),
      isActive: el('admin-pricing-active').value === 'true',
    };
    if (!payload.model) {
      alert('Modell ist erforderlich.');
      return;
    }
    if (!Number.isFinite(payload.inputPricePerMillion) || payload.inputPricePerMillion < 0
      || !Number.isFinite(payload.outputPricePerMillion) || payload.outputPricePerMillion < 0) {
      alert('Input/Output Preis muessen >= 0 sein.');
      return;
    }

    if (adminState.selectedPricingId) {
      await api(`/api/admin/model-pricing/${adminState.selectedPricingId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      el('admin-pricing-status').textContent = 'Pricing-Eintrag aktualisiert.';
    } else {
      await api('/api/admin/model-pricing', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      el('admin-pricing-status').textContent = 'Pricing-Eintrag gespeichert.';
    }
    clearPricingForm();
    await loadAdminData();
  }

  async function deletePricingEntry(pricingId) {
    if (!hasPermission('pricing.manage')) return;
    await api(`/api/admin/model-pricing/${encodeURIComponent(pricingId)}`, { method: 'DELETE' });
    if (Number(pricingId) === adminState.selectedPricingId) {
      clearPricingForm();
    }
    await loadAdminData();
    el('admin-pricing-status').textContent = 'Pricing-Eintrag deaktiviert.';
  }

  function bindEvents() {
    el('btn-admin').addEventListener('click', () => openAdminScreen().catch((error) => alert(error.message)));
    el('btn-back-home-from-admin').addEventListener('click', () => showScreen('home'));
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
