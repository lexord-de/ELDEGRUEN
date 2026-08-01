<?php
/* ===============================================================
   ELDEGRUEN – Kontaktformular-Versand
   Sendet direkt per PHP mail() an eldegruen-service@gmx.de.
   Kein Drittanbieter, keine Werbung, keine Weitergabe an Dritte.
   =============================================================== */

header('Content-Type: application/json; charset=utf-8');

// Nur POST-Anfragen erlauben
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'method_not_allowed']);
    exit;
}

// Empfänger – hier bei Bedarf ändern
$empfaenger = 'eldegruen-service@gmx.de';

// Eingehende Daten lesen: JSON (per fetch) oder klassisches POST-Formular
$raw = file_get_contents('php://input');
$json = json_decode($raw, true);
$input = is_array($json) ? $json : $_POST;

// Eingaben einlesen und säubern
function clean($v) {
    $v = trim($v ?? '');
    $v = str_replace(["\r", "\n"], ' ', $v); // Header-Injection verhindern
    return htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
}

$name    = clean($input['name'] ?? '');
$adresse = clean($input['adresse'] ?? '');
$email   = clean($input['email'] ?? '');
$telefon = clean($input['telefon'] ?? '');
$leistung= clean($input['leistung'] ?? '');
$nachricht = trim($input['nachricht'] ?? ''); // Zeilenumbrüche hier erlaubt
$honeypot = trim($input['website'] ?? ''); // Spam-Falle (unsichtbares Feld)

// Spam-Falle: Bots füllen versteckte Felder aus, Menschen nicht
if ($honeypot !== '') {
    echo json_encode(['success' => true]); // Bot bekommt "Erfolg" vorgetäuscht, aber es passiert nichts
    exit;
}

// Pflichtfelder prüfen
if ($name === '' || $email === '' || $telefon === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'missing_fields']);
    exit;
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid_email']);
    exit;
}

// --- E-Mail an dich (den Betrieb) ---
$betreff = "Neue Anfrage über die Website – " . $name;

$text = "Neue Kontaktanfrage über eldegruen-service.de\n";
$text .= "----------------------------------------------\n";
$text .= "Name:      $name\n";
$text .= "Adresse:   " . ($adresse ?: '-') . "\n";
$text .= "E-Mail:    $email\n";
$text .= "Telefon:   $telefon\n";
$text .= "Leistung:  " . ($leistung ?: '-') . "\n";
$text .= "Nachricht:\n" . ($nachricht !== '' ? $nachricht : '-') . "\n";

$headers = "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
$headers .= "From: ELDEGRUEN Website <no-reply@eldegruen-service.de>\r\n";
$headers .= "Reply-To: $name <$email>\r\n";

$erfolg = @mail($empfaenger, $betreff, $text, $headers);

// --- Automatische Empfangsbestätigung an den Kunden ---
if ($erfolg) {
    $autoBetreff = "Ihre Anfrage bei ELDEGRUEN ist eingegangen";
    $autoText  = "Hallo $name,\n\n";
    $autoText .= "vielen Dank für Ihre Anfrage bei ELDEGRUEN! Wir haben Ihre Nachricht erhalten und melden uns in der Regel innerhalb von 24 Stunden bei Ihnen.\n\n";
    $autoText .= "Mit freundlichen Grüßen\nIhr ELDEGRUEN-Team\nAn der Domsühler Straße 2, 19374 Domsühl\n";

    $autoHeaders = "MIME-Version: 1.0\r\n";
    $autoHeaders .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $autoHeaders .= "From: ELDEGRUEN <$empfaenger>\r\n";

    @mail($email, $autoBetreff, $autoText, $autoHeaders);
}

echo json_encode(['success' => (bool)$erfolg]);
