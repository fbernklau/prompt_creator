import { PROVIDER_BASE_URLS } from './config.js';

const CUSTOM_MODEL_VALUE = '__custom__';
const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  mistral: 'Mistral',
  google: 'Google',
  custom: 'Custom API',
};

function createProviderController({
  state,
  el,
  api,
  uid,
  notify = null,
  setVaultStatus,
  persistProviderStageSettings,
}) {
  state.providerModelCatalog = state.providerModelCatalog || {};
  state.providerPricingCatalog = state.providerPricingCatalog || [];
  state.assignedSystemKeys = state.assignedSystemKeys || [];
  state.systemKeysEnabled = state.systemKeysEnabled !== false;
  state.settings = state.settings || {};
  state.providerEditorMode = state.providerEditorMode || 'modal';

  function emitNotice(message = '', type = 'info') {
    const text = String(message || '').trim();
    if (!text || typeof notify !== 'function') return;
    notify(text, { type });
  }

  function getSettingsKeyForStage(stage) {
    return stage === 'result' ? 'resultProviderId' : 'metapromptProviderId';
  }

  function getAssignedProviderId(stage) {
    const key = getSettingsKeyForStage(stage);
    const raw = state.settings?.[key];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  function setAssignedProviderId(stage, providerId) {
    const key = getSettingsKeyForStage(stage);
    state.settings[key] = String(providerId || '').trim();
  }

  function setStageAssignmentStatus(text = '', type = 'info') {
    const node = el('provider-active-stage-status');
    if (!node) return;
    node.textContent = text;
    node.dataset.type = type;
    if (!text) return;
    setTimeout(() => {
      if (node.textContent === text) node.textContent = '';
    }, 1800);
  }

  async function persistStageSettings(partial = {}) {
    if (!partial || typeof partial !== 'object' || !Object.keys(partial).length) return;
    if (typeof persistProviderStageSettings !== 'function') return;
    await persistProviderStageSettings(partial);
  }

  function getProviderById(providerId = '') {
    const normalized = String(providerId || '').trim();
    if (!normalized) return null;
    return (Array.isArray(state.providers) ? state.providers : []).find((entry) => entry.id === normalized) || null;
  }

  function formatProviderSummaryLabel(provider, { emptyLabel = 'nicht gesetzt' } = {}) {
    if (!provider) return emptyLabel;
    return `${provider.name} (${provider.kind}, ${provider.model})`;
  }

  function setProviderStageHealth(text = '', type = 'info') {
    const node = el('provider-stage-health');
    if (!node) return;
    node.textContent = text;
    node.dataset.type = type;
  }

  function getProviderEditorMode() {
    const node = el('provider-editor-mode');
    const selected = String(node?.value || state.providerEditorMode || 'modal').trim().toLowerCase();
    return selected === 'inline' ? 'inline' : 'modal';
  }

  function updateProviderEditorTitle() {
    const titleNode = el('provider-editor-title');
    if (!titleNode) return;
    titleNode.textContent = state.editProviderId ? 'API-Key bearbeiten' : 'API-Key hinzufügen';
  }

  function mountProviderEditor({ forceMode = '' } = {}) {
    const form = el('provider-form');
    const inlineHost = el('provider-form-inline-host');
    const modalHost = el('provider-form-modal-host');
    const modeSelect = el('provider-editor-mode');
    const mode = forceMode || getProviderEditorMode();
    if (!form || !inlineHost || !modalHost) return mode;

    if (modeSelect && modeSelect.value !== mode) modeSelect.value = mode;
    state.providerEditorMode = mode;

    if (mode === 'inline') {
      if (form.parentElement !== inlineHost) inlineHost.appendChild(form);
      inlineHost.classList.remove('is-hidden');
      form.classList.remove('is-hidden');
      const modal = el('provider-form-modal');
      if (modal) modal.classList.add('is-hidden');
      return mode;
    }

    if (form.parentElement !== modalHost) modalHost.appendChild(form);
    inlineHost.classList.add('is-hidden');
    form.classList.remove('is-hidden');
    return mode;
  }

  function openProviderEditor({ forceMode = '' } = {}) {
    updateProviderEditorTitle();
    const mode = mountProviderEditor({ forceMode });
    if (mode === 'inline') return;
    const modal = el('provider-form-modal');
    if (modal) modal.classList.remove('is-hidden');
  }

  function closeProviderEditor({ keepInlineVisible = true } = {}) {
    const modal = el('provider-form-modal');
    if (modal) modal.classList.add('is-hidden');
    const mode = getProviderEditorMode();
    if (mode !== 'inline') return;
    const inlineHost = el('provider-form-inline-host');
    if (!inlineHost) return;
    inlineHost.classList.toggle('is-hidden', !keepInlineVisible);
  }

  function renderStageSummary() {
    const metaProvider = getProviderById(getAssignedProviderId('metaprompt'));
    const resultProvider = getProviderById(getAssignedProviderId('result'));

    const metaChip = el('provider-stage-chip-metaprompt');
    const resultChip = el('provider-stage-chip-result');
    if (metaChip) {
      metaChip.classList.toggle('is-active', !!metaProvider);
      const strong = metaChip.querySelector('strong');
      if (strong) strong.textContent = formatProviderSummaryLabel(metaProvider, { emptyLabel: 'nicht gesetzt' });
    }
    if (resultChip) {
      resultChip.classList.toggle('is-active', !!resultProvider);
      const strong = resultChip.querySelector('strong');
      if (strong) strong.textContent = formatProviderSummaryLabel(resultProvider, { emptyLabel: 'nicht gesetzt' });
    }
  }

  function getProviderAvailabilitySummary() {
    const providers = Array.isArray(state.providers) ? state.providers : [];
    const assigned = Array.isArray(state.assignedSystemKeys) ? state.assignedSystemKeys : [];
    const personal = providers.filter((entry) => !entry.systemKeyId);
    const readyProviders = providers.filter((entry) => Boolean(entry.hasServerKey || entry.systemKeyId || entry.canUseSharedTestKey));
    return {
      totalProviders: providers.length,
      personalProviders: personal.length,
      assignedSystemKeys: assigned.length,
      readyProviderCount: readyProviders.length,
      hasReadyProvider: readyProviders.length > 0,
      hasAnySystemKeyAccess: state.systemKeysEnabled !== false && assigned.length > 0,
    };
  }

  async function selectProviderForStage(stage, providerId, { silent = false } = {}) {
    const normalizedStage = stage === 'result' ? 'result' : 'metaprompt';
    const normalizedProviderId = String(providerId || '').trim();
    if (!normalizedProviderId) throw new Error('Provider-ID fehlt.');
    const provider = getProviderById(normalizedProviderId);
    if (!provider) throw new Error('Provider nicht gefunden.');
    const current = getAssignedProviderId(normalizedStage);
    if (current === normalizedProviderId) return { ok: true, changed: false };

    setAssignedProviderId(normalizedStage, normalizedProviderId);
    state.activeId = getAssignedProviderId('metaprompt') || normalizedProviderId;
    await persistStageSettings({
      [getSettingsKeyForStage(normalizedStage)]: normalizedProviderId,
    });
    renderProviders();
    if (!silent) {
      setStageAssignmentStatus(`Aktiver ${normalizedStage === 'result' ? 'Result' : 'Metaprompt'}-Key gespeichert.`, 'ok');
    }
    return { ok: true, changed: true };
  }

  async function checkStageConnectivity({ autoSwitchOnSingleSuccess = false } = {}) {
    setProviderStageHealth('Verbindung wird geprüft …', 'info');
    await syncStageAssignmentsWithProviderList({ persist: false });
    const stages = ['metaprompt', 'result'];
    const results = [];
    const testedProviders = new Map();

    for (const stage of stages) {
      const providerId = getAssignedProviderId(stage);
      const provider = getProviderById(providerId);
      if (!provider) {
        results.push({
          stage,
          ok: false,
          providerId: '',
          providerLabel: 'nicht gesetzt',
          error: 'Kein aktiver Key zugeordnet.',
        });
        continue;
      }

      if (testedProviders.has(provider.id)) {
        const cached = testedProviders.get(provider.id);
        results.push({
          stage,
          ...cached,
        });
        continue;
      }

      try {
        const payload = {
          providerId: provider.id,
          kind: provider.kind,
          model: provider.model,
          baseUrl: provider.baseUrl || getRecommendedBaseUrl(provider.kind),
          keySource: provider.systemKeyId ? 'system' : 'provider',
          systemKeyId: provider.systemKeyId || '',
        };
        const testResult = await api('/api/providers/test', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        results.push({
          stage,
          ok: true,
          providerId: provider.id,
          providerLabel: formatProviderSummaryLabel(provider),
          latencyMs: Number(testResult?.latencyMs || 0),
          keySource: testResult?.keySource || '',
        });
        testedProviders.set(provider.id, {
          ok: true,
          providerId: provider.id,
          providerLabel: formatProviderSummaryLabel(provider),
          latencyMs: Number(testResult?.latencyMs || 0),
          keySource: testResult?.keySource || '',
        });
      } catch (error) {
        results.push({
          stage,
          ok: false,
          providerId: provider.id,
          providerLabel: formatProviderSummaryLabel(provider),
          error: String(error?.message || error || 'Verbindungstest fehlgeschlagen'),
        });
        testedProviders.set(provider.id, {
          ok: false,
          providerId: provider.id,
          providerLabel: formatProviderSummaryLabel(provider),
          error: String(error?.message || error || 'Verbindungstest fehlgeschlagen'),
        });
      }
    }

    let switched = false;
    if (autoSwitchOnSingleSuccess) {
      const okResult = results.find((entry) => entry.ok && entry.providerId);
      if (okResult) {
        const failed = results.filter((entry) => !entry.ok && entry.providerId && entry.providerId !== okResult.providerId);
        for (const failedEntry of failed) {
          await selectProviderForStage(failedEntry.stage, okResult.providerId, { silent: true });
          switched = true;
        }
      }
    }

    const metaResult = results.find((entry) => entry.stage === 'metaprompt');
    const resultResult = results.find((entry) => entry.stage === 'result');
    if (metaResult?.ok && resultResult?.ok) {
      setProviderStageHealth('Verbindung geprüft: Metaprompt und Result sind bereit.', 'ok');
    } else if (metaResult?.ok || resultResult?.ok) {
      const workingStage = metaResult?.ok ? 'Metaprompt' : 'Result';
      const failingStage = metaResult?.ok ? 'Result' : 'Metaprompt';
      const switchHint = switched ? ' Nicht funktionierende Stage wurde auf den funktionierenden Key umgestellt.' : '';
      setProviderStageHealth(`Teilweise bereit: ${workingStage} funktioniert, ${failingStage} aktuell nicht.${switchHint}`, 'warn');
    } else {
      setProviderStageHealth('Verbindung fehlgeschlagen: Bitte Key/Modell prüfen.', 'error');
    }

    return { results, switched };
  }

  async function syncStageAssignmentsWithProviderList({ persist = false } = {}) {
    const firstProviderId = state.providers[0]?.id || '';
    const updates = {};

    ['metaprompt', 'result'].forEach((stage) => {
      const key = getSettingsKeyForStage(stage);
      const assigned = getAssignedProviderId(stage);
      const valid = assigned && state.providers.some((provider) => provider.id === assigned);
      const next = valid ? assigned : firstProviderId;
      if ((assigned || '') !== (next || '')) {
        updates[key] = next || '';
        setAssignedProviderId(stage, next || '');
      }
    });

    const nextActive = getAssignedProviderId('metaprompt') || firstProviderId || null;
    state.activeId = nextActive;

    if (persist && Object.keys(updates).length) {
      try {
        await persistStageSettings(updates);
      } catch (error) {
        setStageAssignmentStatus(`Zuordnung konnte nicht gespeichert werden: ${error.message}`, 'error');
      }
    }
  }

  function redactKeyState(provider) {
    if (provider.systemKeyId) {
      const assigned = (state.assignedSystemKeys || []).find((entry) => entry.systemKeyId === provider.systemKeyId);
      return `system: ${assigned?.name || provider.systemKeyId}`;
    }
    if (provider.hasServerKey) return 'server-verschlüsselt';
    if (provider.canUseSharedTestKey) return 'shared test key';
    return 'kein Key';
  }

  function isKnownProvider(kind) {
    return Object.prototype.hasOwnProperty.call(PROVIDER_BASE_URLS, kind);
  }

  function getRecommendedBaseUrl(kind) {
    return PROVIDER_BASE_URLS[kind] || '';
  }

  function getProviderLabel(kind) {
    return PROVIDER_LABELS[kind] || 'Provider';
  }

  function getCatalogModels(kind) {
    const fromApi = state.providerModelCatalog?.[kind];
    return Array.isArray(fromApi) ? fromApi : [];
  }

  function parseNonNegativeNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) return null;
    return normalized;
  }

  function findCatalogPricing(kind, model) {
    if (!Array.isArray(state.providerPricingCatalog)) return null;
    return state.providerPricingCatalog.find((entry) => entry.providerKind === kind && entry.model === model) || null;
  }

  function getSelectedPricingMode() {
    return el('provider-pricing-mode').value === 'custom' ? 'custom' : 'catalog';
  }

  function syncPricingUi() {
    const pricingMode = getSelectedPricingMode();
    const inputWrap = el('provider-pricing-input-wrap');
    const outputWrap = el('provider-pricing-output-wrap');
    const input = el('provider-pricing-input');
    const output = el('provider-pricing-output');
    const hint = el('provider-pricing-hint');
    const kind = el('provider-kind').value;
    const model = getSelectedModel();

    const showCustom = pricingMode === 'custom';
    inputWrap.classList.toggle('is-hidden', !showCustom);
    outputWrap.classList.toggle('is-hidden', !showCustom);
    input.required = showCustom;
    output.required = showCustom;

    if (showCustom) {
      hint.textContent = 'Custom aktiv: Kostenberechnung nutzt deine Input/Output-Preise.';
      return;
    }

    const catalogEntry = findCatalogPricing(kind, model);
    if (catalogEntry) {
      if (catalogEntry.hasPricing) {
        hint.textContent = `Katalog aktiv: ${catalogEntry.inputPricePerMillion} / ${catalogEntry.outputPricePerMillion} ${catalogEntry.currency} pro 1M Tokens.`;
      } else {
        hint.textContent = 'Katalog aktiv: Modell vorhanden, aber noch ohne gepflegte Preiswerte.';
      }
    } else {
      hint.textContent = 'Katalog aktiv: Fuer dieses Modell ist aktuell kein Preis hinterlegt.';
    }
  }

  async function refreshModelCatalog() {
    try {
      const payload = await api('/api/providers/model-catalog');
      if (payload && typeof payload === 'object') {
        state.providerModelCatalog = payload.catalog || {};
        state.providerPricingCatalog = Array.isArray(payload.pricing) ? payload.pricing : [];
      }
    } catch (_error) {
      state.providerModelCatalog = {};
      state.providerPricingCatalog = [];
    }
  }

  async function refreshModelCatalogAndSync() {
    const preferredModel = getSelectedModel();
    await refreshModelCatalog();
    syncProviderModelUi({ preferredModel });
    syncPricingUi();
  }

  function syncModelCustomUi() {
    const customWrap = el('provider-model-custom-wrap');
    const customInput = el('provider-model-custom');
    const isCustom = el('provider-model').value === CUSTOM_MODEL_VALUE;
    customWrap.classList.toggle('is-hidden', !isCustom);
    customInput.required = isCustom;
    if (!isCustom) customInput.value = '';
    syncPricingUi();
  }

  function syncProviderModelUi({ preferredModel = '' } = {}) {
    const kind = el('provider-kind').value;
    const modelSelect = el('provider-model');
    const hint = el('provider-model-hint');
    const customInput = el('provider-model-custom');
    const catalogModels = getCatalogModels(kind);
    const normalizedPreferredModel = String(preferredModel || '').trim();

    const optionHtml = catalogModels
      .map((model) => `<option value="${model}">${model}</option>`)
      .join('');
    modelSelect.innerHTML = `${optionHtml}<option value="${CUSTOM_MODEL_VALUE}">Custom (selbst eingeben)</option>`;

    if (normalizedPreferredModel && catalogModels.includes(normalizedPreferredModel)) {
      modelSelect.value = normalizedPreferredModel;
      customInput.value = '';
    } else if (normalizedPreferredModel) {
      modelSelect.value = CUSTOM_MODEL_VALUE;
      customInput.value = normalizedPreferredModel;
    } else if (catalogModels.length > 0) {
      modelSelect.value = catalogModels[0];
      customInput.value = '';
    } else {
      modelSelect.value = CUSTOM_MODEL_VALUE;
      customInput.value = '';
    }

    if (catalogModels.length > 0) {
      hint.textContent = `${getProviderLabel(kind)}: Empfohlene Modelle geladen. Für eigene IDs "Custom" wählen.`;
    } else {
      hint.textContent = `${getProviderLabel(kind)}: Modell frei definierbar.`;
    }
    syncModelCustomUi();
    syncPricingUi();
  }

  function getSelectedKeySource() {
    return el('provider-key-source').value === 'system' ? 'system' : 'provider';
  }

  function getMatchingSystemKeysForKind(kind) {
    const normalizedKind = String(kind || '').trim().toLowerCase();
    return (Array.isArray(state.assignedSystemKeys) ? state.assignedSystemKeys : [])
      .filter((entry) => String(entry.providerKind || '').trim().toLowerCase() === normalizedKind);
  }

  function syncSystemKeyUi({ preferredSystemKeyId = '' } = {}) {
    const keySource = getSelectedKeySource();
    const kind = el('provider-kind').value;
    const wrap = el('provider-system-key-wrap');
    const select = el('provider-system-key-id');
    const keyInput = el('provider-key');
    const keySourceSelect = el('provider-key-source');
    const matchingKeys = getMatchingSystemKeysForKind(kind);
    const systemOption = keySourceSelect?.querySelector('option[value="system"]');
    if (systemOption) {
      systemOption.disabled = !state.systemKeysEnabled;
      systemOption.textContent = state.systemKeysEnabled
        ? 'Zugewiesener System-Key'
        : 'Zugewiesener System-Key (global deaktiviert)';
    }
    if (!state.systemKeysEnabled && keySource === 'system') {
      keySourceSelect.value = 'provider';
    }

    select.innerHTML = matchingKeys.length
      ? matchingKeys.map((entry) => `<option value="${entry.systemKeyId}">${entry.name} (${entry.systemKeyId})</option>`).join('')
      : '<option value="">Keine zugewiesenen System-Keys</option>';

    if (preferredSystemKeyId && matchingKeys.some((entry) => entry.systemKeyId === preferredSystemKeyId)) {
      select.value = preferredSystemKeyId;
    }

    const isSystemSource = keySourceSelect.value === 'system';
    wrap.classList.toggle('is-hidden', !isSystemSource);
    select.required = isSystemSource;
    keyInput.disabled = isSystemSource;

    if (isSystemSource) {
      keyInput.value = '';
      keyInput.placeholder = 'Bei System-Key nicht erforderlich';
    } else {
      keyInput.disabled = false;
      keyInput.placeholder = 'API-Key (wird serverseitig verschlüsselt)';
    }
  }

  async function refreshAssignedSystemKeys({ preferredSystemKeyId = '' } = {}) {
    try {
      const payload = await api('/api/providers/assigned-system-keys');
      state.systemKeysEnabled = payload?.enabled !== false;
      state.assignedSystemKeys = Array.isArray(payload?.keys) ? payload.keys : [];
    } catch (_error) {
      state.assignedSystemKeys = [];
    }
    syncSystemKeyUi({ preferredSystemKeyId });
  }

  function getSelectedModel() {
    const modelValue = el('provider-model').value;
    if (modelValue === CUSTOM_MODEL_VALUE) return el('provider-model-custom').value.trim();
    return modelValue.trim();
  }

  function syncProviderBaseUi() {
    const kind = el('provider-kind').value;
    const baseInput = el('provider-base');
    const autoCheckbox = el('provider-auto-base');
    const hint = el('provider-base-hint');
    const recommendedBaseUrl = getRecommendedBaseUrl(kind);
    const knownProvider = Boolean(recommendedBaseUrl);

    if (!knownProvider) {
      autoCheckbox.checked = false;
      autoCheckbox.disabled = true;
      baseInput.readOnly = false;
      baseInput.classList.remove('is-locked-field');
      if (Object.values(PROVIDER_BASE_URLS).includes(baseInput.value.trim())) baseInput.value = '';
      baseInput.placeholder = 'https://api.example.com/v1';
      hint.textContent = 'Custom API: Base URL frei editierbar.';
      return;
    }

    autoCheckbox.disabled = false;
    baseInput.placeholder = recommendedBaseUrl;
    if (autoCheckbox.checked) {
      baseInput.value = recommendedBaseUrl;
      baseInput.readOnly = true;
      baseInput.classList.add('is-locked-field');
      hint.textContent = `Empfohlene URL aktiv: ${recommendedBaseUrl}`;
      return;
    }

    baseInput.readOnly = false;
    baseInput.classList.remove('is-locked-field');
    hint.textContent = 'Empfohlene URL deaktiviert: eigene Base URL verwenden.';
  }

  function initializeProviderForm() {
    setVaultStatus('Server-Key-Schutz aktiv: API-Keys werden nur serverseitig verschlüsselt gespeichert.', 'ok');
    el('provider-kind').addEventListener('change', () => {
      syncProviderModelUi();
      syncProviderBaseUi();
      syncSystemKeyUi();
      syncPricingUi();
    });
    el('provider-model').addEventListener('change', syncModelCustomUi);
    el('provider-key-source').addEventListener('change', () => syncSystemKeyUi());
    el('provider-auto-base').addEventListener('change', syncProviderBaseUi);
    el('provider-pricing-mode').addEventListener('change', syncPricingUi);
    if (el('provider-editor-mode')) {
      const storedMode = localStorage.getItem('eduprompt_provider_editor_mode');
      const preferredMode = storedMode === 'inline' ? 'inline' : 'modal';
      el('provider-editor-mode').value = preferredMode;
      state.providerEditorMode = preferredMode;
      el('provider-editor-mode').addEventListener('change', () => {
        const nextMode = getProviderEditorMode();
        localStorage.setItem('eduprompt_provider_editor_mode', nextMode);
        state.providerEditorMode = nextMode;
        mountProviderEditor();
      });
    }
    if (el('provider-editor-close')) {
      el('provider-editor-close').addEventListener('click', () => {
        closeProviderEditor({ keepInlineVisible: false });
      });
    }
    if (el('provider-form-modal')) {
      el('provider-form-modal').addEventListener('click', (event) => {
        if (event.target === el('provider-form-modal')) {
          closeProviderEditor({ keepInlineVisible: false });
        }
      });
    }
    el('provider-auto-base').checked = true;
    Promise.all([
      refreshModelCatalog().catch(() => {}),
      refreshAssignedSystemKeys().catch(() => {}),
    ]).finally(() => {
      syncProviderModelUi();
      syncSystemKeyUi();
      mountProviderEditor();
      closeProviderEditor({ keepInlineVisible: getProviderEditorMode() === 'inline' });
    });
    syncProviderBaseUi();
    syncSystemKeyUi();
    syncPricingUi();
    updateProviderEditorTitle();
  }

  function startEditProvider(id) {
    const provider = state.providers.find((entry) => entry.id === id);
    if (!provider) return;
    state.editProviderId = id;
    el('provider-name').value = provider.name;
    el('provider-kind').value = provider.kind;
    syncProviderModelUi({ preferredModel: provider.model });
    el('provider-key').value = '';
    el('provider-key').placeholder = provider.hasServerKey
      ? 'Leer lassen = vorhandenen Key beibehalten'
      : 'API-Key für diesen Provider';
    el('provider-key-source').value = provider.systemKeyId ? 'system' : 'provider';
    el('provider-base').value = provider.baseUrl || '';
    el('provider-pricing-mode').value = provider.pricingMode === 'custom' ? 'custom' : 'catalog';
    el('provider-pricing-input').value = provider.inputPricePerMillion ?? '';
    el('provider-pricing-output').value = provider.outputPricePerMillion ?? '';
    const recommendedBaseUrl = getRecommendedBaseUrl(provider.kind);
    const isPresetMode = provider.baseUrlMode === 'preset'
      || (!provider.baseUrlMode && !!recommendedBaseUrl && provider.baseUrl === recommendedBaseUrl);
    el('provider-auto-base').checked = isPresetMode;
    syncProviderBaseUi();
    syncSystemKeyUi({ preferredSystemKeyId: provider.systemKeyId || '' });
    syncPricingUi();
    openProviderEditor();
  }

  function startDuplicateProvider(id) {
    const provider = state.providers.find((entry) => entry.id === id);
    if (!provider) return;
    state.editProviderId = null;
    el('provider-name').value = `${provider.name} (Kopie)`;
    el('provider-kind').value = provider.kind;
    syncProviderModelUi({ preferredModel: provider.model });
    el('provider-key').value = '';
    el('provider-key-source').value = provider.systemKeyId ? 'system' : 'provider';
    if (provider.systemKeyId) {
      el('provider-key').placeholder = 'Bei System-Key nicht erforderlich';
    } else if (provider.hasServerKey) {
      el('provider-key').placeholder = 'Für Kopie bitte API-Key erneut eingeben';
    } else {
      el('provider-key').placeholder = 'API-Key (wird serverseitig verschlüsselt)';
    }
    el('provider-base').value = provider.baseUrl || '';
    el('provider-pricing-mode').value = provider.pricingMode === 'custom' ? 'custom' : 'catalog';
    el('provider-pricing-input').value = provider.inputPricePerMillion ?? '';
    el('provider-pricing-output').value = provider.outputPricePerMillion ?? '';
    const recommendedBaseUrl = getRecommendedBaseUrl(provider.kind);
    const isPresetMode = provider.baseUrlMode === 'preset'
      || (!provider.baseUrlMode && !!recommendedBaseUrl && provider.baseUrl === recommendedBaseUrl);
    el('provider-auto-base').checked = isPresetMode;
    syncProviderBaseUi();
    syncSystemKeyUi({ preferredSystemKeyId: provider.systemKeyId || '' });
    syncPricingUi();
    emitNotice('Profil als Kopie geladen. Bei persönlichen Keys bitte den API-Key erneut eingeben.', 'info');
    openProviderEditor();
  }

  function clearProviderForm() {
    state.editProviderId = null;
    el('provider-form').reset();
    el('provider-key').placeholder = 'API-Key (wird serverseitig verschlüsselt)';
    el('provider-key-source').value = 'provider';
    el('provider-auto-base').checked = true;
    el('provider-pricing-mode').value = 'catalog';
    el('provider-pricing-input').value = '';
    el('provider-pricing-output').value = '';
    syncProviderModelUi();
    syncSystemKeyUi();
    syncProviderBaseUi();
    syncPricingUi();
    updateProviderEditorTitle();
  }

  function getDraftProviderPayload() {
    const kind = el('provider-kind').value;
    const recommendedBaseUrl = getRecommendedBaseUrl(kind);
    const useRecommendedBaseUrl = isKnownProvider(kind) && el('provider-auto-base').checked;
    const baseUrl = useRecommendedBaseUrl ? recommendedBaseUrl : el('provider-base').value.trim();
    const payload = {
      providerId: state.editProviderId || state.activeId || '',
      name: el('provider-name').value.trim(),
      kind,
      model: getSelectedModel(),
      baseUrl,
      baseUrlMode: useRecommendedBaseUrl ? 'preset' : 'custom',
      pricingMode: getSelectedPricingMode(),
      inputPricePerMillion: parseNonNegativeNumberOrNull(el('provider-pricing-input').value),
      outputPricePerMillion: parseNonNegativeNumberOrNull(el('provider-pricing-output').value),
      keySource: getSelectedKeySource(),
      systemKeyId: getSelectedKeySource() === 'system'
        ? String(el('provider-system-key-id').value || '').trim()
        : '',
    };
    const apiKey = el('provider-key').value.trim();
    if (apiKey) payload.apiKey = apiKey;
    return payload;
  }

  async function deleteProvider(id) {
    await api(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.providers = state.providers.filter((provider) => provider.id !== id);
    await syncStageAssignmentsWithProviderList({ persist: true });
    renderProviders();
  }

  function renderProviders() {
    const allProviders = Array.isArray(state.providers) ? state.providers : [];
    const activeLabel = el('provider-active-label');
    if (activeLabel) activeLabel.textContent = 'Aktive Key-Auswahl je Stage';

    const firstProviderId = allProviders[0]?.id || '';
    const currentMeta = getAssignedProviderId('metaprompt');
    const currentResult = getAssignedProviderId('result');
    const hasMeta = currentMeta && allProviders.some((provider) => provider.id === currentMeta);
    const hasResult = currentResult && allProviders.some((provider) => provider.id === currentResult);
    const nextMeta = hasMeta ? currentMeta : firstProviderId;
    const nextResult = hasResult ? currentResult : (firstProviderId || nextMeta || '');
    const fallbackUpdates = {};
    if ((currentMeta || '') !== (nextMeta || '')) {
      setAssignedProviderId('metaprompt', nextMeta || '');
      fallbackUpdates.metapromptProviderId = nextMeta || '';
    }
    if ((currentResult || '') !== (nextResult || '')) {
      setAssignedProviderId('result', nextResult || '');
      fallbackUpdates.resultProviderId = nextResult || '';
    }
    if (Object.keys(fallbackUpdates).length) {
      persistStageSettings(fallbackUpdates)
        .then(() => {
          setStageAssignmentStatus('Zuweisung wurde auf verfügbaren Key zurückgesetzt.', 'info');
        })
        .catch((error) => {
          setStageAssignmentStatus(`Fallback-Zuweisung konnte nicht gespeichert werden: ${error.message}`, 'error');
        });
    }
    state.activeId = nextMeta || firstProviderId || null;

    const activeSelect = el('active-provider');
    activeSelect.innerHTML = allProviders.length
      ? allProviders.map((provider) => `<option value="${provider.id}" ${provider.id === state.activeId ? 'selected' : ''}>${provider.name} (${provider.model})</option>`).join('')
      : '<option value="">Bitte Provider anlegen...</option>';

    const personalProviders = allProviders.filter((provider) => !provider.systemKeyId);
    const assignedProviders = allProviders.filter((provider) => !!provider.systemKeyId);
    const configuredSystemKeyIds = new Set(assignedProviders.map((provider) => provider.systemKeyId).filter(Boolean));
    const availableAssignedKeys = (Array.isArray(state.assignedSystemKeys) ? state.assignedSystemKeys : [])
      .filter((entry) => !configuredSystemKeyIds.has(entry.systemKeyId));

    const renderProviderRow = (provider) => {
      const metaActive = provider.id === getAssignedProviderId('metaprompt');
      const resultActive = provider.id === getAssignedProviderId('result');
      const isAnyStageActive = metaActive || resultActive;
      return `
        <li class="provider-stage-row ${isAnyStageActive ? 'is-stage-active' : ''}">
          <div class="provider-stage-row-left">
            <span class="admin-state-dot ${provider.systemKeyId ? 'dot-warning' : 'dot-active'}"></span>
            <span class="material-icons-round provider-stage-row-icon">${provider.systemKeyId ? 'hub' : 'vpn_key'}</span>
            <div class="provider-stage-row-meta">
              <strong>${provider.name}</strong>
              <small>${provider.kind} | ${provider.model}</small>
              <small>${redactKeyState(provider)}</small>
              <small class="provider-stage-badges">
                <span class="provider-stage-badge ${metaActive ? 'is-active' : ''}">Metaprompt</span>
                <span class="provider-stage-badge ${resultActive ? 'is-active' : ''}">Result</span>
              </small>
            </div>
          </div>
          <div class="provider-stage-row-right">
            <label class="admin-toggle provider-stage-toggle">
              <input type="checkbox" data-select-stage-provider="metaprompt:${provider.id}" ${metaActive ? 'checked' : ''} />
              <span class="admin-toggle-track"><span class="admin-toggle-thumb"></span></span>
              <span class="admin-toggle-text">Metaprompt</span>
            </label>
            <label class="admin-toggle provider-stage-toggle">
              <input type="checkbox" data-select-stage-provider="result:${provider.id}" ${resultActive ? 'checked' : ''} />
              <span class="admin-toggle-track"><span class="admin-toggle-thumb"></span></span>
              <span class="admin-toggle-text">Result</span>
            </label>
            <button type="button" class="secondary small" data-duplicate-provider="${provider.id}">Duplizieren</button>
            <button type="button" class="secondary small" data-edit-provider="${provider.id}">Bearbeiten</button>
            <button type="button" class="secondary small" data-delete-provider="${provider.id}">Löschen</button>
          </div>
        </li>
      `;
    };

    const list = el('provider-list');
    const assignedHint = state.systemKeysEnabled
      ? ''
      : '<li class="provider-stage-note"><span><small>System-Keys sind global deaktiviert.</small></span></li>';
    list.innerHTML = `
      <li class="provider-stage-shell">
        <div class="provider-stage-group">
          <div class="provider-stage-group-head">
            <h4>Persönliche Keys</h4>
            <small>${personalProviders.length} Einträge</small>
          </div>
          <ul class="provider-stage-rows">
            ${personalProviders.length
    ? personalProviders.map(renderProviderRow).join('')
    : '<li class="provider-stage-note"><span>Keine persönlichen Keys.</span></li>'}
            <li class="provider-stage-row provider-stage-row-addable provider-stage-row-add-btn">
              <button type="button" class="admin-create-dashed" data-open-provider-editor>
                <span class="material-icons-round">add_circle</span>
                API-Key hinzufügen
              </button>
            </li>
          </ul>
        </div>

        <div class="provider-stage-group">
          <div class="provider-stage-group-head">
            <h4>Zugewiesene Keys</h4>
            <small>${assignedProviders.length} hinzugefügt</small>
          </div>
          <ul class="provider-stage-rows">
            ${assignedProviders.length
    ? assignedProviders.map(renderProviderRow).join('')
    : '<li class="provider-stage-note"><span>Keine zugewiesenen System-Keys.</span><small>Lege einen persönlichen Provider an oder kontaktiere Admin.</small></li>'}
            ${availableAssignedKeys.map((entry) => `
              <li class="provider-stage-row provider-stage-row-addable">
                <div class="provider-stage-row-left">
                  <span class="admin-state-dot dot-active"></span>
                  <span class="material-icons-round provider-stage-row-icon">key</span>
                  <div class="provider-stage-row-meta">
                    <strong>${entry.name}</strong>
                    <small>${entry.providerKind} | ${entry.modelHint || 'Modell frei wählen'}</small>
                    <small>noch nicht als Profil hinzugefügt</small>
                  </div>
                </div>
                <div class="provider-stage-row-right">
                  <button type="button" class="secondary small" data-add-assigned-key="${entry.systemKeyId}">Als Profil hinzufügen</button>
                </div>
              </li>
            `).join('')}
            ${assignedHint}
          </ul>
        </div>
      </li>
    `;

    list.querySelectorAll('[data-select-stage-provider]').forEach((input) => {
      input.addEventListener('change', async () => {
        const [stage, providerId] = String(input.dataset.selectStageProvider || '').split(':');
        if (!stage || !providerId) return;
        const currentProviderId = getAssignedProviderId(stage);
        const isActiveForStage = currentProviderId === providerId;
        if (!input.checked && isActiveForStage) {
          input.checked = true;
          setStageAssignmentStatus('Pro Stage muss genau ein aktiver Key ausgewählt sein.', 'info');
          return;
        }
        if (!input.checked) return;
        try {
          await selectProviderForStage(stage, providerId, { silent: true });
          setStageAssignmentStatus(`Aktiver ${stage === 'result' ? 'Result' : 'Metaprompt'}-Key gespeichert.`, 'ok');
          renderProviders();
        } catch (error) {
          setStageAssignmentStatus(`Speichern fehlgeschlagen: ${error.message}`, 'error');
        }
      });
    });

    list.querySelectorAll('[data-edit-provider]').forEach((button) => {
      button.onclick = () => startEditProvider(button.dataset.editProvider);
    });
    list.querySelectorAll('[data-duplicate-provider]').forEach((button) => {
      button.onclick = () => startDuplicateProvider(button.dataset.duplicateProvider);
    });
    list.querySelectorAll('[data-delete-provider]').forEach((button) => {
      button.onclick = () => deleteProvider(button.dataset.deleteProvider);
    });
    list.querySelectorAll('[data-open-provider-editor]').forEach((button) => {
      button.onclick = () => {
        clearProviderForm();
        openProviderEditor();
      };
    });
    list.querySelectorAll('[data-add-assigned-key]').forEach((button) => {
      button.onclick = () => addAssignedKeyAsProvider(button.dataset.addAssignedKey).catch((error) => emitNotice(error.message, 'error'));
    });

    renderStageSummary();
    const healthNode = el('provider-stage-health');
    if (healthNode && !String(healthNode.textContent || '').trim()) {
      setProviderStageHealth('Tipp: Prüfe die aktive Stage-Zuordnung, um Metaprompt und Result sicher zu nutzen.', 'info');
    }
  }

  async function addAssignedKeyAsProvider(systemKeyId) {
    const entry = (state.assignedSystemKeys || []).find((row) => row.systemKeyId === systemKeyId);
    if (!entry) throw new Error('System-Key nicht verfügbar.');
    const catalogModels = getCatalogModels(entry.providerKind);
    const fallbackModel = String(entry.modelHint || '').trim() || catalogModels[0] || `${entry.providerKind}-model`;
    const recommended = getRecommendedBaseUrl(entry.providerKind);
    const payload = {
      id: uid(),
      name: `${entry.name} (${entry.systemKeyId})`,
      kind: entry.providerKind,
      model: fallbackModel,
      baseUrl: entry.baseUrl || recommended || '',
      baseUrlMode: entry.baseUrl ? 'custom' : 'preset',
      pricingMode: 'catalog',
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      systemKeyId: entry.systemKeyId,
    };
    await api(`/api/providers/${encodeURIComponent(payload.id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    state.providers = await api('/api/providers');
    await refreshAssignedSystemKeys();
    await syncStageAssignmentsWithProviderList({ persist: true });
    renderProviders();
    emitNotice('Zugewiesener System-Key wurde als Provider hinzugefügt.', 'ok');
  }

  async function unlockVault() {
    setVaultStatus('Nicht mehr erforderlich: Keys werden serverseitig verschlüsselt.', 'info');
  }

  async function lockVault() {
    setVaultStatus('Nicht mehr erforderlich: Keys bleiben serverseitig geschützt.', 'info');
  }

  async function handleProviderSubmit(event) {
    event.preventDefault();

    const name = el('provider-name').value.trim();
    const kind = el('provider-kind').value;
    const model = getSelectedModel();
    const recommendedBaseUrl = getRecommendedBaseUrl(kind);
    const useRecommendedBaseUrl = isKnownProvider(kind) && el('provider-auto-base').checked;
    const baseUrl = useRecommendedBaseUrl ? recommendedBaseUrl : el('provider-base').value.trim();
    const baseUrlMode = useRecommendedBaseUrl ? 'preset' : 'custom';
    const keyInput = el('provider-key').value.trim();

    if (!model) {
      throw new Error('Bitte ein Modell wählen oder bei Custom ein eigenes Modell eintragen.');
    }

    if (getSelectedKeySource() === 'system' && !state.systemKeysEnabled) {
      throw new Error('System-Keys sind global deaktiviert.');
    }

    const provider = {
      id: state.editProviderId || uid(),
      name,
      kind,
      model,
      baseUrl,
      baseUrlMode,
      pricingMode: getSelectedPricingMode(),
      inputPricePerMillion: parseNonNegativeNumberOrNull(el('provider-pricing-input').value),
      outputPricePerMillion: parseNonNegativeNumberOrNull(el('provider-pricing-output').value),
      keySource: getSelectedKeySource(),
      systemKeyId: getSelectedKeySource() === 'system'
        ? String(el('provider-system-key-id').value || '').trim()
        : '',
    };
    if (keyInput) provider.apiKey = keyInput;

    await api(`/api/providers/${encodeURIComponent(provider.id)}`, {
      method: 'PUT',
      body: JSON.stringify(provider),
    });

    state.providers = await api('/api/providers');
    await refreshModelCatalog();
    await refreshAssignedSystemKeys();
    await syncStageAssignmentsWithProviderList({ persist: true });
    clearProviderForm();
    closeProviderEditor({ keepInlineVisible: getProviderEditorMode() === 'inline' });
    emitNotice('API-Key-Profil gespeichert.', 'ok');
    renderProviders();
  }

  async function testProviderConnection({ preferActive = false } = {}) {
    const draft = getDraftProviderPayload();
    const activeProvider = state.providers.find((provider) => provider.id === state.activeId);
    const payload = preferActive && activeProvider
      ? {
        providerId: activeProvider.id || '',
        kind: activeProvider.kind || '',
        model: activeProvider.model || '',
        baseUrl: activeProvider.baseUrl || '',
        keySource: activeProvider.systemKeyId ? 'system' : 'provider',
        systemKeyId: activeProvider.systemKeyId || '',
      }
      : {
        providerId: draft.providerId || activeProvider?.id || '',
        kind: draft.kind || activeProvider?.kind || '',
        model: draft.model || activeProvider?.model || '',
        baseUrl: draft.baseUrl || activeProvider?.baseUrl || '',
        keySource: draft.keySource || (activeProvider?.systemKeyId ? 'system' : 'provider'),
      };
    if (!preferActive && draft.name && draft.kind && draft.model && draft.baseUrl) {
      payload.kind = draft.kind;
      payload.model = draft.model;
      payload.baseUrl = draft.baseUrl;
    }
    if (draft.systemKeyId) payload.systemKeyId = draft.systemKeyId;
    if (draft.apiKey) payload.apiKey = draft.apiKey;

    setVaultStatus('Teste Provider-Verbindung...', 'info');
    const result = await api('/api/providers/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setVaultStatus(
      `Provider-Test erfolgreich (${result.latencyMs} ms, Key: ${result.keySource}).`,
      'ok'
    );
    return result;
  }

  return {
    initializeProviderForm,
    renderProviders,
    clearProviderForm,
    refreshModelCatalog,
    refreshModelCatalogAndSync,
    deleteProvider,
    unlockVault,
    lockVault,
    handleProviderSubmit,
    testProviderConnection,
    checkStageConnectivity,
    selectProviderForStage,
    getProviderAvailabilitySummary,
  };
}

export { createProviderController };
