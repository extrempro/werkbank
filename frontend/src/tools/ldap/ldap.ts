/**
 * LDAP: Werte maskieren (Filter nach RFC 4515, DN nach RFC 4514) und Distinguished Names zerlegen.
 */

// ---------- Filter (RFC 4515) ----------

const utf8 = new TextEncoder();
const hex2 = (b: number) => b.toString(16).padStart(2, "0");

/** maskiert * ( ) \ und NUL für einen Wert in einem LDAP-Filter; optional alle Nicht-ASCII-Zeichen als UTF-8-Bytes */
export function escapeFilterValue(value: string, escapeNonAscii = false): string {
  let out = "";
  for (const ch of value) {
    if (ch === "*" || ch === "(" || ch === ")" || ch === "\\" || ch === "\0")
      out += `\\${hex2(ch.charCodeAt(0))}`;
    else if (escapeNonAscii && ch.codePointAt(0)! > 0x7e)
      out += Array.from(utf8.encode(ch), (b) => `\\${hex2(b)}`).join("");
    else out += ch;
  }
  return out;
}

/** \2a → * usw. (UTF-8-Bytefolgen werden zusammengesetzt) */
export function unescapeFilterValue(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && /^[0-9a-f]{2}$/i.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...utf8.encode(value[i]!));
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

// ---------- DN (RFC 4514) ----------

/** maskiert einen Attributwert für einen DN */
export function escapeDnValue(value: string): string {
  let out = "";
  const chars = [...value];
  chars.forEach((ch, i) => {
    if (',+"\\<>;='.includes(ch)) out += `\\${ch}`;
    else if (ch === "\0") out += "\\00";
    else if (i === 0 && (ch === "#" || ch === " ")) out += `\\${ch}`;
    else if (i === chars.length - 1 && ch === " ") out += "\\ ";
    else out += ch;
  });
  return out;
}

export interface Rdn {
  /** mehrwertige RDNs (a=1+b=2) haben mehrere Paare */
  parts: { type: string; value: string; raw: string }[];
  raw: string;
}

function unescapeDnValue(raw: string): string {
  let v = raw.trim();
  // Leerzeichen, die maskiert am Ende standen, wieder herstellen
  if (raw.trimEnd().endsWith("\\") && raw.endsWith(" ")) v = `${v} `;
  if (v.startsWith("#")) return v; // BER-kodierter Wert, unverändert anzeigen
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); // alte Schreibweise (RFC 1779)
  const bytes: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && i + 1 < v.length) {
      const h = v.slice(i + 1, i + 3);
      if (/^[0-9a-f]{2}$/i.test(h)) {
        bytes.push(parseInt(h, 16));
        i += 2;
      } else {
        bytes.push(...utf8.encode(v[i + 1]!));
        i++;
      }
    } else bytes.push(...utf8.encode(v[i]!));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** zerlegt an Trennzeichen, die nicht maskiert und nicht in Anführungszeichen stehen */
function splitUnescaped(text: string, separators: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length) {
      cur += ch + text[i + 1];
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
      cur += ch;
    } else if (!quoted && separators.includes(ch)) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (quoted) throw new Error("Anführungszeichen nicht geschlossen");
  out.push(cur);
  return out;
}

export function parseDn(dn: string): Rdn[] {
  const text = dn.trim();
  if (!text) return [];
  return splitUnescaped(text, ",;").map((rdnRaw) => {
    if (!rdnRaw.trim()) throw new Error("Leerer Bestandteil im DN (doppeltes Komma?)");
    const parts = splitUnescaped(rdnRaw, "+").map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 1) throw new Error(`„${pair.trim()}“ hat kein „Typ=Wert“`);
      const type = pair.slice(0, eq).trim();
      if (!/^([a-zA-Z][a-zA-Z0-9-]*|\d+(\.\d+)*)$/.test(type))
        throw new Error(`Ungültiger Attributtyp „${type}“`);
      return { type, value: unescapeDnValue(pair.slice(eq + 1)), raw: pair.trim() };
    });
    return { parts, raw: rdnRaw.trim() };
  });
}

export const formatRdn = (rdn: Rdn) =>
  rdn.parts.map((p) => `${p.type}=${escapeDnValue(p.value)}`).join("+");

export interface DnInfo {
  rdns: Rdn[];
  /** sauber formatierter DN */
  normalized: string;
  /** DNS-Name aus den DC-Bestandteilen */
  domain?: string;
  /** canonicalName wie in „Active Directory-Benutzer und -Computer“ (Objekt, Ansicht → Erweitert) */
  canonical?: string;
  parent?: string;
  name?: string;
}

export function analyzeDn(dn: string): DnInfo {
  const rdns = parseDn(dn);
  const normalized = rdns.map(formatRdn).join(",");
  const dc = rdns
    .filter((r) => r.parts[0]!.type.toLowerCase() === "dc")
    .map((r) => r.parts[0]!.value);
  const domain = dc.length ? dc.join(".") : undefined;
  const nonDc = rdns.filter((r) => r.parts[0]!.type.toLowerCase() !== "dc");
  const canonical = domain
    ? [
        domain,
        ...[...nonDc]
          .reverse()
          .map((r) =>
            r.parts.map((p) => p.value.replace(/\\/g, "\\\\").replace(/\//g, "\\/")).join("+"),
          ),
      ].join("/")
    : undefined;
  return {
    rdns,
    normalized,
    domain,
    canonical,
    parent: rdns.length > 1 ? rdns.slice(1).map(formatRdn).join(",") : undefined,
    name: rdns[0]?.parts.map((p) => p.value).join("+"),
  };
}

/** canonicalName (example.com/Benutzer/Max) → DN; Zwischenebenen werden als OU angenommen, das letzte Element als CN */
export function canonicalToDn(canonical: string, leafType = "CN"): string {
  const parts = splitUnescaped(canonical.trim().replace(/\/$/, ""), "/").map((p) =>
    p.replace(/\\\//g, "/"),
  );
  const [domain, ...path] = parts;
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain))
    throw new Error("Beginnt nicht mit einem Domainnamen (z. B. example.com/…)");
  const dc = domain.split(".").map((d) => `DC=${escapeDnValue(d)}`);
  const containers = new Set([
    "users",
    "computers",
    "builtin",
    "system",
    "program data",
    "foreignsecurityprincipals",
    "managed service accounts",
  ]);
  const rdns = path.map((p, i) => {
    const isLeaf = i === path.length - 1;
    const type = isLeaf ? leafType : i === 0 && containers.has(p.toLowerCase()) ? "CN" : "OU";
    return `${type}=${escapeDnValue(p)}`;
  });
  return [...rdns.reverse(), ...dc].join(",");
}
