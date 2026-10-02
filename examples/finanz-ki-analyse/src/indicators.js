// Technische Kennzahlen, berechnet aus täglichen OHLCV-Kerzen.
// Alle Funktionen sind rein (keine Seiteneffekte) und liefern für
// unzureichende Datenmengen `null`, damit die Analyse nie mit
// erfundenen Werten arbeitet.

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// RSI nach Wilder-Glättung.
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null,
  );
  const start = line.findIndex((v) => v != null);
  const signalLine = new Array(values.length).fill(null);
  if (start >= 0) {
    const sig = ema(line.slice(start), signal);
    sig.forEach((v, i) => (signalLine[start + i] = v));
  }
  const histogram = line.map((v, i) =>
    v != null && signalLine[i] != null ? v - signalLine[i] : null,
  );
  return { line, signal: signalLine, histogram };
}

export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const variance = slice.reduce((a, v) => a + (v - mid[i]) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

// Annualisierte Volatilität aus logarithmischen Tagesrenditen.
// Krypto handelt 365 Tage, Börsen etwa 252.
export function annualizedVolatility(values, tradingDays = 252, lookback = 60) {
  const slice = values.slice(-(lookback + 1));
  if (slice.length < 10) return null;
  const rets = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(tradingDays);
}

export function maxDrawdown(values) {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return values.length ? mdd : null;
}

// Einfache Unterstützungen/Widerstände: lokale Tiefs/Hochs (Fenster ±5 Tage)
// der letzten ~6 Monate, nach Nähe zum aktuellen Kurs sortiert.
export function supportResistance(candles, window = 5, lookback = 126) {
  const recent = candles.slice(-lookback);
  const last = recent.at(-1)?.close;
  const lows = [];
  const highs = [];
  for (let i = window; i < recent.length - window; i++) {
    const seg = recent.slice(i - window, i + window + 1);
    if (recent[i].low === Math.min(...seg.map((c) => c.low))) lows.push(recent[i].low);
    if (recent[i].high === Math.max(...seg.map((c) => c.high))) highs.push(recent[i].high);
  }
  const byDistance = (a, b) => Math.abs(a - last) - Math.abs(b - last);
  return {
    supports: lows.filter((v) => v < last).sort(byDistance).slice(0, 3),
    resistances: highs.filter((v) => v > last).sort(byDistance).slice(0, 3),
  };
}

function pctChange(closes, timestamps, daysBack) {
  const lastTs = timestamps.at(-1);
  const target = lastTs - daysBack * 86400;
  let idx = timestamps.findIndex((t) => t >= target);
  if (idx < 0 || idx === closes.length - 1) return null;
  // Nur werten, wenn die Historie tatsächlich so weit zurückreicht.
  if (timestamps[0] > target + 5 * 86400) return null;
  return closes.at(-1) / closes[idx] - 1;
}

function ytdChange(closes, timestamps) {
  const year = new Date(timestamps.at(-1) * 1000).getUTCFullYear();
  const start = Date.UTC(year, 0, 1) / 1000;
  const idx = timestamps.findIndex((t) => t >= start);
  if (idx <= 0) return null;
  // Basis ist der letzte Schlusskurs des Vorjahres.
  return closes.at(-1) / closes[idx - 1] - 1;
}

const round = (v, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

// Fasst alle Kennzahlen zu einem kompakten Objekt zusammen, das sowohl
// im Frontend angezeigt als auch der KI übergeben wird.
export function summarize(candles, { tradingDays = 252 } = {}) {
  if (!candles || candles.length < 2) return null;
  const closes = candles.map((c) => c.close);
  const ts = candles.map((c) => c.time);
  const last = closes.at(-1);
  const i = closes.length - 1;

  const sma20 = sma(closes, 20)[i];
  const sma50 = sma(closes, 50)[i];
  const sma200 = sma(closes, 200)[i];
  const rsi14 = rsi(closes, 14)[i];
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const atr14 = atr(candles, 14)[i];
  const year = candles.slice(-tradingDays);
  const high52 = Math.max(...year.map((c) => c.high));
  const low52 = Math.min(...year.map((c) => c.low));

  const vols = candles.map((c) => c.volume || 0);
  const vol20 = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
  const vol90 = vols.slice(-90).reduce((a, b) => a + b, 0) / Math.min(90, vols.length);

  let trend = 'seitwärts';
  if (sma50 && sma200) {
    if (last > sma50 && sma50 > sma200) trend = 'Aufwärtstrend';
    else if (last < sma50 && sma50 < sma200) trend = 'Abwärtstrend';
  }

  // Golden/Death Cross in den letzten 20 Handelstagen
  let cross = null;
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  for (let k = Math.max(1, i - 20); k <= i; k++) {
    if (s50[k - 1] == null || s200[k - 1] == null) continue;
    if (s50[k - 1] <= s200[k - 1] && s50[k] > s200[k]) cross = 'Golden Cross';
    if (s50[k - 1] >= s200[k - 1] && s50[k] < s200[k]) cross = 'Death Cross';
  }

  return {
    letzterKurs: round(last, 6),
    performance: {
      '1W': round(pctChange(closes, ts, 7)),
      '1M': round(pctChange(closes, ts, 30)),
      '3M': round(pctChange(closes, ts, 91)),
      '6M': round(pctChange(closes, ts, 182)),
      YTD: round(ytdChange(closes, ts)),
      '1J': round(pctChange(closes, ts, 365)),
      '5J': round(pctChange(closes, ts, 365 * 5)),
    },
    gleitendeDurchschnitte: {
      sma20: round(sma20, 6),
      sma50: round(sma50, 6),
      sma200: round(sma200, 6),
      abstandSma200: sma200 ? round(last / sma200 - 1) : null,
    },
    trend,
    kreuzungLetzte20Tage: cross,
    rsi14: round(rsi14, 2),
    macd: {
      linie: round(m.line[i], 6),
      signal: round(m.signal[i], 6),
      histogramm: round(m.histogram[i], 6),
    },
    bollinger: {
      oben: round(bb.upper[i], 6),
      mitte: round(bb.mid[i], 6),
      unten: round(bb.lower[i], 6),
      positionProzent:
        bb.upper[i] != null && bb.upper[i] !== bb.lower[i]
          ? round((last - bb.lower[i]) / (bb.upper[i] - bb.lower[i]), 3)
          : null,
    },
    atr14: round(atr14, 6),
    atrProzent: atr14 ? round(atr14 / last) : null,
    volatilitaetAnnualisiert: round(annualizedVolatility(closes, tradingDays)),
    maxDrawdown1J: round(maxDrawdown(closes.slice(-tradingDays))),
    hoch52W: round(high52, 6),
    tief52W: round(low52, 6),
    abstandZumHoch: round(last / high52 - 1),
    abstandZumTief: round(last / low52 - 1),
    volumen: {
      schnitt20T: Math.round(vol20),
      schnitt90T: Math.round(vol90),
      verhaeltnis: vol90 ? round(vol20 / vol90, 2) : null,
    },
    ...supportResistance(candles),
  };
}

// Relative Stärke gegenüber einer Benchmark (z. B. S&P 500 oder Bitcoin)
// über gemeinsame Zeiträume.
export function relativeStrength(candles, benchCandles) {
  if (!candles?.length || !benchCandles?.length) return null;
  const perf = (cs, days) => {
    const ts = cs.map((c) => c.time);
    return pctChange(cs.map((c) => c.close), ts, days);
  };
  const out = {};
  for (const [label, days] of [['1M', 30], ['3M', 91], ['1J', 365]]) {
    const a = perf(candles, days);
    const b = perf(benchCandles, days);
    out[label] = a != null && b != null ? round(a - b) : null;
  }
  return out;
}

// Korrelation der Tagesrenditen (letzte 90 gemeinsamen Tage).
export function correlation(candles, benchCandles, lookback = 90) {
  if (!candles?.length || !benchCandles?.length) return null;
  const day = (t) => Math.floor(t / 86400);
  const bench = new Map(benchCandles.map((c) => [day(c.time), c.close]));
  const pairs = candles.filter((c) => bench.has(day(c.time))).map((c) => [c.close, bench.get(day(c.time))]);
  const p = pairs.slice(-(lookback + 1));
  if (p.length < 20) return null;
  const ra = [];
  const rb = [];
  for (let i = 1; i < p.length; i++) {
    ra.push(p[i][0] / p[i - 1][0] - 1);
    rb.push(p[i][1] / p[i - 1][1] - 1);
  }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  return va && vb ? round(cov / Math.sqrt(va * vb), 3) : null;
}
