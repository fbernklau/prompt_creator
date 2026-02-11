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
}) {
  state.providerModelCatalog = state.providerModelCatalog || {};
  state.providerPricingCatalog = state.providerPricingCatalog || [];

  function redactKeyState(provider) {
    if (provider.hasServerKey) return 'server-verschluesselt';
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
      hint.textContent = `${getProviderLabel(kind)}: Empfohlene Modelle geladen. Fuer eigene IDs "Custom" waehlen.`;
    } else {
      hint.textContent = `${getProviderLabel(kind)}: Modell frei definierbar.`;
    }
    syncModelCustomUi();
    syncPricingUi();
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
      hint.textContent = `Empfohlene URL aktiv: ${recommendedBaseUrl}`;
      return;
    }

    baseInput.readOnly = false;
    hint.textContent = 'Empfohlene URL deaktiviert: eigene Base URL verwenden.';
  }

  function initializeProviderForm() {
    setVaultStatus('Server-Key-Schutz aktiv: API-Keys werden nur serverseitig verschluesselt gespeichert.', 'ok');
    el('provider-kind').addEventListener('change', () => {
      syncProviderModelUi();
      syncProviderBaseUi();
      syncPricingUi();
    });
    el('provider-model').addEventListener('change', syncModelCustomUi);
    el('provider-auto-base').addEventListener('change', syncProviderBaseUi);
    el('provider-pricing-mode').addEventListener('change', syncPricingUi);
    el('provider-auto-base').checked = true;
    refreshModelCatalog()
      .catch(() => {})
      .finally(() => {
        syncProviderModelUi();
      });
    syncProviderBaseUi();
    syncPricingUi();
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
      : 'API-Key fuer diesen Provider';
    el('provider-base').value = provider.baseUrl || '';
    el('provider-pricing-mode').value = provider.pricingMode === 'custom' ? 'custom' : 'catalog';
    el('provider-pricing-input').value = provider.inputPricePerMillion ?? '';
    el('provider-pricing-output').value = provider.outputPricePerMillion ?? '';
    const recommendedBaseUrl = getRecommendedBaseUrl(provider.kind);
    const isPresetMode = provider.baseUrlMode === 'preset'
      || (!provider.baseUrlMode && !!recommendedBaseUrl && provider.baseUrl === recommendedBaseUrl);
    el('provider-auto-base').checked = isPresetMode;
    syncProviderBaseUi();
    syncPricingUi();
  }

  function clearProviderForm() {
    state.editProviderId = null;
    el('provider-form').reset();
    el('provider-key').placeholder = 'API-Key (wird serverseitig verschluesselt)';
    el('provider-auto-base').checked = true;
    el('provider-pricing-mode').value = 'catalog';
    el('provider-pricing-input').value = '';
    el('provider-pricing-output').value = '';
    syncProviderModelUi();
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
    };
    const apiKey = el('provider-key').value.trim();
    if (apiKey) payload.apiKey = apiKey;
    return payload;
  }

  async function deleteProvider(id) {
    await api(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.providers = state.providers.filter((provider) => provider.id !== id);
    if (state.activeId === id) state.activeId = state.providers[0]?.id || null;
    renderProviders();
  }

  function renderProviders() {
    const activeSelect = el('active-provider');
    activeSelect.innerHTML = state.providers.length
      ? state.providers
          .map((provider) => `<option value="${provider.id}" ${provider.id === state.activeId ? 'selected' : ''}>${provider.name} (${provider.model})</option>`)
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
            <button type="button" class="secondary small" data-delete-provider="${provider.id}">Loeschen</button>
          </span>
        </li>
      `
      )
      .join('');

    activeSelect.onchange = () => {
      state.activeId = activeSelect.value || null;
      renderProviders();
    };

    list.querySelectorAll('[data-edit-provider]').forEach((button) => {
      button.onclick = () => startEditProvider(button.dataset.editProvider);
    });
    list.querySelectorAll('[data-delete-provider]').forEach((button) => {
      button.onclick = () => deleteProvider(button.dataset.deleteProvider);
    });
  }

  async function unlockVault() {
    setVaultStatus('Nicht mehr erforderlich: Keys werden serverseitig verschluesselt.', 'info');
  }

  async function lockVault() {
    setVaultStatus('Nicht mehr erforderlich: Keys bleiben serverseitig geschuetzt.', 'info');
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
      throw new Error('Bitte ein Modell waehlen oder bei Custom ein eigenes Modell eintragen.');
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
    };
    if (keyInput) provider.apiKey = keyInput;

    await api(`/api/providers/${encodeURIComponent(provider.id)}`, {
      method: 'PUT',
      body: JSON.stringify(provider),
    });

    state.providers = await api('/api/providers');
    await refreshModelCatalog();
    if (!state.activeId) state.activeId = provider.id;
    if (!state.providers.some((entry) => entry.id === state.activeId)) {
      state.activeId = state.providers[0]?.id || null;
    }
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
