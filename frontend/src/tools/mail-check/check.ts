/**
 * DNS-/Mail-Check: sammelt die nötigen DNS-Daten und bewertet sie.
 */
import { readable } from "../dns-lookup/format";
import { txtContent } from "../dns-lookup/normalize";
import { builtInResolvers, queryResolver, type Resolver, type ResolverResult } from "../dns-lookup/resolvers";
import {
  analyzeDkim,
  analyzeDmarc,
  analyzeMtaSts,
  analyzeSpf,
  analyzeTlsRpt,
  commonDkimSelectors,
  mailProvider,
  type DkimKey,
  type DmarcResult,
  type Finding,
  type SpfResult,
} from "./records";

export interface Section {
  id: string;
  title: string;
  findings: Finding[];
  /** Rohdaten zur Anzeige */
  records?: { label: string; value: string; note?: string }[];
}

export interface CheckResult {
  domain: string;
  sections: Section[];
  spf: SpfResult;
  dmarc: DmarcResult;
  dkim: DkimKey[];
  queries: number;
}

export class Dns {
  private cache = new Map<string, Promise<ResolverResult>>();
  count = 0;
  private resolver: Resolver;
  private signal?: AbortSignal;
  constructor(resolver: Resolver, signal?: AbortSignal) {
    this.resolver = resolver;
    this.signal = signal;
  }
  query(name: string, type: string): Promise<ResolverResult> {
    const key = `${name.toLowerCase()}|${type}`;
    let p = this.cache.get(key);
    if (!p) {
      this.count++;
      p = queryResolver(this.resolver, name, type, AbortSignal.any([AbortSignal.timeout(10_000), ...(this.signal ? [this.signal] : [])]));
      this.cache.set(key, p);
    }
    return p;
  }
  /** Daten eines Typs am Namen selbst (ohne CNAME-Kette) – null bei NXDOMAIN */
  async values(name: string, type: string, followCname = false): Promise<string[] | null> {
    const r = await this.query(name, type);
    if (r.status === "NXDOMAIN") return null;
    if (r.status !== "NOERROR") throw new Error(`${name} ${type}: ${r.status}`);
    const n = name.toLowerCase().replace(/\.$/, "");
    return r.answers.filter((a) => a.type === type && (followCname || a.name.toLowerCase() === n)).map((a) => a.data);
  }
  async txt(name: string): Promise<string[] | null> {
    const v = await this.values(name, "TXT", true);
    return v && v.map(txtContent);
  }
}

const level = (cond: boolean, ok: Finding, bad: Finding): Finding => (cond ? ok : bad);

