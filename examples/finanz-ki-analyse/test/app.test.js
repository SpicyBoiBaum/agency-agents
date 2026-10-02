// Server-Tests: Passwortschutz, Alarm-API mit Serverprüfung, Push-Abos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const realFetch = globalThis.fetch;
let price = 100;
let clearMarketCache;
let base;
let app;
let dataDir;

before(async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    if (u.hostname === '127.0.0.1') return realFetch(input, init);
    if (u.pathname.startsWith('/v8/finance/chart/')) {
      const sym = decodeURIComponent(u.pathname.split('/').pop());
      const now = Math.floor(Date.now() / 1000);
      const ts = [now - 86400, now];
      return Response.json({
        chart: {
          result: [{
            meta: { symbol: sym, longName: `${sym} AG`, currency: 'EUR', instrumentType: 'EQUITY', regularMarketPrice: price, chartPreviousClose: 99, regularMarketTime: now },
            timestamp: ts,
            indicators: { quote: [{ open: [99, price], high: [99, price], low: [99, price], close: [99, price], volume: [1, 1] }] },
          }],
        },
      });
    }
    return new Response('x', { status: 503 });
  };
  dataDir = mkdtempSync(join(tmpdir(), 'fka-'));
  ({ clearMarketCache } = await import('../src/market.js'));
  const { createApp } = await import('../src/app.js');
  app = createApp({ dataDir, password: 'geheim123', alertIntervalS: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => {
  app.server.close();
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

const login = (pw) =>
  fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ passwort: pw }),
  });

let cookie;
const authed = (path, init = {}) => fetch(base + path, { ...init, headers: { ...init.headers, Cookie: cookie } });
const json = (path, method, body) =>
  authed(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// Kurs ändern und den 10-Sekunden-Cache der Live-Kurse verwerfen
const setPrice = (p) => {
  price = p;
  clearMarketCache();
};

test('ohne Anmeldung: API 401, Seiten leiten auf /login, Login-Seite und Icons frei', async () => {
  assert.equal((await fetch(`${base}/api/alerts`)).status, 401);
  const page = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/login');
  assert.equal((await fetch(`${base}/login`)).status, 200);
  assert.equal((await fetch(`${base}/icons/icon-192.png`)).status, 200);
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
});

test('falsches Passwort wird abgewiesen, richtiges setzt ein HttpOnly-Cookie', async () => {
  const bad = await login('falsch');
  assert.equal(bad.headers.get('location'), '/login?fehler=1');
  assert.equal(bad.headers.get('set-cookie'), null);

  const ok = await login('geheim123');
  assert.equal(ok.status, 303);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  cookie = setCookie.split(';')[0];

  const health = await (await authed('/api/health')).json();
  assert.equal(health.anmeldung, true);
  assert.equal((await authed('/')).status, 200);
  // manipuliertes Cookie gilt nicht
  const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await fetch(`${base}/api/alerts`, { headers: { Cookie: forged } })).status, 401);
});

test('Alarme: anlegen, Server löst bei Kursänderung aus, neu scharf schalten, löschen', async () => {
  setPrice(100);
  const tooLow = await json('/api/alerts', 'POST', { symbol: 'SAP.DE', ziel: 90, richtung: 'ueber' });
  assert.equal(tooLow.status, 400);

  const res = await json('/api/alerts', 'POST', { symbol: 'sap.de', ziel: 105, notiz: 'Gewinne mitnehmen' });
  assert.equal(res.status, 201);
  const alert = await res.json();
  assert.equal(alert.symbol, 'SAP.DE');
  assert.equal(alert.richtung, 'ueber');
  assert.equal(alert.name, 'SAP.DE AG');

  // Schreibende Aufrufe ohne JSON (z. B. Formular einer fremden Seite) werden abgelehnt.
  const form = await authed('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'symbol=X' });
  assert.equal(form.status, 415);

  setPrice(106);
  await app.monitor.tick();
  const [fired] = await (await authed('/api/alerts')).json();
  assert.ok(fired.ausgeloestAm);
  assert.equal(fired.ausloesekurs, 106);

  // Kurs noch über der Marke → erneutes Scharfschalten wird verweigert
  assert.equal((await json(`/api/alerts/${alert.id}/rearm`, 'POST', {})).status, 400);
  setPrice(101);
  const rearmed = await (await json(`/api/alerts/${alert.id}/rearm`, 'POST', {})).json();
  assert.equal(rearmed.ausgeloestAm, null);

  // Prüfung auch über /api/live (wenn die App offen ist)
  setPrice(107);
  await authed('/api/live?symbols=SAP.DE');
  assert.ok((await (await authed('/api/alerts')).json())[0].ausgeloestAm);

  assert.equal((await authed(`/api/alerts/${alert.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await authed('/api/alerts')).json(), []);
});

test('Alarme überstehen einen Neustart (Datei im Datenverzeichnis)', async () => {
  setPrice(100);
  await json('/api/alerts', 'POST', { symbol: 'ALV.DE', ziel: 80 });
  const { createApp } = await import('../src/app.js');
  const again = createApp({ dataDir, password: 'geheim123', alertIntervalS: 0 });
  assert.equal(again.monitor.alerts.all().length, 1);
  assert.equal(again.push.publicKey, app.push.publicKey); // VAPID-Schlüssel bleiben gleich
});

test('Push: Schlüssel abrufbar, Abo wird geprüft und gespeichert', async () => {
  const { publicKey } = await (await authed('/api/push/key')).json();
  assert.ok(publicKey.length > 40);
  assert.equal((await json('/api/push/subscribe', 'POST', { subscription: { endpoint: 'http://unsicher' } })).status, 400);
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'x', auth: 'y' } };
  assert.equal((await (await json('/api/push/subscribe', 'POST', { subscription: sub })).json()).geraete, 1);
  assert.equal((await (await json('/api/push/subscribe', 'POST', { subscription: sub })).json()).geraete, 1); // kein Duplikat
  assert.equal((await (await json('/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint })).json()).geraete, 0);
});

test('Logout löscht das Cookie', async () => {
  const res = await authed('/logout', { redirect: 'manual' });
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});
