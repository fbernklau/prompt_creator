const categoryConfig = {
  Jahresplanung: {
    title: "Jahres- & Semesterplanung",
    short: "JA",
    description: "Strukturierung des Schuljahres nach Lehrplan.",
    pflichtangaben: ["schulstufe", "fach", "zeitraum", "kompetenzziele"],
    unterkategorien: ["Semesterplanung", "Kompetenzraster", "Themenverteilung", "Pruefungs- und Leistungsfenster"],
    dynamicFields: [
      { id: "zeitraum", label: "Planungszeitraum", type: "select", required: true, options: ["Semester", "Schuljahr", "Quartal", "Monat"] },
      { id: "kompetenzziele", label: "Kompetenzziele", type: "textarea", required: true, placeholder: "Welche Kompetenzen sollen erreicht werden?" },
      { id: "leistungsfenster", label: "Leistungsfenster beruecksichtigen", type: "checkbox" },
    ],
  },
  Unterrichtsvorbereitung: {
    title: "Unterrichtsvorbereitung",
    short: "UV",
    description: "Stundenbilder, Arbeitsblaetter und Medien.",
    pflichtangaben: ["lernziel", "dauer", "heterogenitaet", "material"],
    unterkategorien: ["Stundendesign", "Arbeitsauftraege", "Materialerstellung", "Einstiegs- und Abschlussphasen"],
    dynamicFields: [
      { id: "lernziel", label: "Lernziel", type: "text", required: true },
      { id: "dauer", label: "Dauer", type: "select", required: true, options: ["50 Min", "100 Min", "1 Woche", "2 Wochen"] },
      { id: "heterogenitaet", label: "Heterogenitaet", type: "text", required: true, placeholder: "z. B. stark heterogen" },
      { id: "material", label: "Verfuegbares Material", type: "text", required: true, placeholder: "z. B. Laptops, Arbeitsblaetter" },
      { id: "hausuebung", label: "Mit Hausuebung", type: "checkbox" },
    ],
  },
  "Individualisierung & Differenzierung": {
    title: "Individualisierung & Foerderplaene",
    short: "ID",
    description: "Differenzierung fuer heterogene Klassen.",
    pflichtangaben: ["thema", "niveaustufen", "foerderbedarf"],
    unterkategorien: ["Niveaustufen", "Foerdermassnahmen", "Lernpfade", "Wahlaufgaben"],
    dynamicFields: [
      { id: "thema", label: "Thema", type: "text", required: true },
      { id: "niveaustufen", label: "Niveaustufen", type: "multiselect", required: true, options: ["Basis", "Aufbau", "Transfer"] },
      { id: "foerderbedarf", label: "Foerderbedarf", type: "textarea", required: true },
      { id: "selbstlernphase", label: "Selbstlernphase integrieren", type: "checkbox" },
    ],
  },
  "Barrierefreiheit & Inklusion": {
    title: "Barrierefreiheit",
    short: "BI",
    description: "Leichte Sprache und inklusive Materialien.",
    pflichtangaben: ["ausgangsmaterial", "bedarfe", "zielniveau"],
    unterkategorien: ["Leichte Sprache", "DaZ-Unterstuetzung", "Visuelle Strukturierung", "Nachteilsausgleich"],
    dynamicFields: [
      { id: "ausgangsmaterial", label: "Ausgangsmaterial", type: "text", required: true },
      { id: "bedarfe", label: "Bedarfe", type: "multiselect", required: true, options: ["Leichte Sprache", "DaZ", "Screenreader", "Visuelle Unterstuetzung"] },
      { id: "zielniveau", label: "Zielniveau", type: "select", required: true, options: ["Basis", "Mittel", "Erweitert"] },
      { id: "nachteilsausgleich", label: "Nachteilsausgleich beruecksichtigen", type: "checkbox" },
    ],
  },
  "Elternkontakte & Kommunikation": {
    title: "Elternkontakte",
    short: "EK",
    description: "Briefe, Einladungen und Kommunikation.",
    pflichtangaben: ["anlass", "ton", "ziel"],
    unterkategorien: ["Elternbrief", "Gespraechsleitfaden", "Rueckmeldung zu Lernstand", "Konfliktsensible Kommunikation"],
    dynamicFields: [
      { id: "anlass", label: "Anlass", type: "text", required: true },
      { id: "ton", label: "Ton", type: "select", required: true, options: ["wertschaetzend", "sachlich", "motivierend"] },
      { id: "ziel", label: "Kommunikationsziel", type: "textarea", required: true },
      { id: "mehrsprachig", label: "Mehrsprachige Version vorschlagen", type: "checkbox" },
    ],
  },
  "Leistungsbeurteilung & Feedback": {
    title: "Leistungsbeurteilung",
    short: "LB",
    description: "Kriterienkataloge und Feedback.",
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
    title: "Administration",
    short: "AD",
    description: "Listen, Dokumentation und Anwesenheit.",
    pflichtangaben: ["aufgabe", "turnus", "ausgabeformat"],
    unterkategorien: ["Anwesenheitsdokumentation", "Listen & Uebersichten", "Protokolle", "Fristenmanagement"],
    dynamicFields: [
      { id: "aufgabe", label: "Aufgabe", type: "text", required: true },
      { id: "turnus", label: "Turnus", type: "select", required: true, options: ["taeglich", "woechentlich", "monatlich"] },
      { id: "ausgabeformat", label: "Ausgabeformat", type: "select", required: true, options: ["Tabelle", "Checkliste", "Protokoll"] },
      { id: "automatische_fristen", label: "Fristenhinweise einplanen", type: "checkbox" },
    ],
  },
  Organisation: {
    title: "Organisation & Exkursionen",
    short: "OR",
    description: "Planung von Wandertagen und Events.",
    pflichtangaben: ["vorhaben", "zeitrahmen_org", "risiken"],
    unterkategorien: ["Exkursionen", "Projektplanung", "Checklisten", "Ressourcenplanung"],
    dynamicFields: [
      { id: "vorhaben", label: "Vorhaben", type: "text", required: true },
      { id: "zeitrahmen_org", label: "Zeitrahmen", type: "text", required: true },
      { id: "risiken", label: "Risiken/Abhaengigkeiten", type: "textarea", required: true },
      { id: "plan_b", label: "Plan B ausgeben", type: "checkbox" },
    ],
  },
};

