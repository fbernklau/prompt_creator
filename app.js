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
  welcomeFlowEnabled: true,
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

const INTRO_TOUR_VERSION = 1;
const introTourState = {
  active: false,
  index: 0,
  highlightedSelector: '',
  highlightedNode: null,
  highlightedClass: '',
  anchorClickCleanup: null,
  waitConditionCleanup: null,
  spotlightCleanup: null,
  autoActionStep: -1,
};
const introTourContext = {
  providerCheckSummary: '',
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

function resolveLogoutTarget(rawUrl = '') {
  const fallback = `/outpost.goauthentik.io/sign_out?rd=${encodeURIComponent(`${window.location.origin}/`)}`;
  const normalized = String(rawUrl || '').trim();
  if (!normalized) return fallback;
  const lower = normalized.toLowerCase();
  if (lower.includes('backchannel-logout')) {
    try {
      const parsed = new URL(normalized);
      return `${parsed.origin}/outpost.goauthentik.io/sign_out?rd=${encodeURIComponent(`${window.location.origin}/`)}`;
    } catch (_error) {
      return fallback;
    }
  }
  if (normalized.startsWith('/outpost.goauthentik.io/sign_out') && !normalized.includes('?rd=')) {
    return `${normalized}?rd=${encodeURIComponent(`${window.location.origin}/`)}`;
  }
  return normalized;
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

function shouldShowIntroductionTour() {
  if (state.welcomeFlowEnabled === false) return false;
  if (sessionStorage.getItem('eduprompt_intro_skip_session') === '1') return false;
  const hasSeen = state.settings?.hasSeenIntroduction === true;
  const version = Number(state.settings?.introTourVersion || 0);
  return !hasSeen || version < INTRO_TOUR_VERSION;
}

function clearIntroductionHighlight() {
  if (typeof introTourState.anchorClickCleanup === 'function') {
    introTourState.anchorClickCleanup();
  }
  introTourState.anchorClickCleanup = null;
  if (typeof introTourState.waitConditionCleanup === 'function') {
    introTourState.waitConditionCleanup();
  }
  introTourState.waitConditionCleanup = null;
  if (typeof introTourState.spotlightCleanup === 'function') {
    introTourState.spotlightCleanup();
  }
  introTourState.spotlightCleanup = null;
  const spotlight = el('intro-tour-spotlight');
  if (spotlight) {
    spotlight.classList.add('is-hidden');
    spotlight.style.left = '';
    spotlight.style.top = '';
    spotlight.style.width = '';
    spotlight.style.height = '';
  }
  const modal = el('intro-tour-modal');
  if (modal) {
    modal.classList.add('tour-no-spotlight');
  }
  if (!introTourState.highlightedSelector) return;
  const node = introTourState.highlightedNode || document.querySelector(introTourState.highlightedSelector);
  if (node) {
    node.classList.remove('tour-highlight');
    if (introTourState.highlightedClass) {
      node.classList.remove(introTourState.highlightedClass);
    }
  }
  introTourState.highlightedSelector = '';
  introTourState.highlightedNode = null;
  introTourState.highlightedClass = '';
}

function applyIntroductionSpotlight(targetNode) {
  const spotlight = el('intro-tour-spotlight');
  const modal = el('intro-tour-modal');
  if (!spotlight || !modal || !targetNode) return;

  const padding = 8;
  const minSize = 24;
  const update = () => {
    if (!introTourState.active) return;
    if (!document.contains(targetNode) || targetNode.closest('.is-hidden')) {
      spotlight.classList.add('is-hidden');
      modal.classList.add('tour-no-spotlight');
      return;
    }
    const rect = targetNode.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      spotlight.classList.add('is-hidden');
      modal.classList.add('tour-no-spotlight');
      return;
    }

    const left = Math.max(4, rect.left - padding);
    const top = Math.max(4, rect.top - padding);
    const right = Math.min(window.innerWidth - 4, rect.right + padding);
    const bottom = Math.min(window.innerHeight - 4, rect.bottom + padding);
    const width = Math.max(minSize, right - left);
    const height = Math.max(minSize, bottom - top);

    spotlight.style.left = `${left}px`;
    spotlight.style.top = `${top}px`;
    spotlight.style.width = `${width}px`;
    spotlight.style.height = `${height}px`;
    spotlight.classList.remove('is-hidden');
    modal.classList.remove('tour-no-spotlight');
  };

  const onViewportChange = () => update();
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
  introTourState.spotlightCleanup = () => {
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
  };

  update();
}

function isScreenVisible(screenId) {
  const node = el(screenId);
  return !!node && !node.classList.contains('is-hidden');
}

function isFieldEffectivelyVisible(node) {
  if (!node) return false;
  if (node.disabled) return false;
  if (node.closest('.is-hidden')) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

function isTemplateFormReadyForGeneration() {
  const form = el('prompt-form');
  if (!form || !isScreenVisible('screen-form')) return false;
  const requiredNodes = Array.from(form.querySelectorAll('input[required], select[required], textarea[required]'))
    .filter((node) => isFieldEffectivelyVisible(node));
  return requiredNodes.every((node) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      return node.checkValidity();
    }
    return true;
  });
}

