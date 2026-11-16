/**
 * Erweiterte SMTP-Statuscodes (RFC 3463, 7372, 7505) auf Deutsch, dazu häufige Codes von Microsoft 365 /
 * Exchange Online und Hinweise anhand typischer Fehlermeldungen.
 */

export const classText: Record<string, string> = {
  "2": "zugestellt",
  "4": "vorübergehender Fehler – der Server versucht es weiter",
  "5": "dauerhafter Fehler – die Nachricht wurde nicht zugestellt",
};

/** Bedeutung nach „Betreff.Detail“ (gilt für 4.x.x und 5.x.x gleichermaßen) */
const generic: Record<string, string> = {
  "0.0": "sonstiger oder unbekannter Fehler",
  "1.0": "Problem mit der Adresse",
  "1.1": "Postfach existiert nicht (Empfängeradresse unbekannt)",
  "1.2": "Ziel-Domain existiert nicht oder ist nicht erreichbar",
  "1.3": "Empfängeradresse ist ungültig geschrieben",
  "1.4": "Empfängeradresse ist mehrdeutig",
  "1.6": "Postfach ist umgezogen, eine Weiterleitung gibt es nicht",
  "1.7": "Absenderadresse ist ungültig",
  "1.8": "Absenderadresse oder -Domain wird abgelehnt",
  "1.10": "Empfänger nicht gefunden bzw. die Domain nimmt keine E-Mails an (Null-MX)",
  "2.0": "Problem mit dem Postfach",
  "2.1": "Postfach ist deaktiviert und nimmt nichts an",
  "2.2": "Postfach ist voll",
  "2.3": "Nachricht ist größer als für dieses Postfach erlaubt",
  "2.4": "Problem beim Erweitern einer Verteilerliste",
  "3.0": "Problem am Mailsystem des Empfängers",
  "3.1": "Speicher des Mailsystems ist voll",
  "3.2": "Mailsystem nimmt derzeit keine Nachrichten an",
  "3.3": "Mailsystem unterstützt eine benötigte Funktion nicht",
  "3.4": "Nachricht ist größer als das Mailsystem erlaubt",
  "3.5": "Mailsystem ist falsch konfiguriert",
  "4.0": "Netzwerk- oder Routingproblem",
  "4.1": "Zielserver antwortet nicht",
  "4.2": "Verbindung wurde abgebrochen",
  "4.3": "DNS- oder Routingfehler",
  "4.4": "keine Zustellroute gefunden (z. B. kein MX-Eintrag)",
  "4.5": "Mailsystem ist überlastet",
  "4.6": "Mail-Schleife erkannt",
  "4.7": "Zustellzeit abgelaufen – der Server hat aufgegeben",
  "5.0": "Protokollfehler",
  "5.1": "ungültiger SMTP-Befehl",
  "5.2": "Syntaxfehler im SMTP-Befehl",
  "5.3": "zu viele Empfänger",
  "5.4": "ungültige Befehlsparameter",
  "6.0": "Problem mit dem Inhalt der Nachricht",
  "6.1": "Format bzw. Medientyp wird nicht unterstützt",
  "6.3": "Umwandlung des Inhalts nicht möglich",
  "7.0": "Sicherheits- oder Richtlinienproblem",
  "7.1": "Zustellung nicht erlaubt – vom Empfängersystem abgelehnt (Richtlinie)",
  "7.2": "Verteilerliste darf nicht erweitert werden",
  "7.4": "Sicherheitsfunktion wird nicht unterstützt",
  "7.5": "Verschlüsselung fehlgeschlagen",
  "7.7": "Integritätsprüfung fehlgeschlagen",
  "7.8": "Anmeldedaten ungültig",
  "7.9": "Anmeldeverfahren zu schwach",
  "7.10": "Verschlüsselung (TLS) erforderlich",
  "7.11": "für dieses Anmeldeverfahren ist Verschlüsselung erforderlich",
  "7.13": "Benutzerkonto ist deaktiviert",
  "7.20": "keine gültige DKIM-Signatur",
  "7.21": "keine akzeptable DKIM-Signatur",
  "7.22": "keine gültige DKIM-Signatur der Absender-Domain",
  "7.23": "SPF-Prüfung fehlgeschlagen",
  "7.24": "SPF-Prüfung nicht möglich (Fehler im SPF-Eintrag)",
  "7.25": "Reverse-DNS-Prüfung fehlgeschlagen (kein passender PTR-Eintrag)",
  "7.26": "mehrere Authentifizierungsprüfungen fehlgeschlagen (z. B. DMARC)",
  "7.27": "Absender-Domain nimmt selbst keine E-Mails an (Null-MX)",
};

