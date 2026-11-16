/**
 * Auswertung von SPF, DMARC, DKIM, MTA-STS und TLS-RPT – reine Logik, DNS kommt über eine Lookup-Funktion.
 */

export type Level = "ok" | "info" | "warn" | "error";

export interface Finding {
  level: Level;
  title: string;
  detail?: string;
}

/** liefert TXT-Inhalte (bereits ohne Anführungszeichen) oder null bei NXDOMAIN/keinen Daten */
export type TxtLookup = (name: string) => Promise<string[] | null>;

// ---------- SPF ----------

export interface SpfTerm {
  raw: string;
  qualifier: "+" | "-" | "~" | "?";
  kind: string;
  value?: string;
}

export interface SpfNode {
  domain: string;
  record?: string;
  terms: SpfTerm[];
  /** DNS-Lookups dieses Records ohne die der Unter-Records */
  lookups: number;
  children: SpfNode[];
  findings: Finding[];
}

export interface SpfResult {
  records: string[];
  tree?: SpfNode;
  /** DNS-Lookups insgesamt (Grenze 10, RFC 7208 4.6.4) */
  lookups: number;
  voidLookups: number;
  findings: Finding[];
}

const MECHANISMS = new Set(["all", "include", "a", "mx", "ptr", "ip4", "ip6", "exists"]);
const LOOKUP_KINDS = new Set(["include", "a", "mx", "ptr", "exists", "redirect"]);

function validIp4(value: string): boolean {
  const m = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
  return (
    !!m &&
    m.slice(1, 5).every((o) => Number(o) <= 255) &&
    (m[5] === undefined || Number(m[5]) <= 32)
  );
}

export function parseSpf(record: string): { terms: SpfTerm[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const parts = record.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "v=spf1")
    findings.push({ level: "error", title: "SPF beginnt nicht mit „v=spf1“" });
  const terms: SpfTerm[] = [];
  for (const raw of parts.slice(1)) {
    const modifier = raw.match(/^([a-z][a-z0-9_.-]*)=(.*)$/i);
    if (modifier) {
      const kind = modifier[1]!.toLowerCase();
      terms.push({ raw, qualifier: "+", kind, value: modifier[2] });
      if (kind !== "redirect" && kind !== "exp")
        findings.push({ level: "info", title: `Unbekannter Modifikator „${kind}“` });
      continue;
    }
    const m = raw.match(/^([+\-~?]?)([a-z0-9]+)(?:[:/](.*))?$/i);
    const kind = m?.[2]?.toLowerCase();
    if (!m || !kind || !MECHANISMS.has(kind)) {
      findings.push({
        level: "error",
        title: `Ungültiger SPF-Bestandteil „${raw}“`,
        detail: "Empfänger werten den Record dann als Fehler (permerror).",
      });
      continue;
    }
    const value = raw.includes(":")
      ? raw.slice(raw.indexOf(":") + 1)
      : raw.includes("/")
        ? raw.slice(raw.indexOf("/"))
        : undefined;
    terms.push({ raw, qualifier: (m[1] || "+") as SpfTerm["qualifier"], kind, value });
    if ((kind === "ip4" || kind === "ip6" || kind === "include" || kind === "exists") && !value) {
      findings.push({ level: "error", title: `„${raw}“ ohne Wert` });
    }
    if (kind === "ip4" && value && !validIp4(value))
      findings.push({ level: "error", title: `Ungültige IPv4-Angabe „${raw}“` });
    if (kind === "ip6" && value && !/^[0-9a-f:.]+(\/\d{1,3})?$/i.test(value))
      findings.push({ level: "error", title: `Ungültige IPv6-Angabe „${raw}“` });
  }
  return { terms, findings };
}

