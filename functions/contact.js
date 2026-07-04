// Cloudflare Pages Function – verarbeitet POST /api/contact
// Verschickt die Formulardaten per Resend (kostenlos bis 3.000 Mails/Monat).
//
// WICHTIG – DIESE DATEI MUSS UNTER GENAU DIESEM PFAD LIEGEN, DAMIT
// CLOUDFLARE PAGES SIE ALS FUNKTION ERKENNT:
//   /functions/api/contact.js   (relativ zum Projekt-Root, NICHT im Ordner
//   mit den Bildern oder direkt neben index.html!)
// Nach jeder Änderung an dieser Datei muss neu deployt werden – sonst
// läuft im Hintergrund weiter die alte Version.
//
// Benötigte Umgebungsvariable (Cloudflare Pages Dashboard -> Projekt ->
// Settings -> Environment variables -> Production):
//   RESEND_API_KEY  -> API-Key von resend.com (als Secret anlegen!)
//
// Voraussetzung: Domain bei resend.com hinzufügen und per DNS verifizieren,
// damit z.B. formular@eldegruen-service.de als Absender erlaubt ist.
//
// DIAGNOSE 400-FEHLER: Ruf https://deine-domain.de/api/contact direkt im
// Browser auf (GET). Kommt "ELDEGRUEN Kontakt-Funktion ist aktiv" zurück,
// ist die Funktion korrekt deployt und erreichbar. Kommt stattdessen die
// normale Seite oder ein 404, liegt die Datei am falschen Pfad oder wurde
// nicht neu deployt.
//
// Die Feldnamen hier MÜSSEN exakt zu denen passen, die das Kontaktformular
// in index.html per fetch('/api/contact', ...) sendet:
//   { name, adresse, email, telefon, leistung, nachricht }

const EMPFAENGER = "eldegruen-service@gmx.de";
const ABSENDER = "ELDEGRUEN Kontaktformular <formular@eldegruen-service.de>"; // muss zur verifizierten Domain gehören

// Gleiche Regel wie im Frontend (index.html, doForm()) – bewusst identisch
// gehalten, damit eine E-Mail nie im Browser als "gültig" durchgeht, aber
// hier serverseitig mit 400 abgelehnt wird (das war die Hauptursache für
// die bisherigen 400-Fehler).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Kleiner Diagnose-Endpunkt: im Browser aufrufbar (GET), um zu prüfen,
// ob die Funktion überhaupt deployt und erreichbar ist.
export async function onRequestGet(context) {
  return json({
    ok: true,
    info: "ELDEGRUEN Kontakt-Funktion ist aktiv.",
    hinweis: "Formulardaten werden per POST an diesen Endpunkt gesendet.",
    resendConfiguriert: Boolean(context.env.RESEND_API_KEY),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    let data;
    try {
      data = await request.json();
    } catch {
      // Kam kein (gültiges) JSON an? Sauberer 400 statt eines rohen
      // Parse-Fehlers, damit die Ursache im Alert sofort erkennbar ist.
      return json(
        { ok: false, error: "Ungültige Anfrage: Body war kein gültiges JSON." },
        400
      );
    }

    const name = (data.name || "").toString().trim();
    const adresse = (data.adresse || "").toString().trim();
    const email = (data.email || "").toString().trim().toLowerCase();
    const telefon = (data.telefon || "").toString().trim();
    const leistung = (data.leistung || "").toString().trim();
    const nachricht = (data.nachricht || "").toString().trim();
    const hp = (data.hp || "").toString().trim(); // optionales Honeypot-Feld

    // Spam-Falle: falls ein Bot das versteckte Feld ausfüllt, so tun als ob alles ok ist
    if (hp) {
      return json({ ok: true });
    }

    // Pflichtfelder müssen zu denen im Formular (index.html) passen: Name, E-Mail, Telefon
    // Fehlende Felder werden namentlich genannt, damit ein 400-Fehler sich
    // sofort einer Ursache zuordnen lässt (z.B. Feldnamen-Mismatch nach
    // einer Formular-Änderung, die noch nicht deployt wurde).
    const fehlend = [];
    if (!name) fehlend.push("name");
    if (!email) fehlend.push("email");
    if (!telefon) fehlend.push("telefon");
    if (fehlend.length) {
      return json(
        {
          ok: false,
          error: "Bitte alle Pflichtfelder ausfüllen.",
          fehlendeFelder: fehlend,
          empfangeneFelder: Object.keys(data || {}),
        },
        400
      );
    }
    if (!EMAIL_REGEX.test(email)) {
      return json({ ok: false, error: "Ungültige E-Mail-Adresse.", empfangeneEmail: email }, 400);
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
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