/** Microsoft 365 / Exchange Online – Codes mit eigener Bedeutung */
const microsoft: Record<string, string> = {
  "5.1.8": "Absender gesperrt: Microsoft hat das Konto wegen verdächtigem Spamversand blockiert",
  "5.1.10": "Empfänger in der Ziel-Organisation nicht gefunden",
  "5.2.121": "Empfänger hat sein Stundenlimit für Nachrichten von diesem Absender erreicht",
  "5.2.122": "Empfänger hat sein Stundenlimit für eingehende Nachrichten erreicht",
  "5.4.1": "Empfängeradresse abgelehnt: In der Ziel-Organisation (Microsoft 365) gibt es diese Adresse nicht",
  "5.4.6": "Routing-Schleife (z. B. Weiterleitung oder Connector im Kreis)",
  "5.4.14": "Routing-Schleife (z. B. Weiterleitung oder Connector im Kreis)",
  "5.4.300": "Zustellzeit abgelaufen – der Server hat aufgegeben",
  "5.7.57": "Versand ohne Anmeldung: Der Client hat sich vor dem Senden nicht authentifiziert",
  "5.7.64": "Relay verweigert: Die Nachricht passt zu keinem Connector der Organisation",
  "5.7.124": "Absender steht nicht auf der Liste der zugelassenen Absender der Gruppe",
  "5.7.133": "Gruppe nimmt nur Nachrichten von internen bzw. angemeldeten Absendern an",
  "5.7.134": "Postfach nimmt nur Nachrichten von internen bzw. angemeldeten Absendern an",
  "5.7.135": "Öffentlicher Ordner nimmt nur Nachrichten von internen bzw. angemeldeten Absendern an",
  "5.7.136": "E-Mail-Benutzer nimmt nur Nachrichten von internen bzw. angemeldeten Absendern an",
  "5.7.501": "Zugriff verweigert: Spam erkannt, Absender gesperrt",
  "5.7.502": "Zugriff verweigert: Spam erkannt, Absender gesperrt",
  "5.7.503": "Zugriff verweigert: Spam erkannt, Absender gesperrt",
  "5.7.509": "DMARC der Absender-Domain fehlgeschlagen, die Domain verlangt Ablehnung (p=reject)",
  "5.7.705": "Organisation (Tenant) hat wegen Spamversand ein Limit überschritten",
  "5.7.708": "Zugriff verweigert: Mails von dieser IP-Adresse werden nicht angenommen",
  "5.7.750": "Versand über eine nicht registrierte Domain blockiert",
};

export interface StatusInfo {
  code: string;
  permanent: boolean | undefined;
  classText: string;
  text: string;
  microsoft: boolean;
}

export function explainStatus(code: string | undefined, diagnostic = ""): StatusInfo | undefined {
  const m = /^([245])\.(\d{1,3})\.(\d{1,3})$/.exec(code?.trim() ?? "");
  if (!m) return undefined;
  const [, cls, subj, det] = m as unknown as [string, string, string, string];
  const full = `${cls}.${subj}.${det}`;
  const isMs = /outlook\.com|protection\.outlook|microsoft|exchange|RESOLVER\.|SMTPSEND|STOREDRV|ROUTING\./i.test(diagnostic);
  let text = (cls === "5" || cls === "4") && microsoft[full] && (isMs || !generic[`${subj}.${det}`]) ? microsoft[full] : undefined;
  if (!text) {
    const n = Number(det);
    if (cls === "5" && subj === "7" && n >= 606 && n <= 649) text = "Absende-IP ist bei Microsoft gesperrt (Entsperren über sender.office.com)";
    else if (cls === "5" && subj === "7" && n >= 700 && n <= 749) text = "Zugriff für die Absender-Organisation (Tenant) gesperrt";
  }
  text ??= generic[`${subj}.${det}`] ?? generic[`${subj}.0`] ?? generic["0.0"]!;
  return { code: full, permanent: cls === "5" ? true : cls === "4" ? false : undefined, classText: classText[cls]!, text, microsoft: !!microsoft[full] && isMs };
}

/** erweiterten Statuscode aus einem Diagnosetext holen, z. B. „550 5.1.1 <x>: …“ oder „#5.1.1 smtp;550 …“ */
export function findStatus(text: string): string | undefined {
  return /(?:^|[^\d.])([245]\.\d{1,3}\.\d{1,3})(?![\d.]\d)/.exec(text)?.[1];
}

