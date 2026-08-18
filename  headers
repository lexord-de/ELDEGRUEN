/*
  # Verhindert Clickjacking (Seite darf nicht in iFrame eingebettet werden)
  X-Frame-Options: DENY

  # Verhindert MIME-Type-Sniffing
  X-Content-Type-Options: nosniff

  # Kein Referrer bei externen Links
  Referrer-Policy: strict-origin-when-cross-origin

  # Zugriff nur über HTTPS (1 Jahr)
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

  # Kamera/Mikrofon etc. sperren
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

  # Content Security Policy — erlaubt nur benötigte Quellen
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://is.gd; frame-ancestors 'none';

/send-rechnung
  # API-Route: kein Caching, nur POST erlaubt
  Cache-Control: no-store
  X-Robots-Tag: noindex
