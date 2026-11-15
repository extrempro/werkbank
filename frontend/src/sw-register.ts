export const UPDATE_EVENT = "werkbank:update-available";

let updateRequested = false;

/** Neue Version aktivieren. Die Seite lädt neu, sobald der neue Service Worker übernimmt. */
export function applyUpdate(worker: ServiceWorker): void {
  updateRequested = true;
  worker.postMessage("SKIP_WAITING");
}

/** Frühestens nach dieser Zeit wird erneut nach einer neuen Version gefragt. */
export const UPDATE_CHECK_MIN_MS = 5 * 60 * 1000;
/** Eine offene Seite fragt in diesem Abstand von selbst nach. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Fragt regelmäßig nach einer neuen Version. Ohne das prüft der Browser nur beim Laden
 * einer Seite; die Werkbank wechselt ihre Seiten aber ohne Neuladen, sodass ein offenes
 * Fenster eine neue Version sonst nie bemerkt.
 * Gefragt wird im festen Abstand, wenn das Fenster wieder sichtbar wird und wenn das Netz
 * zurückkommt, aber nie öfter als alle paar Minuten.
 */
export function watchForUpdates(registration: Pick<ServiceWorkerRegistration, "update">): void {
  let last = Date.now();
  const check = () => {
    if (document.visibilityState !== "visible" || Date.now() - last < UPDATE_CHECK_MIN_MS) {
      return;
    }
    last = Date.now();
    // Ohne Netz schlägt die Anfrage fehl; der nächste Anlass versucht es wieder.
    registration.update().catch(() => undefined);
  };
  window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
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
        watchForUpdates(registration);
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
