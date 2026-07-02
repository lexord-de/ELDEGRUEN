// Cloudflare Pages Function – verarbeitet POST /api/contact
// Verschickt die Formulardaten per Cloudflare Email Service (REST API).
//
// Benötigte Umgebungsvariablen (Cloudflare Pages Dashboard -> Projekt ->
// Settings -> Environment variables -> Production):
//   CF_ACCOUNT_ID       -> deine Cloudflare Account-ID
//   CF_EMAIL_API_TOKEN  -> API-Token mit Berechtigung "Email Send" (als Secret anlegen!)
//
// Voraussetzung: Domain in "Email Sending" (Cloudflare Dashboard) onboarden,
// damit z.B. formular@eldegruen-service.de als Absender erlaubt ist.

const EMPFAENGER = "info@eldegruen-service.de";
const ABSENDER = "formular@eldegruen-service.de"; // muss zur onboardeten Domain gehören

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const vorname = (data.vorname || "").toString().trim();
    const nachname = (data.nachname || "").toString().trim();
    const email = (data.email || "").toString().trim();
    const leistung = (data.leistung || "").toString().trim();
    const nachricht = (data.nachricht || "").toString().trim();
    const hp = (data.hp || "").toString().trim(); // optionales Honeypot-Feld

    // Spam-Falle: falls ein Bot das versteckte Feld ausfüllt, so tun als ob alles ok ist
    if (hp) {
      return json({ ok: true });
    }

    if (!vorname || !nachname || !email || !nachricht) {
      return json({ ok: false, error: "Bitte alle Pflichtfelder ausfüllen." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Ungültige E-Mail-Adresse." }, 400);
    }

    const betreff = `Neue Anfrage: ${vorname} ${nachname} – ${leistung || "Allgemein"}`;
    const text =
      `Neue Anfrage über eldegruen-service.de\n\n` +
      `Name: ${vorname} ${nachname}\n` +
      `E-Mail: ${email}\n` +
      `Leistung: ${leistung || "-"}\n\n` +
      `Nachricht:\n${nachricht}`;

    if (!env.CF_ACCOUNT_ID || !env.CF_EMAIL_API_TOKEN) {
      return json(
        { ok: false, error: "Server nicht konfiguriert (CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN fehlen)." },
        500
      );
    }

    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CF_EMAIL_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: EMPFAENGER,
          from: ABSENDER,
          reply_to: email,
          subject: betreff,
          text: text,
        }),
      }
    );

    if (!cfRes.ok) {
      const details = await cfRes.text();
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
