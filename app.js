import { DEFAULT_PRESET_OPTIONS, SETTINGS_DEFAULTS } from './frontend/config.js';
import { el } from './frontend/dom.js';
import { api } from './frontend/api.js';
import { uid } from './frontend/id.js';
import { loadTemplateCatalog } from './frontend/catalog.js';
import { createUiShell } from './frontend/ui-shell.js';
import { createSettingsController } from './frontend/settings-controller.js';
import { createHistoryController } from './frontend/history-controller.js';
import { createProviderController } from './frontend/provider-controller.js';
import { createLibraryController } from './frontend/library-controller.js';
import { createTaskController } from './frontend/task-controller.js';
import { createAdminController } from './frontend/admin-controller.js';

let categoryConfig = {};
let presetOptions = { ...DEFAULT_PRESET_OPTIONS };

const state = {
  currentUser: null,
  access: { roles: [], permissions: [] },
  settings: { ...SETTINGS_DEFAULTS },
  providers: [],
  history: [],
  activeId: null,
  selectedCategory: null,
  selectedSubcategory: null,
  generatedPrompt: '',
  generatedMeta: '',
  lastPromptContext: null,
  libraryMode: 'own',
  libraryOwn: [],
  libraryPublic: [],
  editProviderId: null,
};

function getCategoryConfig() {
  return categoryConfig;
}

function getPresetOptions() {
  return presetOptions;
}

const uiShell = createUiShell({ el });
const settingsController = createSettingsController({
  state,
  el,
  api,
  applyTheme: uiShell.applyTheme,
});
const historyController = createHistoryController({ state, el, api });
const providerController = createProviderController({
  state,
  el,
  api,
  uid,
  setVaultStatus: uiShell.setVaultStatus,
});
const libraryController = createLibraryController({
  state,
  el,
  api,
  getCategoryConfig,
});
const adminController = createAdminController({
  state,
  el,
  api,
  showScreen: uiShell.showScreen,
});
const taskController = createTaskController({
  state,
  el,
  api,
  getCategoryConfig,
  getPresetOptions,
  showScreen: uiShell.showScreen,
  saveHistory: historyController.saveHistory,
});

async function loadServerData() {
  const me = await api('/api/me');
  state.currentUser = me.userId;
  state.access = {
    roles: Array.isArray(me.roles) ? me.roles : [],
    permissions: Array.isArray(me.permissions) ? me.permissions : [],
  };
  el('current-user').textContent = `Benutzer: ${state.currentUser} | Rollen: ${(state.access.roles || []).join(', ') || 'keine'}`;

  state.settings = await api('/api/settings');
  state.providers = await api('/api/providers');
  state.history = await api('/api/history');
  state.activeId = state.providers[0]?.id || null;
}

