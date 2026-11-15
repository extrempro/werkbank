/** UTF-8-sichere Base64-Kodierung (funktioniert im Browser und in Node). */
export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Dekodiert Base64 (auch URL-safe Variante) zu UTF-8-Text. Wirft bei ungültiger Eingabe. */
export function base64Decode(input: string): string {
  const normalized = input.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Ungültige Base64-Eingabe");
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Dekodierte Daten sind kein gültiger UTF-8-Text");
  }
}
