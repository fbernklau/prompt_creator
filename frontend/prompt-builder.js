function buildPrompt(data, dynamicValues) {
  const dynamicBlock = Object.entries(dynamicValues)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join('\n');

  return `# Finaler Prompt

Du bist eine didaktisch versierte KI für das österreichische Schulwesen.

## Kontext
- Schulstufe: ${data.schulstufe}
- Fach/Lernbereich: ${data.fach}
- Handlungsfeld: ${data.handlungsfeld}
- Unterkategorie: ${data.unterkategorie}
- Zeitraum: ${data.zeitrahmen}
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
${data.rueckfragen ? 'Stelle zuerst 3 bis 7 klärende Rückfragen. Warte auf Antworten und erstelle danach die finale Lösung.' : 'Arbeite direkt mit 1 bis 2 transparenten Annahmen und liefere sofort eine umsetzbare Version.'}

## Qualität
Nutze klare Zwischenüberschriften, konkrete Schritte, Zeitbezug und umsetzbare Materialien.`;
}

export { buildPrompt };
