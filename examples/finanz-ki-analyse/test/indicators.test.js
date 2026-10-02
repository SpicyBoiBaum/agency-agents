import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, maxDrawdown, summarize, correlation } from '../src/indicators.js';

const day = 86400;
function makeCandles(closes, start = Date.UTC(2024, 0, 1) / 1000) {
  return closes.map((c, i) => ({ time: start + i * day, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 + i }));
}

test('sma berechnet gleitenden Durchschnitt', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('ema startet mit SMA und glättet danach', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.equal(out[2], 2);
  assert.equal(out[3], 3);
  assert.equal(out[4], 4);
});

test('rsi ist 100 bei reinem Anstieg und 0 bei reinem Fall', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = up.slice().reverse();
  assert.equal(rsi(up).at(-1), 100);
  assert.equal(rsi(down).at(-1), 0);
});

test('macd ist positiv in stetigem Aufwärtstrend', () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 * 1.01 ** i);
  const m = macd(up);
  assert.ok(m.line.at(-1) > 0);
  assert.ok(m.signal.at(-1) != null);
});

test('maxDrawdown findet größten Rückgang', () => {
  assert.equal(maxDrawdown([100, 120, 60, 90, 130]), -0.5);
});

test('summarize liefert Trend und Performance', () => {
  const closes = Array.from({ length: 400 }, (_, i) => 100 + i * 0.5);
  const s = summarize(makeCandles(closes));
  assert.equal(s.trend, 'Aufwärtstrend');
  assert.ok(s.performance['1M'] > 0);
  assert.equal(s.performance['5J'], null); // Historie reicht nicht 5 Jahre zurück
  assert.ok(s.rsi14 > 50);
  assert.ok(s.abstandZumHoch <= 0);
});

test('correlation einer Reihe mit sich selbst ist 1', () => {
  const c = makeCandles(Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1));
  assert.equal(correlation(c, c), 1);
});
