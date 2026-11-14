import { useEffect, useState } from "react";
import { fetchMe, type Me } from "./api";
import { Layout } from "./components/Layout";
import { UpdateBanner } from "./components/UpdateBanner";
import { LoginPage } from "./pages/LoginPage";

type State =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "error" }
  | { status: "ready"; me: Me };

export function App() {
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

  return (
    <>
      <UpdateBanner />
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
      {state.status === "anonymous" && <LoginPage />}
      {state.status === "ready" && <Layout me={state.me} />}
    </>
  );
}
