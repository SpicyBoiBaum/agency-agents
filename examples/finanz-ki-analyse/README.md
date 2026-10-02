# 📈 Finanz-KI-Analyse

Web-App, die **Kurse von Aktien, ETFs und Kryptowährungen** anzeigt und per Klick eine **KI-Analyse mit Claude** erstellt. Die Analyse bezieht alle wesentlichen Kurstreiber ein und recherchiert dafür live im Web.

## Funktionen

- **Suche** nach Name, Ticker oder ISIN-nahen Begriffen (z. B. „Apple“, „MSCI World“, „Bitcoin“, `SAP.DE`, `BTC-EUR`)
- **Live-Kurse**: Kurs, Tagesveränderung, letzte Chart-Kerze, Watchlist und Makro-Leiste aktualisieren sich automatisch (alle 15 s, Makro jede Minute). Kursänderungen blinken grün/rot, und eine Anzeige zeigt „● Live“ oder „Börse geschlossen“. Im Hintergrund-Tab pausiert die Aktualisierung.
- **Kursalarme mit Push**: Über 🔔 am Wert einen Alarm setzen („steigt über“ / „fällt unter“ einen Preis, optional mit Notiz). Schnellwahl für ±5 %, ±10 %, 52W-Hoch/-Tief und SMA 200. Der **Server** prüft die Alarme etwa jede Minute, auch wenn die App geschlossen ist, und schickt eine **Push-Benachrichtigung** aufs Handy oder den Computer. Aktive Alarme erscheinen als gestrichelte Linie im Chart und in der Seitenleiste. Ein Alarm löst einmal aus und lässt sich mit ↻ wieder scharf schalten.
- **Installierbar als Handy-App (PWA)**: „Zum Home-Bildschirm hinzufügen“ bzw. „Installieren“, mit eigenem Icon und Vollbild
- **Passwortschutz** für den Betrieb im Internet
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

## Auf dem Handy und unterwegs nutzen (online stellen)

