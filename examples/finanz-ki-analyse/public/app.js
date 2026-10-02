// Frontend der Finanz-KI-Analyse (ohne Build-Schritt).

const $ = (id) => document.getElementById(id);

const QUICKPICKS = {
  Aktien: [
    ['AAPL', 'Apple'],
    ['MSFT', 'Microsoft'],
    ['NVDA', 'Nvidia'],
    ['AMZN', 'Amazon'],
    ['SAP.DE', 'SAP'],
    ['SIE.DE', 'Siemens'],
    ['ALV.DE', 'Allianz'],
    ['ASML.AS', 'ASML'],
  ],
  ETFs: [
    ['EUNL.DE', 'MSCI World'],
    ['VWCE.DE', 'FTSE All-World'],
    ['SXR8.DE', 'S&P 500'],
    ['EXS1.DE', 'DAX'],
    ['IS3N.DE', 'EM IMI'],
    ['QQQ', 'Nasdaq 100'],
  ],
  Krypto: [
    ['BTC-EUR', 'Bitcoin'],
    ['ETH-EUR', 'Ethereum'],
    ['SOL-EUR', 'Solana'],
    ['XRP-EUR', 'XRP'],
    ['ADA-EUR', 'Cardano'],
  ],
};

const TYPE_LABEL = { aktie: 'Aktie', etf: 'ETF / Fonds', krypto: 'Kryptowährung', sonstiges: 'Sonstiges' };

// ---- Formatierung -----------------------------------------------------------

const nf = (d = 2) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtPrice(v, currency) {
  if (v == null) return '–';
  const digits = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 8;
  try {
    return new Intl.NumberFormat('de-DE', {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  } catch {
    return `${nf(digits).format(v)} ${currency || ''}`;
  }
}
const fmtPct = (v, d = 2) => (v == null ? '–' : `${v > 0 ? '+' : ''}${nf(d).format(v * 100)} %`);
const cls = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
const fmtBig = (v) =>
  v == null ? '–' : new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
  return body;
}

// ---- Zustand ----------------------------------------------------------------

const state = { symbol: null, range: '1y', quote: null, analysis: null };

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // privater Modus o. Ä. – dann eben ohne Speicherung
    }
  },
};

// ---- Suche ------------------------------------------------------------------

let searchTimer;
let activeSuggestion = -1;
const searchInput = $('search');
const suggestions = $('suggestions');

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) return (suggestions.hidden = true);
  searchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
      renderSuggestions(results, q);
    } catch {
      renderSuggestions([], q);
    }
  }, 250);
});

function renderSuggestions(results, q) {
  activeSuggestion = -1;
  const direct = /^[A-Za-z0-9.\-^=]{1,24}$/.test(q) ? [{ symbol: q.toUpperCase(), name: 'Symbol direkt öffnen', typ: '' }] : [];
  const items = [...results, ...direct.filter((d) => !results.some((r) => r.symbol === d.symbol))];
  suggestions.innerHTML = items
    .map(
      (r, i) =>
        `<li data-i="${i}" data-symbol="${esc(r.symbol)}"><span><strong>${esc(r.symbol)}</strong> ${esc(r.name)}</span><span class="muted small">${esc(TYPE_LABEL[r.typ] || '')} ${esc(r.boerse || '')}</span></li>`,
    )
    .join('');
  suggestions.hidden = items.length === 0;
}

suggestions.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) pick(li.dataset.symbol);
});
searchInput.addEventListener('keydown', (e) => {
  const items = [...suggestions.querySelectorAll('li')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeSuggestion = (activeSuggestion + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle('active', i === activeSuggestion));
  } else if (e.key === 'Enter') {
    const li = items[activeSuggestion] || items[0];
    if (li) pick(li.dataset.symbol);
  } else if (e.key === 'Escape') {
    suggestions.hidden = true;
  }
});
searchInput.addEventListener('blur', () => setTimeout(() => (suggestions.hidden = true), 150));