/** einfache SMTP-Antwortcodes (RFC 5321) – wenn der Server keinen erweiterten Statuscode liefert */
const basic: Record<string, string> = {
  "421": "Dienst beim Empfänger nicht verfügbar – Verbindung beendet",
  "450": "Postfach vorübergehend nicht verfügbar",
  "451": "vorübergehender Fehler beim Empfänger",
  "452": "zu wenig Speicher beim Empfänger",
  "454": "TLS oder Anmeldung vorübergehend nicht möglich",
  "500": "Befehl nicht erkannt",
  "501": "Syntaxfehler in den Parametern",
  "502": "Befehl nicht unterstützt",
  "503": "falsche Befehlsreihenfolge",
  "504": "Parameter nicht unterstützt",
  "521": "Server nimmt grundsätzlich keine E-Mails an",
  "530": "Anmeldung erforderlich",
  "535": "Anmeldedaten ungültig",
  "550": "abgelehnt – Postfach nicht verfügbar oder aus Richtlinie",
  "551": "Empfänger ist auf diesem Server nicht zu Hause",
  "552": "Speicherplatz überschritten bzw. Nachricht zu groß",
  "553": "Postfachname bzw. Adresse ungültig",
  "554": "Übertragung fehlgeschlagen bzw. abgelehnt",
  "556": "Domain nimmt keine E-Mails an",
};

