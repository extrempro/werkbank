/**
 * Unzustellbarkeitsnachrichten („Undelivered Mail Returned to Sender“, NDR, DSN) erkennen und auswerten:
 * Zustellbericht nach RFC 3464, Textmeldungen gängiger Mailserver und Outlook-NDRs aus .msg-Dateien.
 */
import { parseHeaders } from "../../mail-header/mail-header";
import { getHeader, parseMimeBytes, textOf, walkParts, type MimePart } from "./mime";
import { P, str, type MsgMessage } from "./msg";
import { findSmtpCode, findStatus } from "./smtp-codes";

export interface BounceRecipient {
  address: string;
  originalRecipient?: string;
  /** failed, delayed, delivered, relayed, expanded */
  action?: string;
  status?: string;
  /** einfacher SMTP-Code (z. B. 550), falls kein erweiterter Statuscode vorliegt */
  smtpCode?: string;
  diagnostic?: string;
  remoteMta?: string;
  lastAttempt?: string;
  retryUntil?: string;
}

export interface Bounce {
  source: "dsn" | "text" | "outlook";
  reportingMta?: string;
  arrivalDate?: string;
  recipients: BounceRecipient[];
  /** lesbarer Teil der Meldung (gekürzt) */
  humanText?: string;
  /** Header der zurückgeschickten Original-Nachricht */
  original?: { headers: string; complete: boolean };
}

