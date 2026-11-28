import { navigate } from "../../../router";

/** Setzt oder entfernt Werte in der Adresse, ohne die Seite neu zu laden. */
export function replaceParams(values: Record<string, string>) {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) {
      query.set(key, value);
    } else {
      query.delete(key);
    }
  }
  const text = query.toString();
  navigate(`${window.location.pathname}${text ? `?${text}` : ""}`);
}
