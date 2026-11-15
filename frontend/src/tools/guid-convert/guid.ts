/**
 * Umrechnung zwischen den Darstellungen einer AD-objectGUID.
 *
 * Wichtig: Microsoft speichert die ersten drei Gruppen einer GUID als Little-Endian.
 * Die ImmutableID (Entra Connect / M365) ist das Base64 dieser 16 Bytes in genau dieser Reihenfolge.
 */

export type GuidInputKind = "guid" | "immutableId" | "ldap" | "hex";

export interface GuidForms {
  /** GUID wie in AD-Tools angezeigt, z. B. 748b2d72-706b-42f8-8b25-82fd8733860f */
  guid: string;
  /** Base64 der Bytes – ImmutableID / sourceAnchor / msDS-ConsistencyGuid */
  immutableId: string;
  /** Bytes als Hex in Speicher-Reihenfolge, z. B. für Attribut-Editoren */
  hex: string;
  /** Für LDAP-Filter, z. B. (objectGUID=\72\2d…) */
  ldapFilter: string;
}

export interface GuidResult extends GuidForms {
  detected: GuidInputKind;
}

const guidPattern =
  /^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i;

export function guidToBytes(guid: string): Uint8Array {
  const m = guid.trim().match(guidPattern);
  if (!m) throw new Error("Keine gültige GUID");
  const hex = m.slice(1).join("");
  const bytes = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
  // erste drei Gruppen in Little-Endian umdrehen
  return Uint8Array.from([
    bytes[3]!,
    bytes[2]!,
    bytes[1]!,
    bytes[0]!,
    bytes[5]!,
    bytes[4]!,
    bytes[7]!,
    bytes[6]!,
    ...bytes.slice(8),
  ]);
}

export function bytesToGuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error(`Eine GUID hat 16 Bytes, nicht ${bytes.length}`);
  const h = (i: number) => bytes[i]!.toString(16).padStart(2, "0");
  return [
    h(3) + h(2) + h(1) + h(0),
    h(5) + h(4),
    h(7) + h(6),
    h(8) + h(9),
    [10, 11, 12, 13, 14, 15].map(h).join(""),
  ].join("-");
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(input: string): Uint8Array {
  const normalized = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function bytesToForms(bytes: Uint8Array): GuidForms {
  const hexBytes = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return {
    guid: bytesToGuid(bytes),
    immutableId: toBase64(bytes),
    hex: hexBytes.join(" "),
    ldapFilter: hexBytes.map((b) => `\\${b}`).join(""),
  };
}

/** Erkennt die Eingabe automatisch und liefert alle Darstellungen. */
export function convertGuid(input: string): GuidResult {
  const value = input.trim();
  if (!value) throw new Error("Keine Eingabe");

  // LDAP-Filter-Form: \72\2d\8b…
  if (/^(\\[0-9a-f]{2}){16}$/i.test(value)) {
    const bytes = Uint8Array.from(value.slice(1).split("\\"), (h) => parseInt(h, 16));
    return { detected: "ldap", ...bytesToForms(bytes) };
  }

  // Hex-Bytes mit Trennzeichen (Leerzeichen, Doppelpunkt, Komma) in Speicher-Reihenfolge
  const hexParts = value.split(/[\s:,]+/);
  if (hexParts.length === 16 && hexParts.every((p) => /^(0x)?[0-9a-f]{2}$/i.test(p))) {
    const bytes = Uint8Array.from(hexParts, (h) => parseInt(h.replace(/^0x/i, ""), 16));
    return { detected: "hex", ...bytesToForms(bytes) };
  }

  if (guidPattern.test(value)) {
    return { detected: "guid", ...bytesToForms(guidToBytes(value)) };
  }

  if (/^[A-Za-z0-9+/_-]{22}(==)?$/.test(value)) {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(value);
    } catch {
      throw new Error("Ungültiges Base64");
    }
    if (bytes.length !== 16) throw new Error(`ImmutableID ergibt ${bytes.length} statt 16 Bytes`);
    return { detected: "immutableId", ...bytesToForms(bytes) };
  }

  throw new Error(
    "Format nicht erkannt – erwartet GUID, ImmutableID (Base64), Hex-Bytes oder LDAP-Form (\\xx\\xx…)",
  );
}

export const guidKindLabels: Record<GuidInputKind, string> = {
  guid: "objectGUID",
  immutableId: "ImmutableID (Base64)",
  ldap: "LDAP-Filter-Bytes",
  hex: "Hex-Bytes",
};
