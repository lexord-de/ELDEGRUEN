/* ===============================================================
   ELDEGRUEN – Kontaktformular-Versand über Cloudflare Pages Functions
   Sendet per Resend API direkt an eldegruen-service@gmx.de.
   Kein FormSubmit, kein Web3Forms, keine Werbung in der Mail.

   WICHTIG: Sowohl RESEND_API_KEY als auch TURNSTILE_SECRET_KEY werden
   NICHT hier im Code eingetragen, sondern als "Environment Variable /
   Secret" im Cloudflare Pages Dashboard hinterlegt. So bleiben sie
   geheim, auch wenn dieser Code öffentlich auf GitHub liegt.
   =============================================================== */

const EMPFAENGER = 'eldegruen-service@gmx.de';
// Absenderadresse MUSS zu einer bei Resend verifizierten Domain gehören.
const ABSENDER = 'ELDEGRUEN Website <formular@eldegruen-service.de>';
// Nur Anfragen von diesen Domains werden akzeptiert (Schutz vor
// direktem Skript-Aufruf von fremden Seiten).
const ERLAUBTE_HERKUNFT = [
  'https://eldegruen-service.de',
  'https://www.eldegruen-service.de'
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function herkunftOk(request) {
  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';
  return ERLAUBTE_HERKUNFT.some(o => origin === o || referer.startsWith(o));
}

async function turnstileOk(token, secret, ip) {
  if (!secret) return true; // Wenn kein Secret hinterlegt ist, Prüfung überspringen (z.B. lokal testen)
  if (!token) return false;
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form
    });
    const data = await res.json();
    return !!data.success;
  } catch (e) {
    return false;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!herkunftOk(request)) {
    return json({ success: false, error: 'forbidden_origin' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, error: 'invalid_json' }, 400);
  }

  const name = (body.name || '').toString().trim();
  const adresse = (body.adresse || '').toString().trim();
  const email = (body.email || '').toString().trim();
  const telefon = (body.telefon || '').toString().trim();
  const leistung = (body.leistung || '').toString().trim();
  const nachricht = (body.nachricht || '').toString().trim();
  const honeypot = (body.website || '').toString().trim();
  const tsToken = (body.turnstileToken || '').toString().trim();

  // Spam-Falle: Bots füllen verstecktes Feld aus, Menschen nicht
  if (honeypot !== '') {
    return json({ success: true });
  }

  const tsValid = await turnstileOk(tsToken, env.TURNSTILE_SECRET_KEY, request.headers.get('CF-Connecting-IP'));
  if (!tsValid) {
    return json({ success: false, error: 'turnstile_failed' }, 403);
  }

  if (!name || !email || !telefon) {
    return json({ success: false, error: 'missing_fields' }, 400);
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    return json({ success: false, error: 'invalid_email' }, 400);
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ success: false, error: 'server_not_configured' }, 500);
  }

  const betreff = `Neue Anfrage über die Website – ${name}`;

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6">
      <h2 style="color:#2f5233;margin-bottom:4px">Neue Kontaktanfrage</h2>
      <p style="color:#666;margin-top:0">eingegangen über eldegruen-service.de</p>
      <table style="border-collapse:collapse;width:100%;max-width:520px">
        <tr><td style="padding:6px 10px;font-weight:bold;width:120px">Name</td><td style="padding:6px 10px">${escapeHtml(name)}</td></tr>
        <tr style="background:#f5f5f5"><td style="padding:6px 10px;font-weight:bold">Adresse</td><td style="padding:6px 10px">${escapeHtml(adresse) || '-'}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:bold">E-Mail</td><td style="padding:6px 10px">${escapeHtml(email)}</td></tr>
        <tr style="background:#f5f5f5"><td style="padding:6px 10px;font-weight:bold">Telefon</td><td style="padding:6px 10px">${escapeHtml(telefon)}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:bold">Leistung</td><td style="padding:6px 10px">${escapeHtml(leistung) || '-'}</td></tr>
      </table>
      <p style="font-weight:bold;margin-bottom:4px">Nachricht:</p>
      <p style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px">${escapeHtml(nachricht) || '-'}</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: ABSENDER,
        to: [EMPFAENGER],
        reply_to: email,
        subject: betreff,
        html: htmlBody
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json({ success: false, error: 'resend_error', detail: errText }, 502);
    }

    // --- Professionelle Bestätigungsmail an den Kunden ---
    const kundenHtml = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#eef1ec;padding:36px 16px">
        <div style="max-width:540px;margin:0 auto">
          <div style="height:5px;background:linear-gradient(90deg,#b8874a,#d9b479,#b8874a);border-radius:5px 5px 0 0"></div>
          <div style="background:#ffffff;border-radius:0 0 14px 14px;overflow:hidden;border:1px solid #e2e7de;border-top:none;box-shadow:0 8px 28px rgba(47,82,51,.08)">
            <div style="background:#20361f;padding:34px 30px 28px;text-align:center">
              <img src="https://eldegruen-service.de/logo.png" alt="ELDEGRUEN" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:50%;background:#fff;padding:4px">
              <h1 style="margin:0;color:#ffffff;font-size:21px;letter-spacing:2px;font-weight:700">ELDEGRUEN</h1>
              <p style="margin:6px 0 0;color:#c9d6c3;font-size:11px;letter-spacing:2px;text-transform:uppercase">Garten &amp; Gebäudeservice</p>
            </div>
            <div style="padding:36px 34px 30px;color:#222;font-size:15px;line-height:1.7">
              <p style="margin-top:0;font-size:16px">Hallo ${escapeHtml(name)},</p>
              <p>vielen Dank für Ihre Anfrage bei <strong>ELDEGRUEN</strong>! Wir haben Ihre Nachricht erhalten und melden uns in der Regel <strong>innerhalb von 24 Stunden</strong> bei Ihnen.</p>
              <div style="background:#f7f8f5;border-left:3px solid #b8874a;border-radius:6px;padding:18px 20px;margin:24px 0;font-size:13.5px;color:#3d3d3d">
                <strong style="display:block;margin-bottom:8px;color:#20361f;letter-spacing:.5px;text-transform:uppercase;font-size:11.5px">Ihre Anfrage im Überblick</strong>
                ${leistung ? `<div style="margin-bottom:4px"><span style="color:#888">Leistung:</span> ${escapeHtml(leistung)}</div>` : ''}
                ${nachricht ? `<div><span style="color:#888">Nachricht:</span> ${escapeHtml(nachricht)}</div>` : ''}
              </div>
              <p style="margin-bottom:0">Mit freundlichen Grüßen<br><strong>Ihr ELDEGRUEN-Team</strong><br><span style="color:#777;font-size:13.5px">An der Domsühler Straße 2 · 19374 Domsühl</span></p>
            </div>
            <div style="background:#f7f8f5;border-top:1px solid #eceee9;padding:18px 30px;text-align:center;font-size:11.5px;color:#9a9a9a;letter-spacing:.3px">
              eldegruen-service.de &nbsp;·&nbsp; eldegruen-service@gmx.de
            </div>
          </div>
        </div>
      </div>
    `;

    // Bestätigung an den Kunden separat verschicken — wenn sie fehlschlägt, soll das
    // die eigentliche Anfrage (die schon erfolgreich bei dir angekommen ist) nicht
    // als Fehler zurückmelden, daher hier kein throw, nur best-effort.
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: ABSENDER,
          to: [email],
          subject: 'Ihre Anfrage bei ELDEGRUEN ist eingegangen',
          html: kundenHtml
        })
      });
    } catch (confirmErr) {
      // Best-effort — Hauptanfrage ist trotzdem angekommen.
    }

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: 'network_error', detail: String(err) }, 500);
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