const presetOptions = {
  zeitrahmen: ["", "1 Stunde", "2 Stunden", "Halbtag", "Tag", "Woche", "Monat", "__custom__"],
  niveau: ["", "Basis", "Mittel", "Erweitert", "Heterogen", "__custom__"],
  rahmen: ["", "DaZ", "Teamteaching", "Digital", "Inklusiv", "Pruefung", "__custom__"],
  ergebnisformat: ["", "Liste", "Tabelle", "Ablaufplan", "Rubric", "Checkliste", "__custom__"],
  ton: ["", "klar", "sachlich", "formal", "praezise", "motivierend", "einfach", "__custom__"],
};

const SETTINGS_DEFAULTS = {
  theme: "system",
  flowMode: null,
  copyIncludeMetadata: false,
  advancedOpen: false,
};

const el = (id) => document.getElementById(id);

const state = {
  currentUser: null,
  settings: { ...SETTINGS_DEFAULTS },
  providers: [],
  history: [],
  activeId: null,
  selectedCategory: null,
  selectedSubcategory: null,
  generatedPrompt: "",
  generatedMeta: "",
  lastPromptContext: null,
  libraryMode: "own",
  libraryOwn: [],
  libraryPublic: [],
  vault: {
    unlocked: false,
    passphrase: "",
  },
  editProviderId: null,
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    let details = "Request failed";
    try {
      const payload = await response.json();
      details = payload.error || details;
    } catch (_err) {
      // ignore json parse errors
    }
    throw new Error(details);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function deriveKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptSecret(secret, passphrase) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secret));
  return {
    cipherText: toBase64(new Uint8Array(cipher)),
    iv: toBase64(iv),
    salt: toBase64(salt),
  };
}

async function decryptSecret(payload, passphrase) {
  const dec = new TextDecoder();
  const key = await deriveKey(passphrase, fromBase64(payload.salt));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(payload.iv) }, key, fromBase64(payload.cipherText));
  return dec.decode(plain);
}

function setVaultStatus(text, type = "info") {
  const node = el("vault-status");
  node.textContent = text;
  node.dataset.type = type;
}

function openDrawer(drawerId) {
  closeDrawers();
  el(drawerId).classList.remove("is-hidden");
  el("overlay").classList.remove("is-hidden");
}

function closeDrawers() {
  ["provider-drawer", "history-drawer", "options-drawer"].forEach((id) => el(id).classList.add("is-hidden"));
  el("overlay").classList.add("is-hidden");
}

