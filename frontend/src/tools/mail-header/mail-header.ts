/** Analyse von E-Mail-Headern (RFC 5322) – Zustellweg, Authentifizierung, Auffälligkeiten. */

export interface Header {
  name: string;
  value: string;
}

export interface Hop {
  index: number;
  from?: string;
  fromIp?: string;
  by?: string;
  with?: string;
  date: Date | null;
  /** Sekunden seit dem vorherigen Hop */
  delaySeconds: number | null;
  raw: string;
}

export type AuthResult = "pass" | "fail" | "softfail" | "neutral" | "none" | "temperror" | "permerror" | "bestguesspass" | string;

export interface AuthCheck {
  method: string;
  result: AuthResult;
  details: Record<string, string>;
}

export interface Finding {
  level: "error" | "warn" | "info";
  message: string;
}

export interface HeaderAnalysis {
  headers: Header[];
  summary: { label: string; value: string }[];
  hops: Hop[];
  totalSeconds: number | null;
  auth: AuthCheck[];
  spamInfo: { label: string; value: string }[];
  findings: Finding[];
}

/** Header einlesen: Zeilenumbrüche normalisieren, Fortsetzungszeilen zusammenfügen, beim Body aufhören. */
export function parseHeaders(raw: string): Header[] {
  const lines = raw.replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").split("\n");
  const headers: Header[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (headers.length > 0) break; // Leerzeile = Ende der Header
      continue;
    }
    if (/^[ \t]/.test(line) && headers.length > 0) {
      headers[headers.length - 1]!.value += " " + line.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  return headers;
}

export function getAll(headers: Header[], name: string): string[] {
  const lower = name.toLowerCase();
  return headers.filter((h) => h.name.toLowerCase() === lower).map((h) => h.value);
}

export function getFirst(headers: Header[], name: string): string | undefined {
  return getAll(headers, name)[0];
}

/** RFC 2047: =?UTF-8?B?…?= / =?iso-8859-1?Q?…?= dekodieren */
export function decodeEncodedWords(value: string): string {
  return value.replace(/(\?=)\s+(=\?)/g, "$1$2").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (match, charset: string, enc: string, text: string) => {
    try {
      let bytes: Uint8Array;
      if (enc.toUpperCase() === "B") {
        bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      } else {
        const out: number[] = [];
        const s = text.replace(/_/g, " ");
        for (let i = 0; i < s.length; i++) {
          if (s[i] === "=" && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) {
            out.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 2;
          } else {
            out.push(s.charCodeAt(i));
          }
        }
        bytes = Uint8Array.from(out);
      }
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return match;
    }
  });
}

export function parseMailDate(value: string): Date | null {
  const cleaned = value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? null : new Date(t);
}

