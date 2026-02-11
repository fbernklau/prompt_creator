function createUiShell({ el }) {
  const screenIds = ['home', 'subcategory', 'form', 'result', 'library', 'templates', 'admin', 'dashboard'];
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
  let suppressHistoryPush = false;

  function setActiveNav(buttonId) {
    document.querySelectorAll('.nav-btn[data-nav-id], .nav-btn[id]').forEach((button) => {
      const navId = button.dataset.navId || button.id;
      button.classList.toggle('is-active', navId === buttonId);
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

  function showScreen(screenName, { pushHistory = true, replaceHistory = false } = {}) {
    if (!screenIds.includes(screenName)) return;
    const previousScreen = currentScreen;
    screenIds.forEach((name) => el(`screen-${name}`).classList.toggle('is-hidden', name !== screenName));
    currentScreen = screenName;
    document.body.dataset.screen = screenName;

    if (typeof window !== 'undefined') {
      const historyState = window.history.state || {};
      const nextState = { ...historyState, appScreen: screenName };
      if (replaceHistory) {
        window.history.replaceState(nextState, '');
      } else if (!suppressHistoryPush && pushHistory && previousScreen !== screenName) {
        if (!historyState.appScreen) window.history.replaceState(nextState, '');
        else window.history.pushState(nextState, '');
      } else if (!historyState.appScreen) {
        window.history.replaceState(nextState, '');
      }
    }

    syncActiveNav();
  }

  function applyTheme(theme) {
    const normalized = theme || 'system';
    document.body.setAttribute('data-theme', normalized);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const darkActive = normalized === 'dark' || (normalized === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', darkActive);
  }

  function applyNavLayout(layout) {
    const normalized = layout === 'sidebar' ? 'sidebar' : 'topbar';
    document.body.setAttribute('data-nav-layout', normalized);
  }

  if (typeof window !== 'undefined') {
    const initialState = window.history.state || {};
    if (!initialState.appScreen) {
      window.history.replaceState({ ...initialState, appScreen: currentScreen }, '');
    }

    window.addEventListener('popstate', (event) => {
      const targetScreen = event.state?.appScreen;
      if (!targetScreen || !screenIds.includes(targetScreen)) return;
      closeDrawers();
      suppressHistoryPush = true;
      showScreen(targetScreen, { pushHistory: false });
      suppressHistoryPush = false;
    });
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