/** SPF einer Domain auswerten, inklusive aller include/redirect */
export async function analyzeSpf(domain: string, lookupTxt: TxtLookup): Promise<SpfResult> {
  let total = 0;
  let voids = 0;
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const visit = async (name: string, depth: number): Promise<SpfNode> => {
    const node: SpfNode = { domain: name, terms: [], lookups: 0, children: [], findings: [] };
    if (depth > 10 || seen.has(name)) {
      node.findings.push({
        level: "error",
        title: "Schleife oder zu tiefe Verschachtelung in SPF-includes",
      });
      return node;
    }
    seen.add(name);
    const txt = await lookupTxt(name);
    const spf = (txt ?? []).filter((t) => /^v=spf1(\s|$)/i.test(t));
    if (spf.length === 0) {
      if (depth > 0) {
        voids++;
        node.findings.push({
          level: "error",
          title: `${name} hat keinen SPF-Record`,
          detail: "Ein include auf eine Domain ohne SPF führt zu „permerror“.",
        });
      }
      return node;
    }
    if (spf.length > 1)
      node.findings.push({
        level: "error",
        title: `${name} hat ${spf.length} SPF-Records`,
        detail: "Erlaubt ist genau einer – Empfänger werten das als Fehler.",
      });
    node.record = spf[0]!;
    const parsed = parseSpf(node.record);
    node.terms = parsed.terms;
    node.findings.push(...parsed.findings);
    for (const t of parsed.terms) {
      if (!LOOKUP_KINDS.has(t.kind)) continue;
      node.lookups++;
      total++;
      if (t.kind === "ptr")
        node.findings.push({
          level: "warn",
          title: "„ptr“ ist veraltet",
          detail: "RFC 7208 rät davon ab; manche Empfänger ignorieren es.",
        });
      if ((t.kind === "include" || t.kind === "redirect") && t.value && !t.value.includes("%")) {
        node.children.push(await visit(t.value.toLowerCase().replace(/\.$/, ""), depth + 1));
      }
    }
    return node;
  };

  const all = await lookupTxt(domain);
  const records = (all ?? []).filter((t) => /^v=spf1(\s|$)/i.test(t));
  if (records.length === 0) {
    findings.push({
      level: "warn",
      title: "Kein SPF-Record",
      detail:
        "Ohne SPF kann jeder im Namen der Domain senden. Domains ohne Mailversand: „v=spf1 -all“.",
    });
    return { records, lookups: 0, voidLookups: 0, findings };
  }
  const tree = await visit(domain, 0);
  const collect = (n: SpfNode) => {
    findings.push(...n.findings);
    n.children.forEach(collect);
  };
  collect(tree);

  if (total > 10)
    findings.push({
      level: "error",
      title: `${total} DNS-Lookups – erlaubt sind 10`,
      detail:
        "SPF schlägt dann bei allen Empfängern fehl (permerror). includes zusammenfassen oder durch ip4/ip6 ersetzen.",
    });
  else if (total >= 9)
    findings.push({
      level: "warn",
      title: `${total} von 10 DNS-Lookups`,
      detail: "Knapp an der Grenze – ein weiterer Dienst sprengt sie.",
    });
  else findings.push({ level: "ok", title: `${total} von 10 DNS-Lookups` });
  if (voids > 2)
    findings.push({
      level: "error",
      title: `${voids} ins Leere laufende Lookups`,
      detail: "Mehr als 2 führen zu permerror (RFC 7208 4.6.4).",
    });

  const allTerm = tree.terms.find((t) => t.kind === "all");
  const redirect = tree.terms.find((t) => t.kind === "redirect");
  if (allTerm) {
    const q = allTerm.qualifier;
    if (q === "+")
      findings.push({
        level: "error",
        title: "„+all“ erlaubt jedem Server, im Namen der Domain zu senden",
      });
    else if (q === "?")
      findings.push({ level: "warn", title: "„?all“ (neutral) schützt praktisch nicht" });
    else if (q === "~")
      findings.push({
        level: "ok",
        title: "„~all“ (Softfail) – fremde Server werden markiert",
        detail: "Zusammen mit DMARC üblich; strenger wäre „-all“.",
      });
    else findings.push({ level: "ok", title: "„-all“ – fremde Server werden abgelehnt" });
    if (
      tree.terms.indexOf(allTerm) !== tree.terms.length - 1 &&
      tree.terms.slice(tree.terms.indexOf(allTerm) + 1).some((t) => t.kind !== "exp")
    ) {
      findings.push({ level: "warn", title: "Einträge nach „all“ werden nie ausgewertet" });
    }
  } else if (!redirect) {
    findings.push({
      level: "warn",
      title: "SPF endet ohne „all“",
      detail: "Dann gilt „?all“ (neutral). Üblich ist „~all“ oder „-all“.",
    });
  }
  return { records, tree, lookups: total, voidLookups: voids, findings };
}

// ---------- DMARC ----------

export interface DmarcResult {
  record?: string;
  tags: Record<string, string>;
  findings: Finding[];
}

export function parseTags(record: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of record.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k) tags[k] = part.slice(i + 1).trim();
  }
  return tags;
}