function isResultReadyForTour() {
  if (!isScreenVisible('screen-result')) return false;
  const banner = el('result-ready-banner');
  if (!banner || banner.classList.contains('is-hidden')) return false;
  return String(banner.textContent || '').trim().length > 0;
}

function resolveIntroductionAnchor(step) {
  if (!step) return null;
  const selectors = Array.isArray(step.anchors)
    ? step.anchors
    : [step.anchor].filter(Boolean);
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) continue;
    if (node.closest('.is-hidden')) continue;
    return { node, selector };
  }
  return null;
}

function getIntroductionSteps() {
  const providerAvailability = providerController.getProviderAvailabilitySummary
    ? providerController.getProviderAvailabilitySummary()
    : {
      hasReadyProvider: false,
      readyProviderCount: 0,
      totalProviders: 0,
      assignedSystemKeys: 0,
    };
  const readinessHint = providerAvailability.hasReadyProvider
    ? `Es ist bereits mindestens ein nutzbarer API-Key hinterlegt (${providerAvailability.readyProviderCount} verfügbar).`
    : 'Aktuell ist noch kein nutzbarer API-Key hinterlegt. Das richten wir gemeinsam ein.';

  return [
    {
      title: 'Willkommen',
      text: `${readinessHint} In dieser Tour lernst du den gesamten Ablauf von Auswahl bis Bibliothek.`,
      anchor: '#screen-home .tw-home-hero',
      anchorHint: 'Startpunkt: Home-Übersicht.',
    },
    {
      title: 'Allgemeiner Ablauf',
      text: 'Ablauf: Kategorie wählen → Template öffnen → Felder ausfüllen → Metaprompt oder direktes Ergebnis generieren → in Bibliothek speichern.',
      anchor: '#screen-home .tw-home-hero',
      anchorHint: 'Die Kernschritte bleiben immer gleich.',
    },
    {
      title: 'Hauptseite',
      text: 'Suche nach Templates, kombiniere Tags und starte über die Handlungsfelder direkt in den passenden Flow.',
      anchor: '#screen-home .tw-home-search-card',
      anchorHint: 'Hier startest du typischerweise jeden Lauf.',
    },
    {
      title: 'Navigation',
      text: 'Navigation: Neue Aufgabe, Bibliothek, Dashboard, API-Provider und Optionen. Die wichtigsten Einstellungen liegen im Dashboard.',
      anchors: ['#btn-options', '#mb-options'],
      anchorHint: 'Klicke auf „Optionen“, um den nächsten Schritt auszulösen.',
      highlightClass: 'tour-highlight-arrow-up',
      waitForAnchorClick: true,
      anchorsAdvanceSelectors: ['#btn-options', '#mb-options'],
    },
    {
      title: 'Optionen öffnen',
      text: 'Für diese Tour setzen wir kurz empfohlene Werte: Light Mode, Schrittweise Ansicht, Prompt-only. Du kannst danach alles wieder ändern.',
      anchors: ['#dashboard-options-host', '#btn-options'],
      anchorHint: 'Optionen sind pro Nutzerprofil gespeichert.',
      autoAction: true,
      action: async () => {
        await dashboardController.openDashboard('options');
        await queueSettingsSave(
          { theme: 'light', flowMode: 'step', resultModeEnabled: false },
          { refreshCatalog: false, showStatus: false }
        );
        introTourContext.providerCheckSummary = '';
      },
      actionLabel: 'Optionen anzeigen',
    },
    {
      title: 'Option: Theme',
      text: 'Theme steuert nur die Darstellung. Für die Tour ist „Light“ gesetzt. Später kannst du jederzeit auf „Dark“ oder „System“ wechseln.',
      anchor: '#option-panel-theme',
      anchorHint: 'Aktueller Tour-Wert: Light.',
    },
    {
      title: 'Option: Flow-Modus',
      text: 'Schrittweise Ansicht führt klar durch Kategorie → Template → Formular. Für die Tour ist dieser Modus aktiv.',
      anchor: '#option-panel-flow',
      anchorHint: 'Empfehlung für Einstieg: Schrittweise Ansicht.',
    },
    {
      title: 'Option: Generierungsmodus',
      text: 'Global steht die App auf Prompt-only. Für einzelne Läufe kannst du später auf der Template-Seite auf „Direktes Ergebnis“ umschalten.',
      anchor: '#option-panel-generation',
      anchorHint: 'Tour-Standard: Prompt-only.',
    },
    {
      title: 'Option: Navigation',
      text: 'Hier wählst du Topbar oder Sidebar (Desktop). Auf Mobil bleibt die kompakte Navigation aktiv.',
      anchor: '#option-panel-nav',
      anchorHint: 'Die Navigation beeinflusst nur das Layout.',
    },
    {
      title: 'Option: Library-Detailansicht',
      text: 'Bestimmt, ob Bibliothekseinträge als Seitenansicht oder Modal geöffnet werden.',
      anchor: '#option-panel-library',
      anchorHint: 'Empfehlung: Seitenansicht für klare Nachvollziehbarkeit.',
    },
    {
      title: 'Option: Standardverhalten',
      text: 'Hier steuerst du sinnvolle Defaults (z. B. Metadata beim Kopieren oder Community-Sichtbarkeit).',
      anchor: '#option-panel-defaults',
      anchorHint: 'Diese Werte kannst du jederzeit anpassen.',
    },
    {
      title: 'API-Provider Überblick',
      text: 'Hier siehst du persönliche und zugewiesene Keys. Pro Stage (Metaprompt/Result) muss genau ein aktiver Key gesetzt sein.',
      anchors: ['#dashboard-provider-host', '#btn-provider'],
      anchorHint: 'Wir wechseln jetzt in den API-Provider-Bereich.',
      action: async () => {
        await providerController.refreshModelCatalogAndSync().catch(() => {});
        await dashboardController.openDashboard('providers');
      },
      actionLabel: 'API-Provider öffnen',
    },
    {
      title: 'Aktive Stages',
      text: 'Oben siehst du die aktuell aktiven Keys für Metaprompt und Result. Diese Zuordnung wird beim Generieren verwendet.',
      anchor: '#provider-stage-summary',
      anchorHint: 'Zwei Stages, zwei aktive Zuordnungen.',
    },
    {
      title: 'API-Key Verfügbarkeit prüfen',
      text: () => {
        const checkText = introTourContext.providerCheckSummary
          ? ` ${introTourContext.providerCheckSummary}`
          : ' Wir prüfen jetzt automatisch die aktiven Stage-Zuordnungen.';
        return `Statusprüfung zeigt dir direkt, welcher Key je Stage funktioniert.${checkText}`;
      },
      anchor: '#provider-check-stages',
      anchorHint: 'Wenn nur eine Stage funktioniert, wird automatisch auf den funktionierenden Key umgestellt.',
      autoAction: true,
      action: async () => {
        introTourContext.providerCheckSummary = 'Statuscheck läuft …';
        notify('Statusprüfung gestartet …', { type: 'info' });
        await providerController.refreshModelCatalogAndSync().catch(() => {});
        await dashboardController.openDashboard('providers');
        try {
          const check = await providerController.checkStageConnectivity({ autoSwitchOnSingleSuccess: false });
          let metaprompt = check.results.find((entry) => entry.stage === 'metaprompt');
          let result = check.results.find((entry) => entry.stage === 'result');
          let metaText = metaprompt?.ok
            ? `Metaprompt: bereit (${metaprompt.providerLabel || 'Key unbekannt'})`
            : `Metaprompt: Fehler (${metaprompt?.providerLabel || 'nicht gesetzt'})`;
          let resultText = result?.ok
            ? `Result: bereit (${result.providerLabel || 'Key unbekannt'})`
            : `Result: Fehler (${result?.providerLabel || 'nicht gesetzt'})`;
          let switchText = '';
          const oneWorksOneFails = !!(metaprompt?.ok !== result?.ok);
          if (oneWorksOneFails) {
            const working = metaprompt?.ok ? metaprompt : result;
            const failing = metaprompt?.ok ? result : metaprompt;
            if (working?.providerId && failing?.stage) {
              await providerController.selectProviderForStage(failing.stage, working.providerId);
              switchText = ` ${failing?.stage === 'result' ? 'Result' : 'Metaprompt'} wurde automatisch auf den funktionierenden Key umgestellt.`;
              const recheck = await providerController.checkStageConnectivity({ autoSwitchOnSingleSuccess: false });
              metaprompt = recheck.results.find((entry) => entry.stage === 'metaprompt');
              result = recheck.results.find((entry) => entry.stage === 'result');
              metaText = metaprompt?.ok
                ? `Metaprompt: bereit (${metaprompt.providerLabel || 'Key unbekannt'})`
                : `Metaprompt: Fehler (${metaprompt?.providerLabel || 'nicht gesetzt'})`;
              resultText = result?.ok
                ? `Result: bereit (${result.providerLabel || 'Key unbekannt'})`
                : `Result: Fehler (${result?.providerLabel || 'nicht gesetzt'})`;
            }
          }
          const noWorkingKey = !metaprompt?.ok && !result?.ok;
          if (noWorkingKey) {
            introTourContext.providerCheckSummary = `Statuscheck: ${metaText}, ${resultText}. Kein funktionierender Key gefunden. Nutze „API-Key hinzufügen“, um einen persönlichen Key anzulegen.`;
          } else {
            introTourContext.providerCheckSummary = `Statuscheck: ${metaText}, ${resultText}.${switchText}`;
          }
          notify(introTourContext.providerCheckSummary, { type: (metaprompt?.ok || result?.ok) ? 'ok' : 'error' });
        } catch (error) {
          introTourContext.providerCheckSummary = `Statuscheck fehlgeschlagen: ${error.message}`;
          notify(introTourContext.providerCheckSummary, { type: 'error' });
        }
      },
      actionLabel: 'Status prüfen',
    },
    {
      title: 'API-Key anlegen (falls nötig)',
      text: 'Wenn kein funktionierender Key vorhanden ist, lege hier einen persönlichen Key an. Danach geht die Tour automatisch weiter.',
      anchors: ['#provider-list [data-open-provider-editor]', '#provider-form-modal', '#provider-form'],
      anchorHint: 'Öffne „API-Key hinzufügen“, speichere das Profil und prüfe den Status erneut.',
      action: async () => {
        const summary = providerController.getProviderAvailabilitySummary
          ? providerController.getProviderAvailabilitySummary()
          : { hasReadyProvider: false };
        if (summary.hasReadyProvider) return;
        const addButton = document.querySelector('#provider-list [data-open-provider-editor]');
        if (addButton instanceof HTMLElement) addButton.click();
      },
      actionLabel: 'API-Key hinzufügen',
      waitForCondition: () => {
        const summary = providerController.getProviderAvailabilitySummary
          ? providerController.getProviderAvailabilitySummary()
          : { hasReadyProvider: false };
        return summary.hasReadyProvider;
      },
      waitForHint: 'Sobald ein nutzbarer Key hinterlegt ist, geht es weiter.',
    },
    {
      title: 'Zurück zur Hauptseite',
      text: 'Starte den ersten Lauf über eine Kategoriekarte.',
      anchors: ['#btn-new-task', '#mb-new-task'],
      anchorHint: 'Klicke auf „Neue Aufgabe“, um zurückzugehen.',
      waitForAnchorClick: true,
      anchorsAdvanceSelectors: ['#btn-new-task', '#mb-new-task'],
    },
    {
      title: 'Erste Template-Auswahl',
      text: 'Wähle jetzt ein Handlungsfeld.',
      anchors: ['#category-grid .tw-home-category-card', '#category-grid'],
      anchorHint: 'Klicke auf eine Kategoriekarte.',
      waitForAnchorClick: true,
    },
    {
      title: 'Template auswählen',
      text: 'Wähle nun ein Template in der Unterkategorie-Ansicht.',
      anchors: ['#screen-subcategory #subcategory-list [data-subcategory]', '#screen-subcategory #subcategory-list'],
      anchorHint: 'Klicke auf eine Template-Karte.',
      waitForCondition: () => isScreenVisible('screen-form') && Boolean(state.selectedSubcategory),
      waitForHint: 'Warte auf den Wechsel zur Template-Maske.',
    },
    {
      title: 'Pflichtfelder ausfüllen',
      text: 'Fülle jetzt alle Pflichtfelder des Templates aus.',
      anchor: '#screen-form #form-required-panel',
      anchorHint: 'Sobald alle Pflichtfelder gültig sind, geht es weiter.',
      waitForCondition: () => {
        return isTemplateFormReadyForGeneration();
      },
      waitForHint: 'Pflichtfelder vollständig ausfüllen.',
    },
    {
      title: 'Klärende Rückfragen',
      text: 'Lass „Klärende Rückfragen“ deaktiviert. Für direktes Ergebnis kann diese Option den Lauf sonst unterbrechen oder unvollständig machen.',
      anchor: '#rueckfragen',
      anchorHint: 'Diese Option muss für den Tourlauf aus sein.',
      waitForCondition: () => !Boolean(el('rueckfragen')?.checked),
      waitForHint: 'Deaktiviere „Klärende Rückfragen“, um fortzufahren.',
    },
    {
      title: 'Direktes Ergebnis aktivieren',
      text: 'Schalte jetzt auf „Direktes Ergebnis“ um.',
      anchor: '#run-mode-result-toggle',
      anchorHint: 'Dieser Lauf erzeugt Metaprompt plus direktes Ergebnis.',
      waitForCondition: () => Boolean(el('run-mode-result-toggle')?.checked),
      waitForHint: 'Aktiviere den Toggle „Direktes Ergebnis“.',
    },
    {
      title: 'Generierung starten',
      text: 'Klicke jetzt auf „Direktes Ergebnis generieren“. Das Generieren kann je nach Modell ein wenig dauern.',
      anchors: ['#generate-submit', '#screen-form .tw-form-submit-row'],
      anchorHint: 'Der Lauf startet sofort und wechselt zur Ergebnisansicht.',
      waitForAnchorClick: true,
      anchorsAdvanceSelectors: ['#generate-submit'],
    },
    {
      title: 'Bitte kurz warten',
      text: 'Jetzt werden Metaprompt und (optional) direktes Ergebnis erstellt. Das kann je nach Provider ein paar Sekunden dauern.',
      anchors: ['#screen-result #result-progress-panel', '#screen-result'],
      anchorHint: 'Sobald der Lauf abgeschlossen ist, geht die Tour automatisch weiter.',
      waitForCondition: () => isResultReadyForTour(),
      waitForHint: 'Warte auf den Status „bereit“.',
    },
    {
      title: 'Ergebnis: Metaprompt',
      text: 'Hier steht der Handoff-Prompt (Metaprompt), der den eigentlichen Arbeitsprompt strukturiert.',
      anchor: '#screen-result .result-prompt-panel',
      anchorHint: 'Das obere Feld ist immer der Metaprompt/Handoff.',
    },
    {
      title: 'Ergebnis: Direktes Ergebnis',
      text: 'Da „Direktes Ergebnis“ aktiv ist, siehst du zusätzlich unten das direkte Resultat. Es basiert auf dem Metaprompt/Handoff.',
      anchor: '#screen-result #result-direct-panel',
      anchorHint: 'Im Prompt-only Modus wäre dieses Feld nicht sichtbar.',
    },
    {
      title: 'Bibliothek: Titel',
      text: 'Vergib einen klaren Titel, damit du den Eintrag später schnell wiederfindest.',
      anchor: '#library-title',
      anchorHint: 'Titel kurz und präzise wählen.',
    },
    {
      title: 'Bibliothek: Bewertung & Sichtbarkeit',
      text: 'Du kannst den Eintrag bewerten und optional öffentlich speichern. Öffentlich bedeutet: andere Nutzer können den Eintrag sehen.',
      anchors: ['#library-rating', '#library-public'],
      anchorHint: 'Bewertung und Sichtbarkeit sind optional.',
    },
    {
      title: 'In Bibliothek speichern',
      text: 'Speichere den Lauf in deiner Bibliothek, damit du ihn später mit „Reuse“ wiederverwenden kannst.',
      anchor: '#save-library',
      anchorHint: 'Klicke auf „In Bibliothek speichern“.',
      waitForAnchorClick: true,
      anchorsAdvanceSelectors: ['#save-library'],
    },
    {
      title: 'Speichern bestätigen',
      text: 'Wir warten kurz auf die Speicherbestätigung.',
      anchors: ['#save-library-status', '#screen-result'],
      anchorHint: 'Sobald „Gespeichert.“ erscheint, geht es weiter.',
      waitForCondition: () => String(el('save-library-status')?.textContent || '').toLowerCase().includes('gespeichert'),
      waitForHint: 'Warte auf den Status „Gespeichert.“.',
    },
    {
      title: 'Bibliothek',
      text: 'Speichere gute Ergebnisse in der Bibliothek und nutze „Reuse“, um Felder später vorauszufüllen.',
      anchor: '#btn-library',
      anchorHint: 'Zum Abschluss öffnen wir die Bibliothek.',
      actionLabel: 'Bibliothek öffnen',
      action: async () => {
        uiShell.showScreen('library');
        await libraryController.refreshLibrary();
      },
    },
  ];
}

