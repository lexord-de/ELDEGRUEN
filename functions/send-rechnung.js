/* ===============================================================
   ELDEGRUEN – Rechnung/Angebot-Versand über Resend
   KORRIGIERTE VERSION — passt zu dem Payload, das
   unternehmerverwaltung.html tatsächlich sendet (sendMailAutomatically()),
   und zur Antwortstruktur, die dort erwartet wird ({ ok: true/false }).

   WICHTIG ZUM DEPLOYMENT:
   Diese Datei gehört als Cloudflare PAGES FUNCTION unter
   /functions/send-rechnung.js in DASSELBE Cloudflare-Pages-Projekt
   wie eldegruen-service.de (also derselbe Ort wie send-anfrage.js).
   NICHT als separater Cloudflare Worker auf *.workers.dev deployen —
   dieser war bei euch mit "Cloudflare Access" (Zero Trust) geschützt,
   das blockiert jeden automatischen fetch()-Aufruf aus dem Browser
   mit "Load failed", weil der Worker zuerst einen Login verlangt.

   In unternehmerverwaltung.html muss dazu passend gesetzt werden:
     const MAIL_WORKER_URL = '/send-rechnung';
   (relativer, gleicher Origin — kein Cloudflare Access, kein CORS-Ärger)

   Environment Variables im Cloudflare Pages Projekt (Settings → 
   Environment variables), NICHT im Code:
     RESEND_API_KEY        = dein Resend API-Key
     INTERNAL_API_SECRET   = muss exakt MAIL_WORKER_SHARED_SECRET
                             aus unternehmerverwaltung.html entsprechen
   =============================================================== */

const ABSENDER = 'ELDEGRUEN <rechnung@eldegruen-service.de>';
// Deine echte, geschäftliche Kontakt-Mailadresse. Hier landen Antworten
// der Kunden (reply_to), falls in den Firmen-Einstellungen kein eigenes
// "E-Mail"-Feld ausgefüllt ist.
const ECHTE_EMAIL = 'eldegruen-service@gmx.de';

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

function escapeHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!herkunftOk(request)) {
    return json({ ok: false, error: 'forbidden_origin' }, 403);
  }

  const providedSecret = request.headers.get('X-Internal-Secret') || '';
  if (!env.INTERNAL_API_SECRET || providedSecret !== env.INTERNAL_API_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // ---- Feldnamen exakt wie in sendMailAutomatically() in unternehmerverwaltung.html ----
  const email = (body.to || '').toString().trim();
  const customerName = (body.customerName || '').toString().trim();
  const docType = (body.docType || '').toString().trim();
  const isRechnung = docType === 'Rechnung';
  const docNumber = (body.docNumber || '').toString().trim();
  const amount = (body.amount || '').toString().trim();
  const dueOrValidityText = (body.dueOrValidityText || '').toString().trim();
  const projectName = (body.projectName || '').toString().trim();
  const acceptLink = (body.acceptLink || '').toString().trim();
  const pdfBase64 = (body.pdfBase64 || '').toString();
  const pdfFilename = (body.pdfFilename || 'Dokument.pdf').toString();
  const company = body.company || {};
  const companyName = (company.name || 'ELDEGRUEN').toString().trim();
  const owner = (company.owner || '').toString().trim();
  const phone = (company.phone || '').toString().trim();
  // Deine echte E-Mail: kommt aus dem Feld "E-Mail" bei Firmen-Einstellungen
  // (settings.email). Falls dort nichts eingetragen ist, wird automatisch
  // ECHTE_EMAIL als Rückfall verwendet.
  const ownerEmail = (company.email || ECHTE_EMAIL).toString().trim();

  if (!email || !docNumber || !pdfBase64) {
    return json({ ok: false, error: 'missing_fields' }, 400);
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ ok: false, error: 'server_not_configured' }, 500);
  }

  const subject = `${isRechnung ? 'Ihre Rechnung' : 'Unser Angebot'} ${docNumber} — ${companyName}`;

  const htmlBody = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#eef1ec;padding:36px 16px">
      <div style="max-width:560px;margin:0 auto">
        <div style="height:5px;background:linear-gradient(90deg,#b8874a,#d9b479,#b8874a);border-radius:5px 5px 0 0"></div>
        <div style="background:#ffffff;border-radius:0 0 14px 14px;overflow:hidden;border:1px solid #e2e7de;border-top:none;box-shadow:0 8px 28px rgba(47,82,51,.08)">
          <div style="background:#20361f;padding:34px 30px 28px;text-align:center">
            <img src="https://eldegruen-service.de/logo.png" alt="${escapeHtml(companyName)}" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:50%;background:#fff;padding:4px">
            <h1 style="margin:0;color:#ffffff;font-size:20px;letter-spacing:1.5px;font-weight:700">${escapeHtml(companyName)}</h1>
            <span style="display:inline-block;margin-top:12px;background:#b8874a;color:#20361f;font-weight:700;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;padding:5px 14px;border-radius:20px">${isRechnung ? 'Rechnung' : 'Angebot'} ${escapeHtml(docNumber)}</span>
          </div>
          <div style="padding:36px 34px 30px;color:#222;font-size:15px;line-height:1.7">
            <p style="margin-top:0;font-size:16px">Sehr geehrte(r) ${escapeHtml(customerName)},</p>
            <p>vielen Dank für Ihr Vertrauen in <strong>${escapeHtml(companyName)}</strong>.</p>
            <p>Im Anhang erhalten Sie ${isRechnung ? 'die Rechnung' : 'unser Angebot'} Nr. <strong>${escapeHtml(docNumber)}</strong>${amount ? ` über <strong>${escapeHtml(amount)}</strong>` : ''}${projectName ? ` für „${escapeHtml(projectName)}"` : ''} als PDF.</p>
            ${dueOrValidityText ? `<div style="background:#f7f8f5;border-left:3px solid #b8874a;border-radius:6px;padding:14px 18px;margin:20px 0;font-size:13.5px;color:#3d3d3d">${escapeHtml(dueOrValidityText)}</div>` : ''}
            ${acceptLink ? `<p style="text-align:center;margin:30px 0">
                <a href="${escapeHtml(acceptLink)}" style="background:#20361f;color:#ffffff;text-decoration:none;padding:13px 30px;border-radius:7px;font-size:14px;font-weight:600;display:inline-block">Angebot online ansehen &amp; bestätigen</a>
              </p>` : ''}
            <p>Für Rückfragen stehe ich Ihnen jederzeit gerne zur Verfügung.</p>
            <p style="margin-bottom:0">Mit freundlichen Grüßen<br><strong>${escapeHtml(owner)}</strong><br><span style="color:#777;font-size:13.5px">${escapeHtml(companyName)}${phone ? ` · ${escapeHtml(phone)}` : ''} · ${escapeHtml(ownerEmail)}</span></p>
          </div>
          <div style="background:#f7f8f5;border-top:1px solid #eceee9;padding:18px 30px;text-align:center;font-size:11.5px;color:#9a9a9a;letter-spacing:.3px">
            ${escapeHtml(companyName)}
          </div>
        </div>
      </div>
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
        to: [email],
        reply_to: ownerEmail,
        subject,
        html: htmlBody,
        attachments: [
          { filename: pdfFilename, content: pdfBase64 }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json({ ok: false, error: 'resend_error', detail: errText }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'network_error', detail: String(err) }, 500);
  }
}
