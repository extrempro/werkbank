/**
 * Abfragen der IT-Tools ins Internet. Der Browser darf wegen der Sicherheitsrichtlinie nur die
 * Werkbank selbst erreichen; der Server fragt feste Ziele (DNS-Resolver, RDAP, Have I Been Pwned,
 * crt.sh) und gibt die Antwort weiter. Ausgewertet wird weiter im Browser.
 */
import { errorText, getJson, postJson } from "../../api";

export const NET_BASE = "/api/tools/net";

export interface NetStatus {
  enabled: boolean;
  resolvers: { id: string; name: string }[];
  types: string[];
}

/** Fehler der Werkbank als lesbare Meldung weiterreichen. */
export function netError(error: unknown): Error {
  return new Error(errorText(error, "Die Abfrage ist fehlgeschlagen."));
}

export async function netGet<T>(path: string): Promise<T> {
  try {
    return await getJson<T>(`${NET_BASE}${path}`);
  } catch (error) {
    throw netError(error);
  }
}

export async function netPost<T>(path: string, body: unknown): Promise<T> {
  try {
    return await postJson<T>(`${NET_BASE}${path}`, body);
  } catch (error) {
    throw netError(error);
  }
}

export function fetchNetStatus(): Promise<NetStatus> {
  return netGet<NetStatus>("/status");
}

/** Base64 (vom Server) in Bytes. */
export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
