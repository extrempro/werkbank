import { useEffect, useState } from "react";

/** Kleiner Router ohne Abhängigkeit: Pfad aus der Adresszeile, Wechsel über die History-API. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener("werkbank:navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("werkbank:navigate", update);
    };
  }, []);
  return path;
}

export function navigate(path: string): void {
  if (path !== window.location.pathname + window.location.search) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("werkbank:navigate"));
  }
}

/** Wert eines Parameters aus der Adresszeile (z. B. `q` in `/suche?q=teams`), sonst leer. */
export function useSearchParam(name: string): string {
  const read = () => new URLSearchParams(window.location.search).get(name) ?? "";
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(new URLSearchParams(window.location.search).get(name) ?? "");
    window.addEventListener("popstate", update);
    window.addEventListener("werkbank:navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("werkbank:navigate", update);
    };
  }, [name]);
  return value;
}
