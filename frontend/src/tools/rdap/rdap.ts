/** RDAP (Nachfolger von WHOIS): Domain, IP-Adresse/Netz oder AS-Nummer abfragen */
import { parseIp, type IpVersion } from "../cidr/ip";
import { toAscii } from "../dns-lookup/subdomains";
import { netGet } from "../lib/net";

export type QueryKind = "domain" | "ip" | "autnum";

export interface RdapQuery {
  kind: QueryKind;
  /** Wert für die URL (Domain in Punycode, IP ggf. mit Präfix, AS ohne „AS“) */
  value: string;
  display: string;
  ipVersion?: IpVersion;
}

export function detectQuery(input: string): RdapQuery | null {
  const t = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, (m) => (/^\/\d{1,3}$/.test(m) ? m : ""));
  if (!t) return null;
  const as = /^AS\s*(\d{1,10})$/i.exec(t) ?? /^(\d{1,10})$/.exec(t);
  if (as && !t.includes(".")) return { kind: "autnum", value: as[1]!, display: `AS${as[1]}` };
  const [addr, pfx] = t.split("/");
  const ip = parseIp(addr!);
  if (ip)
    return { kind: "ip", value: pfx ? `${addr}/${pfx}` : addr!, display: t, ipVersion: ip.version };
  let domain = "";
  try {
    domain = toAscii(t.replace(/\.$/, ""));
  } catch {
    return null;
  }
  if (/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/i.test(domain))
    return { kind: "domain", value: domain.toLowerCase(), display: t };
  return null;
}

// ---------- Abfrage über die Werkbank ----------

/**
 * Die Werkbank sucht im RDAP-Verzeichnis der IANA die zuständige Registry und fragt sie.
 * Der Browser selbst darf fremde Server nicht erreichen.
 */
export async function rdapLookup(q: RdapQuery): Promise<{ url: string; data: RdapObject }> {
  const params = new URLSearchParams({ kind: q.kind, value: q.value });
  return netGet<{ url: string; data: RdapObject }>(`/rdap?${params.toString()}`);
}

// ---------- Auswertung ----------

export interface RdapObject {
  objectClassName?: string;
  handle?: string;
  ldhName?: string;
  unicodeName?: string;
  name?: string;
  type?: string;
  country?: string;
  startAddress?: string;
  endAddress?: string;
  ipVersion?: string;
  parentHandle?: string;
  startAutnum?: number;
  endAutnum?: number;
  status?: string[];
  events?: { eventAction: string; eventDate: string; eventActor?: string }[];
  entities?: RdapEntity[];
  nameservers?: {
    ldhName?: string;
    unicodeName?: string;
    ipAddresses?: { v4?: string[]; v6?: string[] };
  }[];
  secureDNS?: {
    delegationSigned?: boolean;
    zoneSigned?: boolean;
    dsData?: { keyTag: number; algorithm: number; digestType: number; digest: string }[];
  };
  cidr0_cidrs?: { v4prefix?: string; v6prefix?: string; length: number }[];
  remarks?: { title?: string; description?: string[] }[];
  notices?: { title?: string; description?: string[]; links?: { href?: string }[] }[];
  links?: { rel?: string; href?: string; type?: string }[];
  port43?: string;
}

export interface RdapEntity {
  handle?: string;
  roles?: string[];
  vcardArray?: [string, [string, Record<string, unknown>, string, unknown][]];
  publicIds?: { type: string; identifier: string }[];
  entities?: RdapEntity[];
  remarks?: { title?: string; description?: string[] }[];
}

export interface Contact {
  roles: string[];
  handle?: string;
  name?: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  ianaId?: string;
  redacted: boolean;
}

function vcard(e: RdapEntity, prop: string): unknown {
  return e.vcardArray?.[1]?.find((p) => p[0] === prop)?.[3];
}

export function contactOf(e: RdapEntity): Contact {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const adr = vcard(e, "adr");
  const adrLabel = e.vcardArray?.[1]?.find((p) => p[0] === "adr")?.[1]?.label;
  const address =
    str(adrLabel) ??
    (Array.isArray(adr)
      ? adr
          .flat()
          .filter((x) => typeof x === "string" && x.trim())
          .join(", ") || undefined
      : undefined);
  const tel = vcard(e, "tel");
  const name = str(vcard(e, "fn"));
  const org =
    str(vcard(e, "org")) ??
    (Array.isArray(vcard(e, "org")) ? str((vcard(e, "org") as unknown[])[0]) : undefined);
  const remarksText = (e.remarks ?? [])
    .map((r) => `${r.title ?? ""} ${(r.description ?? []).join(" ")}`)
    .join(" ");
  return {
    roles: e.roles ?? [],
    handle: e.handle,
    name,
    org,
    email: str(vcard(e, "email")),
    phone: str(typeof tel === "string" ? tel.replace(/^tel:/, "") : undefined),
    address,
    ianaId: e.publicIds?.find((p) => /iana/i.test(p.type))?.identifier,
    redacted: /redact|privacy|data protection|datenschutz/i.test(`${remarksText} ${name ?? ""}`),
  };
}

/** alle Kontakte (auch verschachtelte, z. B. Abuse beim Registrar) */
export function contacts(o: RdapObject): Contact[] {
  const out: Contact[] = [];
  const walk = (list: RdapEntity[] | undefined) => {
    for (const e of list ?? []) {
      out.push(contactOf(e));
      walk(e.entities);
    }
  };
  walk(o.entities);
  return out;
}

export const roleLabels: Record<string, string> = {
  registrant: "Inhaber",
  registrar: "Registrar",
  administrative: "Admin-C",
  technical: "Tech-C",
  abuse: "Abuse (Missbrauch melden)",
  billing: "Rechnung",
  reseller: "Reseller",
  sponsor: "Sponsor",
  noc: "NOC",
  proxy: "Proxy",
  notifications: "Benachrichtigungen",
};

export const eventLabels: Record<string, string> = {
  registration: "Registriert",
  expiration: "Läuft ab",
  "last changed": "Zuletzt geändert",
  "last update of RDAP database": "Datenstand",
  transfer: "Übertragen",
  reregistration: "Neu registriert",
  locked: "Gesperrt",
  unlocked: "Entsperrt",
};

export const statusLabels: Record<string, string> = {
  active: "aktiv",
  "client transfer prohibited": "Transfer gesperrt (Registrar)",
  "server transfer prohibited": "Transfer gesperrt (Registry)",
  "client delete prohibited": "Löschen gesperrt (Registrar)",
  "server delete prohibited": "Löschen gesperrt (Registry)",
  "client update prohibited": "Ändern gesperrt (Registrar)",
  "server update prohibited": "Ändern gesperrt (Registry)",
  "client hold": "gesperrt – nicht im DNS (Registrar)",
  "server hold": "gesperrt – nicht im DNS (Registry)",
  "pending delete": "wird gelöscht",
  "redemption period": "Rückkaufphase",
  "pending transfer": "Transfer läuft",
  inactive: "inaktiv",
  "auto renew period": "automatisch verlängert",
};

/** „cidr0“-Präfixe oder Start/Ende als Text */
export function ipRangeText(o: RdapObject): string | undefined {
  const c = o.cidr0_cidrs?.map((x) => `${x.v4prefix ?? x.v6prefix}/${x.length}`);
  if (c?.length) return c.join(", ");
  if (o.startAddress) return `${o.startAddress} – ${o.endAddress}`;
  return undefined;
}

export const dateText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
};
