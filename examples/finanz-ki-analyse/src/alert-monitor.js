// Prüft Kursalarme auf dem Server – unabhängig davon, ob die App geöffnet ist –
// und verschickt beim Auslösen eine Push-Benachrichtigung.

import { createAlertStore } from './alerts.js';
import { getLiveMany } from './market.js';

const fmt = (v, currency) => {
  try {
    return new Intl.NumberFormat('de-DE', {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      maximumFractionDigits: v >= 1 ? 2 : 6,
    }).format(v);
  } catch {
    return String(v);
  }
};

export function createAlertMonitor({ store, push, intervalS = Number(process.env.ALERT_CHECK_INTERVAL || 60) }) {
  const alerts = createAlertStore(store.asStorage());
  let timer = null;
  let running = false;

  async function notify(fired) {
    for (const a of fired) {
      const richtung = a.richtung === 'ueber' ? 'ist über' : 'ist unter';
      console.log(`🔔 Alarm ausgelöst: ${a.symbol} ${richtung} ${a.ziel} (Kurs ${a.ausloesekurs})`);
      if (!push?.count()) continue;
      await push.sendAll({
        title: `🔔 Kursalarm: ${a.name}`,
        body: `${a.symbol} ${richtung} ${fmt(a.ziel, a.waehrung)} – aktuell ${fmt(a.ausloesekurs, a.waehrung)}${a.notiz ? `\n${a.notiz}` : ''}`,
        url: `/#${encodeURIComponent(a.symbol)}`,
        tag: a.id,
      });
    }
  }

  // Mit bereits geladenen Live-Kursen prüfen (z. B. aus /api/live). Das
  // Auslösen passiert sofort; die Push-Zustellung läuft im Hintergrund.
  function checkWith(live) {
    const fired = alerts.check(live);
    if (fired.length) notify(fired).catch((err) => console.warn('[push]', err.message));
    return fired;
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const symbols = alerts.activeSymbols();
      if (symbols.length) checkWith(await getLiveMany(symbols));
    } catch (err) {
      console.warn('[alarme]', err.message);
    } finally {
      running = false;
    }
  }

  return {
    alerts,
    checkWith,
    tick,
    start() {
      if (!timer && intervalS > 0) {
        timer = setInterval(tick, intervalS * 1000);
        timer.unref?.();
        tick();
      }
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
