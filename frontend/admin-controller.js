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

  async function loadAdminData() {
    if (!hasPermission('rbac.manage')) return;
    const [permissions, roles, bindings] = await Promise.all([
      api('/api/admin/permissions'),
      api('/api/admin/roles'),
      api('/api/admin/group-role-bindings'),
    ]);
    adminState = {
      permissions,
      roles,
      bindings,
      selectedRoleId: adminState.selectedRoleId || roles[0]?.id || null,
    };
    renderRoleSelect();
    renderRoleDetails();
    renderBindings();
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
  }

  return {
    bindEvents,
    ensureAdminVisible,
    loadAdminData,
  };
}

export { createAdminController };