function renderIntroductionStep(index) {
  const steps = getIntroductionSteps();
  const total = steps.length;
  if (!total) return;
  const boundedIndex = Math.max(0, Math.min(index, total - 1));
  const step = steps[boundedIndex];
  const previousIndex = introTourState.index;
  if (previousIndex !== boundedIndex) {
    introTourState.autoActionStep = -1;
  }
  introTourState.index = boundedIndex;

  el('intro-tour-progress').textContent = `Schritt ${boundedIndex + 1} von ${total}`;
  el('intro-tour-title').textContent = step.title;
  el('intro-tour-text').textContent = typeof step.text === 'function' ? step.text() : (step.text || '');
  el('intro-tour-anchor').textContent = typeof step.anchorHint === 'function' ? step.anchorHint() : (step.anchorHint || '');

  const prev = el('intro-tour-prev');
  const next = el('intro-tour-next');
  const finish = el('intro-tour-finish');
  const action = el('intro-tour-open');
  prev.disabled = boundedIndex === 0;
  next.classList.toggle('is-hidden', boundedIndex >= total - 1);
  finish.classList.toggle('is-hidden', boundedIndex < total - 1);
  action.classList.toggle('is-hidden', !step.action);
  action.textContent = step.actionLabel || 'Bereich öffnen';

  clearIntroductionHighlight();
  const anchor = resolveIntroductionAnchor(step);
  if (anchor?.node) {
    anchor.node.classList.add('tour-highlight');
    if (step.highlightClass) {
      anchor.node.classList.add(step.highlightClass);
      introTourState.highlightedClass = step.highlightClass;
    } else {
      introTourState.highlightedClass = '';
    }
    introTourState.highlightedSelector = anchor.selector;
    introTourState.highlightedNode = anchor.node;
    applyIntroductionSpotlight(anchor.node);
    anchor.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    const modal = el('intro-tour-modal');
    if (modal) {
      modal.classList.add('tour-no-spotlight');
    }
  }

  if (step.waitForAnchorClick) {
    next.classList.add('is-hidden');
    finish.classList.toggle('is-hidden', true);
    const fallbackSelectors = Array.isArray(step.anchors) && step.anchors.length
      ? step.anchors
      : [step.anchor].filter(Boolean);
    const clickableSelectors = Array.isArray(step.anchorsAdvanceSelectors) && step.anchorsAdvanceSelectors.length
      ? step.anchorsAdvanceSelectors
      : fallbackSelectors;
    const onAnchorClick = (event) => {
      if (!introTourState.active) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const matched = clickableSelectors.some((selector) => target.closest(selector));
      if (!matched) return;
      window.setTimeout(() => {
        renderIntroductionStep(introTourState.index + 1);
      }, 180);
    };
    document.addEventListener('click', onAnchorClick, true);
    introTourState.anchorClickCleanup = () => {
      document.removeEventListener('click', onAnchorClick, true);
    };
    const baseHint = typeof step.anchorHint === 'function' ? step.anchorHint() : (step.anchorHint || '');
    el('intro-tour-anchor').textContent = `${baseHint}${baseHint ? ' ' : ''}Klicke auf den markierten Bereich, um fortzufahren.`;
  }

  if (typeof step.waitForCondition === 'function') {
    next.classList.add('is-hidden');
    finish.classList.toggle('is-hidden', true);
    const baseHint = typeof step.anchorHint === 'function' ? step.anchorHint() : (step.anchorHint || '');
    const conditionHint = String(step.waitForHint || 'Warte auf die nächste Aktion, um fortzufahren.').trim();
    el('intro-tour-anchor').textContent = `${baseHint}${baseHint ? ' ' : ''}${conditionHint}`.trim();

    let handled = false;
    const evaluate = () => {
      if (handled || !introTourState.active) return;
      let fulfilled = false;
      try {
        fulfilled = !!step.waitForCondition();
      } catch (_error) {
        fulfilled = false;
      }
      if (!fulfilled) return;
      handled = true;
      if (typeof introTourState.waitConditionCleanup === 'function') {
        introTourState.waitConditionCleanup();
      }
      introTourState.waitConditionCleanup = null;
      window.setTimeout(() => {
        renderIntroductionStep(introTourState.index + 1);
      }, 220);
    };
    const timer = window.setInterval(evaluate, 300);
    introTourState.waitConditionCleanup = () => {
      window.clearInterval(timer);
    };
    evaluate();
  }

  if (step.autoAction && step.action && introTourState.autoActionStep !== boundedIndex) {
    introTourState.autoActionStep = boundedIndex;
    window.setTimeout(() => {
      runIntroductionStepAction({ rerender: true }).catch((error) => {
        notifyError(error, 'Tour-Aktion fehlgeschlagen');
      });
    }, 120);
  }
}

