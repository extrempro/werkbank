/**
 * Kleiner MIME-Parser für E-Mails (.eml oder eingefügter Quelltext): Header, multipart, base64/quoted-printable,
 * Zeichensätze und eingebettete Nachrichten (message/rfc822). Bewusst nachsichtig bei kaputten Nachrichten.
 */
import { parseHeaders, type Header } from "../../mail-header/mail-header";

export interface MimePart {
  headers: Header[];
  /** roher Header-Block (für die Header-Analyse) */
  headerText: string;
  contentType: string;
  params: Record<string, string>;
  /** Inhalt nach Transfer-Dekodierung als Bytes */
  body: Uint8Array;
  parts: MimePart[];
  /** bei message/rfc822 bzw. message/global: die eingebettete Nachricht */
  message?: MimePart;
}

/** Bytes ↔ „Binär-String“ (ein Zeichen pro Byte) – so lassen sich Grenzen per Regex finden, ohne Daten zu verlieren */
const toBinary = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const fromBinary = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export function decodeText(bytes: Uint8Array, charset = "utf-8"): string {
  const label = charset.trim().toLowerCase().replace(/^"|"$/g, "") || "utf-8";
  try {
    // „us-ascii“ ist in der Praxis oft doch UTF-8 oder Latin-1
    if (label === "us-ascii" || label === "ascii")
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return new TextDecoder(label).decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }
}

function parseContentType(value: string | undefined): {
  type: string;
  params: Record<string, string>;
} {
  const v = value ?? "text/plain";
  const [type = "text/plain", ...rest] = v.split(";");
  const params: Record<string, string> = {};
  for (const m of rest.join(";").matchAll(/([\w*.-]+)\s*=\s*("((?:[^"\\]|\\.)*)"|[^;\s]+)/g)) {
    params[m[1]!.toLowerCase()] = m[3] !== undefined ? m[3].replace(/\\(.)/g, "$1") : m[2]!;
  }
  return { type: type.trim().toLowerCase() || "text/plain", params };
}

function decodeTransfer(body: string, encoding: string | undefined): Uint8Array {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "base64") {
    const clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
    try {
      return fromBinary(atob(clean.slice(0, clean.length - (clean.length % 4))));
    } catch {
      return fromBinary(body);
    }
  }
  if (enc === "quoted-printable") {
    return fromBinary(
      body
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
    );
  }
  return fromBinary(body);
}

const header = (headers: Header[], name: string) =>
  headers.find((h) => h.name.toLowerCase() === name)?.value;

function parseBinary(src: string, depth: number): MimePart {
  const split = /\r?\n\r?\n/.exec(src);
  const headerBin = split ? src.slice(0, split.index) : src;
  const bodyBin = split ? src.slice(split.index + split[0].length) : "";
  // Header als UTF-8 lesen (SMTPUTF8), sonst Latin-1
  const headerText = decodeText(fromBinary(headerBin), "utf-8");
  const headers = parseHeaders(headerText);
  const { type, params } = parseContentType(header(headers, "content-type"));
  const part: MimePart = {
    headers,
    headerText,
    contentType: type,
    params,
    body: new Uint8Array(0),
    parts: [],
  };

  if (type.startsWith("multipart/") && params.boundary && depth < 20) {
    const b = params.boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // alles nach dem Schluss-Trenner (--grenze--) ist Epilog
    const close = new RegExp(`(?:^|\\r?\\n)--${b}--`).exec(bodyBin);
    const inner = close ? bodyBin.slice(0, close.index) : bodyBin;
    const pieces = inner.split(new RegExp(`(?:^|\\r?\\n)--${b}[ \\t]*(?:\\r?\\n|$)`));
    // pieces[0] ist die Präambel
    for (const piece of pieces.slice(1)) {
      if (!piece.trim()) continue;
      part.parts.push(parseBinary(piece, depth + 1));
    }
    part.body = fromBinary(bodyBin);
    return part;
  }

  part.body = decodeTransfer(bodyBin, header(headers, "content-transfer-encoding"));
  if ((type === "message/rfc822" || type === "message/global") && depth < 20) {
    part.message = parseBinary(toBinary(part.body), depth + 1);
  }
  return part;
}

export function parseMimeBytes(bytes: Uint8Array): MimePart {
  return parseBinary(toBinary(bytes), 0);
}

/** eingefügter Text: als UTF-8 kodieren, damit die Zeichensatz-Logik einheitlich bleibt */
export function parseMimeText(text: string): MimePart {
  return parseMimeBytes(new TextEncoder().encode(text));
}

export const textOf = (p: MimePart) => decodeText(p.body, p.params.charset);

/** alle Teile in Dokumentreihenfolge (ohne in eingebettete Nachrichten hineinzugehen) */
export function* walkParts(p: MimePart): Generator<MimePart> {
  yield p;
  for (const c of p.parts) yield* walkParts(c);
}

export const getHeader = header;
