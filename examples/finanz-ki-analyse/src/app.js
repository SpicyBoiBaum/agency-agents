// HTTP-Anwendung ohne Framework: liefert das Frontend aus /public und stellt
// die API bereit. Der Anthropic-API-Schlüssel bleibt auf dem Server.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getQuote, getNews, search, getMacro, getMacroLive, getLive, getLiveMany, getAnalysisContext, SYMBOL_RE } from './market.js';
import { runAnalysis } from './analysis.js';
import { createStore } from './store.js';
import { createAuth } from './auth.js';
import { createPush } from './push.js';
import { createAlertMonitor } from './alert-monitor.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']);
const MAX_ALERTS = 200;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// Ohne Anmeldung erreichbar: Login, Installations-Dateien und Health-Check.
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/login.js', '/styles.css', '/manifest.webmanifest', '/sw.js', '/api/health']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const sendJson = (res, status, body, headers) =>
  send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8', ...headers });

function requireSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw httpError(400, 'Ungültiges Symbol');
  return symbol;
}

async function readBody(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Anfrage zu groß');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// JSON-Pflicht für schreibende API-Aufrufe: Fremde Webseiten können ohne
// CORS-Freigabe keine JSON-Anfragen schicken (Schutz gegen CSRF).
async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw httpError(415, 'Content-Type application/json erwartet');
  }
  try {
    return JSON.parse((await readBody(req)) || '{}');
  } catch {
    throw httpError(400, 'Ungültiges JSON');
  }
}