function showIntroductionTour() {
  hideSetupWizard();
  introTourContext.providerCheckSummary = '';
  introTourState.autoActionStep = -1;
  introTourState.active = true;
  el('intro-tour-modal').classList.remove('is-hidden');
  el('intro-tour-modal').classList.add('tour-no-spotlight');
  renderIntroductionStep(0);
}

async function finishIntroductionTour({ markSeen = true, skipSession = false } = {}) {
  clearIntroductionHighlight();
  introTourState.autoActionStep = -1;
  introTourState.active = false;
  el('intro-tour-modal').classList.add('is-hidden');
  if (skipSession) {
    sessionStorage.setItem('eduprompt_intro_skip_session', '1');
  } else {
    sessionStorage.removeItem('eduprompt_intro_skip_session');
  }

  if (markSeen) {
    await queueSettingsSave(
      { hasSeenIntroduction: true, introTourVersion: INTRO_TOUR_VERSION },
      { refreshCatalog: false, showStatus: false }
    );
  }

  if (shouldShowSetupWizard()) {
    showSetupWizard();
  }
}

async function runIntroductionStepAction({ rerender = true } = {}) {
  const steps = getIntroductionSteps();
  const step = steps[introTourState.index];
  if (!step?.action) return;
  const actionButton = el('intro-tour-open');
  const previousLabel = actionButton?.textContent || '';
  if (actionButton && !actionButton.classList.contains('is-hidden')) {
    actionButton.disabled = true;
    actionButton.textContent = 'Bitte warten …';
  }
  try {
    await step.action();
    if (rerender) {
      renderIntroductionStep(introTourState.index);
    }
  } finally {
    if (actionButton && !actionButton.classList.contains('is-hidden')) {
      actionButton.disabled = false;
      actionButton.textContent = previousLabel || step.actionLabel || 'Bereich öffnen';
    }
  }
}

