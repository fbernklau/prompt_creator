// UI helper for nested API key manager rows.
// Works with data-* attributes used in api-key-manager.layout.html.

function toggleCollapse(id) {
  const content = document.querySelector(`[data-collapsible-content="${id}"]`);
  const button = document.querySelector(`[data-collapse-button="${id}"]`);
  if (!content) return;
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'grid' : 'none';
  if (button) button.textContent = isHidden ? '▾' : '▸';
}

function bindCollapseHandlers(root = document) {
  root.querySelectorAll('[data-collapse-button]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const id = btn.getAttribute('data-collapse-button');
      toggleCollapse(id);
    });
  });
}

// Enforces one active key per stage for user API-provider view.
// Expected markup per row: data-stage-toggle="metaprompt" / "result"
// and data-provider-id="..." on the wrapper.
function bindSingleActiveStageToggles(root = document, onChange = () => {}) {
  root.querySelectorAll('[data-stage-toggle]').forEach((toggle) => {
    toggle.addEventListener('change', () => {
      if (!toggle.checked) return;
      const stage = toggle.getAttribute('data-stage-toggle');
      root
        .querySelectorAll(`[data-stage-toggle="${stage}"]`)
        .forEach((other) => {
          if (other !== toggle) other.checked = false;
        });

      const row = toggle.closest('[data-provider-id]');
      const providerId = row ? row.getAttribute('data-provider-id') : null;
      onChange({ stage, providerId, checked: true });
    });
  });
}

// Shows assignment target input only for selected type.
function bindAssignmentScopeReveal(root = document) {
  root.querySelectorAll('[data-scope-type]').forEach((selectEl) => {
    const sync = () => {
      const value = String(selectEl.value || '');
      const wrap = selectEl.closest('[data-assignment-form]');
      if (!wrap) return;
      const scopeValueWrap = wrap.querySelector('[data-scope-value-wrap]');
      if (!scopeValueWrap) return;
      scopeValueWrap.style.display = value === 'global' ? 'none' : 'block';
    };
    selectEl.addEventListener('change', sync);
    sync();
  });
}

window.ApiKeyManagerUI = {
  toggleCollapse,
  bindCollapseHandlers,
  bindSingleActiveStageToggles,
  bindAssignmentScopeReveal,
};