function showScreen(screenName) {
  const ids = ["home", "subcategory", "form", "result", "library"];
  ids.forEach((name) => el(`screen-${name}`).classList.toggle("is-hidden", name !== screenName));
}

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme || "system");
}

function applySettingsToUi() {
  applyTheme(state.settings.theme);
  document.querySelectorAll('input[name="theme"]').forEach((node) => (node.checked = node.value === state.settings.theme));
  document.querySelectorAll('input[name="flow-mode"]').forEach((node) => (node.checked = node.value === (state.settings.flowMode || "step")));
  el("setting-copy-metadata").checked = !!state.settings.copyIncludeMetadata;
  el("setting-advanced-open").checked = !!state.settings.advancedOpen;
  el("copy-include-metadata").checked = !!state.settings.copyIncludeMetadata;
  el("advanced-fields").classList.toggle("is-hidden", !state.settings.advancedOpen);
}

async function saveSettings(partial, showStatus = true) {
  state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(partial) });
  applySettingsToUi();
  if (showStatus) {
    el("settings-status").textContent = "Gespeichert.";
    setTimeout(() => {
      el("settings-status").textContent = "";
    }, 1200);
  }
}

function setupPresetSelect(selectId, customId, values) {
  const select = el(selectId);
  select.innerHTML = values
    .map((value) => {
      if (!value) return '<option value="">Bitte waehlen...</option>';
      if (value === "__custom__") return '<option value="__custom__">Custom...</option>';
      return `<option value="${value}">${value}</option>`;
    })
    .join("");

  const syncCustomState = () => {
    const isCustom = select.value === "__custom__";
    el(customId).disabled = !isCustom;
    if (!isCustom && !el(customId).value) {
      el(customId).placeholder = "Nur bei Custom aktiv";
    }
  };

  select.addEventListener("change", syncCustomState);
  syncCustomState();
}

function resolveSelectOrCustom(selectId, customId, fallback = "nicht angegeben") {
  const selectValue = el(selectId).value;
  const customValue = el(customId).value.trim();
  if (customValue) return customValue;
  if (!selectValue || selectValue === "__custom__") return fallback;
  return selectValue;
}