async function runStartupOnboarding() {
  if (shouldShowIntroductionTour()) {
    showIntroductionTour();
    return;
  }
  if (shouldShowSetupWizard()) {
    showSetupWizard();
  }
}

async function loadServerData() {
  const me = await api('/api/me');
  state.currentUser = me.userId;
  state.logoutUrl = resolveLogoutTarget(me.logoutUrl || '');
  state.welcomeFlowEnabled = me.welcomeFlowEnabled !== false;
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
  if (el('provider-check-stages')) {
    el('provider-check-stages').addEventListener('click', async () => {
      try {
        await providerController.checkStageConnectivity({ autoSwitchOnSingleSuccess: false });
        notify('Stage-Status wurde aktualisiert.', { type: 'ok' });
      } catch (error) {
        notifyError(error, 'Stage-Status konnte nicht geprüft werden');
      }
    });
  }
  el('btn-options').addEventListener('click', () => dashboardController.openDashboard('options').catch((error) => notifyError(error)));
  if (el('btn-logout')) {
    el('btn-logout').addEventListener('click', () => {
      const target = resolveLogoutTarget(state.logoutUrl || '') || '/api/logout';
      window.location.assign(target);
    });
  }
  if (el('btn-start-tour')) {
    el('btn-start-tour').addEventListener('click', () => {
      sessionStorage.removeItem('eduprompt_intro_skip_session');
      uiShell.showScreen('home');
      showIntroductionTour();
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
    await runStartupOnboarding();
  });
  el('choose-flow-single').addEventListener('click', async () => {
    await settingsController.saveSettings({ flowMode: 'single' }, false);
    taskController.syncFlowModeUi();
    el('flow-choice-modal').classList.add('is-hidden');
    await runStartupOnboarding();
  });

  el('intro-tour-prev').addEventListener('click', () => {
    if (!introTourState.active) return;
    renderIntroductionStep(introTourState.index - 1);
  });
  el('intro-tour-next').addEventListener('click', () => {
    if (!introTourState.active) return;
    renderIntroductionStep(introTourState.index + 1);
  });
  el('intro-tour-open').addEventListener('click', () => {
    runIntroductionStepAction().catch((error) => notifyError(error, 'Tour-Aktion fehlgeschlagen'));
  });
  el('intro-tour-finish').addEventListener('click', () => {
    finishIntroductionTour({ markSeen: true }).catch((error) => notifyError(error));
  });
  el('intro-tour-skip').addEventListener('click', () => {
    finishIntroductionTour({ markSeen: true, skipSession: true }).catch((error) => notifyError(error));
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
    } else {
      await runStartupOnboarding();
    }
  } catch (error) {
    notifyError(error, 'Fehler beim Laden der Anwendungsdaten');
  }
}

init();
