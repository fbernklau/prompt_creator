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
  setVaultStatus,
  persistProviderStageSettings,
}) {
  state.providerModelCatalog = state.providerModelCatalog || {};
  state.providerPricingCatalog = state.providerPricingCatalog || [];
  state.assignedSystemKeys = state.assignedSystemKeys || [];
  state.settings = state.settings || {};

  function getProviderStage() {
    return state.dashboard?.providerStage === 'result' ? 'result' : 'metaprompt';
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
    const matchingKeys = getMatchingSystemKeysForKind(kind);

    select.innerHTML = matchingKeys.length
      ? matchingKeys.map((entry) => `<option value="${entry.systemKeyId}">${entry.name} (${entry.systemKeyId})</option>`).join('')
      : '<option value="">Keine zugewiesenen System-Keys</option>';

    if (preferredSystemKeyId && matchingKeys.some((entry) => entry.systemKeyId === preferredSystemKeyId)) {
      select.value = preferredSystemKeyId;
    }

    const isSystemSource = keySource === 'system';
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
      state.assignedSystemKeys = Array.isArray(payload) ? payload : [];
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
    el('provider-auto-base').checked = true;
    Promise.all([
      refreshModelCatalog().catch(() => {}),
      refreshAssignedSystemKeys().catch(() => {}),
    ]).finally(() => {
      syncProviderModelUi();
      syncSystemKeyUi();
    });
    syncProviderBaseUi();
    syncSystemKeyUi();
    syncPricingUi();
    document.addEventListener('dashboard:provider-stage-change', () => {
      renderProviders();
    });
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
    const stage = getProviderStage();
    const stageLabel = stage === 'result' ? 'Result-Model' : 'Metaprompt-Model';
    const activeLabel = el('provider-active-label');
    if (activeLabel) activeLabel.textContent = `Aktiver Provider (${stageLabel})`;

    const assignedForStage = getAssignedProviderId(stage);
    const fallbackId = state.activeId || state.providers[0]?.id || '';
    const selectedId = assignedForStage && state.providers.some((provider) => provider.id === assignedForStage)
      ? assignedForStage
      : fallbackId;
    if (selectedId) {
      setAssignedProviderId(stage, selectedId);
      state.activeId = selectedId;
    }

    const activeSelect = el('active-provider');
    activeSelect.innerHTML = state.providers.length
      ? state.providers
          .map((provider) => `<option value="${provider.id}" ${provider.id === selectedId ? 'selected' : ''}>${provider.name} (${provider.model})</option>`)
          .join('')
      : '<option value="">Bitte Provider anlegen...</option>';

    const list = el('provider-list');
    list.innerHTML = state.providers
      .map(
        (provider) => `
        <li>
          <span><strong>${provider.name}</strong> | ${provider.kind} | ${provider.model} | ${redactKeyState(provider)}</span>
          <span class="inline-actions">
            <button type="button" class="secondary small" data-edit-provider="${provider.id}">Bearbeiten</button>
            <button type="button" class="secondary small" data-delete-provider="${provider.id}">Löschen</button>
          </span>
        </li>
      `
      )
      .join('');

    activeSelect.onchange = async () => {
      const nextProviderId = activeSelect.value || '';
      state.activeId = nextProviderId || null;
      setAssignedProviderId(stage, nextProviderId || '');
      renderProviders();
      try {
        await persistStageSettings({
          [getSettingsKeyForStage(stage)]: nextProviderId || '',
        });
        setStageAssignmentStatus(`Zuordnung gespeichert (${stageLabel}).`, 'ok');
      } catch (error) {
        setStageAssignmentStatus(`Speichern fehlgeschlagen (${stageLabel}): ${error.message}`, 'error');
      }
    };

    list.querySelectorAll('[data-edit-provider]').forEach((button) => {
      button.onclick = () => startEditProvider(button.dataset.editProvider);
    });
    list.querySelectorAll('[data-delete-provider]').forEach((button) => {
      button.onclick = () => deleteProvider(button.dataset.deleteProvider);
    });
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
      }
      : {
        providerId: draft.providerId || activeProvider?.id || '',
        kind: draft.kind || activeProvider?.kind || '',
        model: draft.model || activeProvider?.model || '',
        baseUrl: draft.baseUrl || activeProvider?.baseUrl || '',
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
  };
}

export { createProviderController };