/** einfache Ermittlung der Hauptdomain (letzte zwei Labels; bekannte zweistufige Endungen) */
export function organizationalDomain(domain: string): string {
  const parts = domain.split(".");
  const twoLevel = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$|^(gv|or)\.at$/;
  const n = parts.length >= 3 && twoLevel.test(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}

export async function runMailCheck(args: {
  domain: string;
  selectors: string[];
  resolver: Resolver;
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
}): Promise<CheckResult> {
  const { domain, selectors, resolver, signal, onProgress } = args;
  const dns = new Dns(resolver, signal);
  const sections: Section[] = [];

  onProgress?.("Grunddaten");
  const [soa, ns, mx, apexTxt, caa, a, aaaa] = await Promise.all([
    dns.query(domain, "SOA"),
    dns.values(domain, "NS"),
    dns.values(domain, "MX"),
    dns.txt(domain),
    dns.values(domain, "CAA"),
    dns.values(domain, "A"),
    dns.values(domain, "AAAA"),
  ]);
  if (soa.status === "NXDOMAIN") throw new Error(`${domain} existiert nicht (NXDOMAIN).`);

  // ---------- Mail: MX ----------
  onProgress?.("Mailserver");
  const mxFindings: Finding[] = [];
  const mxRecords: Section["records"] = [];
  const nullMx = mx?.length === 1 && /^0\s+\.$/.test(mx[0]!.trim());
  if (!mx || mx.length === 0) {
    mxFindings.push({
      level: "warn",
      title: "Kein MX-Record",
      detail: a?.length || aaaa?.length ? "Absender stellen dann an die A/AAAA-Adresse der Domain zu. Domains ohne Mail: Null-MX „0 .“ setzen." : "Die Domain kann keine Mails empfangen.",
    });
  } else if (nullMx) {
    mxFindings.push({ level: "ok", title: "Null-MX – die Domain empfängt bewusst keine Mails (RFC 7505)" });
  } else {
    const sorted = [...mx].sort((x, y) => Number(x.split(/\s+/)[0]) - Number(y.split(/\s+/)[0]));
    const hostChecks = await Promise.all(
      sorted.map(async (rec) => {
        const host = (rec.split(/\s+/)[1] ?? "").replace(/\.$/, "");
        const [ha, haaaa, hcname] = await Promise.all([dns.values(host, "A", true), dns.values(host, "AAAA", true), dns.values(host, "CNAME")]);
        return { rec, host, v4: ha ?? [], v6: haaaa ?? [], cname: hcname?.[0] };
      }),
    );
    for (const h of hostChecks) {
      const provider = mailProvider(h.host);
      mxRecords.push({ label: `Priorität ${h.rec.split(/\s+/)[0]}`, value: h.host, note: [provider, [...h.v4, ...h.v6].join(", ")].filter(Boolean).join(" · ") });
      if (/^\d+\.\d+\.\d+\.\d+$/.test(h.host)) mxFindings.push({ level: "error", title: `MX ${h.host} ist eine IP-Adresse`, detail: "MX muss auf einen Namen zeigen." });
      else if (h.v4.length + h.v6.length === 0) mxFindings.push({ level: "error", title: `${h.host} löst nicht auf`, detail: "An diesen Mailserver kann nicht zugestellt werden." });
      if (h.cname) mxFindings.push({ level: "warn", title: `${h.host} ist ein CNAME`, detail: "MX soll direkt auf einen A/AAAA-Namen zeigen (RFC 2181)." });
    }
    if (!mxFindings.some((f) => f.level === "error")) {
      const providers = [...new Set(hostChecks.map((h) => mailProvider(h.host)).filter(Boolean))];
      mxFindings.unshift({ level: "ok", title: `${hostChecks.length} Mailserver erreichbar${providers.length ? ` (${providers.join(", ")})` : ""}` });
    }
    if (hostChecks.length === 1) mxFindings.push({ level: "info", title: "Nur ein MX-Record", detail: "Bei Cloud-Diensten üblich; eigene Server brauchen ggf. einen zweiten." });
  }
  sections.push({ id: "mx", title: "Mailserver (MX)", findings: mxFindings, records: mxRecords });

  // ---------- SPF ----------
  onProgress?.("SPF");
  const spf = await analyzeSpf(domain, (n) => dns.txt(n));
  if (nullMx && spf.records[0] && !/^v=spf1\s+-all$/i.test(spf.records[0].trim())) {
    spf.findings.push({ level: "info", title: "Null-MX: SPF sollte „v=spf1 -all“ sein" });
  }
  sections.push({ id: "spf", title: "SPF", findings: spf.findings, records: spf.records.map((r) => ({ label: "Record", value: r })) });

  // ---------- DMARC ----------
  onProgress?.("DMARC");
  const org = organizationalDomain(domain);
  const dmarcTxt = await dns.txt(`_dmarc.${domain}`);
  const dmarc = analyzeDmarc(dmarcTxt, org !== domain ? { domain: org, txt: await dns.txt(`_dmarc.${org}`) } : undefined);
  sections.push({ id: "dmarc", title: "DMARC", findings: dmarc.findings, records: dmarc.record ? [{ label: "Record", value: dmarc.record }] : [] });

  // ---------- DKIM ----------
  onProgress?.("DKIM");
  const wanted = [...new Set([...selectors, ...commonDkimSelectors].map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const dkimResults = await Promise.all(
    wanted.map(async (sel) => {
      try {
        const txt = await dns.txt(`${sel}._domainkey.${domain}`);
        return txt ? analyzeDkim(sel, txt) : null;
      } catch {
        return null;
      }
    }),
  );
  const dkim = dkimResults.filter((k): k is DkimKey => k !== null);
  const dkimFindings: Finding[] = [];
  if (dkim.length === 0) {
    dkimFindings.push({
      level: "info",
      title: "Kein DKIM-Schlüssel gefunden",
      detail: `Geprüft: ${selectors.length ? `${selectors.join(", ")} und ` : ""}${commonDkimSelectors.length} gängige Selektoren. Den eigenen Selektor zeigt der Header „DKIM-Signature: s=…“ einer gesendeten Mail.`,
    });
  }
  for (const k of dkim) dkimFindings.push(...k.findings.map((f) => ({ ...f, title: `${k.selector}: ${f.title}` })));
  const missingWanted = selectors.filter((s) => !dkim.some((k) => k.selector === s.toLowerCase()));
  for (const s of missingWanted) dkimFindings.push({ level: "warn", title: `Selektor „${s}“ nicht gefunden` });
  sections.push({ id: "dkim", title: "DKIM", findings: dkimFindings, records: dkim.map((k) => ({ label: k.selector, value: k.record })) });

  // ---------- MTA-STS / TLS-RPT / BIMI ----------
  const [sts, tlsrpt, bimi] = await Promise.all([dns.txt(`_mta-sts.${domain}`), dns.txt(`_smtp._tls.${domain}`), dns.txt(`default._bimi.${domain}`)]);
  const extra = [...analyzeMtaSts(sts), ...analyzeTlsRpt(tlsrpt)];
  const bimiRec = (bimi ?? []).find((t) => /^v=BIMI1/i.test(t));
  if (bimiRec) extra.push({ level: "ok", title: "BIMI-Logo hinterlegt" });
  sections.push({ id: "transport", title: "Transport-Sicherheit (MTA-STS, TLS-RPT)", findings: extra });

  // ---------- Nameserver ----------
  onProgress?.("Nameserver");
  const nsFindings: Finding[] = [];
  const nsRecords: Section["records"] = [];
  const nsHosts = (ns ?? []).map((n) => n.replace(/\.$/, "").toLowerCase()).sort();
  if (nsHosts.length === 0) nsFindings.push({ level: "error", title: "Keine NS-Records" });
  else {
    nsFindings.push(level(nsHosts.length >= 2, { level: "ok", title: `${nsHosts.length} Nameserver` }, { level: "warn", title: "Nur ein Nameserver", detail: "RFC 1034 verlangt mindestens zwei." }));
    const ips = await Promise.all(nsHosts.map(async (h) => ({ host: h, v4: (await dns.values(h, "A", true)) ?? [], v6: (await dns.values(h, "AAAA", true)) ?? [] })));
    for (const i of ips) {
      nsRecords.push({ label: "NS", value: i.host, note: [...i.v4, ...i.v6].join(", ") });
      if (i.v4.length + i.v6.length === 0) nsFindings.push({ level: "error", title: `${i.host} löst nicht auf` });
    }
    const nets = new Set(ips.flatMap((i) => i.v4.map((ip) => ip.split(".").slice(0, 3).join("."))));
    if (nsHosts.length >= 2 && nets.size === 1) nsFindings.push({ level: "warn", title: "Alle Nameserver im selben /24-Netz", detail: "Fällt das Netz aus, ist die Domain nicht erreichbar." });
    if (ips.every((i) => i.v6.length === 0)) nsFindings.push({ level: "info", title: "Kein Nameserver per IPv6 erreichbar" });
    // gleiche NS-Liste bei den eingebauten Resolvern?
    const others = builtInResolvers.filter((r) => r.id !== resolver.id);
    const compare = await Promise.all(
      others.map(async (r) => {
        try {
          const res = await queryResolver(r, domain, "NS", AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]));
          return { r, hosts: res.answers.filter((x) => x.type === "NS").map((x) => x.data.replace(/\.$/, "").toLowerCase()).sort() };
        } catch {
          return null;
        }
      }),
    );
    for (const c of compare) {
      if (c && c.hosts.join() !== nsHosts.join()) nsFindings.push({ level: "warn", title: `${c.r.name} sieht andere Nameserver`, detail: c.hosts.join(", ") || "keine" });
    }
  }
  sections.push({ id: "ns", title: "Nameserver", findings: nsFindings, records: nsRecords });

  // ---------- Domain: SOA, CAA, DNSSEC ----------
  onProgress?.("DNSSEC, CAA");
  const domFindings: Finding[] = [];
  const domRecords: Section["records"] = [];
  const soaRec = soa.answers.find((x) => x.type === "SOA");
  if (soaRec) {
    const r = readable("SOA", soaRec.data);
    domRecords.push({ label: "SOA", value: r.main, note: r.fields.map((f) => `${f.label} ${f.value}`).join(" · ") });
    const [, , , refresh, retry, expire, minimum] = soaRec.data.split(/\s+/).map(Number);
    if (expire !== undefined && refresh !== undefined && expire < refresh) domFindings.push({ level: "warn", title: "SOA: Expire kleiner als Refresh" });
    if (minimum !== undefined && minimum > 86400) domFindings.push({ level: "info", title: `SOA: Negativ-TTL ${minimum} s ist sehr lang`, detail: "Neu angelegte Namen sind dann lange nicht sichtbar." });
    if (retry !== undefined && refresh !== undefined && retry > refresh) domFindings.push({ level: "info", title: "SOA: Retry größer als Refresh" });
  } else if (soa.answers.length === 0) {
    domFindings.push({ level: "info", title: `${domain} ist keine eigene Zone`, detail: "Der Name liegt in der Zone einer übergeordneten Domain." });
  }
  if (soa.authenticated) domFindings.push({ level: "ok", title: "DNSSEC: signiert und gültig" });
  else {
    const ds = await dns.values(domain, "DS").catch(() => null);
    domFindings.push(ds?.length ? { level: "error", title: "DNSSEC: DS vorhanden, Antwort aber nicht validiert" } : { level: "info", title: "DNSSEC: nicht signiert" });
  }
  if (!caa || caa.length === 0) domFindings.push({ level: "info", title: "Kein CAA-Record", detail: "Jede Zertifizierungsstelle darf Zertifikate ausstellen." });
  else {
    const issuers = caa.map((c) => readable("CAA", c)).filter((c) => /issue/.test(c.fields[0]?.value ?? ""));
    domFindings.push({ level: "ok", title: `CAA: ${issuers.map((i) => i.main).join(", ") || "Regeln hinterlegt"}` });
    for (const c of caa) domRecords.push({ label: "CAA", value: c });
  }
  sections.push({ id: "domain", title: "Domain (SOA, DNSSEC, CAA)", findings: domFindings, records: domRecords });

  // ---------- TXT ----------
  const txtFindings: Finding[] = [];
  const txtRecords = (apexTxt ?? []).map((t) => {
    const r = readable("TXT", t);
    return { label: r.kind ?? "TXT", value: t, note: r.hint };
  });
  const dup = (apexTxt ?? []).filter((t, i, arr) => arr.indexOf(t) !== i);
  if (dup.length) txtFindings.push({ level: "warn", title: "Doppelte TXT-Records", detail: [...new Set(dup)].join(" | ") });
  const long = (apexTxt ?? []).filter((t) => t.length > 1024);
  if (long.length) txtFindings.push({ level: "info", title: `${long.length} sehr lange TXT-Records`, detail: "Große Antworten können über UDP abgeschnitten werden." });
  if ((apexTxt ?? []).length > 15) txtFindings.push({ level: "info", title: `${apexTxt!.length} TXT-Records`, detail: "Alte Bestätigungs-Einträge lassen sich meist löschen." });
  txtFindings.unshift({ level: "info", title: `${(apexTxt ?? []).length} TXT-Records an ${domain}` });
  sections.push({ id: "txt", title: "TXT-Records", findings: txtFindings, records: txtRecords });

  return { domain, sections, spf, dmarc, dkim, queries: dns.count };
}
