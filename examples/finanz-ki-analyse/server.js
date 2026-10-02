// Kleiner HTTP-Server ohne Framework: liefert das Frontend aus /public und
// stellt die API bereit. Der Anthropic-API-Schlüssel bleibt auf dem Server.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile?.(); // .env laden (Node >= 20.12)
} catch {
  // keine .env vorhanden – Umgebungsvariablen werden direkt genutzt
}

const { getQuote, getNews, search, getMacro, getAnalysisContext, SYMBOL_RE } = await import('./src/market.js');
const { runAnalysis } = await import('./src/analysis.js');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_PARALLEL_ANALYSES = Number(process.env.MAX_PARALLEL_ANALYSES || 2);
const RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

let runningAnalyses = 0;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function requireSymbol(url) {
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw Object.assign(new Error('Ungültiges Symbol'), { status: 400 });
  }
  return symbol;
}

async function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Verboten' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Nicht gefunden' });
  }
}

async function handleAnalyze(req, res, url) {
  const symbol = requireSymbol(url);
  const focus = (url.searchParams.get('focus') || '').slice(0, 500);

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return sendJson(res, 503, {
      error: 'Kein ANTHROPIC_API_KEY gesetzt. Lege eine .env-Datei an (siehe .env.example) und starte den Server neu.',
    });
  }
  if (runningAnalyses >= MAX_PARALLEL_ANALYSES) {
    return sendJson(res, 429, { error: 'Es laufen bereits Analysen. Bitte kurz warten.' });
  }

  // Server-Sent Events: Fortschritt und Text werden live gestreamt.
  res.writeHead(200, {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Nur GET erlaubt' });

    switch (url.pathname) {
      case '/api/search': {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
        return sendJson(res, 200, q.length < 1 ? [] : await search(q));
      }
      case '/api/quote': {
        const range = url.searchParams.get('range') || '1y';
        if (!RANGES.has(range)) return sendJson(res, 400, { error: 'Ungültiger Zeitraum' });
        return sendJson(res, 200, await getQuote(requireSymbol(url), range));
      }
      case '/api/news': {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
        return sendJson(res, 200, q ? await getNews(q) : []);
      }
      case '/api/macro':
        return sendJson(res, 200, await getMacro());
      case '/api/analyze':
        return await handleAnalyze(req, res, url);
      case '/api/health':
        return sendJson(res, 200, { ok: true, ki: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
      default:
        if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
        return await serveStatic(res, url.pathname);
    }
  } catch (err) {
    const status = err.status && err.status < 600 ? err.status : 502;
    if (status >= 500) console.error('[api]', err.message);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Fehler' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`📈 Finanz-KI-Analyse läuft auf http://${HOST}:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('⚠️  ANTHROPIC_API_KEY fehlt – Kurse funktionieren, die KI-Analyse nicht.');
  }
});