function pick(symbol) {
  suggestions.hidden = true;
  searchInput.value = '';
  location.hash = encodeURIComponent(symbol);
}

// ---- Schnellauswahl & Watchlist --------------------------------------------

$('quickpicks').innerHTML = Object.entries(QUICKPICKS)
  .map(
    ([group, items]) =>
      `<div class="chip-label">${group}</div>` +
      items.map(([s, n]) => `<button class="chip" data-symbol="${s}" title="${s}">${n}</button>`).join(''),
  )
  .join('');
$('quickpicks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-symbol]');
  if (b) pick(b.dataset.symbol);
});

const getWatchlist = () => store.get('watchlist', []);
function toggleWatch() {
  if (!state.quote) return;
  let list = getWatchlist();
  const { symbol, name } = state.quote;
  list = list.some((w) => w.symbol === symbol) ? list.filter((w) => w.symbol !== symbol) : [...list, { symbol, name }];
  store.set('watchlist', list);
  renderWatchlist();
  updateStar();
}
$('star').addEventListener('click', toggleWatch);
function updateStar() {
  const on = getWatchlist().some((w) => w.symbol === state.symbol);
  $('star').textContent = on ? '★' : '☆';
  $('star').title = on ? 'Von der Watchlist entfernen' : 'Zur Watchlist hinzufügen';
}

async function renderWatchlist() {
  const list = getWatchlist();
  $('watchlist-empty').hidden = list.length > 0;
  $('watchlist').innerHTML = list
    .map(
      (w) =>
        `<li data-symbol="${esc(w.symbol)}"><span><span class="sym">${esc(w.symbol)}</span><br><span class="muted small">${esc(w.name)}</span></span><span class="small" data-price>…</span></li>`,
    )
    .join('');
  await Promise.all(
    list.map(async (w) => {
      const el = $('watchlist').querySelector(`[data-symbol="${CSS.escape(w.symbol)}"] [data-price]`);
      try {
        const q = await api(`/api/quote?symbol=${encodeURIComponent(w.symbol)}&range=1mo`);
        el.innerHTML = `${fmtPrice(q.kurs, q.waehrung)}<br><span class="${cls(q.veraenderungTag)}">${fmtPct(q.veraenderungTag)}</span>`;
      } catch {
        el.textContent = '–';
      }
    }),
  );
}
$('watchlist').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) pick(li.dataset.symbol);
});

// ---- Makro-Leiste -----------------------------------------------------------

async function renderMacro() {
  try {
    const rows = await api('/api/macro');
    $('macro').innerHTML = rows
      .map(
        (r) =>
          `<span title="${esc(r.name)} – Veränderung 1 Monat"><b>${esc(r.name.replace(/ \(.*\)/, ''))}</b>${nf(2).format(r.wert)} <span class="${cls(r.veraenderung1M)}">${fmtPct(r.veraenderung1M, 1)}</span></span>`,
      )
      .join('');
  } catch {
    $('macro').hidden = true;
  }
}

// ---- Chart ------------------------------------------------------------------