function renderCategoryGrid() {
  const grid = el("category-grid");
  const categoryNames = Object.keys(categoryConfig);
  grid.innerHTML = categoryNames
    .map((categoryName) => {
      const cfg = categoryConfig[categoryName];
      return `
        <button type="button" class="category-card" data-category="${categoryName}">
          <span class="category-kicker">${cfg.short}</span>
          <strong>${cfg.title}</strong>
          <span class="hint">${cfg.description}</span>
        </button>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => handleCategorySelection(button.dataset.category));
  });
}
function renderSubcategoryList(categoryName) {
  const cfg = categoryConfig[categoryName];
  el("selected-category-title").textContent = cfg.title;
  el("selected-category-desc").textContent = cfg.description;
  el("subcategory-list").innerHTML = cfg.unterkategorien
    .map(
      (subcategory) => `
        <button type="button" class="list-card" data-subcategory="${subcategory}">
          <strong>${subcategory}</strong>
          <span class="hint">${cfg.description}</span>
        </button>
      `
    )
    .join("");

  el("subcategory-list").querySelectorAll("[data-subcategory]").forEach((button) => {
    button.addEventListener("click", () => openForm(categoryName, button.dataset.subcategory));
  });
}

function populateSubcategorySelect(categoryName, selected) {
  const select = el("unterkategorie-select");
  const options = categoryConfig[categoryName].unterkategorien;
  select.innerHTML = options.map((item) => `<option value="${item}">${item}</option>`).join("");
  select.value = selected || options[0];
}

function renderDynamicFields() {
  const cfg = categoryConfig[state.selectedCategory];
  const container = el("dynamic-fields");
  container.innerHTML = "";

  cfg.dynamicFields.forEach((field) => {
    const wrap = document.createElement("label");
    wrap.className = field.type === "checkbox" ? "checkbox span-2" : "";
    if (field.type !== "checkbox") wrap.textContent = field.label;

    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      input.innerHTML = `<option value="">Bitte waehlen...</option>${field.options.map((opt) => `<option value="${opt}">${opt}</option>`).join("")}`;
    } else if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 2;
      input.placeholder = field.placeholder || "";
    } else if (field.type === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      const span = document.createElement("span");
      span.textContent = field.label;
      wrap.appendChild(input);
      wrap.appendChild(span);
    } else if (field.type === "multiselect") {
      input = document.createElement("select");
      input.multiple = true;
      input.innerHTML = field.options.map((opt) => `<option value="${opt}">${opt}</option>`).join("");
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.placeholder = field.placeholder || "";
    }

    input.id = `dyn-${field.id}`;
    if (field.required) input.required = true;
    if (field.type !== "checkbox") wrap.appendChild(input);
    container.appendChild(wrap);
  });

  el("validation-hint").textContent = cfg.pflichtangaben.length
    ? `Pflichtfelder fuer ${cfg.title}: ${cfg.pflichtangaben.join(", ")}`
    : "";
}

function collectDynamicValues() {
  const values = {};
  const cfg = categoryConfig[state.selectedCategory];

  cfg.dynamicFields.forEach((field) => {
    const node = el(`dyn-${field.id}`);
    if (!node) return;

    if (field.type === "checkbox") values[field.id] = node.checked;
    else if (field.type === "multiselect") values[field.id] = [...node.selectedOptions].map((opt) => opt.value).join(", ");
    else values[field.id] = node.value.trim();
  });
  return values;
}

function validateDynamicValues(values) {
  const cfg = categoryConfig[state.selectedCategory];
  const missing = cfg.pflichtangaben.filter((fieldName) => !values[fieldName]);
  if (missing.length) {
    alert(`Bitte Pflichtfelder ausfuellen: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

function resetTaskState() {
  state.selectedCategory = null;
  state.selectedSubcategory = null;
  state.generatedPrompt = "";
  state.generatedMeta = "";
  state.lastPromptContext = null;
  el("prompt-form").reset();
  el("result").value = "";
  el("result-meta").textContent = "";
  el("library-title").value = "";
  el("library-rating").value = "";
  el("library-public").checked = false;
  el("save-library-status").textContent = "";
  showScreen("home");
}

function handleCategorySelection(categoryName) {
  state.selectedCategory = categoryName;
  if ((state.settings.flowMode || "step") === "single") {
    const defaultSubcategory = categoryConfig[categoryName].unterkategorien[0];
    openForm(categoryName, defaultSubcategory);
    return;
  }
  renderSubcategoryList(categoryName);
  showScreen("subcategory");
}

function openForm(categoryName, subcategoryName) {
  state.selectedCategory = categoryName;
  state.selectedSubcategory = subcategoryName;

  const cfg = categoryConfig[categoryName];
  el("form-category-title").textContent = cfg.title;
  el("form-subcategory-title").textContent = subcategoryName;

  populateSubcategorySelect(categoryName, subcategoryName);
  renderDynamicFields();
  showScreen("form");
}

function updateSelectedSubcategory() {
  state.selectedSubcategory = el("unterkategorie-select").value;
  el("form-subcategory-title").textContent = state.selectedSubcategory;
}

function redactKeyState(provider) {
  return provider.keyMeta ? "verschluesselt" : "kein Key";
}

function renderProviders() {
  const activeSelect = el("active-provider");
  activeSelect.innerHTML = state.providers.length
    ? state.providers
        .map((provider) => `<option value="${provider.id}" ${provider.id === state.activeId ? "selected" : ""}>${provider.name} (${provider.model})</option>`)
        .join("")
    : `<option value="">Bitte Provider anlegen...</option>`;

  const list = el("provider-list");
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
    .join("");

  activeSelect.onchange = () => {
    state.activeId = activeSelect.value || null;
    renderProviders();
  };

  list.querySelectorAll("[data-edit-provider]").forEach((button) => {
    button.onclick = () => startEditProvider(button.dataset.editProvider);
  });
  list.querySelectorAll("[data-delete-provider]").forEach((button) => {
    button.onclick = () => deleteProvider(button.dataset.deleteProvider);
  });
}

function startEditProvider(id) {
  const provider = state.providers.find((entry) => entry.id === id);
  if (!provider) return;
  state.editProviderId = id;
  el("provider-name").value = provider.name;
  el("provider-kind").value = provider.kind;
  el("provider-model").value = provider.model;
  el("provider-key").value = "";
  el("provider-key").placeholder = "Leer lassen = vorhandenen Key behalten";
  el("provider-base").value = provider.baseUrl || "";
}

function clearProviderForm() {
  state.editProviderId = null;
  el("provider-form").reset();
  el("provider-key").placeholder = "sk-...";
}

async function deleteProvider(id) {
  await api(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.providers = state.providers.filter((provider) => provider.id !== id);
  if (state.activeId === id) state.activeId = state.providers[0]?.id || null;
  renderProviders();
}

function unlockVault() {
  const passphrase = el("vault-passphrase").value;
  if (!passphrase || passphrase.length < 8) {
    setVaultStatus("Passphrase muss mindestens 8 Zeichen haben.", "error");
    return;
  }
  state.vault.unlocked = true;
  state.vault.passphrase = passphrase;
  setVaultStatus("Vault entsperrt. API-Keys werden verschluesselt gespeichert.", "ok");
}

function lockVault() {
  state.vault.unlocked = false;
  state.vault.passphrase = "";
  el("vault-passphrase").value = "";
  setVaultStatus("Vault gesperrt.", "info");
}
async function handleProviderSubmit(event) {
  event.preventDefault();

  if (!state.vault.unlocked) {
    alert("Bitte zuerst den Key-Vault entsperren. Ohne entsperrten Vault wird kein API-Key gespeichert.");
    return;
  }

  const name = el("provider-name").value.trim();
  const kind = el("provider-kind").value;
  const model = el("provider-model").value.trim();
  const baseUrl = el("provider-base").value.trim();
  const keyInput = el("provider-key").value.trim();

  const existing = state.editProviderId ? state.providers.find((provider) => provider.id === state.editProviderId) : null;
  let keyMeta = existing?.keyMeta || null;
  if (keyInput) keyMeta = await encryptSecret(keyInput, state.vault.passphrase);
  if (!keyMeta) {
    alert("Bitte API-Key eingeben oder bestehenden Key beibehalten.");
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
    method: "PUT",
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
  } catch (_err) {
    return null;
  }
}

async function saveHistory(entry) {
  await api("/api/history", {
    method: "POST",
    body: JSON.stringify(entry),
  });
  state.history.unshift({ ...entry, date: new Date().toLocaleString("de-AT") });
  state.history = state.history.slice(0, 25);
  renderHistory();
}

function renderHistory() {
  el("history-list").innerHTML = state.history
    .map((item) => `<li><span><strong>${item.fach}</strong><br/><small>${item.handlungsfeld}<br/>${item.date}</small></span></li>`)
    .join("");
}

function buildPrompt(data, dynamicValues) {
  const dynamicBlock = Object.entries(dynamicValues)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join("\n");

  return `# Finaler Prompt

Du bist eine didaktisch versierte KI fuer das oesterreichische Schulwesen.

## Kontext
- Schulstufe: ${data.schulstufe}
- Fach/Lernbereich: ${data.fach}
- Handlungsfeld: ${data.handlungsfeld}
- Unterkategorie: ${data.unterkategorie}
- Zeitraum: ${data.zeitrahmen}
- Niveau/Heterogenitaet: ${data.niveau}
- Rahmenbedingungen: ${data.rahmen}

## Template-spezifische Parameter
${dynamicBlock}

## Aufgabe
Erstelle fuer folgende Zielsetzung ein praxistaugliches Ergebnis:
"${data.ziel}"

## Didaktische Anforderungen
- Kompetenzorientiert
- Differenziert fuer heterogene Lerngruppen
- Datenschutzsensibel, ohne personenbezogene Daten
- Klare, sofort einsetzbare Struktur

## Gewuenschtes Outputformat
${data.ergebnisformat}

## Tonalitaet
${data.ton}

## Rueckfragen-Logik
${data.rueckfragen ? "Stelle zuerst 3 bis 7 klaerende Rueckfragen. Warte auf Antworten und erstelle danach die finale Loesung." : "Arbeite direkt mit 1 bis 2 transparenten Annahmen und liefere sofort eine umsetzbare Version."}

## Qualitaet
Nutze klare Zwischenueberschriften, konkrete Schritte, Zeitbezug und umsetzbare Materialien.`;
}

async function generatePrompt(event) {
  event.preventDefault();
  const dynamicValues = collectDynamicValues();
  if (!validateDynamicValues(dynamicValues)) return;

  updateSelectedSubcategory();
  const activeProvider = state.providers.find((provider) => provider.id === state.activeId);
  const decryptedKey = await maybeDecryptActiveKey();
  const data = {
    fach: el("fach").value.trim(),
    schulstufe: el("schulstufe").value.trim(),
    handlungsfeld: state.selectedCategory,
    unterkategorie: state.selectedSubcategory,
    ziel: el("ziel").value.trim(),
    zeitrahmen: resolveSelectOrCustom("zeitrahmen-select", "zeitrahmen-custom"),
    niveau: resolveSelectOrCustom("niveau-select", "niveau-custom"),
    rahmen: resolveSelectOrCustom("rahmen-select", "rahmen-custom", "keine besonderen Angaben"),
    ergebnisformat: resolveSelectOrCustom("ergebnisformat-select", "ergebnisformat-custom", "strukturierte Liste"),
    ton: resolveSelectOrCustom("ton-select", "ton-custom", "klar"),
    rueckfragen: el("rueckfragen").checked,
  };

  if (!data.fach || !data.schulstufe || !data.ziel) {
    alert("Bitte Fach, Schulstufe und Ziel ausfuellen.");
    return;
  }

  const prompt = buildPrompt(data, dynamicValues);
  const providerMeta = activeProvider
    ? `Aktiver Provider: ${activeProvider.name} (${activeProvider.kind}, ${activeProvider.model}) | Key: ${decryptedKey ? "entschluesselt im RAM" : "verschluesselt/gesperrt"}`
    : "Kein aktiver Provider gewaehlt.";

  state.generatedPrompt = prompt;
  state.generatedMeta = providerMeta;
  state.lastPromptContext = {
    fach: data.fach,
    handlungsfeld: data.handlungsfeld,
    unterkategorie: data.unterkategorie,
  };

  el("result").value = prompt;
  el("result-meta").textContent = providerMeta;
  el("library-title").value = `${data.unterkategorie} - ${data.fach}`;
  el("save-library-status").textContent = "";

  await saveHistory({ fach: data.fach, handlungsfeld: data.handlungsfeld });
  showScreen("result");
}

function buildCopyText(includeMetadata) {
  if (!includeMetadata || !state.generatedMeta) return state.generatedPrompt;
  return `${state.generatedPrompt}\n\n---\n${state.generatedMeta}`;
}

function copyPrompt() {
  const text = buildCopyText(el("copy-include-metadata").checked);
  if (!text) return;

  navigator.clipboard.writeText(text).then(() => {
    const button = el("copy-prompt");
    const original = button.textContent;
    button.textContent = "Kopiert";
    setTimeout(() => {
      button.textContent = original;
    }, 1100);
  });
}

function exportPrompt(kind) {
  const content = state.generatedPrompt;
  if (!content) return;
  const extension = kind === "md" ? "md" : "txt";
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `prompt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

function prepareLibraryFilters() {
  const categorySelect = el("lib-filter-category");
  categorySelect.innerHTML = `<option value="">Alle Kategorien</option>${Object.keys(categoryConfig)
    .map((name) => `<option value="${name}">${categoryConfig[name].title}</option>`)
    .join("")}`;

  const refreshSubcategories = () => {
    const selectedCategory = categorySelect.value;
    const options = selectedCategory ? categoryConfig[selectedCategory].unterkategorien : [];
    el("lib-filter-subcategory").innerHTML = `<option value="">Alle Unterkategorien</option>${options
      .map((option) => `<option value="${option}">${option}</option>`)
      .join("")}`;
  };

  categorySelect.addEventListener("change", refreshSubcategories);
  refreshSubcategories();
}

function renderLibraryList() {
  const list = el("library-list");
  const items = state.libraryMode === "own" ? state.libraryOwn : state.libraryPublic;
  if (!items.length) {
    list.innerHTML = `<div class="panel"><span class="hint">Keine Eintraege gefunden.</span></div>`;
    return;
  }

  list.innerHTML = items
    .map((item) => {
      const ratingOptions = [1, 2, 3, 4, 5]
        .map((value) => `<option value="${value}" ${item.myRating === value ? "selected" : ""}>${value}</option>`)
        .join("");

      return `
        <article class="library-item" data-library-id="${item.id}">
          <div class="inline-actions">
            <strong>${item.title}</strong>
            <span class="library-meta">${item.isPublic ? "Public" : "Privat"} | Bewertung: ${item.avgRating.toFixed(2)} (${item.ratingCount})</span>
          </div>
          <span class="library-meta">${item.handlungsfeld} | ${item.unterkategorie} | ${item.fach}</span>
          <pre class="library-text">${item.promptText}</pre>
          <div class="inline-actions">
            <button type="button" class="secondary small" data-action="copy-lib">Kopieren</button>
            <label class="inline-actions">Rate:
              <select data-rate-for="${item.id}">
                <option value="">-</option>
                ${ratingOptions}
              </select>
              <button type="button" class="secondary small" data-action="rate-lib">Speichern</button>
            </label>
            ${
              state.libraryMode === "own"
                ? `
              <button type="button" class="secondary small" data-action="edit-lib">Bearbeiten</button>
              <button type="button" class="secondary small" data-action="toggle-public">${item.isPublic ? "Privat setzen" : "Public setzen"}</button>
              <button type="button" class="secondary small" data-action="delete-lib">Loeschen</button>
            `
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

async function refreshLibrary() {
  const category = el("lib-filter-category").value;
  const subcategory = el("lib-filter-subcategory").value;
  const search = el("lib-filter-search").value.trim();
  if (state.libraryMode === "own") {
    state.libraryOwn = await api("/api/library");
  } else {
    const params = new URLSearchParams();
    if (category) params.set("handlungsfeld", category);
    if (subcategory) params.set("unterkategorie", subcategory);
    if (search) params.set("search", search);
    state.libraryPublic = await api(`/api/library/public?${params.toString()}`);
  }
  renderLibraryList();
}
async function saveCurrentPromptToLibrary() {
  if (!state.generatedPrompt || !state.lastPromptContext) return;
  const payload = {
    title: el("library-title").value.trim() || `${state.lastPromptContext.unterkategorie} - ${state.lastPromptContext.fach}`,
    promptText: state.generatedPrompt,
    fach: state.lastPromptContext.fach,
    handlungsfeld: state.lastPromptContext.handlungsfeld,
    unterkategorie: state.lastPromptContext.unterkategorie,
    isPublic: el("library-public").checked,
    rating: el("library-rating").value ? Number(el("library-rating").value) : null,
  };

  await api("/api/library", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  el("save-library-status").textContent = "Gespeichert.";
  setTimeout(() => {
    el("save-library-status").textContent = "";
  }, 1400);
}

async function handleLibraryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-library-id]");
  if (!card) return;

  const libraryId = card.dataset.libraryId;
  const item = (state.libraryMode === "own" ? state.libraryOwn : state.libraryPublic).find((entry) => String(entry.id) === String(libraryId));
  if (!item) return;

  if (button.dataset.action === "copy-lib") {
    navigator.clipboard.writeText(item.promptText);
    return;
  }

  if (button.dataset.action === "rate-lib") {
    const select = card.querySelector(`select[data-rate-for="${libraryId}"]`);
    if (!select.value) return;
    await api(`/api/library/${libraryId}/rating`, {
      method: "PUT",
      body: JSON.stringify({ rating: Number(select.value) }),
    });
    await refreshLibrary();
    return;
  }

  if (state.libraryMode !== "own") return;

  if (button.dataset.action === "delete-lib") {
    const proceed = confirm("Eintrag wirklich loeschen?");
    if (!proceed) return;
    await api(`/api/library/${libraryId}`, { method: "DELETE" });
    await refreshLibrary();
    return;
  }

  if (button.dataset.action === "toggle-public") {
    await api(`/api/library/${libraryId}`, {
      method: "PUT",
      body: JSON.stringify({ isPublic: !item.isPublic }),
    });
    await refreshLibrary();
    return;
  }

  if (button.dataset.action === "edit-lib") {
    const newTitle = prompt("Neuer Titel", item.title);
    if (!newTitle) return;
    const newPrompt = prompt("Prompt-Inhalt bearbeiten", item.promptText);
    if (!newPrompt) return;
    await api(`/api/library/${libraryId}`, {
      method: "PUT",
      body: JSON.stringify({ title: newTitle, promptText: newPrompt }),
    });
    await refreshLibrary();
  }
}

async function loadServerData() {
  const me = await api("/api/me");
  state.currentUser = me.userId;
  el("current-user").textContent = `Benutzer: ${state.currentUser}`;

  state.settings = await api("/api/settings");
  state.providers = await api("/api/providers");
  state.history = await api("/api/history");
  state.activeId = state.providers[0]?.id || null;
}

function bindEvents() {
  el("btn-provider").addEventListener("click", () => openDrawer("provider-drawer"));
  el("btn-history").addEventListener("click", () => {
    renderHistory();
    openDrawer("history-drawer");
  });
  el("btn-options").addEventListener("click", () => openDrawer("options-drawer"));
  el("btn-library").addEventListener("click", async () => {
    showScreen("library");
    await refreshLibrary();
  });

  el("btn-new-task").addEventListener("click", resetTaskState);
  el("btn-restart-from-result").addEventListener("click", resetTaskState);
  el("btn-adjust").addEventListener("click", () => showScreen("form"));
  el("btn-back-home-from-subcat").addEventListener("click", () => showScreen("home"));
  el("btn-back-home-from-form").addEventListener("click", () => showScreen("home"));
  el("btn-back-subcat").addEventListener("click", () => showScreen((state.settings.flowMode || "step") === "step" ? "subcategory" : "home"));
  el("btn-back-home-from-library").addEventListener("click", () => showScreen("home"));

  el("close-provider-drawer").addEventListener("click", closeDrawers);
  el("close-history-drawer").addEventListener("click", closeDrawers);
  el("close-options-drawer").addEventListener("click", closeDrawers);
  el("overlay").addEventListener("click", closeDrawers);

  el("unlock-vault").addEventListener("click", unlockVault);
  el("lock-vault").addEventListener("click", lockVault);
  el("provider-form").addEventListener("submit", (event) => handleProviderSubmit(event).catch((err) => alert(err.message)));
  el("provider-reset").addEventListener("click", clearProviderForm);

  el("prompt-form").addEventListener("submit", (event) => generatePrompt(event).catch((err) => alert(err.message)));
  el("toggle-advanced").addEventListener("click", () => {
    const area = el("advanced-fields");
    area.classList.toggle("is-hidden");
  });

  el("unterkategorie-select").addEventListener("change", updateSelectedSubcategory);

  el("copy-prompt").addEventListener("click", copyPrompt);
  el("export-txt").addEventListener("click", () => exportPrompt("txt"));
  el("export-md").addEventListener("click", () => exportPrompt("md"));
  el("save-library").addEventListener("click", () => saveCurrentPromptToLibrary().catch((err) => alert(err.message)));

  el("lib-tab-own").addEventListener("click", async () => {
    state.libraryMode = "own";
    el("lib-tab-own").classList.add("is-active");
    el("lib-tab-public").classList.remove("is-active");
    await refreshLibrary();
  });
  el("lib-tab-public").addEventListener("click", async () => {
    state.libraryMode = "public";
    el("lib-tab-public").classList.add("is-active");
    el("lib-tab-own").classList.remove("is-active");
    await refreshLibrary();
  });
  el("lib-refresh").addEventListener("click", () => refreshLibrary().catch((err) => alert(err.message)));
  el("library-list").addEventListener("click", (event) => handleLibraryAction(event).catch((err) => alert(err.message)));

  el("save-settings").addEventListener("click", async () => {
    const theme = document.querySelector('input[name="theme"]:checked')?.value || "system";
    const flowMode = document.querySelector('input[name="flow-mode"]:checked')?.value || "step";
    await saveSettings({
      theme,
      flowMode,
      copyIncludeMetadata: el("setting-copy-metadata").checked,
      advancedOpen: el("setting-advanced-open").checked,
    });
  });

  el("choose-flow-step").addEventListener("click", async () => {
    await saveSettings({ flowMode: "step" }, false);
    el("flow-choice-modal").classList.add("is-hidden");
  });
  el("choose-flow-single").addEventListener("click", async () => {
    await saveSettings({ flowMode: "single" }, false);
    el("flow-choice-modal").classList.add("is-hidden");
  });
}

function setupAdvancedPresets() {
  setupPresetSelect("zeitrahmen-select", "zeitrahmen-custom", presetOptions.zeitrahmen);
  setupPresetSelect("niveau-select", "niveau-custom", presetOptions.niveau);
  setupPresetSelect("rahmen-select", "rahmen-custom", presetOptions.rahmen);
  setupPresetSelect("ergebnisformat-select", "ergebnisformat-custom", presetOptions.ergebnisformat);
  setupPresetSelect("ton-select", "ton-custom", presetOptions.ton);
}

async function init() {
  setVaultStatus("Vault gesperrt. Bitte Passphrase setzen/entsperren.");

  renderCategoryGrid();
  prepareLibraryFilters();
  setupAdvancedPresets();
  bindEvents();

  try {
    await loadServerData();
    applySettingsToUi();
    renderProviders();
    renderHistory();
    showScreen("home");

    if (!state.settings.flowMode) {
      el("flow-choice-modal").classList.remove("is-hidden");
    }
  } catch (error) {
    alert(`Fehler beim Laden der Serverdaten: ${error.message}`);
  }
}

init();
