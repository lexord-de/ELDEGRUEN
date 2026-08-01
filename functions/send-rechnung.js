/* ===============================================================
   ELDEGRUEN – Rechnung/Angebot-Versand über Resend
   Zusätzliche Versandart neben der bestehenden Teilen-Funktion.
   Sendet die PDF als echten Anhang + professionelle HTML-Mail.

   WICHTIG: Der Resend API-Key wird als Environment Variable
   "RESEND_API_KEY" im Cloudflare Pages Dashboard hinterlegt,
   NICHT im Code. Ebenso "INTERNAL_API_SECRET" — ein selbst
   ausgedachtes Passwort, das nur die Verwaltungs-Seite kennt.
   =============================================================== */

const ABSENDER = 'ELDEGRUEN <rechnung@eldegruen-service.de>';
// Nur Anfragen von diesen Domains werden akzeptiert.
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

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!herkunftOk(request)) {
    return json({ success: false, error: 'forbidden_origin' }, 403);
  }

  const providedSecret = request.headers.get('X-Internal-Secret') || '';
  if (!env.INTERNAL_API_SECRET || providedSecret !== env.INTERNAL_API_SECRET) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, error: 'invalid_json' }, 400);
  }

  const email = (body.email || '').toString().trim();
  const anrede = (body.anrede || '').toString().trim();
  const subject = (body.subject || '').toString().trim();
  const isRechnung = !!body.isRechnung;
  const number = (body.number || '').toString().trim();
  const companyName = (body.companyName || 'ELDEGRUEN').toString().trim();
  const betragText = (body.betragText || '').toString().trim();
  const projekt = (body.projekt || '').toString().trim();
  const dueLine = (body.dueLine || '').toString().trim();
  const acceptLink = (body.acceptLink || '').toString().trim();
  const owner = (body.owner || '').toString().trim();
  const phone = (body.phone || '').toString().trim();
  const ownerEmail = (body.ownerEmail || '').toString().trim();
  const pdfBase64 = (body.pdfBase64 || '').toString();
  const filename = (body.filename || 'Dokument.pdf').toString();

  if (!email || !subject || !pdfBase64) {
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

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;background:#f4f6f4;padding:30px 0">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e8e2">
        <div style="background:#2f5233;padding:26px 30px;text-align:center">
          <h1 style="margin:0;color:#ffffff;font-size:20px;letter-spacing:.5px">${escapeHtml(companyName)}</h1>
          <p style="margin:4px 0 0;color:#cfe0d2;font-size:12px;letter-spacing:1.5px;text-transform:uppercase">${isRechnung ? 'Rechnung' : 'Angebot'} ${escapeHtml(number)}</p>
        </div>
        <div style="padding:32px 30px;color:#1a1a1a;font-size:15px;line-height:1.65">
          <p style="margin-top:0">Sehr geehrte(r) ${escapeHtml(anrede)},</p>
          <p>vielen Dank für Ihr Vertrauen in ${escapeHtml(companyName)}.</p>
          <p>Im Anhang erhalten Sie ${isRechnung ? 'die Rechnung' : 'unser Angebot'} Nr. <strong>${escapeHtml(number)}</strong>${betragText ? ` über <strong>${escapeHtml(betragText)}</strong>` : ''}${projekt ? ` für „${escapeHtml(projekt)}"` : ''} als PDF.</p>
          ${dueLine ? `<p>${escapeHtml(dueLine)}</p>` : ''}
          ${acceptLink ? `<p style="text-align:center;margin:26px 0">
              <a href="${escapeAttr(acceptLink)}" style="background:#2f5233;color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:6px;font-size:14px;display:inline-block">Angebot online ansehen &amp; bestätigen</a>
            </p>` : ''}
          <p>Für Rückfragen stehe ich Ihnen jederzeit gerne zur Verfügung.</p>
          <p style="margin-bottom:0">Mit freundlichen Grüßen<br><strong>${escapeHtml(owner)}</strong><br>${escapeHtml(companyName)}<br>${escapeHtml(phone)}${phone && ownerEmail ? ' · ' : ''}${escapeHtml(ownerEmail)}</p>
        </div>
        <div style="background:#f7f8f6;padding:14px 30px;text-align:center;font-size:11px;color:#999">
          ${escapeHtml(companyName)}
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
        reply_to: ownerEmail || undefined,
        subject,
        html: htmlBody,
        attachments: [
          { filename, content: pdfBase64 }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json({ success: false, error: 'resend_error', detail: errText }, 502);
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
function escapeAttr(str) {
  return escapeHtml(str);
}
