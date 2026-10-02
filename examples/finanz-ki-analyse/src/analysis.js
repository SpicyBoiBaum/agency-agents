// KI-Analyse mit Claude: bekommt alle gesammelten Markt-, Fundamental-,
// Krypto- und Makrodaten und recherchiert per Websuche zusätzlich aktuelle
// Nachrichten, Termine, Analystenmeinungen und Regulierung.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ANALYSIS_EFFORT || 'high';
const MAX_SEARCHES = Number(process.env.MAX_WEB_SEARCHES || 8);
const MAX_CONTINUATIONS = 4;

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

const FAKTOREN = {
  aktie: `
- Geschäftsmodell, Burggraben (Moat), Marktstellung und Wettbewerb
- Umsatz- und Gewinnwachstum, Margen-Entwicklung, Guidance des Managements
- Bewertung: KGV (trailing/forward), PEG, KUV, KBV, EV/EBITDA – im Vergleich zu Historie, Peers und Wachstum
- Bilanzqualität: Verschuldung, Liquidität, Free Cashflow, Kapitalallokation (Buybacks, Dividende, Übernahmen)
- Dividende: Rendite, Ausschüttungsquote, Nachhaltigkeit
- Analystenkonsens, Kursziele, jüngste Up-/Downgrades
- Quartalszahlen: letzte Überraschung (Beat/Miss) und nächster Termin
- Insider-Käufe/-Verkäufe, institutionelle Investoren, Short-Interest
- Branche/Sektor-Rotation, Zyklik, Rohstoff- und Inputkosten
- Regulierung, Rechtsstreitigkeiten, Kartellverfahren, Zölle/Handelspolitik, Geopolitik
- Management-Wechsel, M&A, Produkt-Launches, Großaufträge
- Makro: Leitzinsen (Fed/EZB), Inflation, Konjunktur, Währungseffekte
- Sentiment und Nachrichtenlage, technische Verfassung des Charts`,
  etf: `
- Abgebildeter Index bzw. Strategie, Replikationsmethode (physisch/synthetisch, Sampling)
- Kosten: TER, Tracking Difference, Spread/Liquidität, Fondsvolumen
- Ertragsverwendung (ausschüttend/thesaurierend), Fondsdomizil, steuerliche Aspekte für deutsche Anleger (Teilfreistellung)
- Zusammensetzung: Top-Positionen und Klumpenrisiko, Sektor- und Länderallokation
- Bewertung des zugrundeliegenden Index (KGV, KBV) vs. historischem Durchschnitt
- Gewinnentwicklung und Ausblick der größten Positionen
- Währungsrisiko (Fondswährung vs. Handelswährung vs. EUR)
- Mittelzuflüsse/-abflüsse, Anbieter-Reputation
- Makro: Zinsen, Inflation, Konjunktur, Geopolitik in den Hauptregionen
- Alternativen/vergleichbare ETFs
- Sentiment und technische Verfassung des Charts`,
  krypto: `
- Use Case, Technologie, Netzwerkeffekte, Konkurrenz zu anderen Chains/Coins
- Tokenomics: Umlauf- vs. Maximalmenge, Inflation/Emission, Token-Unlocks, Staking, Burn-Mechanismen
- Marktkapitalisierung, Rang, Bitcoin-Dominanz, Liquidität/Handelsvolumen
- On-Chain-Daten soweit recherchierbar: aktive Adressen, Hashrate, TVL, Börsen-Zu-/Abflüsse, Wal-Bewegungen
- Spot-ETF-Zu-/Abflüsse und institutionelle Nachfrage
- Regulierung (MiCA in der EU, SEC/USA, Asien), Steuern
- Zyklen (z. B. Bitcoin-Halving), Abstand zum Allzeithoch
- Derivate-Markt: Funding Rates, Open Interest, Liquidationen
- Sentiment: Fear & Greed Index, Social Media, Nachrichtenlage
- Entwicklungsaktivität, Upgrades/Hard Forks, Sicherheitsvorfälle/Hacks
- Makro: Zinsen, US-Dollar, globale Liquidität, Korrelation mit Aktien (Nasdaq)
- Technische Verfassung des Charts`,
  sonstiges: `
- Was das Instrument abbildet und welche Treiber den Kurs bestimmen
- Makro, Zinsen, Währungen, Angebot/Nachfrage, Geopolitik
- Sentiment und technische Verfassung des Charts`,
};

