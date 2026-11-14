export const UPDATE_EVENT = "werkbank:update-available";

let updateRequested = false;

/** Neue Version aktivieren. Die Seite lädt neu, sobald der neue Service Worker übernimmt. */
export function applyUpdate(worker: ServiceWorker): void {
  updateRequested = true;
  worker.postMessage("SKIP_WAITING");
}

/** Registriert den Service Worker und meldet neue Versionen an die Oberfläche. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) {
    return;
  }
  window.addEventListener("load", () => {
    const notify = (worker: ServiceWorker) =>
      window.dispatchEvent(new CustomEvent<ServiceWorker>(UPDATE_EVENT, { detail: worker }));

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          notify(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) {
            return;
          }
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              notify(installing);
            }
          });
        });
      })
      .catch(() => undefined);

    // Nur neu laden, wenn die Person das Update angestoßen hat. Beim allerersten Besuch
    // übernimmt der Service Worker ebenfalls (clients.claim), dann soll nichts neu laden.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateRequested) {
        updateRequested = false;
        window.location.reload();
      }
    });
  });
}
