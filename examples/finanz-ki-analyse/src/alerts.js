// Kursalarme: Logik und Speicherung (ohne DOM, damit sie testbar ist).
// Ein Alarm löst einmal aus, sobald der Kurs die Zielmarke über- bzw.
// unterschreitet, und kann danach erneut scharf geschaltet werden.

const KEY = 'kursalarme';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? memoryStorage();
  } catch {
    return memoryStorage(); // Zugriff auf localStorage kann blockiert sein
  }
}

export function createAlertStore(storage = defaultStorage()) {
  let alerts = [];
  const load = () => {
    try {
      const parsed = JSON.parse(storage.getItem(KEY));
      if (Array.isArray(parsed)) alerts = parsed;
    } catch {
      // privater Modus, gesperrter Speicher o. Ä. – dann nur für diese Sitzung
    }
  };
  load();
  const save = () => {
    try {
      storage.setItem(KEY, JSON.stringify(alerts));
    } catch {
      // ebenso
    }
  };

  return {
    key: KEY,
    reload: load, // z. B. wenn ein anderer Tab Alarme geändert hat
    all: () => alerts.slice(),
    forSymbol: (symbol) => alerts.filter((a) => a.symbol === symbol),
    activeSymbols: () => [...new Set(alerts.filter((a) => !a.ausgeloestAm).map((a) => a.symbol))],

    // richtung: 'ueber' | 'unter'; ohne Angabe wird sie aus dem aktuellen Kurs abgeleitet.
    add({ symbol, name, waehrung, ziel, richtung, notiz = '', aktuell }) {
      const price = Number(ziel);
      if (!symbol || !Number.isFinite(price) || price <= 0) throw new Error('Bitte einen gültigen Zielpreis eingeben.');
      const dir = richtung || (aktuell != null && price < aktuell ? 'unter' : 'ueber');
      if (aktuell != null && (dir === 'ueber' ? aktuell >= price : aktuell <= price)) {
        throw new Error(
          dir === 'ueber'
            ? 'Der Kurs liegt bereits über diesem Preis. Wähle einen höheren Preis oder „fällt unter“.'
            : 'Der Kurs liegt bereits unter diesem Preis. Wähle einen niedrigeren Preis oder „steigt über“.',
        );
      }
      const alert = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        symbol,
        name: name || symbol,
        waehrung: waehrung || null,
        ziel: price,
        richtung: dir,
        notiz: String(notiz).slice(0, 140),
        erstelltAm: new Date().toISOString(),
        ausgeloestAm: null,
        ausloesekurs: null,
      };
      alerts.push(alert);
      save();
      return alert;
    },

    remove(id) {
      alerts = alerts.filter((a) => a.id !== id);
      save();
    },

    rearm(id) {
      const a = alerts.find((x) => x.id === id);
      if (a) {
        a.ausgeloestAm = null;
        a.ausloesekurs = null;
        save();
      }
    },

    // Prüft aktive Alarme gegen Live-Kurse ({ SYMBOL: { kurs } }) und gibt
    // die neu ausgelösten zurück.
    check(live) {
      const fired = [];
      for (const a of alerts) {
        if (a.ausgeloestAm) continue;
        const kurs = live?.[a.symbol]?.kurs;
        if (kurs == null || !Number.isFinite(kurs)) continue;
        if (a.richtung === 'ueber' ? kurs >= a.ziel : kurs <= a.ziel) {
          a.ausgeloestAm = new Date().toISOString();
          a.ausloesekurs = kurs;
          fired.push({ ...a });
        }
      }
      if (fired.length) save();
      return fired;
    },
  };
}
