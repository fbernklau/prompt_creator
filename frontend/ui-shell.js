function createUiShell({ el }) {
  const screenNavMap = {
    home: 'btn-new-task',
    subcategory: 'btn-new-task',
    form: 'btn-new-task',
    result: 'btn-new-task',
    library: 'btn-library',
    templates: 'btn-templates',
    admin: 'btn-admin',
    dashboard: 'btn-dashboard',
  };
  const drawerNavMap = {
    'provider-drawer': 'btn-provider',
    'history-drawer': 'btn-history',
    'options-drawer': 'btn-options',
  };
  let currentScreen = 'home';
  let activeDrawer = null;

  function setActiveNav(buttonId) {
    document.querySelectorAll('.topbar-actions .nav-btn').forEach((button) => {
      button.classList.toggle('is-active', button.id === buttonId);
    });
  }

  function syncActiveNav() {
    if (activeDrawer && drawerNavMap[activeDrawer]) {
      setActiveNav(drawerNavMap[activeDrawer]);
      return;
    }
    setActiveNav(screenNavMap[currentScreen] || '');
  }

  function setVaultStatus(text, type = 'info') {
    const node = el('vault-status');
    node.textContent = text;
    node.dataset.type = type;
  }

  function closeDrawers() {
    ['provider-drawer', 'history-drawer', 'options-drawer'].forEach((id) => el(id).classList.add('is-hidden'));
    el('overlay').classList.add('is-hidden');
    activeDrawer = null;
    syncActiveNav();
  }

  function openDrawer(drawerId) {
    ['provider-drawer', 'history-drawer', 'options-drawer'].forEach((id) => el(id).classList.add('is-hidden'));
    el('overlay').classList.add('is-hidden');
    el(drawerId).classList.remove('is-hidden');
    el('overlay').classList.remove('is-hidden');
    activeDrawer = drawerId;
    syncActiveNav();
  }

  function showScreen(screenName) {
    const ids = ['home', 'subcategory', 'form', 'result', 'library', 'templates', 'admin', 'dashboard'];
    ids.forEach((name) => el(`screen-${name}`).classList.toggle('is-hidden', name !== screenName));
    currentScreen = screenName;
    document.body.dataset.screen = screenName;
    syncActiveNav();
  }

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme || 'system');
  }

  function applyNavLayout(layout) {
    const normalized = layout === 'sidebar' ? 'sidebar' : 'topbar';
    document.body.setAttribute('data-nav-layout', normalized);
  }

  return {
    setVaultStatus,
    closeDrawers,
    openDrawer,
    showScreen,
    applyTheme,
    applyNavLayout,
  };
}

export { createUiShell };
