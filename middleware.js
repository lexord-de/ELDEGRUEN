// Cloudflare Pages Function — läuft VOR jeder Auslieferung der Seite.
// Das Passwort liegt als verschlüsseltes Secret in Cloudflare (env.SITE_PASSWORD)
// und taucht NIRGENDS im HTML/JS-Code auf, der an den Browser geht.
//
// Einrichtung (siehe README_CLOUDFLARE.md für Details):
//   npx wrangler pages secret put SITE_PASSWORD
//   npx wrangler pages secret put COOKIE_SECRET
//
// COOKIE_SECRET ist ein zweiter, beliebiger, langer Zufallswert — er signiert
// das Login-Cookie, damit niemand ein gültiges Cookie fälschen kann.

const COOKIE_NAME = "eg_session";
const SESSION_HOURS = 12;

async function hmac(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}

async function isValidSession(request, env) {
  const value = getCookie(request, COOKIE_NAME);
  if (!value) return false;
  const [expiryStr, sig] = value.split(".");
  if (!expiryStr || !sig) return false;
  const expected = await hmac(env.COOKIE_SECRET, expiryStr);
  if (expected !== sig) return false;
  const expiry = parseInt(expiryStr, 10);
  return Date.now() < expiry;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eldegruen — Anmeldung</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:'Inter',system-ui,sans-serif;background:linear-gradient(160deg,#1e3c2b,#142a1d);}
  .card{background:#fffdf9;border-radius:6px;padding:38px 40px;width:320px;max-width:90vw;
    text-align:center;box-shadow:0 14px 40px rgba(0,0,0,.35);}
  h1{font-size:20px;color:#1e3c2b;margin:0 0 4px;}
  p{font-size:12px;color:#847a63;margin:0 0 20px;}
  input{width:100%;padding:11px 12px;border:1px solid #d8d0bd;border-radius:3px;font-size:14px;
    margin-bottom:10px;box-sizing:border-box;text-align:center;}
  button{width:100%;padding:11px;border:none;border-radius:3px;background:#1e3c2b;color:#fff;
    font-weight:700;font-size:13px;letter-spacing:.03em;cursor:pointer;text-transform:uppercase;}
  .err{color:#a4451f;font-size:12px;min-height:16px;margin-top:10px;}
</style></head>
<body>
  <div class="card">
    <h1>Eldegruen</h1>
    <p>Geschützter Bereich — bitte Passwort eingeben</p>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Passwort" autofocus required>
      <button type="submit">Anmelden</button>
    </form>
    <div class="err">${error ? "Falsches Passwort. Bitte erneut versuchen." : ""}</div>
  </div>
</body></html>`;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Login-Verarbeitung
  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    const entered = (form.get("password") || "").toString();

    if (!env.SITE_PASSWORD) {
      return new Response("SITE_PASSWORD ist nicht konfiguriert. Siehe README_CLOUDFLARE.md.", { status: 500 });
    }

    // Konstante Vergleichszeit (grober Schutz gegen Timing-Angriffe)
    const a = new TextEncoder().encode(entered.padEnd(64, "\0"));
    const b = new TextEncoder().encode(env.SITE_PASSWORD.padEnd(64, "\0"));
    let diff = a.length === b.length ? 0 : 1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a[i] || 0) ^ (b[i] || 0);
    }

    if (diff === 0 && entered.length === env.SITE_PASSWORD.length) {
      const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
      const sig = await hmac(env.COOKIE_SECRET, expiry.toString());
      const cookieValue = `${expiry}.${sig}`;
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`
        }
      });
    }
    return new Response(loginPage(true), { status: 401, headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // Alle anderen Aufrufe: Session prüfen
  if (await isValidSession(request, env)) {
    return next(); // Passwort korrekt -> Seite normal ausliefern
  }

  return new Response(loginPage(false), { status: 401, headers: { "Content-Type": "text/html; charset=UTF-8" } });
}
