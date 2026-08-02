/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ELDEGRUEN — Kontaktformular-Endpunkt (Cloudflare Pages Function)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Zweck:
 *  Diese Datei beantwortet genau die Adresse, die das Kontaktformular
 *  auf eldegruen-service.de per fetch() anspricht: /send-anfrage
 *  (siehe index.html, Funktion doForm()).
 *
 *  Sie prüft das Cloudflare-Turnstile-Sicherheits-Token, wehrt den
 *  Honeypot ("website"-Feld) ab und verschickt dann eine E-Mail über
 *  Resend an dein GMX-Postfach — mit der Anfrage des Besuchers als
 *  Inhalt und dessen E-Mail-Adresse als Reply-To.
 *
 *  ─────────────────────────────────────────────────────────────────────
 *  EINRICHTUNG:
 *  ─────────────────────────────────────────────────────────────────────
 *  1) Diese Datei unter genau diesem Pfad in dein GitHub-Repo legen:
 *       functions/send-anfrage.js
 *     (Cloudflare Pages erkennt den Ordner "functions" automatisch und
 *     macht jede Datei darin unter ihrem Dateinamen als Route verfügbar
 *     — diese Datei wird automatisch zu POST /send-anfrage.)
 *
 *  2) In Cloudflare Pages → dein Projekt → Settings → Environment
 *     variables → Production (und Preview) folgende drei Werte als
 *     "Secret" hinzufügen:
 *       RESEND_API_KEY        = dein Resend-API-Key
 *       TURNSTILE_SECRET_KEY  = der Secret Key zu deinem Turnstile-
 *                                Widget (Dashboard → Turnstile → dein
 *                                Widget mit Site Key
 *                                0x4AAAAAAEEaApgPyGlsv72C → Secret Key
 *                                daneben kopieren)
 *       NOTIFY_EMAIL           = deine echte GMX-Adresse, an die neue
 *                                Anfragen gehen sollen (z. B.
 *                                eldegruen-service@gmx.de)
 *
 *  3) FROM_EMAIL unten muss eine bei Resend verifizierte Adresse auf
 *     deiner Domain sein — bereits eingetragen: info@eldegruen-service.de
 *     (setzt voraus, dass eldegruen-service.de bei Resend verifiziert ist,
 *     das habt ihr für die Rechnungs-Mails bereits eingerichtet).
 *
 *  4) Nach dem nächsten Git-Push deployt Cloudflare Pages automatisch
 *     neu, und /send-anfrage ist live.
 * ═══════════════════════════════════════════════════════════════════════
 */

const FROM_EMAIL = 'Eldegruen Kontaktformular <info@eldegruen-service.de>';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return json({ success: false, error: 'Ungültiger Anfrage-Body.' }, 400);
    }

    const {
      name, adresse, email, telefon, leistung, nachricht, website, turnstileToken,
    } = body;

    // ── Honeypot: Bots füllen unsichtbare Felder aus, Menschen nicht ──
    if (website) {
      // Wir tun so, als wäre alles gut gelaufen, um Bots nicht zu verraten,
      // schicken aber keine Mail.
      return json({ success: true }, 200);
    }

    if (!name || !email || !telefon) {
      return json({ success: false, error: 'Pflichtfelder fehlen.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return json({ success: false, error: 'Ungültige E-Mail-Adresse.' }, 400);
    }

    // ── Konfigurationsprüfung ──
    if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY || !env.NOTIFY_EMAIL) {
      return json({
        success: false,
        error: 'Server noch nicht eingerichtet: RESEND_API_KEY / TURNSTILE_SECRET_KEY / NOTIFY_EMAIL fehlen als Environment Variable in Cloudflare Pages.',
      }, 500);
    }

    // ── Turnstile-Token serverseitig prüfen ──
    if (!turnstileToken) {
      return json({ success: false, error: 'Sicherheits-Check fehlt.' }, 400);
    }
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: ip,
      }),
    });
    const verifyData = await verifyRes.json().catch(() => ({ success: false }));
    if (!verifyData.success) {
      return json({ success: false, error: 'Sicherheits-Check fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.' }, 403);
    }

    // ── E-Mail an dich zusammenbauen ──
    const subject = `Neue Anfrage über die Website — ${name}`;
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;max-width:560px;">
        <h2 style="color:#1e3c2b;margin:0 0 14px;">Neue Kontaktanfrage von der Website</h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:4px 0;color:#666;width:110px;">Name</td><td style="padding:4px 0;"><strong>${esc(name)}</strong></td></tr>
          <tr><td style="padding:4px 0;color:#666;">E-Mail</td><td style="padding:4px 0;">${esc(email)}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Telefon</td><td style="padding:4px 0;">${esc(telefon)}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Adresse</td><td style="padding:4px 0;">${esc(adresse || '-')}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Leistung</td><td style="padding:4px 0;">${esc(leistung || '-')}</td></tr>
        </table>
        <p style="margin:18px 0 4px;color:#666;">Nachricht:</p>
        <p style="margin:0;white-space:pre-wrap;background:#f7f4ed;border:1px solid #e7e0d2;border-radius:4px;padding:12px 14px;">${esc(nachricht || '-')}</p>
      </div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [env.NOTIFY_EMAIL],
        reply_to: email,
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.error('Resend-Fehler:', resendRes.status, resendData);
      return json({ success: false, error: 'Versand fehlgeschlagen.' }, 502);
    }

    return json({ success: true }, 200);
  } catch (err) {
    console.error('Fehler in /send-anfrage:', err);
    return json({ success: false, error: 'Unerwarteter Serverfehler.' }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