const FUNDAMENT_UEBERSCHRIFT = {
  aktie: 'Fundamentale Analyse',
  etf: 'Fonds-Analyse (Kosten, Struktur, Zusammensetzung, Bewertung)',
  krypto: 'Fundamentale Analyse (Technologie, Tokenomics, On-Chain)',
  sonstiges: 'Fundamentale Treiber',
};

function systemPrompt(typ) {
  return `Du bist ein erfahrener, unabhängiger Finanzanalyst (CFA) mit Expertise in Aktien, ETFs und Kryptowährungen. Du erstellst für Privatanleger im deutschsprachigen Raum eine gründliche, ausgewogene Analyse eines Wertpapiers bzw. einer Kryptowährung. Antworte immer auf Deutsch.

Arbeitsweise:
1. Werte zuerst die mitgelieferten Daten (JSON) aus: Kurs, technische Kennzahlen, relative Stärke, Fundamentaldaten, Krypto-Daten, Makro-Umfeld, Schlagzeilen. Prozentwerte im JSON sind Dezimalzahlen (0.05 = 5 %).
2. Recherchiere anschließend mit der Websuche gezielt, was in den Daten fehlt oder sich kürzlich geändert hat: aktuelle Nachrichten der letzten Wochen, letzte und nächste Quartalszahlen/Termine, Analystenänderungen, Regulierung, Branchentrends, Zentralbank-Erwartungen und – je nach Asset-Typ – die unten genannten Faktoren. Bevorzuge seriöse, aktuelle Quellen und achte auf das Datum.
3. Berücksichtige ALLE für den Kurs relevanten Faktoren. Für diesen Asset-Typ (${typ}) insbesondere:${FAKTOREN[typ] || FAKTOREN.sonstiges}
4. Gewichte die Faktoren nach ihrer tatsächlichen Bedeutung für den Kurs und begründe deine Gewichtung. Trenne klar zwischen Fakten (mit Quelle bzw. aus den Daten) und deiner Einschätzung.
5. Erfinde niemals Zahlen. Wenn etwas nicht verfügbar oder unsicher ist, sage das.

Gliederung deiner Antwort (Markdown, prägnant, Tabellen wo sinnvoll):
## Kurzfazit
(3–5 Sätze: Gesamtbild, wichtigste Treiber, Haupt-Risiko)
## Kursentwicklung & Technische Analyse
## ${FUNDAMENT_UEBERSCHRIFT[typ] || FUNDAMENT_UEBERSCHRIFT.sonstiges}
## Nachrichten & Katalysatoren
## Makroökonomisches Umfeld
## Sentiment & Marktpositionierung
## Chancen
## Risiken
## Szenarien (12 Monate)
(Tabelle Bull / Basis / Bear mit Wahrscheinlichkeit, grober Kursspanne und Auslöser)
## Wichtige Termine & worauf man achten sollte

Ganz am Ende gibst du genau einen JSON-Codeblock (\`\`\`json … \`\`\`) mit dieser Struktur aus, ohne weiteren Text danach:
{
  "gesamtscore": <Ganzzahl von -100 (sehr negativ) bis 100 (sehr positiv)>,
  "einschaetzung": "<stark negativ | negativ | neutral | positiv | stark positiv>",
  "risiko": "<niedrig | mittel | hoch | sehr hoch>",
  "zeithorizonte": { "kurzfristig": "<negativ | neutral | positiv>", "mittelfristig": "…", "langfristig": "…" },
  "faktoren": [ { "name": "<Faktor>", "bewertung": <-2 bis 2>, "gewicht": <1 bis 5>, "begruendung": "<ein Satz>" } ],
  "szenarien": [ { "name": "Bull", "wahrscheinlichkeit": <0-1>, "kursziel": <Zahl> }, { "name": "Basis", … }, { "name": "Bear", … } ]
}
Nimm 6–12 der wichtigsten Faktoren in "faktoren" auf.

Hinweis: Dies ist keine Anlageberatung; erwähne das einmal kurz am Ende des Textteils.`;
}

