// Web-Push-Benachrichtigungen (funktionieren auch bei geschlossener App).
// VAPID-Schlüssel kommen aus der Umgebung oder werden einmalig erzeugt und im
// Datenverzeichnis gespeichert. Abos, die der Push-Dienst als abgelaufen
// meldet (404/410), werden automatisch entfernt.

import webpush from 'web-push';

const MAX_SUBSCRIPTIONS = 20;

export function createPush({ store }) {
  let keys = null;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    keys = store.get('vapid');
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      store.set('vapid', keys);
      console.log('🔑 Neue VAPID-Schlüssel für Push erzeugt (im Datenverzeichnis gespeichert).');
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:finanz-ki@example.com', keys.publicKey, keys.privateKey);

  const list = () => store.get('pushSubscriptions', []);
  const save = (subs) => store.set('pushSubscriptions', subs);

  function validate(sub) {
    if (
      !sub ||
      typeof sub.endpoint !== 'string' ||
      !/^https:\/\//.test(sub.endpoint) ||
      sub.endpoint.length > 1000 ||
      typeof sub.keys?.p256dh !== 'string' ||
      typeof sub.keys?.auth !== 'string'
    ) {
      throw Object.assign(new Error('Ungültiges Push-Abo'), { status: 400 });
    }
    return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  }

  return {
    publicKey: keys.publicKey,
    count: () => list().length,

    subscribe(sub, userAgent = '') {
      const clean = validate(sub);
      const subs = list().filter((s) => s.endpoint !== clean.endpoint);
      subs.push({ ...clean, geraet: String(userAgent).slice(0, 160), erstelltAm: new Date().toISOString() });
      save(subs.slice(-MAX_SUBSCRIPTIONS));
    },

    unsubscribe(endpoint) {
      save(list().filter((s) => s.endpoint !== endpoint));
    },

    // payload: { title, body, url, tag }
    async sendAll(payload) {
      const subs = list();
      const gone = new Set();
      const results = await Promise.allSettled(
        subs.map((s) =>
          webpush
            .sendNotification(s, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' })
            .catch((err) => {
              if (err.statusCode === 404 || err.statusCode === 410) gone.add(s.endpoint);
              throw err;
            }),
        ),
      );
      if (gone.size) save(list().filter((s) => !gone.has(s.endpoint)));
      const failed = results.filter((r) => r.status === 'rejected');
      failed.forEach((r) => console.warn('[push]', r.reason?.statusCode ?? '', r.reason?.message));
      return { gesendet: results.length - failed.length, fehlgeschlagen: failed.length };
    },
  };
}
