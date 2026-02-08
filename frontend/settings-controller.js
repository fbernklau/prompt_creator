function createSettingsController({ state, el, api, applyTheme }) {
  function applySettingsToUi() {
    applyTheme(state.settings.theme);
    document.querySelectorAll('input[name="theme"]').forEach((node) => (node.checked = node.value === state.settings.theme));
    document.querySelectorAll('input[name="flow-mode"]').forEach((node) => (node.checked = node.value === (state.settings.flowMode || 'step')));
    el('setting-copy-metadata').checked = !!state.settings.copyIncludeMetadata;
    el('setting-advanced-open').checked = !!state.settings.advancedOpen;
    el('setting-show-community').checked = state.settings.showCommunityTemplates !== false;
    el('copy-include-metadata').checked = !!state.settings.copyIncludeMetadata;
    el('advanced-fields').classList.toggle('is-hidden', !state.settings.advancedOpen);
  }

  async function saveSettings(partial, showStatus = true) {
    state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(partial) });
    applySettingsToUi();
    if (showStatus) {
      el('settings-status').textContent = 'Gespeichert.';
      setTimeout(() => {
        el('settings-status').textContent = '';
      }, 1200);
    }
  }

  return {
    applySettingsToUi,
    saveSettings,
  };
}

export { createSettingsController };
