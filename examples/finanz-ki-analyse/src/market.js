// Marktdaten aus frei zugänglichen Quellen:
//   - Yahoo Finance: Kurse (Aktien, ETFs, Krypto, Indizes, Devisen, Rohstoffe),
//     Suche, Schlagzeilen und – soweit verfügbar – Fundamentaldaten
//   - CoinGecko: Tokenomics und Marktdaten für Kryptowährungen
//   - alternative.me: Crypto Fear & Greed Index
// Jede Quelle ist "best effort": fällt eine aus, läuft die App mit den
// übrigen Daten weiter und die KI recherchiert Fehlendes per Websuche.

import { summarize, relativeStrength, correlation } from './indicators.js';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const YF1 = 'https://query1.finance.yahoo.com';
const YF2 = 'https://query2.finance.yahoo.com';
const CG = 'https://api.coingecko.com/api/v3';

export const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,24}$/;

// ---- kleiner In-Memory-Cache ------------------------------------------------

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

// Für Tests: zwischengespeicherte Antworten verwerfen.
export function clearMarketCache() {
  cache.clear();
}

async function getJson(url, { headers = {}, timeoutMs = 12000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} für ${new URL(url).host}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const settle = async (p) => {
  try {
    return await p;
  } catch (e) {
    console.warn('[market]', e.message);
    return null;
  }
};

// ---- Asset-Typ --------------------------------------------------------------

export function assetType(instrumentType) {
  switch (instrumentType) {
    case 'EQUITY':
      return 'aktie';
    case 'ETF':
    case 'MUTUALFUND':
      return 'etf';
    case 'CRYPTOCURRENCY':
      return 'krypto';
    default:
      return 'sonstiges';
  }
}

// ---- Yahoo Finance ----------------------------------------------------------

export async function getChart(symbol, range = '2y', interval = '1d') {
  // Intraday-Abfragen (Live-Kurse) nur kurz cachen, Historie länger.
  const ttl = range === '1d' ? 10_000 : 60_000;
  return cached(`chart:${symbol}:${range}:${interval}`, ttl, async () => {
    const url = `${YF1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
    let data;
    try {
      data = await getJson(url);
    } catch (e) {
      if (e.status === 404) throw Object.assign(new Error(`Symbol "${symbol}" nicht gefunden`), { status: 404 });
      throw e;
    }
    const result = data?.chart?.result?.[0];
    if (!result) {
      throw Object.assign(new Error(data?.chart?.error?.description || `Keine Kursdaten für "${symbol}"`), {
        status: 404,
      });
    }
    const q = result.indicators?.quote?.[0] || {};
    const candles = [];
    (result.timestamp || []).forEach((t, i) => {
      const c = q.close?.[i];
      if (c == null) return; // Feiertage / fehlende Werte überspringen
      candles.push({
        time: t,
        open: q.open?.[i] ?? c,
        high: q.high?.[i] ?? c,
        low: q.low?.[i] ?? c,
        close: c,
        volume: q.volume?.[i] ?? 0,
      });
    });
    const dividends = Object.values(result.events?.dividends || {})
      .sort((a, b) => a.date - b.date)
      .map((d) => ({ datum: new Date(d.date * 1000).toISOString().slice(0, 10), betrag: d.amount }));
    return { meta: result.meta, candles, dividends };
  });
}

export async function search(query) {
  return cached(`search:${query.toLowerCase()}`, 5 * 60_000, async () => {
    const url = `${YF1}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&lang=de-DE&region=DE`;
    const data = await getJson(url);
    return (data.quotes || [])
      .filter((q) => q.symbol && ['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND', 'INDEX'].includes(q.quoteType))
      .map((q) => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        typ: assetType(q.quoteType),
        quoteType: q.quoteType,
        boerse: q.exchDisp || q.exchange,
      }));
  });
}

export async function getNews(query, count = 12) {
  return cached(`news:${query.toLowerCase()}`, 10 * 60_000, async () => {
    const url = `${YF1}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}&lang=de-DE&region=DE`;
    const data = await getJson(url);
    return (data.news || []).map((n) => ({
      titel: n.title,
      quelle: n.publisher,
      link: n.link,
      datum: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10) : null,
    }));
  });
}

// Yahoo verlangt für quoteSummary ein Cookie + "Crumb". Wird einmal geholt
// und wiederverwendet; schlägt es fehl, gibt es eben keine Fundamentaldaten.
let crumbState = null;
async function getCrumb() {
  if (crumbState && crumbState.expires > Date.now()) return crumbState;
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  const setCookies = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Yahoo-Cookie nicht erhalten');
  const r2 = await fetch(`${YF2}/v1/test/getcrumb`, {
    headers: { 'User-Agent': UA, Cookie: cookie },
    signal: AbortSignal.timeout(10000),
  });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes('<')) throw new Error('Yahoo-Crumb nicht erhalten');
  crumbState = { cookie, crumb, expires: Date.now() + 30 * 60_000 };
  return crumbState;
}

// {raw: 1.23, fmt: "1.23"} -> 1.23 ; leere Objekte entfernen
function unwrap(v) {
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') {
    if ('raw' in v) return v.raw;
    if ('fmt' in v && Object.keys(v).length <= 2) return v.fmt ?? null;
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'maxAge') continue;
      const u = unwrap(val);
      if (u == null) continue;
      if (typeof u === 'object' && !Array.isArray(u) && Object.keys(u).length === 0) continue;
      out[k] = u;
    }
    return out;
  }
  return v;
}

const pick = (obj, keys) =>
  obj ? Object.fromEntries(keys.filter((k) => obj[k] != null).map((k) => [k, obj[k]])) : undefined;

export async function getFundamentals(symbol, typ) {
  const modules =
    typ === 'etf'
      ? ['summaryDetail', 'defaultKeyStatistics', 'fundProfile', 'topHoldings', 'assetProfile']
      : [
          'summaryDetail',
          'defaultKeyStatistics',
          'financialData',
          'assetProfile',
          'calendarEvents',
          'recommendationTrend',
          'earningsTrend',
          'majorHoldersBreakdown',
          'netSharePurchaseActivity',
        ];
  return cached(`fund:${symbol}`, 60 * 60_000, async () => {
    const { cookie, crumb } = await getCrumb();
    const url = `${YF2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}&crumb=${encodeURIComponent(crumb)}`;
    const data = await getJson(url, { headers: { Cookie: cookie } });
    const r = unwrap(data?.quoteSummary?.result?.[0]);
    if (!r) return null;

    const sd = r.summaryDetail || {};
    const ks = r.defaultKeyStatistics || {};
    const fd = r.financialData || {};
    const ap = r.assetProfile || {};

    if (typ === 'etf') {
      const th = r.topHoldings || {};
      const fp = r.fundProfile || {};
      return {
        fondsfamilie: fp.family,
        kategorie: fp.categoryName,
        laufendeKosten: fp.feesExpensesInvestment?.annualReportExpenseRatio ?? ks.annualReportExpenseRatio,
        fondsvolumen: sd.totalAssets ?? ks.totalAssets,
        ausschuettungsrendite: sd.yield,
        kgv: th.equityHoldings?.priceToEarnings,
        kbv: th.equityHoldings?.priceToBook,
        auflage: ks.fundInceptionDate,
        beta3J: ks.beta3Year,
        topPositionen: (th.holdings || []).slice(0, 10).map((h) => ({
          name: h.holdingName,
          symbol: h.symbol,
          anteil: h.holdingPercent,
        })),
        sektoren: (th.sectorWeightings || []).map((s) => Object.entries(s)[0]).filter(Boolean),
        anlageklassen: pick(th, ['stockPosition', 'bondPosition', 'cashPosition', 'otherPosition']),
        beschreibung: ap.longBusinessSummary?.slice(0, 600),
      };
    }

    const rt = r.recommendationTrend?.trend?.[0];
    return {
      unternehmen: pick(ap, ['sector', 'industry', 'country', 'fullTimeEmployees', 'website']),
      beschreibung: ap.longBusinessSummary?.slice(0, 800),
      bewertung: {
        marktkapitalisierung: sd.marketCap,
        kgvTrailing: sd.trailingPE,
        kgvForward: sd.forwardPE ?? ks.forwardPE,
        pegRatio: ks.pegRatio,
        kuv: sd.priceToSalesTrailing12Months,
        kbv: ks.priceToBook,
        evEbitda: ks.enterpriseToEbitda,
        evUmsatz: ks.enterpriseToRevenue,
      },
      wachstumUndProfitabilitaet: pick(fd, [
        'totalRevenue',
        'revenueGrowth',
        'earningsGrowth',
        'grossMargins',
        'operatingMargins',
        'profitMargins',
        'ebitdaMargins',
        'returnOnEquity',
        'returnOnAssets',
      ]),
      bilanzUndCashflow: pick(fd, [
        'totalCash',
        'totalDebt',
        'debtToEquity',
        'currentRatio',
        'quickRatio',
        'freeCashflow',
        'operatingCashflow',
      ]),
      dividende: pick(sd, ['dividendRate', 'dividendYield', 'payoutRatio', 'exDividendDate', 'fiveYearAvgDividendYield']),
      aktie: {
        beta: sd.beta,
        sharesOutstanding: ks.sharesOutstanding,
        shortRatio: ks.shortRatio,
        shortAnteilFreefloat: ks.shortPercentOfFloat,
        insiderAnteil: r.majorHoldersBreakdown?.insidersPercentHeld ?? ks.heldPercentInsiders,
        institutionenAnteil: r.majorHoldersBreakdown?.institutionsPercentHeld ?? ks.heldPercentInstitutions,
        insiderNettokaeufe6M: r.netSharePurchaseActivity?.netPercentInsiderShares,
      },
      analysten: {
        kurszielDurchschnitt: fd.targetMeanPrice,
        kurszielHoch: fd.targetHighPrice,
        kurszielTief: fd.targetLowPrice,
        empfehlung: fd.recommendationKey,
        anzahlAnalysten: fd.numberOfAnalystOpinions,
        verteilungAktuellerMonat: rt ? pick(rt, ['strongBuy', 'buy', 'hold', 'sell', 'strongSell']) : undefined,
      },
      termine: {
        naechsteZahlen: r.calendarEvents?.earnings?.earningsDate,
        exDividende: r.calendarEvents?.exDividendDate,
      },
      schaetzungen: (r.earningsTrend?.trend || [])
        .filter((t) => ['0q', '+1q', '0y', '+1y'].includes(t.period))
        .map((t) => ({
          zeitraum: t.period,
          ende: t.endDate,
          wachstum: t.growth,
          epsSchaetzung: t.earningsEstimate?.avg,
          umsatzSchaetzung: t.revenueEstimate?.avg,
        })),
    };
  });
}

// ---- Krypto -----------------------------------------------------------------

function cgHeaders() {
  const key = process.env.COINGECKO_API_KEY;
  return key ? { 'x-cg-demo-api-key': key } : {};
}

export async function getCryptoProfile(yahooSymbol, name) {
  const base = yahooSymbol.split('-')[0].toLowerCase();
  return cached(`cg:${base}`, 30 * 60_000, async () => {
    const s = await getJson(`${CG}/search?query=${encodeURIComponent(base)}`, { headers: cgHeaders() });
    const coin =
      (s.coins || []).find((c) => c.symbol?.toLowerCase() === base) ||
      (s.coins || []).find((c) => c.name?.toLowerCase() === name?.toLowerCase());
    if (!coin) return null;
    const c = await getJson(
      `${CG}/coins/${coin.id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=true&sparkline=false`,
      { headers: cgHeaders() },
    );
    const md = c.market_data || {};
    return {
      name: c.name,
      kategorien: (c.categories || []).filter(Boolean).slice(0, 8),
      beschreibung: (c.description?.en || '').replace(/<[^>]+>/g, '').slice(0, 800),
      genesis: c.genesis_date,
      konsens: c.hashing_algorithm,
      marktkapRang: c.market_cap_rank,
      marktkapUsd: md.market_cap?.usd,
      voll_verwaesserteBewertungUsd: md.fully_diluted_valuation?.usd,
      volumen24hUsd: md.total_volume?.usd,
      umlaufmenge: md.circulating_supply,
      gesamtmenge: md.total_supply,
      maximalmenge: md.max_supply,
      anteilImUmlauf: md.max_supply ? md.circulating_supply / md.max_supply : null,
      allzeithochUsd: md.ath?.usd,
      abstandAllzeithoch: md.ath_change_percentage?.usd != null ? md.ath_change_percentage.usd / 100 : null,
      allzeithochDatum: md.ath_date?.usd?.slice(0, 10),
      entwicklung: {
        commits4Wochen: c.developer_data?.commit_count_4_weeks,
        githubSterne: c.developer_data?.stars,
      },
      stimmungCoinGecko: {
        positiv: c.sentiment_votes_up_percentage,
        negativ: c.sentiment_votes_down_percentage,
      },
    };
  });
}

export async function getCryptoGlobal() {
  return cached('cg:global', 30 * 60_000, async () => {
    const g = (await getJson(`${CG}/global`, { headers: cgHeaders() })).data || {};
    return {
      gesamtMarktkapUsd: g.total_market_cap?.usd,
      veraenderung24h: g.market_cap_change_percentage_24h_usd != null ? g.market_cap_change_percentage_24h_usd / 100 : null,
      bitcoinDominanz: g.market_cap_percentage?.btc != null ? g.market_cap_percentage.btc / 100 : null,
      ethereumDominanz: g.market_cap_percentage?.eth != null ? g.market_cap_percentage.eth / 100 : null,
    };
  });
}

export async function getFearGreed() {
  return cached('fng', 30 * 60_000, async () => {
    const d = await getJson('https://api.alternative.me/fng/?limit=30');
    const rows = d.data || [];
    if (!rows.length) return null;
    return {
      aktuell: Number(rows[0].value),
      einstufung: rows[0].value_classification,
      vor7Tagen: rows[7] ? Number(rows[7].value) : null,
      vor30Tagen: rows[29] ? Number(rows[29].value) : null,
    };
  });
}

// ---- Makro-Umfeld -----------------------------------------------------------

const MACRO = [
  ['^GSPC', 'S&P 500'],
  ['^IXIC', 'Nasdaq Composite'],
  ['^GDAXI', 'DAX'],
  ['^STOXX50E', 'Euro Stoxx 50'],
  ['^VIX', 'VIX (Volatilitätsindex)'],
  ['^TNX', 'US-Staatsanleihen 10J Rendite (%)'],
  ['DX-Y.NYB', 'US-Dollar-Index'],
  ['EURUSD=X', 'EUR/USD'],
  ['GC=F', 'Gold'],
  ['CL=F', 'Rohöl WTI'],
  ['BTC-USD', 'Bitcoin'],
];

export async function getMacro() {
  return cached('macro', 5 * 60_000, async () => {
    const rows = await Promise.all(
      MACRO.map(async ([sym, label]) => {
        const c = await settle(getChart(sym, '3mo'));
        if (!c?.candles?.length) return null;
        const closes = c.candles.map((x) => x.close);
        const last = closes.at(-1);
        const monthAgo = closes[Math.max(0, closes.length - 22)];
        return {
          symbol: sym,
          name: label,
          wert: Number(last.toFixed(4)),
          veraenderung1M: Number((last / monthAgo - 1).toFixed(4)),
        };
      }),
    );
    return rows.filter(Boolean);
  });
}

// ---- Live-Kurse --------------------------------------------------------------

// Aktueller Kurs eines Symbols (ca. 10 s gecacht). `boerseOffen` wird aus den
// Handelszeiten der Börse berechnet; Krypto handelt rund um die Uhr.
export async function getLive(symbol) {
  const { meta } = await getChart(symbol, '1d', '5m');
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const price = meta.regularMarketPrice;
  const period = meta.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  const crypto = meta.instrumentType === 'CRYPTOCURRENCY';
  return {
    symbol: meta.symbol,
    name: meta.longName || meta.shortName || meta.symbol,
    waehrung: meta.currency,
    kurs: price,
    vortag: prev,
    veraenderungTag: prev ? price / prev - 1 : null,
    tagesHoch: meta.regularMarketDayHigh,
    tagesTief: meta.regularMarketDayLow,
    volumen: meta.regularMarketVolume,
    zeitpunkt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    zeitstempel: meta.regularMarketTime,
    gmtOffset: meta.gmtoffset ?? 0,
    boerseOffen: crypto || (period ? now >= period.start && now < period.end : null),
  };
}

export async function getLiveMany(symbols) {
  const rows = await Promise.all(symbols.map((s) => settle(getLive(s))));
  return Object.fromEntries(rows.filter(Boolean).map((r) => [r.symbol, r]));
}

export async function getMacroLive() {
  const live = await getLiveMany(MACRO.map(([s]) => s));
  return MACRO.filter(([s]) => live[s]).map(([s, name]) => ({ ...live[s], name }));
}

// ---- Gesamtpaket für Anzeige + Analyse --------------------------------------

export async function getQuote(symbol, range = '2y') {
  const { meta, candles, dividends } = await getChart(symbol, range);
  const typ = assetType(meta.instrumentType);
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const lastClose = candles.at(-2)?.close ?? prev;
  const price = meta.regularMarketPrice ?? candles.at(-1)?.close;
  return {
    symbol: meta.symbol,
    name: meta.longName || meta.shortName || meta.symbol,
    typ,
    instrumentType: meta.instrumentType,
    waehrung: meta.currency,
    boerse: meta.fullExchangeName || meta.exchangeName,
    zeitzone: meta.exchangeTimezoneName,
    kurs: price,
    veraenderungTag: lastClose ? price / lastClose - 1 : null,
    zeitpunkt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    candles,
    dividenden: dividends.slice(-8),
    kennzahlen: summarize(candles, { tradingDays: typ === 'krypto' ? 365 : 252 }),
  };
}

export async function getAnalysisContext(symbol) {
  // Für Kennzahlen wie die 5-Jahres-Performance längere Historie laden.
  const quote = await getQuote(symbol, '5y');
  const { typ } = quote;

  const benchSymbol = typ === 'krypto' ? (symbol.startsWith('BTC-') ? '^IXIC' : 'BTC-USD') : '^GSPC';
  const isUs = !/\.[A-Z]{1,3}$/.test(symbol);
  const newsQuery = typ === 'krypto' ? quote.name.replace(/\s+[A-Z]{3}$/, '') : isUs ? symbol : quote.name;

  const [bench, news, fundamentals, crypto, cryptoGlobal, fng, macro] = await Promise.all([
    settle(getChart(benchSymbol, '2y')),
    settle(getNews(newsQuery)),
    typ === 'aktie' || typ === 'etf' ? settle(getFundamentals(symbol, typ)) : null,
    typ === 'krypto' ? settle(getCryptoProfile(symbol, quote.name)) : null,
    typ === 'krypto' ? settle(getCryptoGlobal()) : null,
    typ === 'krypto' ? settle(getFearGreed()) : null,
    settle(getMacro()),
  ]);

  return {
    abgerufenAm: new Date().toISOString(),
    asset: {
      symbol: quote.symbol,
      name: quote.name,
      typ,
      boerse: quote.boerse,
      waehrung: quote.waehrung,
      kurs: quote.kurs,
      veraenderungTag: quote.veraenderungTag,
      kurszeitpunkt: quote.zeitpunkt,
    },
    technischeAnalyse: quote.kennzahlen,
    benchmark: bench
      ? {
          symbol: benchSymbol,
          relativeStaerke: relativeStrength(quote.candles, bench.candles),
          korrelation90T: correlation(quote.candles, bench.candles),
        }
      : null,
    dividendenHistorie: quote.dividenden.length ? quote.dividenden : undefined,
    fundamentaldaten: fundamentals || undefined,
    krypto: crypto || undefined,
    kryptoMarkt: cryptoGlobal || undefined,
    fearAndGreed: fng || undefined,
    makro: macro || undefined,
    schlagzeilen: news?.length ? news : undefined,
    fehlendeDaten: [
      !fundamentals && typ !== 'krypto' && typ !== 'sonstiges' ? 'Fundamentaldaten (Yahoo)' : null,
      !crypto && typ === 'krypto' ? 'Krypto-Profil (CoinGecko)' : null,
      !news?.length ? 'Schlagzeilen' : null,
      !macro?.length ? 'Makrodaten' : null,
    ].filter(Boolean),
  };
}
