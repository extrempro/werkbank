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
  if (path !== window.location.pathname) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("werkbank:navigate"));
  }
}
