/**
 * Eingaben in abfragbare Namen umwandeln (Umlaute, Wildcard) und Subdomains finden.
 *
 * Eine vollständige Liste aller Subdomains gibt öffentliches DNS nicht her (Zonentransfer ist gesperrt).
 * Gefunden wird, was in Zertifikats-Logs (crt.sh) steht oder in einer Liste typischer Namen auflöst.
 */
import { isValidHostname } from "./doh";
import { netGet } from "../lib/net";
import { queryResolver, type Resolver } from "./resolvers";

// ---------- Namen ----------

/** Umlaute → Punycode (bücher.example → xn--bcher-kva.example) über die URL-API des Browsers */
export function toAscii(name: string): string {
  // Nur ASCII: nichts umzuwandeln
  if (![...name].some((char) => char.charCodeAt(0) > 0x7f)) return name;
  try {
    return new URL(`http://${name}`).hostname;
  } catch {
    throw new Error("Ungültiger Domainname");
  }
}

export interface QueryName {
  /** so wird abgefragt (ASCII, klein, ohne Punkt am Ende) */
  name: string;
  /** Hinweis zur Umwandlung, z. B. Punycode */
  note?: string;
}

/** prüft und normalisiert eine eingegebene Domain; „*.example.com“ fragt den Wildcard-Eintrag selbst ab */
export function toQueryName(input: string): QueryName {
  const raw = input
    .trim()
    .replace(/\.$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  if (!raw) throw new Error("Bitte gib eine Domain ein");
  const wildcard = raw.startsWith("*.");
  const rest = wildcard ? raw.slice(2) : raw;
  const ascii = toAscii(rest.toLowerCase());
  if (!isValidHostname(ascii)) {
    throw new Error(
      rest.includes("*")
        ? "Ein * ist nur ganz vorne erlaubt, z. B. *.example.com"
        : "Ungültiger Domainname",
    );
  }
  const name = wildcard ? `*.${ascii}` : ascii;
  const notes: string[] = [];
  if (ascii !== rest.toLowerCase()) notes.push(`Umlaute umgewandelt: ${name}`);
  if (wildcard)
    notes.push(
      "Abgefragt wird der Wildcard-Eintrag selbst – er gilt für alle Namen, die nicht eigens eingetragen sind.",
    );
  return { name, note: notes.join(" ") || undefined };
}

// ---------- Zertifikats-Logs ----------

export interface CertName {
  name: string;
  /** Ausstellungsdatum des neuesten Zertifikats mit diesem Namen */
  lastSeen?: Date;
  /** Name stand (auch) als Wildcard „*.name“ im Zertifikat */
  wildcard: boolean;
}

interface CrtEntry {
  name_value?: unknown;
  common_name?: unknown;
  not_before?: unknown;
}

export function parseCrtSh(json: unknown, domain: string): CertName[] {
  const d = domain.toLowerCase();
  const map = new Map<string, CertName>();
  if (!Array.isArray(json)) return [];
  for (const entry of json as CrtEntry[]) {
    const date =
      typeof entry.not_before === "string"
        ? new Date(`${entry.not_before.replace(/Z?$/, "")}Z`)
        : undefined;
    const text = [entry.name_value, entry.common_name]
      .filter((v): v is string => typeof v === "string")
      .join("\n");
    for (const raw of text.split(/\s+/)) {
      let name = raw.trim().toLowerCase().replace(/\.$/, "");
      const wildcard = name.startsWith("*.");
      if (wildcard) name = name.slice(2);
      if (!name || !/^[a-z0-9_.-]+$/.test(name) || !(name === d || name.endsWith(`.${d}`)))
        continue;
      const prev = map.get(name);
      const lastSeen =
        date && !Number.isNaN(date.getTime()) && (!prev?.lastSeen || date > prev.lastSeen)
          ? date
          : prev?.lastSeen;
      map.set(name, { name, lastSeen, wildcard: wildcard || !!prev?.wildcard });
    }
  }
  return [...map.values()];
}

/** Namen aus Zertifikats-Transparenzlogs (crt.sh), abgefragt über die Werkbank. */
export async function fetchCrtSh(domain: string): Promise<CertName[]> {
  const entries = await netGet<unknown>(`/crtsh?${new URLSearchParams({ domain }).toString()}`);
  return parseCrtSh(entries, domain);
}

// ---------- typische Namen ----------

export const commonSubdomains = [
  "www",
  "mail",
  "webmail",
  "smtp",
  "imap",
  "pop",
  "mx",
  "mx1",
  "mx2",
  "autodiscover",
  "autoconfig",
  "owa",
  "exchange",
  "remote",
  "vpn",
  "sslvpn",
  "gateway",
  "citrix",
  "rdweb",
  "rds",
  "portal",
  "intranet",
  "extranet",
  "login",
  "sso",
  "adfs",
  "sts",
  "api",
  "app",
  "apps",
  "dev",
  "test",
  "staging",
  "stage",
  "demo",
  "beta",
  "admin",
  "cms",
  "shop",
  "store",
  "blog",
  "news",
  "cdn",
  "static",
  "assets",
  "media",
  "img",
  "files",
  "download",
  "cloud",
  "nextcloud",
  "owncloud",
  "share",
  "sharepoint",
  "status",
  "monitor",
  "support",
  "help",
  "helpdesk",
  "ticket",
  "service",
  "docs",
  "wiki",
  "git",
  "gitlab",
  "jira",
  "confluence",
  "ns",
  "ns1",
  "ns2",
  "ns3",
  "dns",
  "ftp",
  "sftp",
  "m",
  "mobile",
  "kunden",
  "partner",
  "karriere",
  "jobs",
  "lyncdiscover",
  "sip",
  "meet",
  "teams",
  "enterpriseenrollment",
  "enterpriseregistration",
  "mta-sts",
  "crm",
  "erp",
  "hr",
  "time",
  "calendar",
];

// ---------- Suche ----------

export interface Subdomain {
  name: string;
  sources: ("crtsh" | "list")[];
  lastSeen?: Date;
  certWildcard: boolean;
  cname?: string;
  addresses: string[];
  /** löst öffentlich auf */
  live: boolean;
  /** Antwort gleicht der Wildcard der Domain – existiert vermutlich nicht eigens */
  viaWildcard: boolean;
  error?: string;
}

export interface SubdomainResult {
  domain: string;
  items: Subdomain[];
  warnings: string[];
  /** Domain hat einen Wildcard-Eintrag (beliebige Namen lösen auf) */
  wildcard?: string[];
}

const answerKey = (cname: string | undefined, addresses: string[]) =>
  `${cname ?? ""}|${[...addresses].sort().join(",")}`;

async function resolveName(resolver: Resolver, name: string, signal?: AbortSignal) {
  const sig = () => AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
  const [a, aaaa] = await Promise.all([
    queryResolver(resolver, name, "A", sig()),
    queryResolver(resolver, name, "AAAA", sig()),
  ]);
  const own = (n: string) => n.toLowerCase().replace(/\.$/, "") === name;
  const cname = [...a.answers, ...aaaa.answers]
    .find((x) => x.type === "CNAME" && own(x.name))
    ?.data.replace(/\.$/, "");
  // Adressen am Ende der Kette
  const addresses = [
    ...new Set(
      [...a.answers, ...aaaa.answers]
        .filter((x) => x.type === "A" || x.type === "AAAA")
        .map((x) => x.data),
    ),
  ];
  return { cname, addresses, status: a.status };
}

export async function findSubdomains(args: {
  domain: string;
  resolver: Resolver;
  useCrtSh: boolean;
  useList: boolean;
  onProgress: (text: string, done?: number, total?: number) => void;
  signal?: AbortSignal;
}): Promise<SubdomainResult> {
  const { domain, resolver, useCrtSh, useList, onProgress, signal } = args;
  const warnings: string[] = [];
  const found = new Map<string, Subdomain>();
  const add = (name: string, source: "crtsh" | "list", extra: Partial<Subdomain> = {}) => {
    const prev = found.get(name);
    if (prev) {
      if (!prev.sources.includes(source)) prev.sources.push(source);
      Object.assign(
        prev,
        Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)),
      );
    } else {
      found.set(name, {
        name,
        sources: [source],
        certWildcard: false,
        addresses: [],
        live: false,
        viaWildcard: false,
        ...extra,
      });
    }
  };

  if (useCrtSh) {
    onProgress(
      "Zertifikats-Logs (crt.sh) werden durchsucht – das kann bei großen Domains eine Minute dauern …",
    );
    try {
      for (const c of await fetchCrtSh(domain))
        add(c.name, "crtsh", { lastSeen: c.lastSeen, certWildcard: c.wildcard });
    } catch (e) {
      if (signal?.aborted) throw e;
      warnings.push(`Zertifikats-Logs: ${(e as Error).message}`);
    }
  }
  if (useList) for (const label of commonSubdomains) add(`${label}.${domain}`, "list");
  found.delete(domain);

  let names = [...found.keys()];
  if (names.length > 1500) {
    warnings.push(
      `${names.length} Namen gefunden – aufgelöst werden die ersten 1500 (alphabetisch).`,
    );
    names = names.sort().slice(0, 1500);
  }

  // Wildcard der Domain erkennen
  let wildcardKey: string | undefined;
  let wildcardInfo: string[] | undefined;
  try {
    const probe = await resolveName(
      resolver,
      `werkbank-wildcard-test-${Math.random().toString(36).slice(2, 10)}.${domain}`,
      signal,
    );
    if (probe.addresses.length || probe.cname) {
      wildcardKey = answerKey(probe.cname, probe.addresses);
      wildcardInfo = probe.cname ? [`CNAME ${probe.cname}`, ...probe.addresses] : probe.addresses;
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }

  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      signal?.throwIfAborted();
      const item = found.get(names[next++]!)!;
      try {
        const r = await resolveName(resolver, item.name, signal);
        item.cname = r.cname;
        item.addresses = r.addresses;
        item.live = r.addresses.length > 0 || !!r.cname;
        item.viaWildcard =
          item.live && wildcardKey !== undefined && answerKey(r.cname, r.addresses) === wildcardKey;
      } catch (e) {
        if (signal?.aborted) throw e;
        item.error =
          (e as Error).name === "TimeoutError" ? "Zeitüberschreitung" : (e as Error).message;
      }
      onProgress("Namen werden aufgelöst", ++done, names.length);
    }
  };
  // Zehn Namen gleichzeitig: Je Name zwei Abfragen, die gebündelt zum Server gehen.
  await Promise.all(Array.from({ length: Math.min(10, names.length) }, worker));

  const items = names
    .map((n) => found.get(n)!)
    // Listen-Treffer, die nicht auflösen, sind kein Befund
    .filter((s) => s.live || s.error || s.sources.includes("crtsh"))
    .sort(
      (a, b) =>
        Number(b.live && !b.viaWildcard) - Number(a.live && !a.viaWildcard) ||
        sortKey(a.name).localeCompare(sortKey(b.name)),
    );
  return { domain, items, warnings, wildcard: wildcardInfo };
}

/** sortiert nach Hierarchie: a.example.com vor b.a.example.com */
const sortKey = (name: string) => name.split(".").reverse().join(".");

// ---------- Export ----------

export function subdomainsToCsv(items: Subdomain[]): string {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [["Name", "Status", "CNAME", "Adressen", "Quelle", "Zertifikat zuletzt"].join(";")];
  for (const s of items) {
    lines.push(
      [
        s.name,
        s.error
          ? `Fehler: ${s.error}`
          : s.viaWildcard
            ? "über Wildcard"
            : s.live
              ? "aktiv"
              : "löst nicht auf",
        s.cname ?? "",
        s.addresses.join(" "),
        s.sources.map((x) => (x === "crtsh" ? "Zertifikats-Log" : "Namensliste")).join(", "),
        s.lastSeen ? s.lastSeen.toISOString().slice(0, 10) : "",
      ]
        .map(esc)
        .join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
