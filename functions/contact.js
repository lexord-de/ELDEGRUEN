// Cloudflare Pages Function – verarbeitet POST /api/contact
// Verschickt die Formulardaten per Resend (kostenlos bis 3.000 Mails/Monat).
//
// Benötigte Umgebungsvariable (Cloudflare Pages Dashboard -> Projekt ->
// Settings -> Environment variables -> Production):
//   RESEND_API_KEY  -> API-Key von resend.com (als Secret anlegen!)
//
// Voraussetzung: Domain bei resend.com hinzufügen und per DNS verifizieren,
// damit z.B. formular@eldegruen-service.de als Absender erlaubt ist.
//
// WICHTIG: Die Feldnamen hier MÜSSEN exakt zu denen passen, die das
// Kontaktformular in index.html per fetch('/api/contact', ...) sendet:
//   { name, adresse, email, telefon, leistung, nachricht }
// Werden hier andere Feldnamen erwartet (z.B. vorname/nachname), schlägt
// die Pflichtfeld-Prüfung unten IMMER fehl -> Formular liefert dauerhaft
// einen 400-Fehler, egal was eingegeben wird.

const EMPFAENGER = "eldegruen-service@gmx.de";
const ABSENDER = "ELDEGRUEN Kontaktformular <formular@eldegruen-service.de>"; // muss zur verifizierten Domain gehören

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const name = (data.name || "").toString().trim();
    const adresse = (data.adresse || "").toString().trim();
    const email = (data.email || "").toString().trim();
    const telefon = (data.telefon || "").toString().trim();
    const leistung = (data.leistung || "").toString().trim();
    const nachricht = (data.nachricht || "").toString().trim();
    const hp = (data.hp || "").toString().trim(); // optionales Honeypot-Feld

    // Spam-Falle: falls ein Bot das versteckte Feld ausfüllt, so tun als ob alles ok ist
    if (hp) {
      return json({ ok: true });
    }

    // Pflichtfelder müssen zu denen im Formular (index.html) passen: Name, E-Mail, Telefon
    if (!name || !email || !telefon) {
      return json({ ok: false, error: "Bitte alle Pflichtfelder ausfüllen." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Ungültige E-Mail-Adresse." }, 400);
    }

    const betreff = `Neue Anfrage: ${name} – ${leistung || "Allgemein"}`;
    const text =
      `Neue Anfrage über eldegruen-service.de\n\n` +
      `Name: ${name}\n` +
      `E-Mail: ${email}\n` +
      `Telefon: ${telefon}\n` +
      `Adresse: ${adresse || "-"}\n` +
      `Leistung: ${leistung || "-"}\n\n` +
      `Nachricht:\n${nachricht || "-"}`;

    if (!env.RESEND_API_KEY) {
      return json(
        { ok: false, error: "Server nicht konfiguriert (RESEND_API_KEY fehlt)." },
        500
      );
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ABSENDER,
        to: [EMPFAENGER],
        reply_to: email,
        subject: betreff,
        text: text,
      }),
    });

    if (!resendRes.ok) {
      const details = await resendRes.text();
      return json({ ok: false, error: "E-Mail-Versand fehlgeschlagen.", details }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message || "Unbekannter Fehler." }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
