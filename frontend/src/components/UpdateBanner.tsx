import { useEffect, useState } from "react";
import { UPDATE_EVENT } from "../sw-register";

/** Hinweis auf eine neue Version. Gewechselt wird erst nach Klick (spec.md, Kapitel 11). */
export function UpdateBanner() {
  const [worker, setWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const onUpdate = (event: Event) => setWorker((event as CustomEvent<ServiceWorker>).detail);
    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(UPDATE_EVENT, onUpdate);
  }, []);

  if (!worker) {
    return null;
  }
  return (
    <div className="update-banner" role="status">
      <span>Eine neue Version der Werkbank ist verfügbar.</span>
      <button
        type="button"
        className="button button-primary"
        onClick={() => worker.postMessage("SKIP_WAITING")}
      >
        Neu laden
      </button>
    </div>
  );
}
