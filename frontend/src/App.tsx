import { useEffect, useState } from "react";
import { AUTH_EVENT, fetchMe, type AuthProblem, type Me } from "./api";
import { AuthBanner } from "./components/AuthBanner";
import { Layout } from "./components/Layout";
import { UpdateBanner } from "./components/UpdateBanner";
import { parseConfirmPath } from "./modules/inventory/issuesApi";
import { ConfirmIssuePage } from "./pages/ConfirmIssuePage";
import { LoginPage } from "./pages/LoginPage";

type State =
  | { status: "loading" }
  | { status: "anonymous"; expired?: boolean }
  | { status: "error" }
  | { status: "ready"; me: Me };

/** Frühestens nach dieser Zeit wird beim Zurückkehren in den Tab die Anmeldung geprüft. */
const RECHECK_MS = 60_000;

export function App() {
  // Einmal-Link zum Bestätigen einer Ausgabe: ohne Anmeldung, ohne Navigation
  const confirmToken = parseConfirmPath(window.location.pathname);
  return confirmToken ? <ConfirmIssuePage token={confirmToken} /> : <SignedInApp />;
}

function SignedInApp() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((me) => {
        if (active) {
          setState(me ? { status: "ready", me } : { status: "anonymous" });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "error" });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Läuft die Sitzung ab, während die Werkbank offen ist, erscheint gleich die Anmeldeseite:
  // sobald eine Abfrage „nicht angemeldet“ meldet oder der Tab wieder nach vorn kommt.
  useEffect(() => {
    const expire = () =>
      setState((current) =>
        current.status === "ready" ? { status: "anonymous", expired: true } : current,
      );
    const onProblem = (event: Event) => {
      if ((event as CustomEvent<AuthProblem>).detail === "abgemeldet") {
        expire();
      }
    };
    let lastCheck = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < RECHECK_MS) {
        return;
      }
      lastCheck = Date.now();
      fetchMe()
        .then((me) => {
          if (!me) {
            expire();
          }
        })
        .catch(() => {
          // Ohne Netz bleibt die Seite, wie sie ist.
        });
    };
    window.addEventListener(AUTH_EVENT, onProblem);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(AUTH_EVENT, onProblem);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <>
      <UpdateBanner />
      {state.status === "ready" && <AuthBanner />}
      {state.status === "loading" && (
        <p className="page-message" role="status">
          Werkbank wird geladen …
        </p>
      )}
      {state.status === "error" && (
        <main className="page-message">
          <h1>Werkbank nicht erreichbar</h1>
          <p>Bitte versuche es in einem Moment erneut.</p>
          <a className="button button-primary" href="/">
            Erneut versuchen
          </a>
        </main>
      )}
      {state.status === "anonymous" && <LoginPage expired={state.expired === true} />}
      {state.status === "ready" && <Layout me={state.me} />}
    </>
  );
}