export function parseReceived(raw: string, index: number): Hop {
  const semicolon = raw.lastIndexOf(";");
  const main = semicolon >= 0 ? raw.slice(0, semicolon) : raw;
  const date = semicolon >= 0 ? parseMailDate(raw.slice(semicolon + 1)) : null;
  const from = main.match(/\bfrom\s+([^\s(;]+)/i)?.[1];
  // IP steht je nach Server in [eckigen] oder (runden) Klammern, IPv6 teils mit Präfix "IPv6:"
  const ip =
    main.match(/\[(?:IPv6:)?((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]*:[0-9a-f:.]+)\]/i)?.[1] ??
    main.match(/\(\s*((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]*:[0-9a-f:.]+)\s*\)/i)?.[1];
  const by = main.match(/\bby\s+([^\s(;]+)/i)?.[1];
  const withProto = main.match(/\bwith\s+([^\s(;]+)/i)?.[1];
  return { index, from, fromIp: ip, by, with: withProto, date, delaySeconds: null, raw };
}

/** Domain aus einer Adresse wie "Max <max@example.com>" */
export function domainOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const m = address.match(/@([a-z0-9.-]+)/i);
  return m?.[1]?.toLowerCase().replace(/\.$/, "");
}

function sameOrgDomain(a: string, b: string): boolean {
  // grobe Näherung an die Organisationsdomain: die letzten zwei Labels vergleichen
  const tail = (d: string) => d.split(".").slice(-2).join(".");
  return tail(a) === tail(b);
}

export function parseAuthResults(values: string[]): AuthCheck[] {
  const checks: AuthCheck[] = [];
  for (const value of values) {
    for (const segment of value.split(";")) {
      const m = segment.trim().match(/^([a-z][a-z0-9-]*)=([a-z]+)/i);
      if (!m) continue; // z. B. authserv-id
      const method = m[1]!.toLowerCase();
      if (checks.some((c) => c.method === method)) continue; // oberster (neuester) Eintrag zählt
      const details: Record<string, string> = {};
      const rest = segment.trim().slice(m[0].length).replace(/\([^)]*\)/g, " ");
      for (const kv of rest.matchAll(/([a-z][a-z0-9.-]*)=("[^"]*"|[^\s;]+)/gi)) {
        details[kv[1]!.toLowerCase()] = kv[2]!.replace(/^"|"$/g, "");
      }
      checks.push({ method, result: m[2]!.toLowerCase(), details });
    }
  }
  return checks;
}

function parseKeyValueList(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(";")) {
    const idx = part.indexOf(":");
    if (idx > 0) out[part.slice(0, idx).trim().toUpperCase()] = part.slice(idx + 1).trim();
  }
  return out;
}

const sfvLabels: Record<string, string> = {
  NSPM: "kein Spam",
  SPM: "Spam",
  SKS: "als Spam markiert (Transportregel)",
  SKN: "als kein Spam markiert (Transportregel)",
  SKI: "intern (Organisation)",
  SKA: "erlaubter Absender",
  SKB: "blockierter Absender",
  SFE: "sichere Absender (Benutzer)",
  BLK: "blockiert (Benutzer)",
};

export function analyzeHeaders(raw: string): HeaderAnalysis {
  const headers = parseHeaders(raw);
  if (headers.length === 0) throw new Error("Keine Header gefunden – bitte die vollständigen Kopfzeilen der E-Mail einfügen.");

  const findings: Finding[] = [];
  const get = (n: string) => getFirst(headers, n);

  // Zustellweg: oberster Received-Header = letzter Hop → umdrehen
  const hops = getAll(headers, "Received")
    .reverse()
    .map((r, i) => parseReceived(r, i + 1));
  for (let i = 1; i < hops.length; i++) {
    const prev = hops[i - 1]!.date;
    const cur = hops[i]!.date;
    if (prev && cur) hops[i]!.delaySeconds = Math.round((cur.getTime() - prev.getTime()) / 1000);
  }
  const dated = hops.filter((h) => h.date);
  const totalSeconds =
    dated.length >= 2 ? Math.round((dated[dated.length - 1]!.date!.getTime() - dated[0]!.date!.getTime()) / 1000) : null;

  if (hops.length === 0) findings.push({ level: "warn", message: "Keine Received-Header – vermutlich nicht die vollständigen Header." });
  const slow = hops.filter((h) => (h.delaySeconds ?? 0) > 300);
  for (const h of slow) {
    findings.push({ level: "warn", message: `Hop ${h.index} (${h.by ?? "?"}) hat ${formatDuration(h.delaySeconds!)} Verzögerung.` });
  }
  if (hops.some((h) => (h.delaySeconds ?? 0) < -60)) {
    findings.push({ level: "info", message: "Negative Verzögerung – die Uhren der beteiligten Server weichen voneinander ab." });
  }

  // Authentifizierung
  const auth = parseAuthResults(getAll(headers, "Authentication-Results"));
  if (!auth.some((a) => a.method === "spf")) {
    const receivedSpf = get("Received-SPF");
    const result = receivedSpf?.match(/^([a-z]+)/i)?.[1]?.toLowerCase();
    if (result) auth.push({ method: "spf", result, details: { quelle: "Received-SPF" } });
  }
  for (const a of auth) {
    if (["fail", "permerror"].includes(a.result)) {
      findings.push({ level: "error", message: `${a.method.toUpperCase()} ist fehlgeschlagen (${a.result}).` });
    } else if (["softfail", "temperror"].includes(a.result)) {
      findings.push({ level: "warn", message: `${a.method.toUpperCase()}: ${a.result}.` });
    }
  }
  if (auth.length === 0) findings.push({ level: "info", message: "Keine Authentication-Results vorhanden." });

  // Absender-Auffälligkeiten
  const from = get("From");
  const fromDomain = domainOf(from);
  const replyDomain = domainOf(get("Reply-To"));
  const returnDomain = domainOf(get("Return-Path"));
  if (fromDomain && replyDomain && !sameOrgDomain(fromDomain, replyDomain)) {
    findings.push({ level: "warn", message: `Reply-To (${replyDomain}) gehört nicht zur Absender-Domain (${fromDomain}) – Antworten gehen woanders hin.` });
  }
  if (fromDomain && returnDomain && !sameOrgDomain(fromDomain, returnDomain)) {
    findings.push({ level: "info", message: `Return-Path (${returnDomain}) weicht von der Absender-Domain (${fromDomain}) ab – bei Newslettern üblich, sonst prüfen.` });
  }

  // Microsoft-Spamfilter
  const spamInfo: { label: string; value: string }[] = [];
  const scl = get("X-MS-Exchange-Organization-SCL");
  const forefront = get("X-Forefront-Antispam-Report");
  const ff = forefront ? parseKeyValueList(forefront) : {};
  const sclValue = scl ?? ff.SCL;
  if (sclValue !== undefined) {
    spamInfo.push({ label: "SCL (Spam Confidence Level)", value: `${sclValue}${Number(sclValue) >= 5 ? " – als Spam eingestuft" : ""}` });
    if (Number(sclValue) >= 5) findings.push({ level: "warn", message: `Microsoft hat die Nachricht als Spam eingestuft (SCL ${sclValue}).` });
  }
  if (ff.SFV) spamInfo.push({ label: "SFV (Filterurteil)", value: `${ff.SFV}${sfvLabels[ff.SFV] ? ` – ${sfvLabels[ff.SFV]}` : ""}` });
  if (ff.CIP) spamInfo.push({ label: "CIP (verbindende IP)", value: ff.CIP });
  if (ff.CTRY) spamInfo.push({ label: "CTRY (Land)", value: ff.CTRY });
  if (ff.CAT) spamInfo.push({ label: "CAT (Kategorie)", value: ff.CAT });
  const spamStatus = get("X-Spam-Status");
  if (spamStatus) spamInfo.push({ label: "X-Spam-Status", value: spamStatus });

  const summary = [
    ["Von", from],
    ["An", get("To")],
    ["Cc", get("Cc")],
    ["Betreff", get("Subject")],
    ["Datum", get("Date")],
    ["Message-ID", get("Message-ID")],
    ["Return-Path", get("Return-Path")],
    ["Reply-To", get("Reply-To")],
  ]
    .filter((e): e is [string, string] => Boolean(e[1]))
    .map(([label, value]) => ({ label, value: decodeEncodedWords(value) }));

  return { headers, summary, hops, totalSeconds, auth, spamInfo, findings };
}

export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? "−" : "";
  let s = Math.abs(seconds);
  if (s < 60) return `${sign}${s} s`;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return h > 0 ? `${sign}${h} h ${m} min` : `${sign}${m} min ${s} s`;
}
