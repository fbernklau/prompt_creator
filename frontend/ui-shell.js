function createUiShell({ el }) {
  function setVaultStatus(text, type = 'info') {
    const node = el('vault-status');
    node.textContent = text;
    node.dataset.type = type;
  }

  function closeDrawers() {
    ['provider-drawer', 'history-drawer', 'options-drawer'].forEach((id) => el(id).classList.add('is-hidden'));
    el('overlay').classList.add('is-hidden');
  }

  function openDrawer(drawerId) {
    closeDrawers();
    el(drawerId).classList.remove('is-hidden');
    el('overlay').classList.remove('is-hidden');
  }

  function showScreen(screenName) {
    const ids = ['home', 'subcategory', 'form', 'result', 'library', 'templates', 'admin', 'dashboard'];
    ids.forEach((name) => el(`screen-${name}`).classList.toggle('is-hidden', name !== screenName));
  }

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme || 'system');
  }

  return {
    setVaultStatus,
    closeDrawers,
    openDrawer,
    showScreen,
    applyTheme,
  };
}

export { createUiShell };
