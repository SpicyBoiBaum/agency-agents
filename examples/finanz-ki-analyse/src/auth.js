// Passwortschutz für den Betrieb im Internet.
//
// Ist APP_PASSWORD gesetzt, braucht jede Anfrage (außer Login-Seite, Icons,
// Manifest und Service Worker) ein gültiges Sitzungs-Cookie. Das Cookie ist
// ein HMAC-signierter Ablaufzeitpunkt; ein geändertes Passwort macht alle
// bestehenden Sitzungen ungültig.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'fka_session';
const SESSION_DAYS = 30;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60_000;

const sha256 = (s) => createHash('sha256').update(String(s)).digest();

export function createAuth({ password = process.env.APP_PASSWORD, secret, store, trustProxy = false } = {}) {
  const enabled = Boolean(password);
  // Geheimnis für die Signatur: SESSION_SECRET oder einmalig erzeugt und gespeichert.
  let key = secret || process.env.SESSION_SECRET || store?.get('sessionSecret');
  if (!key) {
    key = randomBytes(32).toString('hex');
    store?.set('sessionSecret', key);
  }
  const pwHash = enabled ? sha256(password) : null;
  const fails = new Map(); // ip -> { count, first }

  const sign = (payload) =>
    createHmac('sha256', key).update(payload).update(pwHash ?? '').digest('base64url');

  function clientIp(req) {
    if (trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      if (fwd) return String(fwd).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unbekannt';
  }

  function isHttps(req) {
    return req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
  }

  function readCookie(req, name) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  function isAuthenticated(req) {
    if (!enabled) return true;
    const token = readCookie(req, COOKIE);
    if (!token) return false;
    const [version, expires, mac] = token.split('.');
    if (version !== 'v1' || !expires || !mac) return false;
    if (Number(expires) < Date.now()) return false;
    const expected = Buffer.from(sign(`v1.${expires}`));
    const given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  function cookieHeader(req, value, maxAgeS) {
    return [
      `${COOKIE}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeS}`,
      isHttps(req) ? 'Secure' : null,
    ]
      .filter(Boolean)
      .join('; ');
  }

  // Liefert { ok, cookie } oder { ok: false, error, status }.
  function login(req, attempt) {
    const ip = clientIp(req);
    const now = Date.now();
    const f = fails.get(ip);
    if (f && now - f.first < FAIL_WINDOW_MS && f.count >= MAX_FAILS) {
      return { ok: false, status: 429, error: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' };
    }
    const ok = enabled && timingSafeEqual(sha256(attempt ?? ''), pwHash);
    if (!ok) {
      if (!f || now - f.first >= FAIL_WINDOW_MS) fails.set(ip, { count: 1, first: now });
      else f.count++;
      if (fails.size > 10_000) fails.clear();
      return { ok: false, status: 401, error: 'Falsches Passwort.' };
    }
    fails.delete(ip);
    const expires = now + SESSION_DAYS * 86400_000;
    const token = `v1.${expires}.${sign(`v1.${expires}`)}`;
    return { ok: true, cookie: cookieHeader(req, token, SESSION_DAYS * 86400) };
  }

  const logoutCookie = (req) => cookieHeader(req, '', 0);

  return { enabled, isAuthenticated, login, logoutCookie, clientIp };
}
