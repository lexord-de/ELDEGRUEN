// Cloudflare Pages Function — läuft VOR jeder Auslieferung der Seite.
// Das Passwort liegt als verschlüsseltes Secret in Cloudflare (env.SITE_PASSWORD)
// und taucht NIRGENDS im HTML/JS-Code auf, der an den Browser geht.
//
// Einrichtung (siehe README_CLOUDFLARE.md für Details):
//   npx wrangler pages secret put SITE_PASSWORD
//   npx wrangler pages secret put COOKIE_SECRET
//
// WICHTIG: Cloudflare Pages trennt Secrets standardmäßig zwischen "Production"
// und "Preview". Setze sie für BEIDE Umgebungen (oder wähle im Dashboard beim
// Anlegen "Production and Preview"), sonst funktioniert der Login auf manchen
// URLs nicht wie erwartet. Siehe README_CLOUDFLARE.md, Abschnitt "Fehlersuche".

const COOKIE_NAME = "eg_session";
const SESSION_HOURS = 12;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" };

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
  if (!env.COOKIE_SECRET) return false;
  const value = getCookie(request, COOKIE_NAME);
  if (!value) return false;
  const [expiryStr, sig] = value.split(".");
  if (!expiryStr || !sig) return false;
  const expected = await hmac(env.COOKIE_SECRET, expiryStr);
  if (expected !== sig) return false;
  const expiry = parseInt(expiryStr, 10);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

function loginPage(error, misconfigured) {
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
  .warn{color:#a4451f;font-size:11px;background:#fbeae2;border-radius:4px;padding:10px;margin-top:14px;text-align:left;}
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
    ${misconfigured ? `<div class="warn"><b>Konfigurationsproblem:</b> SITE_PASSWORD oder COOKIE_SECRET ist in dieser Umgebung nicht gesetzt. In Cloudflare Pages werden Secrets getrennt für "Production" und "Preview" verwaltet — bitte beide setzen. Siehe README_CLOUDFLARE.md.</div>` : ''}
  </div>
</body></html>`;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const secretsConfigured = !!(env.SITE_PASSWORD && env.SITE_PASSWORD.length > 0 && env.COOKIE_SECRET && env.COOKIE_SECRET.length > 0);

  // Logout-Hilfe zum Testen: /?logout=1 löscht das Cookie sofort
  if (url.searchParams.get("logout") === "1") {
    return new Response(null, {
      status: 302,
      headers: { "Location": "/", "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0`, ...NO_STORE }
    });
  }

  // Login-Verarbeitung
  if (url.pathname === "/login" && request.method === "POST") {
    if (!secretsConfigured) {
      return new Response(loginPage(false, true), { status: 500, headers: { "Content-Type": "text/html; charset=UTF-8", ...NO_STORE } });
    }

    const form = await request.formData();
    const entered = (form.get("password") || "").toString().trim();
    const expected = env.SITE_PASSWORD.trim();

    if (entered.length > 0 && entered === expected) {
      const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
      const sig = await hmac(env.COOKIE_SECRET, expiry.toString());
      const cookieValue = `${expiry}.${sig}`;
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`,
          ...NO_STORE
        }
      });
    }
    return new Response(loginPage(true, false), { status: 401, headers: { "Content-Type": "text/html; charset=UTF-8", ...NO_STORE } });
  }

  if (!secretsConfigured) {
    return new Response(loginPage(false, true), { status: 500, headers: { "Content-Type": "text/html; charset=UTF-8", ...NO_STORE } });
  }

  // Alle anderen Aufrufe: Session prüfen
  if (await isValidSession(request, env)) {
    return next(); // Passwort korrekt -> Seite normal ausliefern
  }

  return new Response(loginPage(false, false), { status: 401, headers: { "Content-Type": "text/html; charset=UTF-8", ...NO_STORE } });
}