const EMAIL = /[A-Za-z0-9._%+'=-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const stripType = (v: string | undefined) => v?.replace(/^\s*[\w-]+\s*;\s*/, "").trim();
const clean = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() || undefined;

// ---------- Zustellbericht (message/delivery-status) ----------

export function parseDeliveryStatus(text: string): {
  reportingMta?: string;
  arrivalDate?: string;
  recipients: BounceRecipient[];
} {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((b) => parseHeaders(b))
    .filter((h) => h.length);
  const get = (h: ReturnType<typeof parseHeaders>, n: string) =>
    h.find((x) => x.name.toLowerCase() === n)?.value;
  const first = blocks[0] ?? [];
  const isRecipientBlock = (h: ReturnType<typeof parseHeaders>) =>
    !!(get(h, "final-recipient") || get(h, "original-recipient"));
  const recipients = blocks.filter(isRecipientBlock).map((h) => {
    const final =
      stripType(get(h, "final-recipient")) ?? stripType(get(h, "original-recipient")) ?? "";
    return {
      address: final.replace(/^<|>$/g, ""),
      originalRecipient: stripType(get(h, "original-recipient"))?.replace(/^<|>$/g, ""),
      action: get(h, "action")?.toLowerCase().trim(),
      status: findStatus(get(h, "status") ?? "") ?? get(h, "status")?.trim(),
      diagnostic: clean(stripType(get(h, "diagnostic-code"))),
      remoteMta: stripType(get(h, "remote-mta")),
      lastAttempt: get(h, "last-attempt-date"),
      retryUntil: get(h, "will-retry-until"),
    } satisfies BounceRecipient;
  });
  return {
    reportingMta: isRecipientBlock(first) ? undefined : stripType(get(first, "reporting-mta")),
    arrivalDate: isRecipientBlock(first) ? undefined : get(first, "arrival-date"),
    recipients,
  };
}

// ---------- Textmeldungen ----------

/** Markierungen, hinter denen Mailserver die Original-Nachricht als Text anhängen */
const ORIGINAL_MARKERS = [
  /^-+ ?This is a copy of the message,? including all the headers\.? ?-+$/im,
  /^-+ ?Below this line is a copy of the message\.?$/im,
  /^-+ ?(?:Original|Returned) message(?: headers)?:? ?-*$/im,
  /^Original message headers:\s*$/im,
  /^-+ ?Undelivered message headers ?-+$/im,
  /^-+ ?The header of the original message is following\.? ?-+$/im,
  /^-+ ?Ursprüngliche Nachricht ?-*$/im,
  /^Kopfzeilen der Originalnachricht:?\s*$/im,
  /^(?:-+ ?)?(?:Original )?Message headers? follows?\.?(?: ?-+)?$/im,
  /^Original message follows\.?\s*$/im,
  /^-+ ?Returned mail follows ?-+$/im,
  /^-+ ?Original message text ?-+$/im,
];

function splitOriginal(text: string): { human: string; original?: string } {
  for (const re of ORIGINAL_MARKERS) {
    const m = re.exec(text);
    if (m)
      return {
        human: text.slice(0, m.index),
        original: text.slice(m.index + m[0].length).replace(/^\s*\n/, ""),
      };
  }
  return { human: text };
}

/** Empfänger und Fehlermeldungen aus einer Textmeldung (Postfix, Exim, qmail, Exchange …) */
export function parseTextBounce(text: string, ignore: string[] = []): BounceRecipient[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const skip = (a: string) =>
    /^(?:mailer-daemon|postmaster|noreply|no-reply|abuse)@/i.test(a) ||
    ignore.some((i) => i.toLowerCase() === a.toLowerCase());
  const found = new Map<string, BounceRecipient>();
  const recipientLine = [
    /^\s*<([^>\s]+@[^>\s]+)>\s*:?/, // Postfix: <user@x>: host … said: …
    /^\s{1,}([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,})\s*:?\s*$/, // Exim: eingerückte Adresse, Fehler in den Folgezeilen
    /^\s*["<]?([^\s<>"@]+@[^\s<>"@]+\.[A-Za-z]{2,})[">]?:\s*$/, // qmail/GMX: <user@x>: bzw. "user@x":
    /(?:Final-Recipient|Original-Recipient|RCPT TO|Recipient(?: address)?|Empfänger|Failed recipient|Delivery to the following recipients? failed|Ihre Nachricht an)[^\n]*?<?([^\s<>@;:]+@[^\s<>@]+\.[A-Za-z]{2,})>?/i,
    /^\s*([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}):\s+\S/, // OpenSMTPD: user@x: 550 …
    /^\s*--\s+([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,})\s*$/, // Mimecast: -- user@x
    /^\s*([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,})\s*$/, // Exchange: Adresse allein in einer Zeile
    /^\s*<?([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,})>?\s+(?:on|at|am|\(|-|–)\s/, // Exchange 2003: „user@x on Thu, …“
    /(?:unknown user|user unknown|no such user|mailbox unavailable|invalid recipient|unbekannter Empfänger)[:\s]+<?([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,})>?/i,
    /(?:deliver(?:ing|y)?|send(?:ing)?|zustell\w*|delivered)\b[^\n]*?\b(?:to|an|for|für)\s+<?([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,})>?/i,
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let addr: string | undefined;
    for (const re of recipientLine) {
      const m = re.exec(line);
      if (m && EMAIL.test(m[1]!)) {
        addr = m[1]!.replace(/[.>]+$/, "");
        break;
      }
    }
    if (!addr || skip(addr)) continue;
    // Diagnose: der Rest der Zeile und folgende Zeilen; ohne SMTP-Antwort auch noch den nächsten Absatz
    const rest = line
      .slice(line.indexOf(addr) + addr.length)
      .replace(/^[>:\s]+/, "")
      .replace(/^[.,;:\s]+$/, "");
    const block: string[] = rest ? [rest] : [];
    const hasCode = () => /\b[245]\d\d\b|\b[245]\.\d{1,3}\.\d{1,3}\b/.test(block.join(" "));
    let blanks = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
      const l = lines[j]!;
      if (!l.trim()) {
        if (block.length && (hasCode() || ++blanks > 1)) break;
        continue;
      }
      if (
        recipientLine.slice(0, 3).some((re) => re.test(l)) ||
        ORIGINAL_MARKERS.some((re) => re.test(l))
      )
        break;
      block.push(l.trim());
    }
    const diag = compactSmtp(clean(block.join(" ")));
    const prev = found.get(addr.toLowerCase());
    const status = findStatus(diag ?? "");
    if (!prev || (!prev.status && status)) {
      found.set(addr.toLowerCase(), {
        address: addr,
        status,
        diagnostic:
          diag &&
          /\d{3}|error|fail|reject|denied|unknown|not|said|refused|timed? ?out|exceed/i.test(diag)
            ? diag
            : prev?.diagnostic,
        remoteMta:
          /host\s+([\w.-]+\.[a-z]{2,})(?:\[[\d.:a-f]+\])?\s+said/i.exec(diag ?? "")?.[1] ??
          prev?.remoteMta,
        action: status?.startsWith("4") ? "delayed" : "failed",
      });
    }
  }
  return [...found.values()];
}

const BOUNCE_SUBJECT =
  /undeliver|unzustellbar|nicht zustellbar|delivery status notification|delivery (?:failure|failed|has failed|problem)|failure notice|returned mail|mail delivery (?:failed|subsystem|system)|returned to sender|non-?delivery|zustellung (?:ist )?fehlgeschlagen|rückläufer|warning: could not send|delayed mail|zustellung verzögert|message not delivered/i;
const BOUNCE_FROM =
  /mailer-daemon|postmaster|mail delivery (?:system|subsystem)|microsoftexchange[0-9a-f]+@|mail ?administrator/i;

// ---------- aus MIME (.eml / eingefügter Quelltext) ----------

export function bounceFromMime(root: MimePart): Bounce | null {
  const subject = getHeader(root.headers, "subject") ?? "";
  const from = getHeader(root.headers, "from") ?? "";
  const reportType =
    root.contentType === "multipart/report" ? (root.params["report-type"] ?? "").toLowerCase() : "";
  if (reportType && reportType !== "delivery-status") return null; // z. B. Missbrauchs-Berichte (ARF), Lesebestätigungen
  const parts = [...walkParts(root)];
  const dsnPart = parts.find(
    (p) =>
      p.contentType === "message/delivery-status" ||
      p.contentType === "message/global-delivery-status",
  );
  const textParts = parts.filter((p) => p.contentType === "text/plain" && !p.parts.length);
  const firstText = textParts[0]
    ? textOf(textParts[0])
    : root.contentType.startsWith("text/")
      ? textOf(root)
      : "";
  const looksLikeBounce =
    !!dsnPart ||
    BOUNCE_SUBJECT.test(subject) ||
    BOUNCE_FROM.test(from) ||
    /"notificationType"\s*:\s*"Bounce"/.test(firstText);
  if (!looksLikeBounce) return null;
  const htmlPart = !firstText ? parts.find((p) => p.contentType === "text/html") : undefined;
  const humanFull = firstText || (htmlPart ? htmlToText(textOf(htmlPart)) : "");
  const split = splitOriginal(humanFull);

  // Original-Nachricht: eingebettete Nachricht, nur Header oder Text hinter einer Markierung
  let original: Bounce["original"];
  const msgPart = parts.find((p) => p.message);
  const hdrPart = parts.find(
    (p) =>
      p.contentType === "text/rfc822-headers" ||
      p.contentType === "message/rfc822-headers" ||
      p.contentType === "text/rfc822-header",
  );
  if (msgPart?.message) original = { headers: msgPart.message.headerText, complete: true };
  else if (hdrPart) original = { headers: textOf(hdrPart), complete: false };
  else {
    // manche Server hängen die Original-Nachricht als weiteren Textteil an
    const textOriginal = textParts
      .slice(1)
      .map(textOf)
      .find((t) =>
        /^(?:Received|Return-Path|From|Message-ID|Date|Subject):/im.test(t.slice(0, 2000)),
      );
    const candidate = split.original ?? textOriginal;
    if (candidate && parseHeaders(candidate).length >= 2)
      original = { headers: candidate.split(/\r?\n\r?\n/)[0]!, complete: false };
  }

  const humanText = split.human.trim().slice(0, 1500) || undefined;
  const ignore = [EMAIL.exec(getHeader(root.headers, "to") ?? "")?.[0] ?? ""].filter(Boolean);

  if (dsnPart) {
    const dsn = parseDeliveryStatus(textOf(dsnPart));
    // Diagnose fehlt im Bericht? → aus dem lesbaren Teil ergänzen
    const fromText = parseTextBounce(split.human, ignore);
    for (const r of dsn.recipients) {
      const t = fromText.find((x) => x.address.toLowerCase() === r.address.toLowerCase());
      if (t) {
        r.diagnostic ??= t.diagnostic;
        r.remoteMta ??= t.remoteMta;
      }
    }
    if (dsn.recipients.length) return finish({ source: "dsn", ...dsn, humanText, original });
  }
  let recipients = parseSesJson(split.human);
  if (!recipients.length) recipients = parseTextBounce(split.human, ignore);
  if (!recipients.length) {
    // erkannt, aber ohne verwertbare Angaben: zumindest Code und Meldung zeigen
    const status = findStatus(split.human);
    recipients = [
      {
        address: "",
        status,
        diagnostic: compactSmtp(clean(diagnosticLine(split.human))),
        action: status?.startsWith("4") ? "delayed" : "failed",
      },
    ];
  }
  return finish({ source: "text", recipients, humanText, original });
}

/** mehrzeilige SMTP-Antworten („550-5.7.26 … 550-5.7.26 …“) auf eine Zeile kürzen */
export function compactSmtp(s: string | undefined): string | undefined {
  if (!s) return s;
  const first = /\b(\d{3})[- ](\d\.\d{1,3}\.\d{1,3})\s/.exec(s);
  if (!first) return s.replace(/\s\d{3}-(?=\S)/g, " ");
  let seen = false;
  return s
    .replace(new RegExp(`\\b${first[1]}[- ]${escapeRegExp(first[2]!)}\\s+`, "g"), (m) => {
      if (seen) return "";
      seen = true;
      return m.replace("-", " ");
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Amazon-SES-Benachrichtigung (JSON im Text) */
function parseSesJson(text: string): BounceRecipient[] {
  const start = text.indexOf("{");
  if (start < 0 || !/"notificationType"\s*:\s*"Bounce"/.test(text)) return [];
  try {
    const j = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as {
      bounce?: {
        bouncedRecipients?: {
          emailAddress: string;
          action?: string;
          status?: string;
          diagnosticCode?: string;
        }[];
        reportingMTA?: string;
      };
    };
    return (j.bounce?.bouncedRecipients ?? []).map((r) => ({
      address: r.emailAddress,
      action: r.action,
      status: r.status,
      diagnostic: stripType(r.diagnosticCode),
    }));
  } catch {
    return [];
  }
}

/** erste Zeile mit SMTP-Antwort, z. B. „550 5.1.1 User unknown“ */
function diagnosticLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .find((l) => /\b[45]\d\d[ -]/.test(l) || /\b[45]\.\d{1,3}\.\d{1,3}\b/.test(l))
    ?.trim();
}

/** Sonderzeichen für einen regulären Ausdruck maskieren. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Text aus dem HTML-Teil eines Rückläufers. Gelesen wird über den HTML-Parser des Browsers
 * statt über reguläre Ausdrücke: Der Parser führt nichts aus, Skripte und Stile fallen weg,
 * und das Ergebnis ist reiner Text (die Oberfläche zeigt ihn nie als HTML).
 */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(doc.querySelectorAll("script, style, template, noscript"))) {
    element.remove();
  }
  for (const element of Array.from(doc.querySelectorAll("br"))) {
    element.replaceWith("\n");
  }
  for (const element of Array.from(
    doc.querySelectorAll("p, div, tr, li, h1, h2, h3, h4, h5, h6"),
  )) {
    element.append("\n");
  }
  return (doc.body.textContent ?? "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
}

// ---------- aus Outlook (.msg) ----------

export const isReportClass = (cls: string | undefined) =>
  !!cls && /^REPORT\.IPM\..*\.(?:NDR|DR|Delayed\.DR|Relayed\.DR)$/i.test(cls);

export function bounceFromMsg(m: MsgMessage): Bounce | null {
  const cls = str(m.props, P.MESSAGE_CLASS);
  const subject = str(m.props, P.SUBJECT) ?? "";
  const sender = `${str(m.props, P.SENDER_NAME) ?? ""} ${str(m.props, P.SENDER_EMAIL) ?? ""}`;
  const isNdr = cls ? /\.NDR$/i.test(cls) || /Delayed/i.test(cls) : false;
  if (!isNdr && !BOUNCE_SUBJECT.test(subject) && !BOUNCE_FROM.test(sender)) return null;

  const body = str(m.props, P.BODY) ?? str(m.props, P.REPORT_TEXT) ?? "";
  const split = splitOriginal(body);

  // 1. Zustellbericht als Anhang (bei weitergereichten Bounces externer Server)
  let dsn: ReturnType<typeof parseDeliveryStatus> | undefined;
  for (const a of m.attachments) {
    if (!a.data) continue;
    const t = new TextDecoder().decode(a.data.subarray(0, 64 * 1024));
    if (/delivery-status/i.test(a.mimeTag ?? "") || /^(?:Final|Original)-Recipient:/im.test(t)) {
      const d = parseDeliveryStatus(t);
      if (d.recipients.length) dsn = d;
    }
  }

  // 2. Outlook-NDR: Angaben je Empfänger in der Empfängerliste
  const ndrRecipients: BounceRecipient[] = m.recipients
    .filter(
      (r) => r.has(P.SUPPLEMENTARY_INFO) || r.has(P.NDR_DIAG_CODE) || r.has(P.NDR_STATUS_CODE),
    )
    .map((r) => {
      const info = str(r, P.SUPPLEMENTARY_INFO);
      const address =
        str(r, P.SMTP_ADDRESS) ??
        (EMAIL.test(str(r, P.EMAIL_ADDRESS) ?? "")
          ? str(r, P.EMAIL_ADDRESS)!
          : (str(r, P.DISPLAY_NAME) ?? ""));
      const status = findStatus(info ?? "");
      return {
        address,
        status,
        // Outlook: „< #5.1.10 smtp;550 5.1.10 …>“ → „550 5.1.10 …“
        diagnostic: clean(
          info
            ?.replace(/^<\s*#?/, "")
            .replace(/>\s*$/, "")
            .replace(/^[245]\.\d{1,3}\.\d{1,3}\s+smtp;\s*/i, ""),
        ),
        action: status?.startsWith("4") ? "delayed" : "failed",
        remoteMta: /\[([\w.-]+\.[a-z]{2,})\]/i.exec(info ?? "")?.[1],
      };
    });

  let recipients = dsn?.recipients.length ? dsn.recipients : ndrRecipients;
  // Diagnose aus dem Text ergänzen (Outlook schreibt z. B. „Remote server returned '550 5.1.1 …'“)
  const fromText = parseTextBounce(split.human, []);
  if (!recipients.length) recipients = fromText;
  for (const r of recipients) {
    const t = fromText.find((x) => x.address.toLowerCase() === r.address.toLowerCase());
    if (t) {
      r.status ??= t.status;
      r.diagnostic ??= t.diagnostic;
    }
    if (!r.status) {
      const remote =
        /(?:Remote server returned|Der Remoteserver hat|Diagnostic information for administrators)[^\n]*\n?[^\n]*/i.exec(
          body,
        )?.[0];
      r.status = findStatus(remote ?? "") ?? findStatus(body);
      r.diagnostic ??= clean(remote);
    }
  }
  if (!recipients.length) {
    const status = findStatus(body);
    if (!status) return null;
    recipients = [
      {
        address: "",
        status,
        diagnostic: clean(diagnosticLine(body)),
        action: status.startsWith("4") ? "delayed" : "failed",
      },
    ];
  }

  // Original: eingebettete Nachricht oder angehängte .eml
  let original: Bounce["original"];
  for (const a of m.attachments) {
    if (a.embedded) {
      const h = str(a.embedded.props, P.TRANSPORT_HEADERS);
      original = h
        ? { headers: h, complete: true }
        : { headers: synthHeaders(a.embedded), complete: false };
      break;
    }
    if (a.data && (/message\/rfc822/i.test(a.mimeTag ?? "") || /\.eml$/i.test(a.filename ?? ""))) {
      original = { headers: parseMimeBytes(a.data).headerText, complete: true };
      break;
    }
  }
  if (!original && split.original && parseHeaders(split.original).length >= 2)
    original = { headers: split.original.split(/\r?\n\r?\n/)[0]!, complete: false };

  return finish({
    source: dsn ? "dsn" : "outlook",
    reportingMta: dsn?.reportingMta,
    arrivalDate: dsn?.arrivalDate,
    recipients,
    humanText: split.human.trim().slice(0, 1500) || undefined,
    original,
  });
}

/** Statuscode aus der Diagnose ergänzen, einfachen SMTP-Code merken, Duplikate entfernen */
function finish(b: Bounce): Bounce {
  const seen = new Set<string>();
  b.recipients = b.recipients.filter((r) => {
    const k = r.address.toLowerCase();
    if (k && seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const r of b.recipients) {
    r.diagnostic = compactSmtp(r.diagnostic);
    r.status ??= findStatus(r.diagnostic ?? "");
    if (r.status && !/^[245]\.\d{1,3}\.\d{1,3}$/.test(r.status)) r.status = findStatus(r.status);
    r.smtpCode = findSmtpCode(r.diagnostic ?? "");
    if (!r.action)
      r.action = r.status?.startsWith("4") || r.smtpCode?.startsWith("4") ? "delayed" : "failed";
  }
  return b;
}

/** Kopfzeilen aus den Eigenschaften nachbauen, wenn eine eingebettete Nachricht keine Internetkopfzeilen hat */
function synthHeaders(m: MsgMessage): string {
  const lines: string[] = [];
  const from = str(m.props, P.SENDER_EMAIL);
  const name = str(m.props, P.SENDER_NAME);
  if (from) lines.push(`From: ${name ? `${name} <${from}>` : from}`);
  const to = str(m.props, P.DISPLAY_TO);
  if (to) lines.push(`To: ${to}`);
  const subject = str(m.props, P.SUBJECT);
  if (subject) lines.push(`Subject: ${subject}`);
  const date = m.props.get(P.CLIENT_SUBMIT_TIME);
  if (date instanceof Date) lines.push(`Date: ${date.toUTCString()}`);
  const id = str(m.props, P.INTERNET_MESSAGE_ID);
  if (id) lines.push(`Message-ID: ${id}`);
  return lines.join("\n");
}

export const domainOfAddress = (a: string | undefined) =>
  a
    ?.split("@")[1]
    ?.toLowerCase()
    .replace(/[>.]+$/, "");
export const firstEmail = (s: string | undefined) => (s ? EMAIL.exec(s)?.[0] : undefined);