export function findSmtpCode(text: string): string | undefined {
  return /(?:^|[\s:;'"(\[#])([245][0-5]\d)(?=[\s-])/.exec(text)?.[1];
}

export function explainSmtpCode(code: string | undefined): StatusInfo | undefined {
  if (!code || !/^[245]\d\d$/.test(code)) return undefined;
  const cls = code[0]!;
  return { code, permanent: cls === "5" ? true : cls === "4" ? false : undefined, classText: classText[cls]!, text: basic[code] ?? (cls === "4" ? "vorübergehender Fehler" : "dauerhafter Fehler"), microsoft: false };
}

export interface Hint {
  id: string;
  title: string;
  text: string;
  /** Link auf ein anderes Tool der Toolbox */
  action?: { label: string; tool: string; search: Record<string, string> };
}

interface Rule {
  id: string;
  test: RegExp;
  title: string;
  text: string;
  action?: (ctx: { senderDomain?: string; recipientDomain?: string; ip?: string }) => Hint["action"];
}

const rules: Rule[] = [
  {
    id: "ms-dbeb",
    test: /5\.4\.1\b[\s\S]*access denied|Recipient address rejected: Access denied/i,
    title: "Adresse gibt es in der Ziel-Organisation nicht",
    text: "Die Empfänger-Domain liegt bei Microsoft 365, dort existiert die Adresse aber nicht (Directory-Based Edge Blocking). Schreibweise prüfen; ist es eure eigene Domain, fehlt das Postfach bzw. der Alias oder er ist noch nicht synchronisiert.",
  },
  {
    id: "blocklist",
    test: /spamhaus|spamcop|barracuda|sorbs|uceprotect|block ?list|black ?list|\bRBL\b|DNSBL|listed (?:at|on|in|by)|banned sending IP|\bS3150\b|5\.7\.6[0-4]\d/i,
    title: "Absende-IP steht auf einer Sperrliste",
    text: "Der Empfänger lehnt die IP-Adresse eures Mailservers ab. Die IP auf der genannten Liste prüfen, die Ursache beseitigen (z. B. kompromittiertes Konto oder Gerät, offenes Relay) und dann die Entfernung beantragen. Bei Microsoft-Sperren: sender.office.com.",
  },
  {
    id: "dmarc",
    test: /\bDMARC\b|5\.7\.509|5\.7\.26\b|policy of reject|unauthenticated (?:e-?mail|sender)/i,
    title: "DMARC-Prüfung fehlgeschlagen",
    text: "Die Nachricht hat weder eine passende SPF- noch eine passende DKIM-Prüfung bestanden, und die Absender-Domain verlangt Ablehnung. SPF- und DKIM-Einträge sowie den Versandweg (z. B. externe Dienste, Weiterleitungen) prüfen.",
    action: (c) => (c.senderDomain ? { label: `DNS-/Mail-Check für ${c.senderDomain}`, tool: "mail-check", search: { domain: c.senderDomain } } : undefined),
  },
  {
    id: "spf",
    test: /\bSPF\b|5\.7\.2[34]\b|not designated as permitted sender|sender policy framework/i,
    title: "SPF-Prüfung fehlgeschlagen",
    text: "Der versendende Server steht nicht im SPF-Eintrag der Absender-Domain. Den sendenden Dienst bzw. die IP im SPF-Eintrag ergänzen.",
    action: (c) => (c.senderDomain ? { label: `DNS-/Mail-Check für ${c.senderDomain}`, tool: "mail-check", search: { domain: c.senderDomain } } : undefined),
  },
  {
    id: "dkim",
    test: /\bDKIM\b|5\.7\.2[0-2]\b/,
    title: "DKIM-Signatur fehlt oder ist ungültig",
    text: "DKIM-Signierung für die Absender-Domain einrichten bzw. prüfen, ob die Nachricht unterwegs verändert wurde (z. B. durch Signaturen oder Disclaimer nach dem Signieren).",
    action: (c) => (c.senderDomain ? { label: `DNS-/Mail-Check für ${c.senderDomain}`, tool: "mail-check", search: { domain: c.senderDomain } } : undefined),
  },
  {
    id: "ptr",
    test: /5\.7\.25\b|reverse (?:dns|lookup|mapping)|\bPTR\b|\brDNS\b|no reverse|cannot find your hostname|client host rejected: cannot find/i,
    title: "Reverse-DNS fehlt oder passt nicht",
    text: "Für die öffentliche IP des Mailservers muss beim Provider ein PTR-Eintrag gesetzt sein, der zum Servernamen (HELO) passt.",
  },
  {
    id: "ms-blocked-sender",
    test: /5\.1\.8\b|5\.7\.70[05-8]\b|5\.7\.50[123]\b|bad outbound sender|outbound spam|restricted from sending|exceeded (?:the )?(?:sending|message|recipient) (?:rate )?limit/i,
    title: "Konto oder Organisation für den Versand gesperrt",
    text: "Microsoft blockiert den Versand, meist wegen Spam aus einem kompromittierten Konto oder überschrittener Versandlimits. Konto prüfen (Kennwort ändern, Anmeldungen und Weiterleitungsregeln kontrollieren) und im Defender-Portal unter „Eingeschränkte Entitäten“ freigeben.",
  },
  {
    id: "ms-auth",
    test: /5\.7\.57\b|5\.7\.139\b|SmtpClientAuthentication|authentication (?:unsuccessful|required)|Client not authenticated/i,
    title: "SMTP-Versand ohne (gültige) Anmeldung",
    text: "Das sendende Gerät oder Programm (z. B. Scanner, Fachanwendung) meldet sich nicht korrekt an. Bei Microsoft 365: SMTP AUTH für das Postfach erlauben bzw. auf Direktversand oder einen Connector umstellen.",
  },
  {
    id: "relay",
    test: /relay(?:ing)? (?:access )?(?:denied|not permitted)|not permitted to relay|unable to relay|5\.7\.64\b|TenantAttribution/i,
    title: "Relay verweigert",
    text: "Der Server leitet für euren Absender nicht weiter. Anmeldung bzw. Connector-Konfiguration (Absender-IP, Zertifikat) prüfen.",
  },
  {
    id: "group",
    test: /5\.7\.12[0-9]\b|5\.7\.13[3-6]\b|not authori[sz]ed to send|only accepts (?:mail|messages) from|restricted to (?:internal|authenticated)/i,
    title: "Empfänger nimmt nur bestimmte Absender an",
    text: "Die Gruppe bzw. das Postfach ist auf interne oder ausgewählte Absender beschränkt. Der Verantwortliche der Gruppe muss den Absender zulassen.",
  },
  {
    id: "unknown-user",
    test: /5\.1\.1\b|5\.1\.10\b|user unknown|unknown user|no such (?:user|mailbox|recipient)|does ?n[o']t exist|mailbox (?:unavailable|not found)|recipient not found|invalid recipient|unknown recipient|RecipNotFound|address rejected|unrouteable address|Benutzer unbekannt/i,
    title: "Empfängeradresse gibt es nicht",
    text: "Schreibweise prüfen. Stammt die Adresse aus der Outlook-Vorschlagsliste, kann ein veralteter Eintrag schuld sein – mit dem „X“ in der Vorschlagsliste entfernen und neu eingeben.",
    action: (c) => (c.recipientDomain ? { label: `MX von ${c.recipientDomain} prüfen`, tool: "dns-lookup", search: { domain: c.recipientDomain, types: "MX" } } : undefined),
  },
  {
    id: "domain",
    test: /5\.1\.2\b|5\.4\.4\b|host (?:or domain name )?not found|domain (?:not found|does not exist)|NXDOMAIN|no (?:mx|mail exchanger)|name service error|host unknown|unrouteable mail domain|Null-MX|null MX/i,
    title: "Ziel-Domain nicht erreichbar",
    text: "Für die Domain des Empfängers gibt es keinen gültigen Mailserver (MX). Schreibweise der Domain prüfen.",
    action: (c) => (c.recipientDomain ? { label: `MX von ${c.recipientDomain} prüfen`, tool: "dns-lookup", search: { domain: c.recipientDomain, types: "MX,A" } } : undefined),
  },
  {
    id: "full",
    test: /5\.2\.2\b|4\.2\.2\b|quota|mailbox (?:is )?full|over ?quota|insufficient (?:system )?storage|storage (?:limit|quota) exceeded|Postfach (?:ist )?voll/i,
    title: "Postfach des Empfängers ist voll",
    text: "Der Empfänger muss Platz schaffen. Später erneut senden oder auf anderem Weg Bescheid geben.",
  },
  {
    id: "size",
    test: /5\.3\.4\b|5\.2\.3\b|too (?:big|large)|size (?:limit|exceeds)|message (?:size|length) exceeds|exceeds (?:the )?(?:maximum|size)|zu groß/i,
    title: "Nachricht ist zu groß",
    text: "Anhänge verkleinern oder per Freigabelink (z. B. OneDrive/SharePoint) senden. Durch die Base64-Kodierung wird eine Mail etwa ein Drittel größer als die Anhänge.",
  },
  {
    id: "tls",
    test: /TLS (?:is )?required|must issue a STARTTLS|5\.7\.10\b|encryption (?:is )?required/i,
    title: "Verschlüsselte Übertragung (TLS) verlangt",
    text: "Der Empfänger nimmt nur per TLS an. TLS am sendenden Server bzw. Connector aktivieren und Zertifikat prüfen.",
  },
  {
    id: "loop",
    test: /\bloop\b|5\.4\.6\b|5\.4\.14\b|too many hops|hop count exceeded/i,
    title: "Mail-Schleife",
    text: "Die Nachricht ist im Kreis gelaufen – meist durch Weiterleitungen oder Connectoren, die aufeinander zeigen.",
  },
  {
    id: "timeout",
    test: /timed? ?out|connection refused|connection reset|lost connection|4\.4\.[12]\b|5\.4\.7\b|4\.4\.7\b|5\.4\.300\b|expired|retry time(?:out)? exceeded|could not be delivered within/i,
    title: "Zielserver nicht erreichbar",
    text: "Der Server des Empfängers hat über längere Zeit nicht geantwortet. Prüfen, ob die Domain korrekte MX-Einträge hat und Port 25 erreichbar ist – oder ob die Gegenseite eine Störung hat.",
    action: (c) => (c.recipientDomain ? { label: `MX von ${c.recipientDomain} prüfen`, tool: "dns-lookup", search: { domain: c.recipientDomain, types: "MX" } } : undefined),
  },
  {
    id: "greylist",
    test: /grey-?list|gray-?list|try (?:again )?later|temporar(?:y|ily)|4\.7\.[01]\b/i,
    title: "Vorübergehend abgewiesen",
    text: "Typisch für Greylisting oder kurzzeitige Drosselung. Euer Server versucht es automatisch erneut – meist kommt die Mail mit etwas Verspätung an.",
  },
  {
    id: "spam",
    test: /\bspam\b|content (?:rejected|filter)|policy violation|message rejected|blocked by (?:the )?(?:content|spam)|suspicious|phishing|malware|virus/i,
    title: "Vom Spam- oder Inhaltsfilter abgelehnt",
    text: "Inhalt, Links und Anhänge prüfen (z. B. Makro-Dateien, verkürzte Links) und den Versandweg (SPF, DKIM, DMARC). Bei wiederholten Problemen den Empfänger bitten, euch zuzulassen.",
  },
];

/** Hinweise passend zu Statuscode und Diagnosetext – spezifische zuerst, höchstens drei */
export function hintsFor(
  status: string | undefined,
  diagnostic: string,
  ctx: { senderDomain?: string; recipientDomain?: string; ip?: string },
): Hint[] {
  const text = `${status ?? ""} ${diagnostic}`;
  const out: Hint[] = [];
  for (const r of rules) {
    if (!r.test.test(text)) continue;
    // bei DMARC ist die SPF-/DKIM-Regel überflüssig
    if ((r.id === "spf" || r.id === "dkim") && out.some((h) => h.id === "dmarc")) continue;
    if (r.id === "unknown-user" && out.some((h) => h.id === "ms-dbeb")) continue;
    if (r.id === "greylist" && status?.startsWith("5")) continue;
    if (r.id === "spam" && out.length) continue;
    out.push({ id: r.id, title: r.title, text: r.text, action: r.action?.(ctx) });
    if (out.length === 3) break;
  }
  return out;
}
