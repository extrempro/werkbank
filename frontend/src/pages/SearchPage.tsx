import { useEffect, useState, type FormEvent } from "react";
import { searchAll, type SearchHit } from "../api";
import { Link } from "../components/Link";
import { searchHandbook, topicPath } from "../handbook";
import { TOOLS_PATH } from "../navigation";
import { navigate, useSearchParam } from "../router";
import { CATEGORY_LABELS, searchTools } from "../tools";

export const SEARCH_PATH = "/suche";
const MIN_LENGTH = 2;

export function searchUrl(query: string): string {
  return `${SEARCH_PATH}?${new URLSearchParams({ q: query }).toString()}`;
}

function moduleClass(module: string): string {
  if (module === "IT-Tools") {
    return "module-tag module-tag-tools";
  }
  if (module.startsWith("M365")) {
    return "module-tag module-tag-m365";
  }
  return module === "Evergreen" ? "module-tag module-tag-evergreen" : "module-tag";
}

type State =
  { status: "idle" | "loading" | "error" } | { status: "ready"; query: string; hits: SearchHit[] };

/** Treffer unter den IT-Tools. Die Tools liegen im Browser, deshalb sucht nicht der Server. */
export function toolHits(query: string): SearchHit[] {
  return searchTools(query).map((tool) => ({
    module: "IT-Tools",
    kind: "Tool",
    title: tool.name,
    subtitle: CATEGORY_LABELS[tool.category],
    link: `${TOOLS_PATH}/${tool.id}`,
  }));
}

/** Treffer im Handbuch, nur in den Themen, die zu den Rollen passen. Sucht der Browser. */
export function handbookHits(query: string, roles: readonly string[]): SearchHit[] {
  return searchHandbook(query, roles, 5).map((hit) => ({
    module: "Handbuch",
    kind: "Thema",
    title: hit.topic.title,
    subtitle: hit.area.title,
    link: topicPath(hit.area.id, hit.topic.id),
  }));
}

/** Suche über Einstellungen, Änderungen, Vorgänge und, mit der Rolle dafür, die IT-Tools. */
export function SearchPage({ roles = [] }: { roles?: readonly string[] }) {
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
  const fromServer = !tooShort && state.status === "ready" && state.query === query ? state : null;
  const withTools = roles.includes("Tools.User");
  // Die Tools sucht der Browser selbst: Ihre Treffer stehen sofort da, auch wenn der Server
  // noch sucht oder nicht antwortet.
  const tools = !tooShort && withTools ? toolHits(query) : [];
  const handbook = tooShort ? [] : handbookHits(query, roles);
  const failed = !tooShort && state.status === "error";
  const ready =
    fromServer || failed || tools.length > 0 || handbook.length > 0
      ? { query, hits: [...tools, ...(fromServer?.hits ?? []), ...handbook] }
      : null;
  const loading = !tooShort && !fromServer && !failed;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Suche</h1>
        <p className="page-sub">
          Sucht in Einstellungen, Änderungen und Vorgängen, die du sehen darfst
          {withTools && ", in den IT-Tools"} und im Handbuch.
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
      {failed && (
        <p role="alert">
          Die Suche in den Modulen ist fehlgeschlagen. Bitte versuch es noch einmal.
          {withTools
            ? " Die Treffer unter den IT-Tools und im Handbuch stehen trotzdem da."
            : " Die Treffer im Handbuch stehen trotzdem da."}
        </p>
      )}
      {ready && !loading && ready.hits.length === 0 && (
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
