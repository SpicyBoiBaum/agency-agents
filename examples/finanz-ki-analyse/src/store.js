// Kleiner, dauerhafter Schlüssel-Wert-Speicher als JSON-Datei im DATA_DIR.
// Reicht für eine Einzelperson (Alarme, Push-Abos, Schlüssel) völlig aus.
// Geschrieben wird atomar (temporäre Datei + rename), damit ein Absturz
// die Datei nicht beschädigt.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createStore(dir = process.env.DATA_DIR || './data') {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.json');
  let data = {};
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[store] ${file} unlesbar, starte leer:`, err.message);
  }
  const persist = () => {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EROFS') {
        err.message = `Keine Schreibrechte im Datenverzeichnis "${dir}" (DATA_DIR). Prüfe Pfad und Rechte des Volumes. (${err.message})`;
      }
      throw err;
    }
  };
  return {
    dir,
    get: (key, fallback = null) => (key in data ? structuredClone(data[key]) : fallback),
    set(key, value) {
      data[key] = structuredClone(value);
      persist();
    },
    // Adapter im Stil von localStorage, z. B. für createAlertStore()
    asStorage: () => ({
      getItem: (k) => (k in data ? JSON.stringify(data[k]) : null),
      setItem(k, v) {
        data[k] = JSON.parse(v);
        persist();
      },
    }),
  };
}
