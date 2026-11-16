import { useEffect, useState } from "react";

/**
 * Einstellungen eines Tools in der Adresszeile, damit sich ein Link teilen lässt.
 * Dort stehen nur Optionen und harmlose Eingaben, nie Geheimnisse (Kennwörter, Schlüssel, Texte).
 * Werte, die dem Standard entsprechen, werden weggelassen.
 */
export function useToolParams<T extends Record<string, string>>(
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const read = (): T => {
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string> = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = params.get(key);
      if (value !== null) {
        result[key] = value;
      }
    }
    return result as T;
  };
  const [values, setValues] = useState<T>(read);

  useEffect(() => {
    const update = () => setValues(read());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
    // Die Standardwerte eines Tools ändern sich nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (patch: Partial<T>) => {
    const next = { ...values, ...patch } as T;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value !== defaults[key] && value !== "") {
        params.set(key, value);
      }
    }
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    setValues(next);
  };
  return [values, change];
}

/** Ganze Zahl innerhalb von Grenzen; ungültige Eingaben fallen auf den Standard zurück. */
export function clampInt(text: string, min: number, max: number, fallback: number): number {
  const value = Number(text);
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Wert, den ein Verweis aus einem anderen Tool mitgibt (z. B. eine Domain); nur lesen. */
export function readParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

/**
 * Nimmt mitgegebene Werte wieder aus der Adresszeile, damit eingegebene Namen dort nicht stehen
 * bleiben. Einstellungen des Tools bleiben.
 */
export function dropParams(names: string[]): void {
  const params = new URLSearchParams(window.location.search);
  if (!names.some((name) => params.has(name))) {
    return;
  }
  for (const name of names) {
    params.delete(name);
  }
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
}
