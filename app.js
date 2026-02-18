import { DEFAULT_PRESET_OPTIONS, SETTINGS_DEFAULTS } from './frontend/config.js';
import { el } from './frontend/dom.js';
import { api, apiStream } from './frontend/api.js';
import { uid } from './frontend/id.js';
import { loadTemplateCatalog } from './frontend/catalog.js';
import { createUiShell } from './frontend/ui-shell.js';
import { createSettingsController } from './frontend/settings-controller.js';
import { createHistoryController } from './frontend/history-controller.js';
import { createProviderController } from './frontend/provider-controller.js';
import { createLibraryController } from './frontend/library-controller.js';
import { createTaskController } from './frontend/task-controller.js';
import { createAdminController } from './frontend/admin-controller.js';
import { createTemplateStudioController } from './frontend/template-studio-controller.js';
import { createDashboardController } from './frontend/dashboard-controller.js';

let categoryConfig = {};
let presetOptions = { ...DEFAULT_PRESET_OPTIONS };

const state = {
  currentUser: null,
  logoutUrl: '',
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

function notify(message, { type = 'info', timeoutMs = 3200 } = {}) {
  const text = String(message || '').trim();
  if (!text) return;
  const stack = el('app-toast-stack');
  if (!stack) {
    if (type === 'error') console.error(text);
    else console.log(text);
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.dataset.type = type;

  const messageNode = document.createElement('span');
  messageNode.textContent = text;
  toast.appendChild(messageNode);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'app-toast-close';
  closeButton.setAttribute('aria-label', 'Toast schließen');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => toast.remove());
  toast.appendChild(closeButton);

  stack.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, Math.max(1200, Number(timeoutMs) || 3200));
}

function notifyError(error, prefix = '') {
  const message = String(error?.message || error || 'Unbekannter Fehler').trim();
  notify(prefix ? `${prefix}: ${message}` : message, { type: 'error' });
}

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
  applyNavLayout: uiShell.applyNavLayout,
});
const historyController = createHistoryController({ state, el, api });
const providerController = createProviderController({
  state,
  el,
  api,
  uid,
  notify,
  setVaultStatus: uiShell.setVaultStatus,
  persistProviderStageSettings: async (partial) => {
    await queueSettingsSave(partial, { refreshCatalog: false, showStatus: false });
  },
});
const adminController = createAdminController({
  state,
  el,
  api,
  showScreen: uiShell.showScreen,
});
const templateStudioController = createTemplateStudioController({
  state,
  el,
  api,
  showScreen: uiShell.showScreen,
  reloadCatalog: async () => {
    const catalog = await loadTemplateCatalog(api);
    categoryConfig = catalog.categories;
    presetOptions = catalog.presetOptions;
    taskController.renderCategoryGrid();
    await taskController.refreshTemplateDiscovery();
    libraryController.prepareLibraryFilters();
  },
});
const dashboardController = createDashboardController({
  state,
  el,
  api,
  notify,
  showScreen: uiShell.showScreen,
});
const taskController = createTaskController({
  state,
  el,
  api,
  apiStream,
  getCategoryConfig,
  getPresetOptions,
  showScreen: uiShell.showScreen,
  saveHistory: historyController.saveHistory,
  notify,
});
dashboardController.setOpenHistoryHandler((entry) => taskController.openHistoryEntry(entry));
const libraryController = createLibraryController({
  state,
  el,
  api,
  notify,
  getCategoryConfig,
  showScreen: uiShell.showScreen,
  onOpenTemplateFromLibrary: (entry) => taskController.openLibraryEntry(entry),
});

function hideSetupWizard() {
  el('setup-wizard-modal').classList.add('is-hidden');
}

function showSetupWizard() {
  el('setup-wizard-modal').classList.remove('is-hidden');
}

function shouldShowSetupWizard() {
  if (sessionStorage.getItem('eduprompt_setup_skip_session') === '1') return false;
  const setupDone = localStorage.getItem('eduprompt_setup_done') === '1';
  if (!setupDone) return true;
  return state.providers.length === 0;
}

