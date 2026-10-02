# 📈 Finanz-KI-Analyse

Web-App, die **Kurse von Aktien, ETFs und Kryptowährungen** anzeigt und per Klick eine **KI-Analyse mit Claude** erstellt. Die Analyse bezieht alle wesentlichen Kurstreiber ein und recherchiert dafür live im Web.

## Funktionen

- **Suche** nach Name, Ticker oder ISIN-nahen Begriffen (z. B. „Apple“, „MSCI World“, „Bitcoin“, `SAP.DE`, `BTC-EUR`)
- **Live-Kurse**: Kurs, Tagesveränderung, letzte Chart-Kerze, Watchlist und Makro-Leiste aktualisieren sich automatisch (alle 15 s, Makro jede Minute). Kursänderungen blinken grün/rot, und eine Anzeige zeigt „● Live“ oder „Börse geschlossen“. Im Hintergrund-Tab pausiert die Aktualisierung.
- **Kerzen-Chart** mit SMA 50/200 und Volumen, Zeiträume 1M bis Max
- **Technische Kennzahlen**: Trend, RSI, MACD, Bollinger-Bänder, ATR, Volatilität, Max. Drawdown, 52W-Hoch/Tief, Golden/Death Cross, Unterstützungen/Widerstände, Performance (1W bis 5J, YTD)
- **Makro-Leiste** (Tagesveränderung): S&P 500, Nasdaq, DAX, Euro Stoxx 50, VIX, US-10J-Rendite, Dollar-Index, EUR/USD, Gold, Öl, Bitcoin
- **Watchlist** (im Browser gespeichert) und Schnellauswahl
- **Schlagzeilen** zum gewählten Wert
- **KI-Analyse** (live gestreamt):
  - Score von −100 bis +100, Einschätzung, Risiko, Einschätzung kurz/mittel/lang
  - Faktoren mit Bewertung (−2 bis +2) und Gewichtung
  - Bull-/Basis-/Bear-Szenarien mit Wahrscheinlichkeit und Kursziel
  - ausführlicher Bericht mit Quellenangaben, optional mit eigenem Fokus („Lohnt sich ein Sparplan?“)

### Was die KI berücksichtigt

| Aktien | ETFs | Krypto |
|---|---|---|
| Geschäftsmodell, Burggraben, Wettbewerb | Index, Replikation, TER, Tracking Difference | Use Case, Technologie, Konkurrenz |
| Wachstum, Margen, Guidance, Quartalszahlen | Fondsvolumen, Liquidität, Ausschüttung, Domizil/Steuern | Tokenomics: Angebot, Inflation, Unlocks, Staking |
| Bewertung (KGV, PEG, KUV, KBV, EV/EBITDA) | Top-Positionen, Klumpenrisiko, Sektoren/Länder | Marktkapitalisierung, BTC-Dominanz, Allzeithoch |
| Bilanz, Free Cashflow, Dividende | Index-Bewertung, Währungsrisiko, Mittelflüsse | On-Chain-Daten, ETF-Flows, Funding Rates |
| Analysten, Insider, Short-Interest | Alternativen | Regulierung (MiCA, SEC), Halving-Zyklen, Hacks |
| Regulierung, Klagen, Zölle, Geopolitik | | Fear & Greed Index, Entwicklungsaktivität |

Bei allen drei kommen Makro (Zinsen, Inflation, Dollar, Konjunktur), Sentiment und Nachrichten, technische Analyse sowie relative Stärke bzw. Korrelation gegenüber einer Benchmark (S&P 500, Bitcoin bzw. Nasdaq) dazu.

## Schnellstart

Voraussetzung: **Node.js 20.12 oder neuer** und ein API-Schlüssel von <https://console.anthropic.com>.

```bash
cd examples/finanz-ki-analyse
npm install
cp .env.example .env      # ANTHROPIC_API_KEY eintragen
npm start
```

Dann <http://127.0.0.1:3000> öffnen. Kurse funktionieren auch ohne API-Schlüssel, nur die KI-Analyse braucht ihn.

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Pflicht für die KI-Analyse |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude-Modell |
| `ANALYSIS_EFFORT` | `high` | Gründlichkeit: `low`, `medium`, `high`, `xhigh`, `max` |
| `MAX_WEB_SEARCHES` | `8` | Max. Websuchen pro Analyse |
| `COINGECKO_API_KEY` | – | Optionaler kostenloser Demo-Key für höheres Rate-Limit |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Server-Adresse |
| `MAX_PARALLEL_ANALYSES` | `2` | Gleichzeitige Analysen |

**Kosten:** Jede Analyse ist ein Claude-Aufruf mit Websuche, typischerweise einige Cent bis wenige zehn Cent, je nach Effort und Anzahl der Suchen. Token- und Suchverbrauch stehen unter jeder Analyse.

## Aufbau

```
server.js            HTTP-Server (ohne Framework), API + statische Dateien
src/market.js        Datenquellen: Yahoo Finance, CoinGecko, alternative.me
src/indicators.js    Technische Indikatoren (reine Funktionen)
src/analysis.js      Claude-Aufruf: Prompt, Websuche, Streaming, pause_turn, Fallback
public/              Frontend (HTML/CSS/JS, kein Build-Schritt)
test/                Unit- und End-to-End-Tests mit simulierten APIs
```

API-Endpunkte: `/api/search?q=`, `/api/quote?symbol=&range=`, `/api/live?symbols=A,B,C`, `/api/macro/live`, `/api/news?q=`, `/api/macro`, `/api/analyze?symbol=&focus=` (Server-Sent Events), `/api/health`.

```bash
npm test
```

## Hinweise

- Datenquellen sind inoffiziell bzw. kostenlos. „Live“ heißt: so aktuell, wie Yahoo die Kurse liefert. Das ist für viele Börsen in Echtzeit, für manche (z. B. Xetra) bis zu 15 Minuten verzögert. Krypto läuft rund um die Uhr. Einzelne Quellen (z. B. Fundamentaldaten von Yahoo) fallen manchmal aus. Die KI ergänzt fehlende Daten dann per Websuche.
- Der Server lauscht standardmäßig nur auf `127.0.0.1`. Wer ihn öffentlich betreibt, sollte Authentifizierung und Rate-Limits davorschalten, weil jede Analyse API-Kosten verursacht.
- **Keine Anlageberatung.** Die KI kann sich irren. Alle Angaben ohne Gewähr.
