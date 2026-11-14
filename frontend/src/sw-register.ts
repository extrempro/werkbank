export const UPDATE_EVENT = "werkbank:update-available";

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

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    });
  });
}