async function loadServerData() {
  const me = await api('/api/me');
  state.currentUser = me.userId;
  state.logoutUrl = String(me.logoutUrl || '').trim();
  state.access = {
    roles: Array.isArray(me.roles) ? me.roles : [],
    permissions: Array.isArray(me.permissions) ? me.permissions : [],
  };
  el('current-user').textContent = `Benutzer: ${state.currentUser} | Rollen: ${(state.access.roles || []).join(', ') || 'keine'}`;
  if (el('btn-logout')) {
    el('btn-logout').classList.toggle('is-hidden', !state.logoutUrl);
  }

  state.settings = await api('/api/settings');
  state.providers = await api('/api/providers');
  state.history = await api('/api/history');
  state.activeId = state.providers[0]?.id || null;
}

async function reloadCatalogUi() {
  const catalog = await loadTemplateCatalog(api);
  categoryConfig = catalog.categories;
  presetOptions = catalog.presetOptions;
  taskController.renderCategoryGrid();
  await taskController.refreshTemplateDiscovery();
  libraryController.prepareLibraryFilters();
}

function setSettingsStatus(text = '') {
  el('settings-status').textContent = text;
  if (!text) return;
  setTimeout(() => {
    if (el('settings-status').textContent === text) {
      el('settings-status').textContent = '';
    }
  }, 1400);
}

let settingsSaveChain = Promise.resolve();
function queueSettingsSave(partial, { refreshCatalog = false, showStatus = true } = {}) {
  settingsSaveChain = settingsSaveChain
    .then(async () => {
      await settingsController.saveSettings(partial, false);
      taskController.syncAdvancedSectionUi();
      taskController.syncFlowModeUi();
      if (refreshCatalog) {
        await reloadCatalogUi();
      }
      if (showStatus) {
        setSettingsStatus('Automatisch gespeichert.');
      }
    })
    .catch((error) => {
      notifyError(error);
    });
  return settingsSaveChain;
}

function mountDashboardUserPanels() {
  const providerHost = el('dashboard-provider-host');
  const optionsHost = el('dashboard-options-host');
  const providerBody = document.querySelector('#provider-drawer .drawer-body');
  const optionsBody = document.querySelector('#options-drawer .drawer-body');

  if (providerHost && providerBody && !providerHost.contains(providerBody)) {
    providerHost.appendChild(providerBody);
  }
  if (optionsHost && optionsBody && !optionsHost.contains(optionsBody)) {
    optionsHost.appendChild(optionsBody);
  }

  if (el('provider-drawer')) el('provider-drawer').classList.add('is-hidden');
  if (el('options-drawer')) el('options-drawer').classList.add('is-hidden');
}

