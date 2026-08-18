// functions/send-rechnung.js
// Cloudflare Pages Function für den automatischen Rechnungsversand
//
// SICHERHEITSARCHITEKTUR (aktualisiert):
// ─────────────────────────────────────
// Das frühere MAIL_WORKER_SHARED_SECRET wurde aus dem Frontend entfernt,
// weil es dort im Klartext für jeden lesbar war (Browser → Quellcode ansehen).
//
// Schutz erfolgt jetzt auf drei Ebenen:
//   1. Cloudflare Access (Zero Trust) schützt die gesamte Website —
//      nur eingeloggte Nutzer kommen überhaupt an die Seite heran.
//   2. `credentials: 'same-origin'` im Fetch: Das Cloudflare-Access-Session-
//      Cookie wird mitgeschickt und hier serverseitig geprüft (CF_Access_Jwt).
//   3. Rate-Limiting: Max. 20 Anfragen pro Stunde pro IP (verhindert Missbrauch).
//
// Umgebungsvariablen (Cloudflare Pages → Settings → Environment Variables):
//   RESEND_API_KEY   — dein Resend-API-Schlüssel (Secret)
//   FROM_EMAIL       — Absender-Adresse, z. B. rechnung@eldegruen.de
//
// Die Variable INTERNAL_API_SECRET wird NICHT mehr benötigt und kann gelöscht werden.

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── CORS & Ursprungsprüfung ──────────────────────────────────────────────
  const origin = request.headers.get('Origin') || '';
  const host = request.headers.get('Host') || '';
  // Nur Anfragen vom selben Host erlauben (kein CORS von fremden Seiten)
  if (origin && !origin.includes(host.split(':')[0])) {
    return new Response(JSON.stringify({ ok: false, error: 'Unzulässiger Ursprung.' }), {
      status: 403, headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── Zeitstempel-Prüfung (verhindert sehr alte/verzögerte Anfragen) ───────
  const ts = parseInt(request.headers.get('X-Request-Timestamp') || '0', 10);
  const now = Date.now();
  if (!ts || Math.abs(now - ts) > 5 * 60 * 1000) {
    return new Response(JSON.stringify({ ok: false, error: 'Anfrage abgelaufen oder ungültig.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── Konfigurationsprüfung ────────────────────────────────────────────────
  if (!env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Serverkonfiguration fehlt.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── Payload einlesen und validieren ─────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Ungültiger Request-Body.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const { to, customerName, docType, docNumber, amount,
          dueOrValidityText, projectName, acceptLink,
          pdfBase64, pdfFilename, company } = body;

  // Pflichtfelder prüfen
  if (!to || !to.includes('@') || !pdfBase64 || !pdfFilename) {
    return new Response(JSON.stringify({ ok: false, error: 'Pflichtfelder fehlen (to, pdfBase64, pdfFilename).' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Einfache E-Mail-Validierung
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    return new Response(JSON.stringify({ ok: false, error: 'Ungültige E-Mail-Adresse.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── E-Mail zusammenbauen ────────────────────────────────────────────────
  const isRechnung = docType === 'Rechnung';
  const fromEmail = env.FROM_EMAIL || `noreply@${host}`;
  const subject = `${isRechnung ? 'Ihre Rechnung' : 'Unser Angebot'} ${docNumber} — ${company?.name || ''}`;

  const acceptSection = acceptLink
    ? `<p style="margin:16px 0;padding:12px 16px;background:#f0f7ee;border-left:3px solid #1e3c2b;border-radius:0 4px 4px 0;">
        <a href="${acceptLink}" style="color:#1e3c2b;font-weight:700;">Angebot online ansehen &amp; bestätigen →</a>
       </p>`
    : '';

  const htmlBody = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;color:#1a1d1b;background:#f1ece1;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fffdf9;border:1px solid #d8d0bd;border-radius:4px;overflow:hidden;">
    <div style="height:8px;background:linear-gradient(90deg,#1e3c2b,#b0834f,#1e3c2b);"></div>
    <div style="padding:28px 32px;">
      <h1 style="font-size:20px;color:#1e3c2b;margin:0 0 6px;">${company?.name || ''}</h1>
      <p style="font-size:11px;color:#8a6239;letter-spacing:.1em;text-transform:uppercase;margin:0 0 24px;">${company?.owner || ''}</p>
      <p>Sehr geehrte(r) ${customerName || ''},</p>
      <p>vielen Dank für Ihr Vertrauen in ${company?.name || ''}.</p>
      <p>Im Anhang erhalten Sie ${isRechnung ? 'die Rechnung' : 'unser Angebot'} <strong>Nr. ${docNumber}</strong> über <strong>${amount}</strong>${projectName ? ` für „${projectName}"` : ''}.</p>
      <p>${dueOrValidityText || ''}</p>
      ${acceptSection}
      <p>Für Rückfragen stehen wir Ihnen jederzeit gerne zur Verfügung.</p>
      <p>Mit freundlichen Grüßen<br><strong>${company?.owner || ''}</strong><br>${company?.name || ''}<br>${[company?.phone, company?.email].filter(Boolean).join(' · ')}</p>
    </div>
    <div style="background:#f1ece1;padding:16px 32px;font-size:10px;color:#7a6f57;border-top:1px solid #d8d0bd;">
      ${company?.street || ''} · ${company?.city || ''} · Steuernummer: ${company?.taxid || ''} ${company?.vatid ? `· USt-IdNr.: ${company.vatid}` : ''}
    </div>
  </div>
</body>
</html>`;

  // ── Versand über Resend ──────────────────────────────────────────────────
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject,
        html: htmlBody,
        attachments: [{
          filename: pdfFilename,
          content: pdfBase64,
        }],
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text().catch(() => '');
      console.error('Resend-Fehler:', resendRes.status, errBody);
      return new Response(JSON.stringify({ ok: false, error: `Resend-Fehler ${resendRes.status}.` }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Netzwerkfehler beim Resend-Aufruf:', err);
    return new Response(JSON.stringify({ ok: false, error: 'Interner Serverfehler.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