function userPrompt(context, focus) {
  const lines = [
    `Analysiere ${context.asset.name} (${context.asset.symbol}), Typ: ${context.asset.typ}. Heutiges Datum: ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Gesammelte Daten:',
    '```json',
    JSON.stringify(context, null, 1),
    '```',
  ];
  if (context.fehlendeDaten?.length) {
    lines.push('', `Nicht automatisch verfügbar (bitte per Websuche ergänzen): ${context.fehlendeDaten.join(', ')}.`);
  }
  if (focus) {
    lines.push('', `Besonderer Fokus bzw. Frage des Nutzers: ${focus}`);
  }
  return lines.join('\n');
}

/**
 * Führt die Analyse aus und meldet Fortschritt über `emit(event, data)`:
 *   status   – { text }               Fortschrittsmeldung
 *   search   – { query }              KI startet eine Websuche
 *   sources  – [{ url, title }]       gefundene Quellen
 *   thinking – { text }               Zusammenfassung des Denkprozesses
 *   text     – { text }               Antwort-Text (inkrementell)
 *   done     – { usage, model }
 */
export async function runAnalysis(context, { focus, emit, signal }) {
  const anthropic = getClient();
  const messages = [{ role: 'user', content: userPrompt(context, focus) }];
  const seenUrls = new Set();
  const usage = { input_tokens: 0, output_tokens: 0, web_searches: 0 };
  let servedBy = MODEL;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = anthropic.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: EFFORT },
        system: systemPrompt(context.asset.typ),
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }],
        messages,
      },
      { signal },
    );

    // Eingaben der Server-Tools (Suchbegriff) kommen als JSON-Fragmente.
    const toolInput = new Map();

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const b = event.content_block;
        if (b.type === 'server_tool_use') toolInput.set(event.index, '');
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          const fresh = b.content
            .filter((r) => r.type === 'web_search_result' && !seenUrls.has(r.url))
            .map((r) => {
              seenUrls.add(r.url);
              return { url: r.url, title: r.title, alter: r.page_age };
            });
          if (fresh.length) emit('sources', fresh);
        }
        if (b.type === 'fallback') {
          emit('status', { text: `Modellwechsel: ${b.to?.model ?? 'Fallback-Modell'} übernimmt.` });
        }
      } else if (event.type === 'content_block_delta') {
        const d = event.delta;
        if (d.type === 'text_delta') emit('text', { text: d.text });
        else if (d.type === 'thinking_delta' && d.thinking) emit('thinking', { text: d.thinking });
        else if (d.type === 'input_json_delta' && toolInput.has(event.index)) {
          toolInput.set(event.index, toolInput.get(event.index) + d.partial_json);
        }
      } else if (event.type === 'content_block_stop' && toolInput.has(event.index)) {
        try {
          const { query } = JSON.parse(toolInput.get(event.index) || '{}');
          if (query) emit('search', { query });
        } catch {
          // unvollständiges JSON – Suchbegriff wird dann einfach nicht angezeigt
        }
        toolInput.delete(event.index);
      }
    }

    const message = await stream.finalMessage();
    servedBy = message.model || servedBy;
    usage.input_tokens += message.usage?.input_tokens ?? 0;
    usage.output_tokens += message.usage?.output_tokens ?? 0;
    usage.web_searches += message.usage?.server_tool_use?.web_search_requests ?? 0;

    if (message.stop_reason === 'refusal') {
      throw new Error(
        `Die KI hat die Analyse abgelehnt${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`,
      );
    }
    if (message.stop_reason === 'pause_turn') {
      // Server-seitige Suchschleife pausiert – Antwort unverändert zurückgeben,
      // der Server setzt automatisch fort.
      messages.push({ role: 'assistant', content: message.content });
      emit('status', { text: 'Recherche wird fortgesetzt …' });
      continue;
    }
    if (message.stop_reason === 'max_tokens') {
      emit('status', { text: 'Hinweis: Die Antwort wurde wegen der Längenbegrenzung abgeschnitten.' });
    }
    emit('done', { usage, model: servedBy });
    return;
  }
  emit('status', { text: 'Recherche-Limit erreicht – Analyse ggf. unvollständig.' });
  emit('done', { usage, model: servedBy });
}
