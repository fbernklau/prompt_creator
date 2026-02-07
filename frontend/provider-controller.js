function createProviderController({
  state,
  el,
  api,
  uid,
  encryptSecret,
  decryptSecret,
  setVaultStatus,
}) {
  function redactKeyState(provider) {
    return provider.keyMeta ? 'verschluesselt' : 'kein Key';
  }

  function startEditProvider(id) {
    const provider = state.providers.find((entry) => entry.id === id);
    if (!provider) return;
    state.editProviderId = id;
    el('provider-name').value = provider.name;
    el('provider-kind').value = provider.kind;
    el('provider-model').value = provider.model;
    el('provider-key').value = '';
    el('provider-key').placeholder = 'Leer lassen = vorhandenen Key behalten';
    el('provider-base').value = provider.baseUrl || '';
  }

  function clearProviderForm() {
    state.editProviderId = null;
    el('provider-form').reset();
    el('provider-key').placeholder = 'sk-...';
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

  function unlockVault() {
    const passphrase = el('vault-passphrase').value;
    if (!passphrase || passphrase.length < 8) {
      setVaultStatus('Passphrase muss mindestens 8 Zeichen haben.', 'error');
      return;
    }
    state.vault.unlocked = true;
    state.vault.passphrase = passphrase;
    setVaultStatus('Vault entsperrt. API-Keys werden verschluesselt gespeichert.', 'ok');
  }

  function lockVault() {
    state.vault.unlocked = false;
    state.vault.passphrase = '';
    el('vault-passphrase').value = '';
    setVaultStatus('Vault gesperrt.', 'info');
  }

  async function handleProviderSubmit(event) {
    event.preventDefault();

    if (!state.vault.unlocked) {
      alert('Bitte zuerst den Key-Vault entsperren. Ohne entsperrten Vault wird kein API-Key gespeichert.');
      return;
    }

    const name = el('provider-name').value.trim();
    const kind = el('provider-kind').value;
    const model = el('provider-model').value.trim();
    const baseUrl = el('provider-base').value.trim();
    const keyInput = el('provider-key').value.trim();

    const existing = state.editProviderId ? state.providers.find((provider) => provider.id === state.editProviderId) : null;
    let keyMeta = existing?.keyMeta || null;
    if (keyInput) keyMeta = await encryptSecret(keyInput, state.vault.passphrase);
    if (!keyMeta) {
      alert('Bitte API-Key eingeben oder bestehenden Key beibehalten.');
      return;
    }

    const provider = {
      id: state.editProviderId || uid(),
      name,
      kind,
      model,
      baseUrl,
      keyMeta,
    };

    await api(`/api/providers/${encodeURIComponent(provider.id)}`, {
      method: 'PUT',
      body: JSON.stringify(provider),
    });

    if (state.editProviderId) {
      const index = state.providers.findIndex((item) => item.id === state.editProviderId);
      if (index >= 0) state.providers[index] = provider;
    } else {
      state.providers.unshift(provider);
    }

    if (!state.activeId) state.activeId = provider.id;
    clearProviderForm();
    renderProviders();
  }

  async function maybeDecryptActiveKey() {
    const active = state.providers.find((provider) => provider.id === state.activeId);
    if (!active?.keyMeta || !state.vault.unlocked) return null;
    try {
      return await decryptSecret(active.keyMeta, state.vault.passphrase);
    } catch (_error) {
      return null;
    }
  }

  return {
    renderProviders,
    clearProviderForm,
    deleteProvider,
    unlockVault,
    lockVault,
    handleProviderSubmit,
    maybeDecryptActiveKey,
  };
}

export { createProviderController };
