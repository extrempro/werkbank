/**
 * DNS-Daten lesbar aufbereiten: Felder benennen (MX, SRV, SOA, CAA …), TXT entpacken, TTL in Klartext.
 */
import { txtContent } from "./normalize";

export interface Field {
  label: string;
  value: string;
}

export interface ReadableRecord {
  /** Hauptwert, z. B. Zielserver oder Adresse */
  main: string;
  /** weitere benannte Felder */
  fields: Field[];
  /** Einordnung, z. B. „SPF“, „DMARC“ */
  kind?: string;
  /** kurze Erklärung */
  hint?: string;
}

const host = (name: string) => (name === "." ? "." : name.replace(/\.$/, ""));

export function humanTtl(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const units: [number, string][] = [
    [86400, "d"],
    [3600, "h"],
    [60, "min"],
  ];
  const parts: string[] = [];
  let rest = seconds;
  for (const [size, label] of units) {
    const n = Math.floor(rest / size);
    if (n) parts.push(`${n} ${label}`);
    rest -= n * size;
    if (parts.length === 2) break;
  }
  if (rest && parts.length < 2 && seconds < 3600) parts.push(`${rest} s`);
  return parts.join(" ");
}

function txtKind(text: string): { kind?: string; hint?: string } {
  const t = text.trim();
  if (/^v=spf1\b/i.test(t)) return { kind: "SPF", hint: "Absender-Erlaubnis für E-Mails" };
  if (/^v=DMARC1\b/i.test(t)) {
    const p = t.match(/\bp=(\w+)/i)?.[1]?.toLowerCase();
    const policy = { none: "nur beobachten", quarantine: "in Quarantäne", reject: "abweisen" }[
      p ?? ""
    ];
    return { kind: "DMARC", hint: policy ? `Richtlinie: ${policy}` : undefined };
  }
  if (/^v=DKIM1\b/i.test(t) || /\bk=rsa;\s*p=/i.test(t))
    return { kind: "DKIM", hint: "öffentlicher Schlüssel zur Mail-Signatur" };
  if (/^v=STSv1\b/i.test(t)) return { kind: "MTA-STS" };
  if (/^v=TLSRPTv1\b/i.test(t)) return { kind: "TLS-RPT" };
  if (/^v=BIMI1\b/i.test(t)) return { kind: "BIMI" };
  if (/^MS=ms\d+/i.test(t)) return { kind: "Microsoft 365", hint: "Domain-Bestätigung" };
  if (/^google-site-verification=/i.test(t)) return { kind: "Google", hint: "Domain-Bestätigung" };
  if (/(^|[-_.])[a-z0-9-]*verification=|domain-verify=|verify=/i.test(t))
    return { kind: "Bestätigung", hint: "Domain-Bestätigung eines Dienstes" };
  return {};
}

const caaTags: Record<string, string> = {
  issue: "darf Zertifikate ausstellen",
  issuewild: "darf Wildcard-Zertifikate ausstellen",
  iodef: "Meldeadresse bei Verstößen",
  issuemail: "darf S/MIME-Zertifikate ausstellen",
};

export function readable(type: string, data: string): ReadableRecord {
  const d = data.trim();
  const parts = d.split(/\s+/);
  switch (type.toUpperCase()) {
    case "CNAME":
    case "NS":
    case "PTR":
    case "DNAME":
      return { main: host(d), fields: [] };
    case "MX": {
      const [pref = "", target = ""] = parts;
      if (target === ".")
        return {
          main: "keine Mail-Annahme",
          fields: [],
          kind: "Null-MX",
          hint: "Die Domain empfängt keine E-Mails (RFC 7505).",
        };
      return { main: host(target), fields: [{ label: "Priorität", value: pref }] };
    }
    case "SRV": {
      const [prio = "", weight = "", port = "", target = ""] = parts;
      return {
        main: `${host(target)}:${port}`,
        fields: [
          { label: "Priorität", value: prio },
          { label: "Gewicht", value: weight },
        ],
      };
    }
    case "SOA": {
      const [mname = "", rname = "", serial = "", refresh, retry, expire, minimum] = parts;
      // hostmaster.example.com. → hostmaster@example.com (erster unmaskierter Punkt)
      const mail = host(rname)
        .replace(/^((?:[^.\\]|\\.)*)\./, "$1@")
        .replace(/\\\./g, ".");
      const t = (v?: string) => (v && /^\d+$/.test(v) ? humanTtl(Number(v)) : (v ?? "–"));
      return {
        main: host(mname),
        fields: [
          { label: "Verantwortlich", value: mail },
          { label: "Seriennummer", value: serial },
          { label: "Refresh", value: t(refresh) },
          { label: "Retry", value: t(retry) },
          { label: "Expire", value: t(expire) },
          { label: "Negativ-TTL", value: t(minimum) },
        ],
      };
    }
    case "TXT":
    case "SPF": {
      const text = txtContent(d);
      return { main: text, fields: [], ...txtKind(text) };
    }
    case "CAA": {
      const m = d.match(/^(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) return { main: d, fields: [] };
      const tag = m[2]!.toLowerCase();
      const value = txtContent(m[3]!);
      return {
        main: value || "(niemand)",
        fields: [
          { label: "Regel", value: tag },
          ...(m[1] !== "0" ? [{ label: "Flag", value: m[1]! }] : []),
        ],
        hint:
          tag === "issue" && !value
            ? "Keine Zertifizierungsstelle darf Zertifikate ausstellen."
            : caaTags[tag],
      };
    }
    case "HTTPS":
    case "SVCB": {
      const [prio = "", target = "", ...params] = parts;
      return {
        main: target === "." ? "(gleicher Name)" : host(target),
        fields: [
          { label: "Priorität", value: prio === "0" ? "0 (Alias)" : prio },
          ...params.map((p) => {
            const [k = "", v = ""] = p.split("=");
            return { label: k, value: v };
          }),
        ],
      };
    }
    case "TLSA": {
      const [usage = "", selector = "", mtype = "", ...hex] = parts;
      const usages: Record<string, string> = {
        "0": "CA",
        "1": "Zertifikat",
        "2": "eigene CA",
        "3": "eigenes Zertifikat",
      };
      return {
        main: hex.join(""),
        fields: [
          { label: "Verwendung", value: `${usage} (${usages[usage] ?? "?"})` },
          {
            label: "Selektor",
            value: selector === "1" ? "1 (Schlüssel)" : `${selector} (Zertifikat)`,
          },
          {
            label: "Abgleich",
            value:
              { "0": "0 (vollständig)", "1": "1 (SHA-256)", "2": "2 (SHA-512)" }[mtype] ?? mtype,
          },
        ],
      };
    }
    case "DS": {
      const [keyTag = "", alg = "", digestType = "", ...hex] = parts;
      return {
        main: hex.join(""),
        fields: [
          { label: "Key-Tag", value: keyTag },
          { label: "Algorithmus", value: alg },
          {
            label: "Digest",
            value: { "1": "SHA-1", "2": "SHA-256", "4": "SHA-384" }[digestType] ?? digestType,
          },
        ],
      };
    }
    case "DNSKEY": {
      const [flags = "", proto = "", alg = "", ...key] = parts;
      return {
        main: key.join(""),
        fields: [
          {
            label: "Art",
            value: flags === "257" ? "KSK (257)" : flags === "256" ? "ZSK (256)" : flags,
          },
          { label: "Algorithmus", value: alg },
          ...(proto !== "3" ? [{ label: "Protokoll", value: proto }] : []),
        ],
      };
    }
    default:
      return { main: d, fields: [] };
  }
}
