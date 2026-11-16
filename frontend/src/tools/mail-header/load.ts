/** Eingabe des E-Mail-Tools laden: eingefügter Quelltext, .eml oder Outlook-.msg */
import { bounceFromMime, bounceFromMsg, type Bounce } from "../lib/mail/bounce";
import { isCfb } from "../lib/mail/cfb";
import { parseMimeBytes, parseMimeText, type MimePart } from "../lib/mail/mime";
import { P, readMsg, str } from "../lib/mail/msg";

export interface LoadedMail {
  /** Header der Nachricht selbst (bei einem Rückläufer: des Rückläufers) */
  headerText?: string;
  bounce: Bounce | null;
  /** Hinweis zur Eingabe, z. B. fehlende Internetkopfzeilen */
  notes: string[];
  kind: "text" | "eml" | "msg";
}

function fromMime(root: MimePart, kind: LoadedMail["kind"]): LoadedMail {
  const bounce = bounceFromMime(root);
  const notes: string[] = [];
  if (
    bounce &&
    !root.parts.length &&
    !root.body.length &&
    !bounce.recipients.some((r) => r.address || r.status || r.diagnostic)
  ) {
    notes.push(
      "Das ist ein Rückläufer, eingefügt sind aber nur die Kopfzeilen. Für Empfänger, Fehlercode und Ursache bitte den vollständigen Quelltext einfügen (in Outlook: „Nachrichtenquelle anzeigen“) oder die Datei hierher ziehen.",
    );
  }
  return { headerText: root.headerText.trim() ? root.headerText : undefined, bounce, notes, kind };
}

export function loadText(text: string): LoadedMail {
  return fromMime(parseMimeText(text), "text");
}

export function loadFile(name: string, bytes: Uint8Array): LoadedMail {
  if (isCfb(bytes)) {
    const m = readMsg(bytes);
    const headerText = str(m.props, P.TRANSPORT_HEADERS);
    const bounce = bounceFromMsg(m);
    const notes: string[] = [];
    if (!headerText) {
      notes.push(
        bounce
          ? "Der Rückläufer wurde von eurem eigenen Exchange/Microsoft 365 erzeugt und hat deshalb keine Internetkopfzeilen – die Auswertung stützt sich auf die Angaben in der Nachricht."
          : "Diese .msg enthält keine Internetkopfzeilen – das ist bei Nachrichten aus „Gesendete Elemente“, Entwürfen oder intern zugestellten Mails normal.",
      );
    }
    return { headerText, bounce, notes, kind: "msg" };
  }
  if (/\.msg$/i.test(name))
    throw new Error("Die Datei endet auf .msg, ist aber keine Outlook-Nachricht.");
  return fromMime(parseMimeBytes(bytes), "eml");
}