export function createApp({
  dataDir = process.env.DATA_DIR || './data',
  password = process.env.APP_PASSWORD,
  trustProxy = process.env.TRUST_PROXY === '1',
  maxParallelAnalyses = Number(process.env.MAX_PARALLEL_ANALYSES || 2),
  alertIntervalS,
} = {}) {
  const store = createStore(dataDir);
  const auth = createAuth({ password, store, trustProxy });
  const push = createPush({ store });
  const monitor = createAlertMonitor({ store, push, intervalS: alertIntervalS });
  const alerts = monitor.alerts;
  let runningAnalyses = 0;
  const kiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

  async function serveStatic(res, pathname) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname === '/login' ? '/login.html' : pathname).replace(
      /^([/\\])+/,
      '',
    );
    const file = join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Verboten' });
    try {
      const body = await readFile(file);
      const headers = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' };
      if (rel === 'sw.js') headers['Service-Worker-Allowed'] = '/';
      if (rel.startsWith('icons/')) headers['Cache-Control'] = 'public, max-age=86400';
      send(res, 200, body, headers);
    } catch {
      sendJson(res, 404, { error: 'Nicht gefunden' });
    }
  }

  async function handleLogin(req, res) {
    const params = new URLSearchParams(await readBody(req, 4096));
    const result = auth.login(req, params.get('passwort'));
    if (!result.ok) {
      return send(res, 303, '', { Location: `/login?fehler=${result.status === 429 ? 'sperre' : '1'}` });
    }
    send(res, 303, '', { Location: '/', 'Set-Cookie': result.cookie });
  }

  async function handleAnalyze(req, res, url) {
    const symbol = requireSymbol(url.searchParams.get('symbol'));
    const focus = (url.searchParams.get('focus') || '').slice(0, 500);

    if (!kiAvailable()) {
      return sendJson(res, 503, {
        error: 'Kein ANTHROPIC_API_KEY gesetzt. Lege eine .env-Datei an (siehe .env.example) und starte den Server neu.',
      });
    }
    if (runningAnalyses >= maxParallelAnalyses) {
      return sendJson(res, 429, { error: 'Es laufen bereits Analysen. Bitte kurz warten.' });
    }

    // Server-Sent Events: Fortschritt und Text werden live gestreamt.
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

    runningAnalyses++;
    try {
      emit('status', { text: 'Sammle Kurs-, Fundamental- und Makrodaten …' });
      const context = await getAnalysisContext(symbol);
      emit('context', context);
      emit('status', { text: 'KI analysiert und recherchiert aktuelle Nachrichten …' });
      await runAnalysis(context, { focus, emit, signal: controller.signal });
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('[analyze]', err);
        emit('error', { message: err.message || 'Analyse fehlgeschlagen' });
      }
    } finally {
      runningAnalyses--;
      clearInterval(heartbeat);
      res.end();
    }
  }

  async function handleAlerts(req, res, parts) {
    // parts: ['api', 'alerts', id?, 'rearm'?]
    const [, , id, action] = parts;
    if (!id && req.method === 'GET') return sendJson(res, 200, alerts.all());

    if (!id && req.method === 'POST') {
      if (alerts.all().length >= MAX_ALERTS) throw httpError(400, `Maximal ${MAX_ALERTS} Alarme.`);
      const body = await readJson(req);
      const symbol = requireSymbol(body.symbol);
      const live = await getLive(symbol); // aktueller Kurs zur Plausibilitätsprüfung
      try {
        const alert = alerts.add({
          symbol: live.symbol || symbol,
          name: live.name,
          waehrung: live.waehrung,
          ziel: body.ziel,
          richtung: body.richtung === 'unter' || body.richtung === 'ueber' ? body.richtung : undefined,
          notiz: typeof body.notiz === 'string' ? body.notiz : '',
          aktuell: live.kurs,
        });
        return sendJson(res, 201, alert);
      } catch (err) {
        throw httpError(400, err.message);
      }
    }

    const alert = alerts.all().find((a) => a.id === id);
    if (!alert) throw httpError(404, 'Alarm nicht gefunden');

    if (!action && req.method === 'DELETE') {
      alerts.remove(id);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'rearm' && req.method === 'POST') {
      const { kurs } = await getLive(alert.symbol);
      if (alert.richtung === 'ueber' ? kurs >= alert.ziel : kurs <= alert.ziel) {
        throw httpError(
          400,
          `Der Kurs liegt noch ${alert.richtung === 'ueber' ? 'über' : 'unter'} der Marke – der Alarm würde sofort wieder auslösen. Lege besser einen neuen an.`,
        );
      }
      alerts.rearm(id);
      return sendJson(res, 200, alerts.all().find((a) => a.id === id));
    }
    throw httpError(405, 'Methode nicht erlaubt');
  }

  async function handlePush(req, res, action) {
    if (action === 'key' && req.method === 'GET') return sendJson(res, 200, { publicKey: push.publicKey });
    if (req.method !== 'POST') throw httpError(405, 'Methode nicht erlaubt');
    const body = await readJson(req);
    switch (action) {
      case 'subscribe':
        push.subscribe(body.subscription, req.headers['user-agent']);
        return sendJson(res, 200, { ok: true, geraete: push.count() });
      case 'unsubscribe':
        push.unsubscribe(String(body.endpoint || ''));
        return sendJson(res, 200, { ok: true, geraete: push.count() });
      case 'test':
        return sendJson(
          res,
          200,
          await push.sendAll({
            title: '🔔 Test-Benachrichtigung',
            body: 'Push funktioniert. So sehen deine Kursalarme aus.',
            url: '/',
            tag: 'test',
          }),
        );
      default:
        throw httpError(404, 'Unbekannter Endpunkt');
    }
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (pathname === '/login' && req.method === 'POST') return handleLogin(req, res);
    if (pathname === '/logout') {
      return send(res, 303, '', { Location: '/login', 'Set-Cookie': auth.logoutCookie(req) });
    }

    // Zugangskontrolle
    if (!PUBLIC_PATHS.has(pathname) && !pathname.startsWith('/icons/') && !auth.isAuthenticated(req)) {
      if (pathname.startsWith('/api/')) return sendJson(res, 401, { error: 'Nicht angemeldet' });
      return send(res, 303, '', { Location: '/login' });
    }
    if ((pathname === '/login' || pathname === '/login.html') && (!auth.enabled || auth.isAuthenticated(req))) {
      return send(res, 303, '', { Location: '/' });
    }

    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'api' && parts[1] === 'alerts') return handleAlerts(req, res, parts);
    if (parts[0] === 'api' && parts[1] === 'push') return handlePush(req, res, parts[2]);

    if (req.method !== 'GET') throw httpError(405, 'Methode nicht erlaubt');

    switch (pathname) {
      case '/api/search': {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
        return sendJson(res, 200, q.length < 1 ? [] : await search(q));
      }
      case '/api/quote': {
        const range = url.searchParams.get('range') || '1y';
        if (!RANGES.has(range)) throw httpError(400, 'Ungültiger Zeitraum');
        return sendJson(res, 200, await getQuote(requireSymbol(url.searchParams.get('symbol')), range));
      }
      case '/api/news': {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
        return sendJson(res, 200, q ? await getNews(q) : []);
      }
      case '/api/live': {
        const symbols = [...new Set((url.searchParams.get('symbols') || '').split(',').map((s) => s.trim().toUpperCase()))]
          .filter((s) => SYMBOL_RE.test(s))
          .slice(0, 40);
        const live = symbols.length ? await getLiveMany(symbols) : {};
        // Frische Kurse gleich für die Alarmprüfung nutzen (schneller als das Intervall).
        monitor.checkWith(live);
        return sendJson(res, 200, live);
      }
      case '/api/macro/live':
        return sendJson(res, 200, await getMacroLive());
      case '/api/macro':
        return sendJson(res, 200, await getMacro());
      case '/api/analyze':
        return handleAnalyze(req, res, url);
      case '/api/health':
        return sendJson(
          res,
          200,
          auth.isAuthenticated(req)
            ? { ok: true, ki: kiAvailable(), anmeldung: auth.enabled, push: true }
            : { ok: true },
        );
      default:
        if (pathname.startsWith('/api/')) throw httpError(404, 'Unbekannter Endpunkt');
        return serveStatic(res, pathname);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err.status && err.status < 600 ? err.status : 502;
      if (status >= 500) console.error('[api]', err.message);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Fehler' });
      else res.end();
    }
  });

  return { server, monitor, auth, push, store };
}
