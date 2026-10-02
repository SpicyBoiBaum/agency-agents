// Fehlermeldung aus ?fehler=… anzeigen (kein Inline-Script wegen Content-Security-Policy).
const code = new URLSearchParams(location.search).get('fehler');
if (code) {
  const el = document.getElementById('fehler');
  el.textContent = code === 'sperre' ? 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' : 'Falsches Passwort.';
  el.hidden = false;
}
