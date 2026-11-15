import { useEffect, useState, type FormEvent } from "react";
import { searchAll, type SearchHit } from "../api";
import { Link } from "../components/Link";
import { navigate, useSearchParam } from "../router";

export const SEARCH_PATH = "/suche";
const MIN_LENGTH = 2;

export function searchUrl(query: string): string {
  return `${SEARCH_PATH}?${new URLSearchParams({ q: query }).toString()}`;
}

function moduleClass(module: string): string {
  if (module.startsWith("M365")) {
    return "module-tag module-tag-m365";
  }
  return module === "Evergreen" ? "module-tag module-tag-evergreen" : "module-tag";
}

type State =
  { status: "idle" | "loading" | "error" } | { status: "ready"; query: string; hits: SearchHit[] };

/** Suche über Einstellungen, Änderungen und Vorgänge. */
export function SearchPage() {
  const query = useSearchParam("q").trim();
  const [draft, setDraft] = useState(query);
  const [state, setState] = useState<State>({ status: "idle" });

  // Übernimmt den Begriff, wenn er sich über die Kopfzeile oder „Zurück“ ändert.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setDraft(query);
  }

  useEffect(() => {
    if (query.length < MIN_LENGTH) {
      return;
    }
    let active = true;
    searchAll(query)
      .then((result) => {
        if (active) {
          setState({ status: "ready", query, hits: result.hits });
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
  }, [query]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (next.length >= MIN_LENGTH) {
      navigate(searchUrl(next));
    }
  };

  const tooShort = query.length < MIN_LENGTH;
  const ready = !tooShort && state.status === "ready" && state.query === query ? state : null;
  const loading = !tooShort && !ready && state.status !== "error";

  return (
    <div className="page">
      <header className="page-head">
        <h1>Suche</h1>
        <p className="page-sub">
          Sucht in Einstellungen, Änderungen und Vorgängen, die du sehen darfst.
        </p>
      </header>

      <form className="search-form" role="search" onSubmit={onSubmit}>
        <label htmlFor="suchbegriff">Suchbegriff</label>
        <div className="search-row">
          <input
            id="suchbegriff"
            type="search"
            value={draft}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="button button-primary">
            Suchen
          </button>
        </div>
        <p className="small">
          Mindestens {MIN_LENGTH} Zeichen, z. B. ein Name, ein Pfad oder EV-2026-014.
        </p>
      </form>

      {loading && <p role="status">Wird gesucht …</p>}
      {!tooShort && state.status === "error" && (
        <p role="alert">Die Suche ist fehlgeschlagen. Bitte noch einmal versuchen.</p>
      )}
      {ready && ready.hits.length === 0 && (
        <p className="panel panel-empty" role="status">
          Keine Treffer für „{ready.query}“.
        </p>
      )}
      {ready && ready.hits.length > 0 && (
        <section className="panel" aria-labelledby="treffer-titel">
          <div className="panel-head">
            <h2 id="treffer-titel">Treffer</h2>
            <span className="small" role="status">
              {ready.hits.length === 1 ? "1 Treffer" : `${ready.hits.length} Treffer`} für „
              {ready.query}“
            </span>
          </div>
          <ul className="rows">
            {ready.hits.map((hit, index) => (
              <li key={`${hit.link}-${hit.kind}-${index}`}>
                <span className={moduleClass(hit.module)}>{hit.module}</span>
                <span className="row-main">
                  <Link to={hit.link} className="row-title">
                    {hit.title}
                  </Link>
                  <span className="small">
                    {hit.kind}
                    {hit.subtitle && ` · ${hit.subtitle}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