export function analyzeDmarc(
  txt: string[] | null,
  organizational?: { domain: string; txt: string[] | null },
): DmarcResult {
  const records = (txt ?? []).filter((t) => /^v=DMARC1\s*(;|$)/i.test(t.trim()));
  const findings: Finding[] = [];
  if (records.length === 0) {
    const org = (organizational?.txt ?? []).find((t) => /^v=DMARC1\s*(;|$)/i.test(t.trim()));
    if (org) {
      const sp = parseTags(org).sp ?? parseTags(org).p;
      findings.push({
        level: "ok",
        title: `DMARC der Hauptdomain ${organizational!.domain} gilt (Richtlinie ${sp})`,
      });
      return { record: org, tags: parseTags(org), findings };
    }
    findings.push({
      level: "warn",
      title: "Kein DMARC-Record",
      detail:
        "Ohne DMARC entscheiden Empfänger selbst, was mit gefälschten Mails passiert. Einstieg: „v=DMARC1; p=none; rua=mailto:…“",
    });
    return { tags: {}, findings };
  }
  if (records.length > 1)
    findings.push({
      level: "error",
      title: `${records.length} DMARC-Records`,
      detail: "Erlaubt ist genau einer – sonst wird DMARC ignoriert.",
    });
  const record = records[0]!;
  const tags = parseTags(record);
  const p = tags.p?.toLowerCase();
  if (!p || !["none", "quarantine", "reject"].includes(p)) {
    findings.push({
      level: "error",
      title: "DMARC ohne gültige Richtlinie (p=)",
      detail: "Erlaubt sind none, quarantine, reject.",
    });
  } else if (p === "none") {
    findings.push({
      level: "warn",
      title: "p=none – nur beobachten",
      detail:
        "Gefälschte Mails werden zugestellt. Nach Auswertung der Berichte auf quarantine bzw. reject erhöhen.",
    });
  } else {
    findings.push({
      level: "ok",
      title: `p=${p} – gefälschte Mails werden ${p === "reject" ? "abgewiesen" : "in Quarantäne gelegt"}`,
    });
  }
  const pct = tags.pct ? Number(tags.pct) : 100;
  if (pct < 100)
    findings.push({
      level: "info",
      title: `pct=${pct} – Richtlinie gilt nur für ${pct} % der Mails`,
    });
  if (tags.sp && tags.sp.toLowerCase() !== p)
    findings.push({ level: "info", title: `Subdomains: sp=${tags.sp}` });
  if (!tags.rua)
    findings.push({
      level: "info",
      title: "Keine Sammelberichte (rua)",
      detail: "Ohne rua erfährt man nicht, wer im Namen der Domain sendet.",
    });
  else
    findings.push({
      level: "ok",
      title:
        "Berichte an " +
        tags.rua
          .split(",")
          .map((s) => s.trim().replace(/^mailto:/i, ""))
          .join(", "),
    });
  return { record, tags, findings };
}

// ---------- DKIM ----------

export interface DkimKey {
  selector: string;
  record: string;
  keyType: string;
  bits?: number;
  revoked: boolean;
  findings: Finding[];
}

/** RSA-Schlüssellänge aus dem öffentlichen Schlüssel (p=, SubjectPublicKeyInfo in Base64) */
export function rsaBitsFromSpki(base64: string): number | undefined {
  let bin: string;
  try {
    bin = atob(base64.replace(/\s+/g, ""));
  } catch {
    return undefined;
  }
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  // SPKI: SEQ { SEQ algId, BIT STRING { SEQ { INTEGER n, INTEGER e } } } – n suchen
  const readLen = (pos: number): [number, number] => {
    const first = b[pos]!;
    if (first < 0x80) return [first, pos + 1];
    const n = first & 0x7f;
    let len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[pos + 1 + i]!;
    return [len, pos + 1 + n];
  };
  try {
    let pos = 0;
    if (b[pos] !== 0x30) return undefined;
    [, pos] = readLen(pos + 1);
    // PKCS#1 direkt (manche Anbieter): SEQ { INTEGER n, INTEGER e }
    if (b[pos] === 0x02) {
      const [len, start] = readLen(pos + 1);
      return modulusBits(b.subarray(start, start + len));
    }
    if (b[pos] !== 0x30) return undefined;
    const [algLen, algStart] = readLen(pos + 1);
    pos = algStart + algLen;
    if (b[pos] !== 0x03) return undefined;
    [, pos] = readLen(pos + 1);
    pos++; // ungenutzte Bits
    if (b[pos] !== 0x30) return undefined;
    [, pos] = readLen(pos + 1);
    if (b[pos] !== 0x02) return undefined;
    const [len, start] = readLen(pos + 1);
    return modulusBits(b.subarray(start, start + len));
  } catch {
    return undefined;
  }
}

function modulusBits(n: Uint8Array): number {
  let i = 0;
  while (i < n.length && n[i] === 0) i++;
  if (i >= n.length) return 0;
  return (n.length - i - 1) * 8 + Math.floor(Math.log2(n[i]!)) + 1;
}