let chart;
let series = {};
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ensureChart() {
  if (chart) return;
  const el = $('chart');
  chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: cssVar('--muted'), fontFamily: 'inherit' },
    grid: { vertLines: { color: cssVar('--border') }, horzLines: { color: cssVar('--border') } },
    rightPriceScale: { borderColor: cssVar('--border') },
    timeScale: { borderColor: cssVar('--border') },
    localization: { locale: 'de-DE' },
  });
  series.candles = chart.addCandlestickSeries({
    upColor: cssVar('--up'),
    downColor: cssVar('--down'),
    borderVisible: false,
    wickUpColor: cssVar('--up'),
    wickDownColor: cssVar('--down'),
  });
  series.sma50 = chart.addLineSeries({ color: cssVar('--sma50'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
  series.sma200 = chart.addLineSeries({ color: cssVar('--sma200'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
  series.volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
}

function smaSeries(candles, period) {
  const out = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: c.time, value: sum / period });
  });
  return out;
}

function renderChart(candles) {
  if (!window.LightweightCharts) {
    $('chart').innerHTML = '<p class="muted">Chart-Bibliothek konnte nicht geladen werden (Internetverbindung/CDN prüfen).</p>';
    return;
  }
  ensureChart();
  // Zeitstempel streng aufsteigend und eindeutig (Anforderung der Chart-Bibliothek)
  const clean = [];
  for (const c of candles) {
    if (clean.length && c.time <= clean.at(-1).time) continue;
    clean.push(c);
  }
  series.candles.setData(clean.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  series.sma50.setData(smaSeries(clean, 50));
  series.sma200.setData(smaSeries(clean, 200));
  const up = cssVar('--up');
  const down = cssVar('--down');
  series.volume.setData(
    clean.map((c, i) => ({
      time: c.time,
      value: c.volume || 0,
      color: `${c.close >= (clean[i - 1]?.close ?? c.open) ? up : down}55`,
    })),
  );
  chart.timeScale().fitContent();
}

$('ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]');
  if (!b || !state.symbol) return;
  state.range = b.dataset.range;
  [...$('ranges').children].forEach((x) => x.classList.toggle('active', x === b));
  loadQuote(state.symbol, { keepAnalysis: true });
});

// ---- Asset-Ansicht ----------------------------------------------------------

function metric(label, value, klass = '') {
  return `<div class="metric"><div class="label">${label}</div><div class="value ${klass}">${value}</div></div>`;
}

function renderQuote(q) {
  const k = q.kennzahlen || {};
  $('welcome').hidden = true;
  $('asset').hidden = false;
  $('asset-name').textContent = q.name;
  $('asset-symbol').textContent = q.symbol;
  $('asset-type').textContent = TYPE_LABEL[q.typ] || q.instrumentType;
  $('asset-exchange').textContent = `${q.boerse || ''} · ${q.waehrung || ''}`;
  $('asset-price').textContent = fmtPrice(q.kurs, q.waehrung);
  $('asset-change').innerHTML = `<span class="${cls(q.veraenderungTag)}">${fmtPct(q.veraenderungTag)} heute</span>`;
  $('asset-time').textContent = q.zeitpunkt ? `Stand: ${new Date(q.zeitpunkt).toLocaleString('de-DE')}` : '';
  document.title = `${q.symbol} – Finanz-KI-Analyse`;
  updateStar();

  renderChart(q.candles);

  const rsiCls = k.rsi14 > 70 ? 'down' : k.rsi14 < 30 ? 'up' : '';
  const rsiHint = k.rsi14 > 70 ? ' (überkauft)' : k.rsi14 < 30 ? ' (überverkauft)' : '';
  $('metrics').innerHTML = [
    metric('Trend', k.trend ?? '–', k.trend === 'Aufwärtstrend' ? 'up' : k.trend === 'Abwärtstrend' ? 'down' : ''),
    metric('RSI (14)', k.rsi14 != null ? nf(1).format(k.rsi14) + rsiHint : '–', rsiCls),
    metric('MACD-Histogramm', k.macd?.histogramm != null ? nf(3).format(k.macd.histogramm) : '–', cls(k.macd?.histogramm)),
    metric('Abstand SMA 200', fmtPct(k.gleitendeDurchschnitte?.abstandSma200), cls(k.gleitendeDurchschnitte?.abstandSma200)),
    metric('Volatilität p. a.', fmtPct(k.volatilitaetAnnualisiert, 1)),
    metric('Max. Drawdown 1J', fmtPct(k.maxDrawdown1J, 1), 'down'),
    metric('52W-Hoch', `${fmtPrice(k.hoch52W)} <span class="small muted">${fmtPct(k.abstandZumHoch, 1)}</span>`),
    metric('52W-Tief', `${fmtPrice(k.tief52W)} <span class="small muted">${fmtPct(k.abstandZumTief, 1)}</span>`),
    metric('ATR (14)', k.atrProzent != null ? `${fmtPrice(k.atr14)} (${fmtPct(k.atrProzent, 1).replace('+', '')})` : '–'),
    metric('Bollinger-Position', k.bollinger?.positionProzent != null ? `${nf(0).format(k.bollinger.positionProzent * 100)} %` : '–'),
    metric('Volumen 20T / 90T', k.volumen?.verhaeltnis != null ? `${nf(2).format(k.volumen.verhaeltnis)}×` : '–'),
    k.kreuzungLetzte20Tage ? metric('Signal', k.kreuzungLetzte20Tage, k.kreuzungLetzte20Tage === 'Golden Cross' ? 'up' : 'down') : '',
  ].join('');

  $('performance').innerHTML = Object.entries(k.performance || {})
    .map(([label, v]) => `<div><span class="label">${label}</span><span class="${cls(v)}">${fmtPct(v, 1)}</span></div>`)
    .join('');
  $('levels').innerHTML = `
    <div>Unterstützungen: ${(k.supports || []).map((v) => fmtPrice(v)).join(' · ') || '–'}</div>
    <div>Widerstände: ${(k.resistances || []).map((v) => fmtPrice(v)).join(' · ') || '–'}</div>
    <div class="muted">Basierend auf lokalen Hochs/Tiefs der letzten 6 Monate.</div>`;
}