Damit die App überall läuft und Kursalarme per Push ankommen, muss sie auf einem Server im Internet laufen. Am einfachsten geht das mit **[Railway](https://railway.com)**: Es baut die App direkt aus GitHub, liefert automatisch HTTPS und bietet dauerhaften Speicher für die Alarme. Das kostet nach der Testphase etwa 5 $ im Monat.

1. **Konto anlegen** auf railway.com und mit GitHub anmelden.
2. **New Project → Deploy from GitHub repo** und dieses Repository auswählen.
3. Im Dienst unter **Settings → Root Directory** `examples/finanz-ki-analyse` eintragen. Railway erkennt dann das `Dockerfile` automatisch.
4. Unter **Variables** eintragen:
   - `ANTHROPIC_API_KEY` = dein API-Schlüssel
   - `APP_PASSWORD` = ein langes Passwort, mit dem du dich in der App anmeldest
   - optional `VAPID_SUBJECT` = `mailto:deine@email.de`
5. **Volume hinzufügen** (Rechtsklick auf den Dienst bzw. „+ New → Volume“) mit dem Mount-Pfad **`/data`**. Dort liegen Alarme, Push-Abos und Schlüssel. Ohne Volume gehen sie bei jedem Neustart verloren.
6. Unter **Settings → Networking → Generate Domain** eine Adresse erzeugen, z. B. `https://finanz-ki-production.up.railway.app`.
7. Die Adresse auf dem Handy öffnen und mit dem Passwort anmelden.

**Als App installieren:**
- **iPhone/iPad (Safari):** Teilen-Symbol → **„Zum Home-Bildschirm“**. Öffne die App danach über das neue Icon. Erst dort lassen sich Push-Benachrichtigungen aktivieren (ab iOS 16.4).
- **Android (Chrome):** Menü ⋮ → **„App installieren“** oder den Knopf „📲 Installieren“ oben in der App.

**Push aktivieren:** In der Seitenleiste unter „Kursalarme“ (auf dem Handy ganz unten) auf **„📲 Push-Benachrichtigungen aktivieren“** tippen und erlauben. Mit „Test senden“ prüfst du, ob es ankommt. Das musst du auf jedem Gerät einmal machen.

**Andere Anbieter:** Das `Dockerfile` läuft auch bei Fly.io, Render oder auf einem eigenen Server. Wichtig sind immer drei Dinge: `APP_PASSWORD` setzen, einen dauerhaften Speicher unter `/data` einhängen und den Dienst durchgehend laufen lassen. Kostenlose Tarife, die nach Inaktivität „einschlafen“ (z. B. Render Free), prüfen in der Zeit keine Alarme.

**Ohne dauerhaften Speicher** (nicht empfohlen): Erzeuge mit `npm run vapid` feste Push-Schlüssel und trage sie als `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` ein. Dann bleiben zumindest die Push-Abos gültig. Alarme gehen bei einem Neustart trotzdem verloren.

### Im Heim-WLAN (ohne Hosting)

In der `.env` `HOST=0.0.0.0` und `APP_PASSWORD=…` setzen, neu starten und auf dem Handy `http://<IP-des-Computers>:3000` öffnen. Ohne HTTPS gibt es dort aber keine Push-Benachrichtigungen, und der Computer muss laufen.

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Pflicht für die KI-Analyse |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude-Modell |
| `ANALYSIS_EFFORT` | `high` | Gründlichkeit: `low`, `medium`, `high`, `xhigh`, `max` |
| `MAX_WEB_SEARCHES` | `8` | Max. Websuchen pro Analyse |
| `COINGECKO_API_KEY` | – | Optionaler kostenloser Demo-Key für höheres Rate-Limit |
| `APP_PASSWORD` | – | Passwort für die Anmeldung. **Pflicht**, sobald `HOST` nicht `127.0.0.1` ist (sonst startet der Server nicht) |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Server-Adresse |
| `DATA_DIR` | `./data` | Speicherort für Alarme, Push-Abos und Schlüssel |
| `ALERT_CHECK_INTERVAL` | `60` | Sekunden zwischen den Alarm-Prüfungen |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | automatisch | Schlüssel für Push (sonst einmalig erzeugt und in `DATA_DIR` gespeichert) |
| `VAPID_SUBJECT` | `mailto:finanz-ki@example.com` | Kontaktadresse für Push-Dienste (am besten die eigene E-Mail) |
| `TRUST_PROXY` | – | `1` hinter einem Hosting-Proxy (im Dockerfile gesetzt) |
| `MAX_PARALLEL_ANALYSES` | `2` | Gleichzeitige Analysen |

**Kosten:** Jede Analyse ist ein Claude-Aufruf mit Websuche, typischerweise einige Cent bis wenige zehn Cent, je nach Effort und Anzahl der Suchen. Token- und Suchverbrauch stehen unter jeder Analyse.

## Aufbau

```
server.js            Start, Sicherheitsprüfung, Alarm-Überwachung
src/app.js           HTTP-Server (ohne Framework): Routing, Login, API, statische Dateien
src/auth.js          Passwortschutz (signiertes Sitzungs-Cookie, Sperre bei Fehlversuchen)
src/alerts.js        Logik der Kursalarme
src/alert-monitor.js Prüft Alarme regelmäßig auf dem Server und verschickt Push
src/push.js          Web-Push (VAPID) und Verwaltung der Abos
src/store.js         Dauerhafter Speicher als JSON-Datei in DATA_DIR
src/market.js        Datenquellen: Yahoo Finance, CoinGecko, alternative.me
src/indicators.js    Technische Indikatoren (reine Funktionen)
src/analysis.js      Claude-Aufruf: Prompt, Websuche, Streaming, pause_turn, Fallback
public/              Frontend (HTML/CSS/JS, kein Build-Schritt), Service Worker, Manifest, Icons
Dockerfile           Container für das Hosting
test/                Unit- und End-to-End-Tests mit simulierten APIs
```

API-Endpunkte: `/api/search?q=`, `/api/quote?symbol=&range=`, `/api/live?symbols=A,B,C`, `/api/macro/live`, `/api/news?q=`, `/api/macro`, `/api/analyze?symbol=&focus=` (Server-Sent Events), `/api/alerts` (GET/POST), `/api/alerts/:id` (DELETE), `/api/alerts/:id/rearm` (POST), `/api/push/key`, `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test`, `/api/health`.

```bash
npm test
```

## Hinweise

- Datenquellen sind inoffiziell bzw. kostenlos. „Live“ heißt: so aktuell, wie Yahoo die Kurse liefert. Das ist für viele Börsen in Echtzeit, für manche (z. B. Xetra) bis zu 15 Minuten verzögert. Krypto läuft rund um die Uhr. Einzelne Quellen (z. B. Fundamentaldaten von Yahoo) fallen manchmal aus. Die KI ergänzt fehlende Daten dann per Websuche.
- Kursalarme prüft der Server, solange er läuft. Lokal heißt das: nur solange `npm start` läuft. Online: rund um die Uhr. Alarme aus älteren Versionen (im Browser gespeichert) werden beim ersten Öffnen automatisch übernommen.
- Die App ist für **eine Person** gedacht: Ein Passwort, gemeinsame Alarme und Watchlist pro Browser. Der Server lauscht standardmäßig nur auf `127.0.0.1`. Ist er von außen erreichbar, verlangt er ein `APP_PASSWORD`, weil jede Analyse API-Kosten verursacht.
- **Keine Anlageberatung.** Die KI kann sich irren. Alle Angaben ohne Gewähr.
