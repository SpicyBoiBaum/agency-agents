import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlertStore } from '../public/alerts.js';

function storage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}

test('Richtung wird aus dem aktuellen Kurs abgeleitet', () => {
  const s = createAlertStore(storage());
  assert.equal(s.add({ symbol: 'AAPL', ziel: 220, aktuell: 200 }).richtung, 'ueber');
  assert.equal(s.add({ symbol: 'AAPL', ziel: 180, aktuell: 200 }).richtung, 'unter');
});

test('ungültige oder bereits erreichte Ziele werden abgelehnt', () => {
  const s = createAlertStore(storage());
  assert.throws(() => s.add({ symbol: 'AAPL', ziel: 'abc', aktuell: 200 }));
  assert.throws(() => s.add({ symbol: 'AAPL', ziel: 180, richtung: 'ueber', aktuell: 200 }));
  assert.throws(() => s.add({ symbol: 'AAPL', ziel: 220, richtung: 'unter', aktuell: 200 }));
});

test('Alarm löst genau einmal aus und kann neu scharf geschaltet werden', () => {
  const st = storage();
  const s = createAlertStore(st);
  const up = s.add({ symbol: 'BTC-EUR', ziel: 100, aktuell: 90 });
  const down = s.add({ symbol: 'BTC-EUR', ziel: 80, aktuell: 90 });

  assert.deepEqual(s.check({ 'BTC-EUR': { kurs: 95 } }), []);
  const fired = s.check({ 'BTC-EUR': { kurs: 100.5 } });
  assert.equal(fired.length, 1);
  assert.equal(fired[0].id, up.id);
  assert.equal(fired[0].ausloesekurs, 100.5);
  assert.deepEqual(s.check({ 'BTC-EUR': { kurs: 101 } }), []); // kein zweites Mal
  assert.deepEqual(s.activeSymbols(), ['BTC-EUR']); // der Unter-Alarm ist noch aktiv

  assert.equal(s.check({ 'BTC-EUR': { kurs: 79 } })[0].id, down.id);
  assert.deepEqual(s.activeSymbols(), []);

  s.rearm(up.id);
  assert.equal(s.activeSymbols().length, 1);

  // Persistenz: neuer Store liest denselben Speicher
  const again = createAlertStore(st);
  assert.equal(again.all().length, 2);
  again.remove(down.id);
  assert.equal(createAlertStore(st).all().length, 1);
});

test('fehlende Kurse lösen nichts aus', () => {
  const s = createAlertStore(storage());
  s.add({ symbol: 'SAP.DE', ziel: 1, aktuell: 2 });
  assert.deepEqual(s.check({}), []);
  assert.deepEqual(s.check({ 'SAP.DE': { kurs: null } }), []);
});
