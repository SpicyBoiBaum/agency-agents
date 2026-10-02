// Startpunkt: Umgebung laden, Sicherheitsprüfung, Server und Alarm-Überwachung starten.

try {
  process.loadEnvFile?.(); // .env laden (Node >= 20.12)
} catch {
  // keine .env vorhanden – Umgebungsvariablen werden direkt genutzt
}

const { createApp } = await import('./src/app.js');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const LOCAL_ONLY = ['127.0.0.1', 'localhost', '::1'].includes(HOST);

// Wer die App im Netzwerk oder Internet erreichbar macht, braucht ein Passwort –
// sonst könnte jede Person KI-Analysen auf Kosten des API-Schlüssels starten.
if (!LOCAL_ONLY && !process.env.APP_PASSWORD && process.env.ALLOW_NO_PASSWORD !== '1') {
  console.error(
    `❌ HOST=${HOST} macht die App von außen erreichbar, aber APP_PASSWORD ist nicht gesetzt.\n` +
      '   Setze APP_PASSWORD in der .env (bzw. bei deinem Hosting-Anbieter) und starte neu.',
  );
  process.exit(1);
}

const { server, monitor } = createApp();

server.listen(PORT, HOST, () => {
  console.log(`📈 Finanz-KI-Analyse läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(process.env.APP_PASSWORD ? '🔒 Passwortschutz aktiv' : 'ℹ️  Kein Passwortschutz (nur lokal erreichbar)');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('⚠️  ANTHROPIC_API_KEY fehlt – Kurse funktionieren, die KI-Analyse nicht.');
  }
  monitor.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    monitor.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
