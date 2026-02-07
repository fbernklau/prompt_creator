import { PROVIDER_BASE_URLS } from './config.js';

function createProviderController({
  state,
  el,
  api,
  uid,
  setVaultStatus,
}) {
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
    el('provider-kind').addEventListener('change', syncProviderBaseUi);
    el('provider-auto-base').addEventListener('change', syncProviderBaseUi);
    el('provider-auto-base').checked = true;
    syncProviderBaseUi();
  }

  function startEditProvider(id) {
    const provider = state.providers.find((entry) => entry.id === id);
    if (!provider) return;
    state.editProviderId = id;
    el('provider-name').value = provider.name;
    el('provider-kind').value = provider.kind;
    el('provider-model').value = provider.model;
    el('provider-key').value = '';
    el('provider-key').placeholder = provider.hasServerKey
      ? 'Leer lassen = vorhandenen Key beibehalten'
      : 'API-Key fuer diesen Provider';
    el('provider-base').value = provider.baseUrl || '';
    const recommendedBaseUrl = getRecommendedBaseUrl(provider.kind);
    const isPresetMode = provider.baseUrlMode === 'preset'
      || (!provider.baseUrlMode && !!recommendedBaseUrl && provider.baseUrl === recommendedBaseUrl);
    el('provider-auto-base').checked = isPresetMode;
    syncProviderBaseUi();
  }

  function clearProviderForm() {
    state.editProviderId = null;
    el('provider-form').reset();
    el('provider-key').placeholder = 'API-Key (wird serverseitig verschluesselt)';
    el('provider-auto-base').checked = true;
    syncProviderBaseUi();
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
    const model = el('provider-model').value.trim();
    const recommendedBaseUrl = getRecommendedBaseUrl(kind);
    const useRecommendedBaseUrl = isKnownProvider(kind) && el('provider-auto-base').checked;
    const baseUrl = useRecommendedBaseUrl ? recommendedBaseUrl : el('provider-base').value.trim();
    const baseUrlMode = useRecommendedBaseUrl ? 'preset' : 'custom';
    const keyInput = el('provider-key').value.trim();

    const provider = {
      id: state.editProviderId || uid(),
      name,
      kind,
      model,
      baseUrl,
      baseUrlMode,
    };
    if (keyInput) provider.apiKey = keyInput;

    await api(`/api/providers/${encodeURIComponent(provider.id)}`, {
      method: 'PUT',
      body: JSON.stringify(provider),
    });

    state.providers = await api('/api/providers');
    if (!state.activeId) state.activeId = provider.id;
    if (!state.providers.some((entry) => entry.id === state.activeId)) {
      state.activeId = state.providers[0]?.id || null;
    }
    clearProviderForm();
    renderProviders();
  }

  return {
    initializeProviderForm,
    renderProviders,
    clearProviderForm,
    deleteProvider,
    unlockVault,
    lockVault,
    handleProviderSubmit,
  };
}

export { createProviderController };