export function analyzeDkim(selector: string, txt: string[]): DkimKey | null {
  const record = txt.find((t) => /(^|;)\s*(v=DKIM1|p=)/i.test(t));
  if (!record) return null;
  const tags = parseTags(record);
  const keyType = (tags.k ?? "rsa").toLowerCase();
  const p = (tags.p ?? "").replace(/\s+/g, "");
  const findings: Finding[] = [];
  const revoked = p === "";
  let bits: number | undefined;
  if (revoked) findings.push({ level: "info", title: "Schlüssel zurückgezogen (p= leer)" });
  else if (keyType === "rsa") {
    bits = rsaBitsFromSpki(p);
    if (bits === undefined)
      findings.push({ level: "error", title: "Öffentlicher Schlüssel lässt sich nicht lesen" });
    else if (bits < 1024) findings.push({ level: "error", title: `RSA ${bits} Bit – zu schwach` });
    else if (bits < 2048)
      findings.push({
        level: "warn",
        title: `RSA ${bits} Bit`,
        detail: "Empfohlen sind 2048 Bit.",
      });
    else findings.push({ level: "ok", title: `RSA ${bits} Bit` });
  } else if (keyType === "ed25519") findings.push({ level: "ok", title: "Ed25519" });
  if (tags.t?.split(":").includes("y")) findings.push({ level: "info", title: "Testmodus (t=y)" });
  return { selector, record, keyType, bits, revoked, findings };
}

/** häufige Selektoren großer Anbieter – nur gefundene werden angezeigt */
export const commonDkimSelectors = [
  "selector1",
  "selector2",
  "google",
  "default",
  "dkim",
  "k1",
  "k2",
  "s1",
  "s2",
  "mail",
  "smtp",
  "mxvault",
  "everlytickey1",
  "everlytickey2",
  "sig1",
  "zoho",
  "protonmail",
  "protonmail2",
  "protonmail3",
  "fm1",
  "fm2",
  "fm3",
  "key1",
  "key2",
  "mandrill",
  "amazonses",
  "sendgrid",
  "mailjet",
  "cm",
  "ionos",
  "strato",
];

// ---------- MTA-STS / TLS-RPT ----------

export function analyzeMtaSts(txt: string[] | null): Finding[] {
  const rec = (txt ?? []).find((t) => /^v=STSv1/i.test(t));
  if (!rec)
    return [
      {
        level: "info",
        title: "Kein MTA-STS",
        detail: "Optional: erzwingt TLS bei der Zustellung an diese Domain.",
      },
    ];
  const id = parseTags(rec).id;
  return [
    {
      level: id ? "ok" : "error",
      title: id ? `MTA-STS aktiv (id=${id})` : "MTA-STS ohne id",
      detail:
        "Die Richtlinie unter https://mta-sts.<domain>/.well-known/mta-sts.txt prüft das Tool nicht.",
    },
  ];
}

export function analyzeTlsRpt(txt: string[] | null): Finding[] {
  const rec = (txt ?? []).find((t) => /^v=TLSRPTv1/i.test(t));
  if (!rec)
    return [
      {
        level: "info",
        title: "Kein TLS-RPT",
        detail: "Optional: Berichte über TLS-Probleme bei der Zustellung.",
      },
    ];
  const rua = parseTags(rec).rua;
  return [
    {
      level: rua ? "ok" : "error",
      title: rua ? `TLS-Berichte an ${rua.replace(/mailto:/gi, "")}` : "TLS-RPT ohne rua",
    },
  ];
}

// ---------- Anbieter erkennen ----------

const providers: [RegExp, string][] = [
  [/\.mail\.protection\.outlook\.com$/, "Microsoft 365"],
  [/(^|\.)google\.com$|\.googlemail\.com$/, "Google Workspace"],
  [/\.pphosted\.com$/, "Proofpoint"],
  [/\.mimecast\.com$/, "Mimecast"],
  [/\.(iphmx|ces\.cisco)\.com$/, "Cisco Secure Email"],
  [/\.messagelabs\.com$/, "Broadcom / Symantec"],
  [/\.hornetsecurity\.com$|\.hornetsecurity\.de$/, "Hornetsecurity"],
  [/\.retarus\.(com|de)$/, "Retarus"],
  [/\.zoho\.(com|eu)$/, "Zoho"],
  [/\.protonmail\.ch$/, "Proton"],
  [/\.ionos\.(de|com)$|\.kundenserver\.de$/, "IONOS"],
  [/\.strato\.de$/, "STRATO"],
  [/\.mailbox\.org$/, "mailbox.org"],
  [/\.secureserver\.net$/, "GoDaddy"],
  [/\.barracudanetworks\.com$/, "Barracuda"],
  [/\.trendmicro\.(com|eu)$/, "Trend Micro"],
];

export function mailProvider(host: string): string | undefined {
  const h = host.toLowerCase().replace(/\.$/, "");
  return providers.find(([re]) => re.test(h))?.[1];
}