async function loadNews(q) {
  const query = q.typ === 'krypto' ? q.name.replace(/\s+[A-Z]{3}$/, '') : /\.[A-Z]{1,3}$/.test(q.symbol) ? q.name : q.symbol;
  try {
    const news = await api(`/api/news?q=${encodeURIComponent(query)}`);
    $('news').innerHTML =
      news
        .map(
          (n) =>
            `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.titel)}</a><div class="muted small">${esc(n.quelle || '')} · ${esc(n.datum || '')}</div></li>`,
        )
        .join('') || '<li class="muted">Keine Schlagzeilen gefunden.</li>';
  } catch {
    $('news').innerHTML = '<li class="muted">Schlagzeilen konnten nicht geladen werden.</li>';
  }
}

async function loadQuote(symbol, { keepAnalysis = false } = {}) {
  try {
    const q = await api(`/api/quote?symbol=${encodeURIComponent(symbol)}&range=${state.range}`);
    if (symbol !== state.symbol) return; // inzwischen anderer Wert gewählt
    state.quote = q;
    renderQuote(q);
    if (!keepAnalysis) loadNews(q);
  } catch (err) {
    $('welcome').hidden = false;
    $('asset').hidden = true;
    $('welcome').innerHTML = `<h2>Nicht gefunden</h2><p>${esc(err.message)}</p><p class="muted">Tipp: Deutsche Börsenwerte haben die Endung <code>.DE</code> (z. B. SAP.DE), Kryptowährungen z. B. <code>BTC-EUR</code>.</p>`;
  }
}

function openSymbol(symbol) {
  if (!symbol || symbol === state.symbol) return;
  state.symbol = symbol;
  resetAnalysis();
  loadQuote(symbol);
}

window.addEventListener('hashchange', () => openSymbol(decodeURIComponent(location.hash.slice(1)).toUpperCase()));

// ---- KI-Analyse -------------------------------------------------------------

function resetAnalysis() {
  state.analysis?.controller.abort();
  state.analysis = null;
  $('analyze').disabled = false;
  $('analyze').textContent = 'KI-Analyse starten';
  for (const id of ['ai-progress', 'ai-error', 'ai-score', 'ai-thinking-box', 'ai-sources-box', 'ai-data-box']) $(id).hidden = true;
  $('ai-report').innerHTML = '';
  $('ai-report').classList.remove('streaming');
  $('ai-searches').innerHTML = '';
  $('ai-sources').innerHTML = '';
  $('ai-thinking').textContent = '';
  $('ai-meta').textContent = '';
}

