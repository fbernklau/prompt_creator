const categoryConfig = {
  "Jahresplanung": {
    pflichtangaben: ["schulstufe", "fach", "zeitraum", "kompetenzziele"],
    unterkategorien: ["Semesterplanung", "Kompetenzraster", "Themenverteilung", "Prüfungs- und Leistungsfenster"],
    dynamicFields: [
      { id: "zeitraum", label: "Planungszeitraum", type: "select", required: true, options: ["Semester", "Schuljahr", "Quartal", "Monat"] },
      { id: "kompetenzziele", label: "Kompetenzziele", type: "textarea", required: true, placeholder: "Welche Kompetenzen sollen erreicht werden?" },
      { id: "leistungsfenster", label: "Leistungsfenster berücksichtigen", type: "checkbox" },
    ],
  },
  "Unterrichtsvorbereitung": {
    pflichtangaben: ["lernziel", "dauer", "heterogenitaet", "material"],
    unterkategorien: ["Stundendesign", "Arbeitsaufträge", "Materialerstellung", "Einstiegs- und Abschlussphasen"],
    dynamicFields: [
      { id: "lernziel", label: "Lernziel", type: "text", required: true },
      { id: "dauer", label: "Dauer", type: "select", required: true, options: ["50 Min", "100 Min", "1 Woche", "2 Wochen"] },
      { id: "heterogenitaet", label: "Heterogenität", type: "text", required: true, placeholder: "z. B. stark heterogen" },
      { id: "material", label: "Verfügbares Material", type: "text", required: true, placeholder: "z. B. Laptops, Arbeitsblätter" },
      { id: "hausuebung", label: "Mit Hausübung", type: "checkbox" },
    ],
  },
  "Individualisierung & Differenzierung": {
    pflichtangaben: ["thema", "niveaustufen", "foerderbedarf"],
    unterkategorien: ["Niveaustufen", "Fördermaßnahmen", "Lernpfade", "Wahlaufgaben"],
    dynamicFields: [
      { id: "thema", label: "Thema", type: "text", required: true },
      { id: "niveaustufen", label: "Niveaustufen", type: "multiselect", required: true, options: ["Basis", "Aufbau", "Transfer"] },
      { id: "foerderbedarf", label: "Förderbedarf", type: "textarea", required: true },
      { id: "selbstlernphase", label: "Selbstlernphase integrieren", type: "checkbox" },
    ],
  },
  "Barrierefreiheit & Inklusion": {
    pflichtangaben: ["ausgangsmaterial", "bedarfe", "zielniveau"],
    unterkategorien: ["Leichte Sprache", "DaZ-Unterstützung", "Visuelle Strukturierung", "Nachteilsausgleich"],
    dynamicFields: [
      { id: "ausgangsmaterial", label: "Ausgangsmaterial", type: "text", required: true },
      { id: "bedarfe", label: "Bedarfe", type: "multiselect", required: true, options: ["Leichte Sprache", "DaZ", "Screenreader", "Visuelle Unterstützung"] },
      { id: "zielniveau", label: "Zielniveau", type: "select", required: true, options: ["Basis", "Mittel", "Erweitert"] },
      { id: "nachteilsausgleich", label: "Nachteilsausgleich berücksichtigen", type: "checkbox" },
    ],
  },
  "Elternkontakte & Kommunikation": {
    pflichtangaben: ["anlass", "ton", "ziel"],
    unterkategorien: ["Elternbrief", "Gesprächsleitfaden", "Rückmeldung zu Lernstand", "Konfliktsensible Kommunikation"],
    dynamicFields: [
      { id: "anlass", label: "Anlass", type: "text", required: true },
      { id: "ton", label: "Ton", type: "select", required: true, options: ["wertschätzend", "sachlich", "motivierend"] },
      { id: "ziel", label: "Kommunikationsziel", type: "textarea", required: true },
      { id: "mehrsprachig", label: "Mehrsprachige Version vorschlagen", type: "checkbox" },
    ],
  },
  "Leistungsbeurteilung & Feedback": {
    pflichtangaben: ["kompetenzen", "kriterienset", "format"],
    unterkategorien: ["Beurteilungsraster", "Rubrics", "Feedbacktexte", "Selbst- und Peer-Assessment"],
    dynamicFields: [
      { id: "kompetenzen", label: "Kompetenzen", type: "textarea", required: true },
      { id: "kriterienset", label: "Kriterienset", type: "textarea", required: true },
      { id: "format", label: "Format", type: "select", required: true, options: ["Rubric", "Punkte", "Noten", "Kompetenzstufen"] },
      { id: "peer_assessment", label: "Selbst-/Peer-Assessment integrieren", type: "checkbox" },
      { id: "feedbackbausteine", label: "Feedbackbausteine mitliefern", type: "checkbox" },
    ],
  },
  Administration: {
    pflichtangaben: ["aufgabe", "turnus", "ausgabeformat"],
    unterkategorien: ["Anwesenheitsdokumentation", "Listen & Übersichten", "Protokolle", "Fristenmanagement"],
    dynamicFields: [
      { id: "aufgabe", label: "Aufgabe", type: "text", required: true },
      { id: "turnus", label: "Turnus", type: "select", required: true, options: ["täglich", "wöchentlich", "monatlich"] },
      { id: "ausgabeformat", label: "Ausgabeformat", type: "select", required: true, options: ["Tabelle", "Checkliste", "Protokoll"] },
      { id: "automatische_fristen", label: "Fristenhinweise einplanen", type: "checkbox" },
    ],
  },
  Organisation: {
    pflichtangaben: ["vorhaben", "zeitrahmen_org", "risiken"],
    unterkategorien: ["Exkursionen", "Projektplanung", "Checklisten", "Ressourcenplanung"],
    dynamicFields: [
      { id: "vorhaben", label: "Vorhaben", type: "text", required: true },
      { id: "zeitrahmen_org", label: "Zeitrahmen", type: "text", required: true },
      { id: "risiken", label: "Risiken/Abhängigkeiten", type: "textarea", required: true },
      { id: "plan_b", label: "Plan B ausgeben", type: "checkbox" },
    ],
  },
};