function bindEvents() {
  providerController.initializeProviderForm();
  adminController.bindEvents();

  el('btn-provider').addEventListener('click', () => uiShell.openDrawer('provider-drawer'));
  el('btn-history').addEventListener('click', () => {
    historyController.renderHistory();
    uiShell.openDrawer('history-drawer');
  });
  el('btn-options').addEventListener('click', () => uiShell.openDrawer('options-drawer'));
  el('btn-library').addEventListener('click', async () => {
    uiShell.showScreen('library');
    await libraryController.refreshLibrary();
  });

  el('btn-new-task').addEventListener('click', taskController.resetTaskState);
  el('btn-restart-from-result').addEventListener('click', taskController.resetTaskState);
  el('btn-adjust').addEventListener('click', () => uiShell.showScreen('form'));
  el('btn-back-home-from-subcat').addEventListener('click', () => uiShell.showScreen('home'));
  el('btn-back-home-from-form').addEventListener('click', () => uiShell.showScreen('home'));
  el('btn-back-subcat').addEventListener('click', () => uiShell.showScreen((state.settings.flowMode || 'step') === 'step' ? 'subcategory' : 'home'));
  el('btn-back-home-from-library').addEventListener('click', () => uiShell.showScreen('home'));

  el('close-provider-drawer').addEventListener('click', uiShell.closeDrawers);
  el('close-history-drawer').addEventListener('click', uiShell.closeDrawers);
  el('close-options-drawer').addEventListener('click', uiShell.closeDrawers);
  el('overlay').addEventListener('click', uiShell.closeDrawers);

  el('unlock-vault').addEventListener('click', providerController.unlockVault);
  el('lock-vault').addEventListener('click', providerController.lockVault);
  el('provider-form').addEventListener('submit', (event) => providerController.handleProviderSubmit(event).catch((error) => alert(error.message)));
  el('provider-reset').addEventListener('click', providerController.clearProviderForm);

  el('prompt-form').addEventListener('submit', (event) => taskController.generatePrompt(event).catch((error) => alert(error.message)));
  el('toggle-advanced').addEventListener('click', () => {
    const area = el('advanced-fields');
    area.classList.toggle('is-hidden');
  });

  el('unterkategorie-select').addEventListener('change', taskController.updateSelectedSubcategory);

  el('copy-prompt').addEventListener('click', taskController.copyPrompt);
  el('export-txt').addEventListener('click', () => taskController.exportPrompt('txt'));
  el('export-md').addEventListener('click', () => taskController.exportPrompt('md'));
  el('save-library').addEventListener('click', () => libraryController.saveCurrentPromptToLibrary().catch((error) => alert(error.message)));

  el('lib-tab-own').addEventListener('click', async () => {
    state.libraryMode = 'own';
    el('lib-tab-own').classList.add('is-active');
    el('lib-tab-public').classList.remove('is-active');
    await libraryController.refreshLibrary();
  });
  el('lib-tab-public').addEventListener('click', async () => {
    state.libraryMode = 'public';
    el('lib-tab-public').classList.add('is-active');
    el('lib-tab-own').classList.remove('is-active');
    await libraryController.refreshLibrary();
  });
  el('lib-refresh').addEventListener('click', () => libraryController.refreshLibrary().catch((error) => alert(error.message)));
  el('library-list').addEventListener('click', (event) => libraryController.handleLibraryAction(event).catch((error) => alert(error.message)));

  el('save-settings').addEventListener('click', async () => {
    const theme = document.querySelector('input[name="theme"]:checked')?.value || 'system';
    const flowMode = document.querySelector('input[name="flow-mode"]:checked')?.value || 'step';
    await settingsController.saveSettings({
      theme,
      flowMode,
      copyIncludeMetadata: el('setting-copy-metadata').checked,
      advancedOpen: el('setting-advanced-open').checked,
    });
  });

  el('choose-flow-step').addEventListener('click', async () => {
    await settingsController.saveSettings({ flowMode: 'step' }, false);
    el('flow-choice-modal').classList.add('is-hidden');
  });
  el('choose-flow-single').addEventListener('click', async () => {
    await settingsController.saveSettings({ flowMode: 'single' }, false);
    el('flow-choice-modal').classList.add('is-hidden');
  });
}

async function init() {
  uiShell.setVaultStatus('Server-Key-Schutz aktiv.');
  bindEvents();

  try {
    await loadServerData();
    const catalog = await loadTemplateCatalog(api);
    categoryConfig = catalog.categories;
    presetOptions = catalog.presetOptions;

    taskController.renderCategoryGrid();
    libraryController.prepareLibraryFilters();
    taskController.setupAdvancedPresets();
    settingsController.applySettingsToUi();
    providerController.renderProviders();
    historyController.renderHistory();
    adminController.ensureAdminVisible();
    uiShell.showScreen('home');

    if (!state.settings.flowMode) {
      el('flow-choice-modal').classList.remove('is-hidden');
    }
  } catch (error) {
    alert(`Fehler beim Laden der Anwendungsdaten: ${error.message}`);
  }
}

init();
