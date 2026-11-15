import { useEffect, useState } from "react";
import { AUTH_EVENT, stepUpLoginUrl, type AuthProblem } from "../api";

/**
 * Deutlicher Hinweis, wenn eine Änderung an einer zu alten Anmeldung scheitert
 * (Verwaltung, spec.md 6.1). Bietet die erneute Anmeldung an und führt danach zurück.
 */
export function AuthBanner() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onProblem = (event: Event) => {
      if ((event as CustomEvent<AuthProblem>).detail === "anmeldung-zu-alt") {
        setShown(true);
      }
    };
    window.addEventListener(AUTH_EVENT, onProblem);
    return () => window.removeEventListener(AUTH_EVENT, onProblem);
  }, []);

  if (!shown) {
    return null;
  }
  return (
    <div className="update-banner auth-banner" role="alert">
      <span>
        <strong>Bitte melde dich erneut an.</strong> Änderungen in der Verwaltung gehen zur
        Sicherheit nur kurz nach einer Anmeldung. Deine letzte Änderung wurde nicht gespeichert.
      </span>
      <a className="button button-primary" href={stepUpLoginUrl(window.location.pathname)}>
        Erneut anmelden
      </a>
      <button type="button" className="button button-secondary" onClick={() => setShown(false)}>
        Später
      </button>
    </div>
  );
}