const el = (id) => document.getElementById(id);

const state = {
  providers: [],
  history: [],
  activeId: null,
  currentUser: null,
  vault: {
    unlocked: false,
    passphrase: "",
  },
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    let details = 'Request failed';
    try {
      const json = await response.json();
      details = json.error || details;
    } catch {
      // ignore parse errors
    }
    throw new Error(details);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptSecret(secret, passphrase) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));
  return {
    cipherText: bytesToBase64(new Uint8Array(cipherBuffer)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

async function decryptSecret(payload, passphrase) {
  const dec = new TextDecoder();
  const key = await deriveKey(passphrase, base64ToBytes(payload.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.cipherText)
  );
  return dec.decode(plain);
}

function setVaultStatus(text, type = 'info') {
  const node = el('vault-status');
  node.textContent = text;
  node.dataset.type = type;
}

function unlockVault() {
  const passphrase = el('vault-passphrase').value;
  if (!passphrase || passphrase.length < 8) {
    setVaultStatus('Passphrase muss mindestens 8 Zeichen haben.', 'error');
    return;
  }
  state.vault.unlocked = true;
  state.vault.passphrase = passphrase;
  setVaultStatus('Vault entsperrt. API-Keys werden verschlüsselt gespeichert.', 'ok');
}

function lockVault() {
  state.vault.unlocked = false;
  state.vault.passphrase = '';
  el('vault-passphrase').value = '';
  setVaultStatus('Vault gesperrt.', 'info');
}

function setupCategories() {
  const names = Object.keys(categoryConfig);
  el('handlungsfeld').innerHTML = names.map((n) => `<option>${n}</option>`).join('');
  updateSubcategories();
  renderDynamicFields();
  el('handlungsfeld').addEventListener('change', () => {
    updateSubcategories();
    renderDynamicFields();
  });
}

function updateSubcategories() {
  const cfg = categoryConfig[el('handlungsfeld').value];
  el('unterkategorie').innerHTML = cfg.unterkategorien.map((s) => `<option>${s}</option>`).join('');
}

function renderDynamicFields() {
  const cfg = categoryConfig[el('handlungsfeld').value];
  const container = el('dynamic-fields');
  container.innerHTML = '';

  cfg.dynamicFields.forEach((field) => {
    const wrap = document.createElement('label');
    wrap.className = field.type === 'checkbox' ? 'checkbox' : '';
    if (field.type !== 'checkbox') wrap.innerHTML = `${field.label}`;

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      input.innerHTML = `<option value="">Bitte wählen…</option>` + field.options.map((o) => `<option value="${o}">${o}</option>`).join('');
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 2;
      input.placeholder = field.placeholder || '';
    } else if (field.type === 'checkbox') {
      const span = document.createElement('span');
      span.textContent = field.label;
      input = document.createElement('input');
      input.type = 'checkbox';
      wrap.appendChild(input);
      wrap.appendChild(span);
    } else if (field.type === 'multiselect') {
      input = document.createElement('select');
      input.multiple = true;
      input.innerHTML = field.options.map((o) => `<option value="${o}">${o}</option>`).join('');
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = field.placeholder || '';
    }

    input.id = `dyn-${field.id}`;
    if (field.required) input.required = true;
    if (field.type !== 'checkbox') wrap.appendChild(input);
    container.appendChild(wrap);
  });

  const reqText = cfg.pflichtangaben.length
    ? `Pflichtfelder für ${el('handlungsfeld').value}: ${cfg.pflichtangaben.join(', ')}`
    : '';
  el('validation-hint').textContent = reqText;
}

function collectDynamicValues() {
  const values = {};
  const cfg = categoryConfig[el('handlungsfeld').value];
  cfg.dynamicFields.forEach((field) => {
    const node = el(`dyn-${field.id}`);
    if (!node) return;
    if (field.type === 'checkbox') values[field.id] = node.checked;
    else if (field.type === 'multiselect') values[field.id] = [...node.selectedOptions].map((o) => o.value).join(', ');
    else values[field.id] = node.value.trim();
  });
  return values;
}

function validateDynamicFields(values) {
  const cfg = categoryConfig[el('handlungsfeld').value];
  const missing = cfg.pflichtangaben.filter((key) => !values[key]);
  if (missing.length) {
    alert(`Bitte Pflichtfelder ausfüllen: ${missing.join(', ')}`);
    return false;
  }
  return true;
}

function redactKeyState(p) {
  return p.keyMeta ? '🔐 verschlüsselt' : '⚠️ kein Key';
}

function renderProviders() {
  const active = el('active-provider');
  active.innerHTML = state.providers.length
    ? state.providers.map((p) => `<option value="${p.id}" ${p.id === state.activeId ? 'selected' : ''}>${p.name} (${p.model})</option>`).join('')
    : `<option value="">Bitte Provider anlegen…</option>`;

  const list = el('provider-list');
  list.innerHTML = state.providers
    .map(
      (p) => `
      <li>
        <span><strong>${p.name}</strong> • ${p.kind} • ${p.model} • ${redactKeyState(p)}${p.id === state.activeId ? '<span class="active"> (aktiv)</span>' : ''}</span>
        <span class="mini-actions">
          <button type="button" data-edit="${p.id}" class="secondary">Bearbeiten</button>
          <button type="button" data-delete="${p.id}" class="secondary">Löschen</button>
        </span>
      </li>
    `
    )
    .join('');

  active.onchange = () => {
    state.activeId = active.value || null;
    renderProviders();
  };

  list.querySelectorAll('[data-edit]').forEach((btn) => (btn.onclick = () => startEditProvider(btn.dataset.edit)));
  list.querySelectorAll('[data-delete]').forEach((btn) => (btn.onclick = () => deleteProvider(btn.dataset.delete)));
}

let editId = null;

function startEditProvider(id) {
  const p = state.providers.find((x) => x.id === id);
  if (!p) return;
  editId = id;
  el('provider-name').value = p.name;
  el('provider-kind').value = p.kind;
  el('provider-model').value = p.model;
  el('provider-key').value = '';
  el('provider-key').placeholder = 'Leer lassen = vorhandenen verschlüsselten Key behalten';
  el('provider-base').value = p.baseUrl || '';
}

function clearProviderForm() {
  editId = null;
  el('provider-form').reset();
  el('provider-key').placeholder = 'sk-...';
}

async function deleteProvider(id) {
  await api(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.providers = state.providers.filter((p) => p.id !== id);
  if (state.activeId === id) state.activeId = state.providers[0]?.id || null;
  renderProviders();
}

async function handleProviderSubmit(e) {
  e.preventDefault();

  if (!state.vault.unlocked) {
    alert('Bitte zuerst den Key-Vault entsperren (Passphrase eingeben). Ohne entsperrten Vault wird kein API-Key gespeichert.');
    return;
  }

  const name = el('provider-name').value.trim();
  const kind = el('provider-kind').value;
  const model = el('provider-model').value.trim();
  const baseUrl = el('provider-base').value.trim();
  const keyInput = el('provider-key').value.trim();

  const existing = editId ? state.providers.find((p) => p.id === editId) : null;
  let keyMeta = existing?.keyMeta || null;
  if (keyInput) {
    keyMeta = await encryptSecret(keyInput, state.vault.passphrase);
  }

  if (!keyMeta) {
    alert('Bitte API-Key eingeben oder bestehenden Key beibehalten.');
    return;
  }

  const provider = {
    id: editId || uid(),
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

  if (editId) {
    const idx = state.providers.findIndex((p) => p.id === editId);
    if (idx >= 0) state.providers[idx] = provider;
  } else {
    state.providers.unshift(provider);
  }

  if (!state.activeId) state.activeId = provider.id;
  clearProviderForm();
  renderProviders();
}

function exportPrompt(kind = 'txt') {
  const content = el('result').value;
  if (!content) return;
  const ext = kind === 'md' ? 'md' : 'txt';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `prompt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function saveHistory(entry) {
  await api('/api/history', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
  state.history.unshift({ ...entry, date: new Date().toLocaleString('de-AT') });
  state.history = state.history.slice(0, 25);
  renderHistory();
}

function renderHistory() {
  el('history-list').innerHTML = state.history
    .map((h) => `<li><strong>${h.fach}</strong> • ${h.handlungsfeld}<br/><small>${h.date}</small></li>`)
    .join('');
}

async function maybeDecryptActiveKey() {
  const active = state.providers.find((p) => p.id === state.activeId);
  if (!active?.keyMeta) return null;
  if (!state.vault.unlocked) return null;
  try {
    return await decryptSecret(active.keyMeta, state.vault.passphrase);
  } catch {
    return null;
  }
}

async function generatePrompt(e) {
  e.preventDefault();
  const dynamicValues = collectDynamicValues();
  if (!validateDynamicFields(dynamicValues)) return;

  const active = state.providers.find((p) => p.id === state.activeId);
  const decryptedKey = await maybeDecryptActiveKey();

  const data = {
    schulstufe: el('schulstufe').value,
    fach: el('fach').value,
    handlungsfeld: el('handlungsfeld').value,
    unterkategorie: el('unterkategorie').value,
    ziel: el('ziel').value,
    zeitrahmen: el('zeitrahmen').value || 'nicht angegeben',
    niveau: el('niveau').value || 'nicht angegeben',
    rahmen: el('rahmen').value || 'keine besonderen Angaben',
    ergebnisformat: el('ergebnisformat').value || 'strukturierte Liste',
    ton: el('ton').value || 'klar und professionell',
    rueckfragen: el('rueckfragen').checked,
  };

  const providerHint = active
    ? `Provider: ${active.name} | Modell: ${active.model}${active.baseUrl ? ` | Base URL: ${active.baseUrl}` : ''} | Key-Status: ${decryptedKey ? 'entschlüsselt im RAM' : 'verschlüsselt/gesperrt'}`
    : 'Kein Provider ausgewählt (Prompt kann trotzdem manuell genutzt werden).';

  const dynamicBlock = Object.entries(dynamicValues).map(([k, v]) => `- ${k}: ${String(v)}`).join('\n');

  const output = `# Finaler Prompt

Du bist eine didaktisch versierte KI für das österreichische Schulwesen.

## Kontext
- Schulstufe: ${data.schulstufe}
- Fach/Lernbereich: ${data.fach}
- Handlungsfeld: ${data.handlungsfeld}
- Unterkategorie: ${data.unterkategorie}
- Zeitrahmen: ${data.zeitrahmen}
- Niveau/Heterogenität: ${data.niveau}
- Rahmenbedingungen: ${data.rahmen}

## Template-spezifische Parameter
${dynamicBlock}

## Aufgabe
Erstelle für folgende Zielsetzung ein praxistaugliches Ergebnis:
"${data.ziel}"

## Didaktische Anforderungen
- Kompetenzorientiert
- Differenziert für heterogene Lerngruppen
- Datenschutzsensibel, ohne personenbezogene Daten
- Klare, sofort einsetzbare Struktur

## Gewünschtes Outputformat
${data.ergebnisformat}

## Tonalität
${data.ton}

## Rückfragen-Logik
${data.rueckfragen ? 'Stelle zuerst 3–7 klärende Rückfragen. Warte auf Antworten und erstelle danach die finale Lösung.' : 'Arbeite direkt mit 1–2 transparenten Annahmen und liefere sofort eine erste umsetzbare Version.'}

## Qualität
Nutze klare Zwischenüberschriften, konkrete Schritte, Zeitbezug und umsetzbare Materialien.

---
${providerHint}
Hinweis: API-Key nie im Prompt teilen.`;

  el('result').value = output;
  el('result-meta').textContent = active
    ? `Aktiver Versandkanal: ${active.name} (${active.kind}, ${active.model})`
    : 'Kein aktiver Provider gewählt – du kannst den Prompt dennoch manuell verwenden.';

  await saveHistory({ fach: data.fach, handlungsfeld: data.handlungsfeld });
}

function copyPrompt() {
  const text = el('result').value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = el('copy-prompt');
    const old = btn.textContent;
    btn.textContent = 'Kopiert ✓';
    setTimeout(() => (btn.textContent = old), 1200);
  });
}

async function loadServerData() {
  const me = await api('/api/me');
  state.currentUser = me.userId;
  el('current-user').textContent = `Benutzer: ${state.currentUser}`;

  state.providers = await api('/api/providers');
  state.history = await api('/api/history');
  state.activeId = state.providers[0]?.id || null;
  renderProviders();
  renderHistory();
}

async function init() {
  setupCategories();

  el('unlock-vault').addEventListener('click', unlockVault);
  el('lock-vault').addEventListener('click', lockVault);
  el('provider-form').addEventListener('submit', (e) => handleProviderSubmit(e).catch((err) => alert(err.message)));
  el('provider-reset').addEventListener('click', clearProviderForm);
  el('prompt-form').addEventListener('submit', (e) => generatePrompt(e).catch((err) => alert(err.message)));
  el('copy-prompt').addEventListener('click', copyPrompt);
  el('export-txt').addEventListener('click', () => exportPrompt('txt'));
  el('export-md').addEventListener('click', () => exportPrompt('md'));

  setVaultStatus('Vault gesperrt. Bitte Passphrase setzen/entsperren.', 'info');

  try {
    await loadServerData();
  } catch (error) {
    alert(`Fehler beim Laden der Serverdaten: ${error.message}`);
  }
}

init();
