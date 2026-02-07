function buildPrompt(data, dynamicValues) {
  const dynamicBlock = Object.entries(dynamicValues)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join('\n');

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
${data.rueckfragen ? 'Stelle zuerst 3 bis 7 klaerende Rueckfragen. Warte auf Antworten und erstelle danach die finale Loesung.' : 'Arbeite direkt mit 1 bis 2 transparenten Annahmen und liefere sofort eine umsetzbare Version.'}

## Qualitaet
Nutze klare Zwischenueberschriften, konkrete Schritte, Zeitbezug und umsetzbare Materialien.`;
}

export { buildPrompt };