function bindEvents() {
  mountDashboardUserPanels();
  providerController.initializeProviderForm();
  adminController.bindEvents();
  templateStudioController.bindEvents();
  dashboardController.bindEvents();
  taskController.bindEvents();
  libraryController.bindEvents();

  el('btn-provider').addEventListener('click', async () => {
    await providerController.refreshModelCatalogAndSync().catch(() => {});
    await dashboardController.openDashboard('providers');
  });
  el('btn-options').addEventListener('click', () => dashboardController.openDashboard('options').catch((error) => notifyError(error)));
  if (el('btn-logout')) {
    el('btn-logout').addEventListener('click', () => {
      if (!state.logoutUrl) return;
      window.location.assign(state.logoutUrl);
    });
  }
  el('btn-library').addEventListener('click', async () => {
    uiShell.showScreen('library');
    await libraryController.refreshLibrary();
  });
  if (el('mb-new-task')) el('mb-new-task').addEventListener('click', taskController.resetTaskState);
  if (el('mb-library')) {
    el('mb-library').addEventListener('click', async () => {
      uiShell.showScreen('library');
      await libraryController.refreshLibrary();
    });
  }
  if (el('mb-dashboard')) {
    el('mb-dashboard').addEventListener('click', () => {
      el('btn-dashboard').click();
    });
  }
  if (el('mb-provider')) {
    el('mb-provider').addEventListener('click', async () => {
      await providerController.refreshModelCatalogAndSync().catch(() => {});
      await dashboardController.openDashboard('providers');
    });
  }
  if (el('mb-options')) el('mb-options').addEventListener('click', () => dashboardController.openDashboard('options').catch((error) => notifyError(error)));

  el('btn-new-task').addEventListener('click', taskController.resetTaskState);
  el('btn-restart-from-result').addEventListener('click', taskController.resetTaskState);
  el('btn-adjust').addEventListener('click', () => uiShell.showScreen('form'));
  el('btn-back-home-from-subcat').addEventListener('click', () => uiShell.showScreen('home'));
  el('btn-back-home-from-form').addEventListener('click', () => uiShell.showScreen('home'));
  el('btn-back-subcat').addEventListener('click', () => uiShell.showScreen((state.settings.flowMode || 'step') === 'step' ? 'subcategory' : 'home'));
  el('btn-back-home-from-library').addEventListener('click', () => uiShell.showScreen('home'));
  if (el('btn-back-library-entry')) {
    el('btn-back-library-entry').addEventListener('click', () => uiShell.showScreen('library'));
  }
  if (el('home-show-all-templates')) {
    el('home-show-all-templates').addEventListener('click', () => {
      el('btn-templates').click();
    });
  }

  el('close-provider-drawer').addEventListener('click', uiShell.closeDrawers);
  el('close-options-drawer').addEventListener('click', uiShell.closeDrawers);
  el('overlay').addEventListener('click', uiShell.closeDrawers);

  el('unlock-vault').addEventListener('click', providerController.unlockVault);
  el('lock-vault').addEventListener('click', providerController.lockVault);
  el('provider-form').addEventListener('submit', (event) => providerController.handleProviderSubmit(event).catch((error) => notifyError(error)));
  el('provider-test').addEventListener('click', () => providerController.testProviderConnection().catch((error) => notifyError(error)));
  el('provider-reset').addEventListener('click', providerController.clearProviderForm);

  el('prompt-form').addEventListener('submit', (event) => taskController.generatePrompt(event).catch((error) => notifyError(error)));

  el('export-txt').addEventListener('click', () => taskController.exportPrompt('txt'));
  el('export-md').addEventListener('click', () => taskController.exportPrompt('md'));
  el('save-library').addEventListener('click', () => libraryController.saveCurrentPromptToLibrary().catch((error) => notifyError(error)));
  el('btn-open-templates-from-result').addEventListener('click', () => {
    el('btn-templates').click();
  });

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
  el('lib-refresh').addEventListener('click', () => libraryController.refreshLibrary().catch((error) => notifyError(error)));
  el('library-list').addEventListener('click', (event) => libraryController.handleLibraryAction(event).catch((error) => notifyError(error)));

  const collectFullSettingsPayload = () => {
    const theme = document.querySelector('input[name="theme"]:checked')?.value || 'system';
    const flowMode = document.querySelector('input[name="flow-mode"]:checked')?.value || 'step';
    const generationMode = document.querySelector('input[name="generation-mode"]:checked')?.value || 'prompt';
    const navLayout = document.querySelector('input[name="nav-layout"]:checked')?.value || 'topbar';
    return {
      theme,
      flowMode,
      resultModeEnabled: generationMode === 'result',
      navLayout,
      libraryDetailView: document.querySelector('input[name="library-detail-view"]:checked')?.value || 'page',
      copyIncludeMetadata: el('setting-copy-metadata').checked,
      advancedOpen: el('setting-advanced-open').checked,
      showCommunityTemplates: el('setting-show-community').checked,
    };
  };

  el('save-settings').addEventListener('click', async () => {
    await queueSettingsSave(collectFullSettingsPayload(), { refreshCatalog: true, showStatus: false });
    setSettingsStatus('Gespeichert.');
  });

  document.querySelectorAll('input[name="theme"]').forEach((node) => {
    node.addEventListener('change', () => {
      queueSettingsSave({ theme: node.value });
    });
  });
  document.querySelectorAll('input[name="flow-mode"]').forEach((node) => {
    node.addEventListener('change', () => {
      queueSettingsSave({ flowMode: node.value });
    });
  });
  document.querySelectorAll('input[name="generation-mode"]').forEach((node) => {
    node.addEventListener('change', () => {
      queueSettingsSave({ resultModeEnabled: node.value === 'result' });
    });
  });
  document.querySelectorAll('input[name="nav-layout"]').forEach((node) => {
    node.addEventListener('change', () => {
      queueSettingsSave({ navLayout: node.value });
    });
  });
  document.querySelectorAll('input[name="library-detail-view"]').forEach((node) => {
    node.addEventListener('change', () => {
      queueSettingsSave({ libraryDetailView: node.value });
    });
  });
  el('setting-copy-metadata').addEventListener('change', () => {
    queueSettingsSave({ copyIncludeMetadata: el('setting-copy-metadata').checked });
  });
  el('setting-advanced-open').addEventListener('change', () => {
    queueSettingsSave({ advancedOpen: el('setting-advanced-open').checked });
  });
  el('setting-show-community').addEventListener('change', () => {
    queueSettingsSave(
      { showCommunityTemplates: el('setting-show-community').checked },
      { refreshCatalog: true }
    );
  });

  el('choose-flow-step').addEventListener('click', async () => {
    await settingsController.saveSettings({ flowMode: 'step' }, false);
    taskController.syncFlowModeUi();
    el('flow-choice-modal').classList.add('is-hidden');
    if (shouldShowSetupWizard()) showSetupWizard();
  });
  el('choose-flow-single').addEventListener('click', async () => {
    await settingsController.saveSettings({ flowMode: 'single' }, false);
    taskController.syncFlowModeUi();
    el('flow-choice-modal').classList.add('is-hidden');
    if (shouldShowSetupWizard()) showSetupWizard();
  });

  el('wizard-open-provider').addEventListener('click', () => {
    dashboardController.openDashboard('providers').catch((error) => notifyError(error));
    el('wizard-status').textContent = 'Dashboard geöffnet. Bitte Modell, Key und Base URL setzen.';
  });
  el('wizard-test-provider').addEventListener('click', async () => {
    el('wizard-status').textContent = 'Teste aktiven Provider...';
    try {
      const result = await providerController.testProviderConnection({ preferActive: true });
      el('wizard-status').textContent = `Test erfolgreich (${result.latencyMs} ms).`;
    } catch (error) {
      el('wizard-status').textContent = `Test fehlgeschlagen: ${error.message}`;
    }
  });
  el('wizard-complete').addEventListener('click', () => {
    localStorage.setItem('eduprompt_setup_done', '1');
    sessionStorage.removeItem('eduprompt_setup_skip_session');
    hideSetupWizard();
  });
  el('wizard-skip').addEventListener('click', () => {
    sessionStorage.setItem('eduprompt_setup_skip_session', '1');
    hideSetupWizard();
  });
}

async function init() {
  uiShell.setVaultStatus('Server-Key-Schutz aktiv.');
  bindEvents();

  try {
    await loadServerData();
    await providerController.refreshModelCatalog();
    const catalog = await loadTemplateCatalog(api);
    categoryConfig = catalog.categories;
    presetOptions = catalog.presetOptions;

    taskController.renderCategoryGrid();
    await taskController.refreshTemplateDiscovery();
    libraryController.prepareLibraryFilters();
    taskController.setupAdvancedPresets();
    settingsController.applySettingsToUi();
    taskController.syncAdvancedSectionUi();
    taskController.syncFlowModeUi();
    providerController.renderProviders();
    historyController.renderHistory();
    adminController.ensureAdminVisible();
    templateStudioController.ensureVisible();
    uiShell.showScreen('home');

    if (!state.settings.flowMode) {
      el('flow-choice-modal').classList.remove('is-hidden');
    } else if (shouldShowSetupWizard()) {
      showSetupWizard();
    }
  } catch (error) {
    notifyError(error, 'Fehler beim Laden der Anwendungsdaten');
  }
}

init();