// Den abschließenden JSON-Block vom Fließtext trennen.
function splitReport(text) {
  const idx = text.lastIndexOf('```json');
  if (idx < 0) return { markdown: text, json: null };
  const rest = text.slice(idx + 7);
  const end = rest.indexOf('```');
  let json = null;
  if (end >= 0) {
    try {
      json = JSON.parse(rest.slice(0, end));
    } catch {
      json = null;
    }
  }
  return { markdown: text.slice(0, idx), json };
}

let renderPending = false;
function scheduleReportRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    if (!state.analysis) return;
    const { markdown } = splitReport(state.analysis.text);
    $('ai-report').innerHTML =
      window.marked && window.DOMPurify
        ? DOMPurify.sanitize(marked.parse(markdown))
        : `<pre style="white-space:pre-wrap">${esc(markdown)}</pre>`;
    $('ai-report').querySelectorAll('a').forEach((a) => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
  });
}

function gaugeSvg(score) {
  const s = Math.max(-100, Math.min(100, Number(score) || 0));
  const angle = Math.PI * (1 - (s + 100) / 200); // 180° (links) … 0° (rechts)
  const x = 80 + 62 * Math.cos(angle);
  const y = 85 - 62 * Math.sin(angle);
  const color = s > 15 ? cssVar('--up') : s < -15 ? cssVar('--down') : cssVar('--warn');
  return `<svg viewBox="0 0 160 95" aria-hidden="true">
    <path d="M18 85 A62 62 0 0 1 142 85" fill="none" stroke="${cssVar('--border')}" stroke-width="12" stroke-linecap="round"/>
    <path d="M18 85 A62 62 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${color}"/>
  </svg>`;
}

const tone = (v) => (/positiv/.test(v) ? 'positiv' : /negativ/.test(v) ? 'negativ' : '');

function renderScore(j) {
  if (!j || typeof j !== 'object') return;
  const score = Number(j.gesamtscore);
  const horizons = j.zeithorizonte || {};
  const factors = Array.isArray(j.faktoren) ? [...j.faktoren].sort((a, b) => (b.gewicht || 0) - (a.gewicht || 0)) : [];
  const scenarios = Array.isArray(j.szenarien) ? j.szenarien : [];
  const currency = state.quote?.waehrung;
  $('ai-score').innerHTML = `
    <div class="gauge">
      ${gaugeSvg(score)}
      <div class="num ${cls(score)}">${Number.isFinite(score) ? (score > 0 ? '+' : '') + score : '–'}</div>
      <div class="label">${esc(j.einschaetzung || '')}</div>
      <div class="muted small">Score von −100 bis +100</div>
    </div>
    <div>
      <div class="pills">
        <span class="pill">Risiko: ${esc(j.risiko || '–')}</span>
        ${[['kurzfristig', 'Kurzfristig'], ['mittelfristig', 'Mittelfristig'], ['langfristig', 'Langfristig']]
          .map(([key, label]) => `<span class="pill ${tone(horizons[key] || '')}">${label}: ${esc(horizons[key] || '–')}</span>`)
          .join('')}
        ${scenarios
          .map(
            (s) =>
              `<span class="pill">${esc(s.name)}: ${s.wahrscheinlichkeit != null ? nf(0).format(s.wahrscheinlichkeit * 100) + ' %' : '–'}${s.kursziel != null ? ' · ' + fmtPrice(Number(s.kursziel), currency) : ''}</span>`,
          )
          .join('')}
      </div>
      <div class="factors">
        ${factors
          .map((f) => {
            const b = Math.max(-2, Math.min(2, Number(f.bewertung) || 0));
            const width = (Math.abs(b) / 2) * 50;
            const left = b >= 0 ? 50 : 50 - width;
            const color = b > 0 ? cssVar('--up') : b < 0 ? cssVar('--down') : cssVar('--muted');
            return `<div class="factor" title="${esc(f.begruendung || '')}">
              <span>${esc(f.name)}</span>
              <span class="bar"><span class="fill" style="left:${left}%;width:${Math.max(width, 1)}%;background:${color}"></span></span>
              <span class="w">G${esc(f.gewicht ?? '')}</span>
            </div>`;
          })
          .join('')}
      </div>
      <p class="muted small">Balken: Einfluss des Faktors (−2 bis +2). G = Gewichtung (1–5). Für Begründung Maus über den Faktor halten.</p>
    </div>`;
  $('ai-score').hidden = false;
}

