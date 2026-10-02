// End-to-end-Test mit simulierten Datenquellen und simulierter Claude-API
// (kein Netzwerk nötig).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
const calls = [];
let anthropicTurn = 0;

function yahooChart(symbol, instrumentType) {
  const n = 600;
  const start = Math.floor(Date.now() / 1000) - n * 86400;
  const ts = Array.from({ length: n }, (_, i) => start + i * 86400);
  const close = ts.map((_, i) => 100 + i * 0.2 + Math.sin(i / 7) * 3);
  return {
    chart: {
      result: [{
        meta: { symbol, instrumentType, currency: 'USD', longName: `${symbol} Inc.`, regularMarketPrice: close.at(-1), chartPreviousClose: close.at(-2), fullExchangeName: 'NASDAQ', regularMarketTime: ts.at(-1), gmtoffset: -14400, currentTradingPeriod: { regular: { start: ts.at(-1) - 3600, end: ts.at(-1) + 3600 } } },
        timestamp: ts,
        indicators: { quote: [{ open: close, high: close.map((c) => c + 1), low: close.map((c) => c - 1), close, volume: close.map(() => 1e6) }] },
      }],
      error: null,
    },
  };
}

function sse(events) {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function anthropicResponse() {
  anthropicTurn++;
  const msg = { id: `msg_${anthropicTurn}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } };
  if (anthropicTurn === 1) {
    // Erste Runde: Websuche, dann pause_turn
    return sse([
      { type: 'message_start', message: msg },
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"AAPL news"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://example.com/a', title: 'Artikel A', encrypted_content: 'x', page_age: '1 day' }] } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'pause_turn', stop_sequence: null }, usage: { output_tokens: 10, server_tool_use: { web_search_requests: 1 } } },
      { type: 'message_stop' },
    ]);
  }
  return sse([
    { type: 'message_start', message: msg },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '## Kurzfazit\nGut.\n```json\n{"gesamtscore": 40}\n```' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ]);
}

before(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    const u = new URL(url);
    if (u.host === 'api.anthropic.com') return anthropicResponse();
    if (u.pathname.startsWith('/v8/finance/chart/')) {
      const sym = decodeURIComponent(u.pathname.split('/').pop());
      return Response.json(yahooChart(sym, sym.startsWith('^') ? 'INDEX' : 'EQUITY'));
    }
    if (u.pathname === '/v1/finance/search') {
      return Response.json({ quotes: [{ symbol: 'AAPL', shortname: 'Apple', quoteType: 'EQUITY', exchDisp: 'NASDAQ' }], news: [{ title: 'Apple News', publisher: 'X', link: 'https://x', providerPublishTime: 1700000000 }] });
    }
    return new Response('nope', { status: 503 }); // Fundamentaldaten etc. fallen aus
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

test('Analyse-Kontext und KI-Stream inkl. pause_turn', async () => {
  const { getAnalysisContext, search } = await import('../src/market.js');
  const { runAnalysis } = await import('../src/analysis.js');

  const s = await search('apple');
  assert.equal(s[0].typ, 'aktie');

  const ctx = await getAnalysisContext('AAPL');
  assert.equal(ctx.asset.typ, 'aktie');
  assert.ok(ctx.technischeAnalyse.rsi14 != null);
  assert.equal(ctx.benchmark.symbol, '^GSPC');
  assert.ok(ctx.makro.length > 0);
  assert.ok(ctx.fehlendeDaten.includes('Fundamentaldaten (Yahoo)'));

  const events = [];
  await runAnalysis(ctx, { focus: 'Sparplan?', emit: (e, d) => events.push([e, d]) });

  assert.deepEqual(events.find(([e]) => e === 'search')[1], { query: 'AAPL news' });
  assert.equal(events.find(([e]) => e === 'sources')[1][0].url, 'https://example.com/a');
  const text = events.filter(([e]) => e === 'text').map(([, d]) => d.text).join('');
  assert.match(text, /gesamtscore/);
  const done = events.find(([e]) => e === 'done')[1];
  assert.equal(done.usage.web_searches, 1);
  assert.equal(anthropicTurn, 2);

  // Zweite Anfrage enthält die pausierte Assistant-Antwort unverändert
  const apiCalls = calls.filter((c) => c.url.includes('api.anthropic.com'));
  const second = JSON.parse(apiCalls[1].init.body);
  assert.equal(second.messages.length, 2);
  assert.equal(second.messages[1].role, 'assistant');
  assert.equal(second.fallbacks, 'default');
  assert.equal(second.tools[0].type, 'web_search_20260209');
  assert.match(new Headers(apiCalls[0].init.headers).get('anthropic-beta'), /server-side-fallback-2026-07-01/);
});

test('Live-Kurse: Tagesveränderung und Börsenstatus', async () => {
  const { getLiveMany } = await import('../src/market.js');
  const live = await getLiveMany(['AAPL', '^GSPC']);
  assert.ok(live.AAPL.kurs > 0);
  assert.equal(typeof live.AAPL.veraenderungTag, 'number');
  assert.equal(live.AAPL.waehrung, 'USD');
  assert.ok('boerseOffen' in live.AAPL);
});