function handleEvent(event, data) {
  const a = state.analysis;
  switch (event) {
    case 'status':
      $('ai-status').textContent = data.text;
      break;
    case 'context':
      $('ai-data').textContent = JSON.stringify(data, null, 2);
      $('ai-data-box').hidden = false;
      break;
    case 'search':
      $('ai-searches').insertAdjacentHTML('beforeend', `<li>🔎 ${esc(data.query)}</li>`);
      break;
    case 'sources':
      for (const s of data) {
        $('ai-sources').insertAdjacentHTML(
          'beforeend',
          `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>${s.alter ? ` <span class="muted">(${esc(s.alter)})</span>` : ''}</li>`,
        );
      }
      $('ai-sources-box').hidden = false;
      break;
    case 'thinking':
      $('ai-thinking').textContent += data.text;
      $('ai-thinking-box').hidden = false;
      break;
    case 'text':
      if (!a.text) $('ai-status').textContent = 'KI schreibt die Analyse …';
      a.text += data.text;
      scheduleReportRender();
      break;
    case 'done': {
      const u = data.usage || {};
      $('ai-meta').textContent = `Modell: ${data.model} · ${fmtBig(u.input_tokens)} Eingabe- / ${fmtBig(u.output_tokens)} Ausgabe-Tokens · ${u.web_searches ?? 0} Websuchen · ${new Date().toLocaleString('de-DE')}`;
      break;
    }
    case 'error':
      $('ai-error').textContent = data.message;
      $('ai-error').hidden = false;
      break;
  }
}

async function startAnalysis() {
  if (!state.symbol) return;
  resetAnalysis();
  const controller = new AbortController();
  const analysis = { controller, text: '' };
  state.analysis = analysis;
  $('analyze').disabled = true;
  $('analyze').textContent = 'Analysiere …';
  $('ai-progress').hidden = false;
  $('ai-status').textContent = 'Starte …';
  $('ai-report').classList.add('streaming');

  const focus = $('focus').value.trim();
  try {
    const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(state.symbol)}&focus=${encodeURIComponent(focus)}`, {
      signal: controller.signal,
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Fehler ${res.status}`);
    }
    // Server-Sent Events manuell lesen (EventSource liefert keine Fehlertexte).
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        let data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data && state.analysis === analysis) handleEvent(event, JSON.parse(data));
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError' && state.analysis === analysis) handleEvent('error', { message: err.message });
  } finally {
    if (state.analysis === analysis) {
      $('analyze').disabled = false;
      $('analyze').textContent = 'Erneut analysieren';
      $('ai-progress').hidden = true;
      $('ai-report').classList.remove('streaming');
      scheduleReportRender();
      const { json } = splitReport(analysis.text);
      renderScore(json);
    }
  }
}

$('analyze').addEventListener('click', startAnalysis);
$('focus').addEventListener('keydown', (e) => e.key === 'Enter' && startAnalysis());

// ---- Start ------------------------------------------------------------------

renderMacro();
renderWatchlist();
if (location.hash.length > 1) openSymbol(decodeURIComponent(location.hash.slice(1)).toUpperCase());
api('/api/health')
  .then((h) => {
    if (!h.ki) {
      $('analyze').title = 'Auf dem Server ist kein ANTHROPIC_API_KEY gesetzt.';
    }
  })
  .catch(() => {});
