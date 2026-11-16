import { Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "../components/Link";
import { TOOLS_PATH } from "../navigation";
import { timeAgo } from "../notifications";
import {
  deleteHistoryEntry,
  entryLink,
  recordRecent,
  toggleFavorite as toggleStoredFavorite,
  TOOLS_HISTORY_PATH,
  useHistory,
  useToolPrefs,
} from "./account";
import {
  CATEGORY_LABELS,
  findTool,
  searchTools,
  type ToolCategory,
  type ToolDefinition,
} from "./index";

export { TOOLS_PATH };

function useFavorites(): [string[], (id: string) => void] {
  const prefs = useToolPrefs();
  return [prefs.favorites, toggleStoredFavorite];
}

function FavoriteButton({
  tool,
  active,
  onToggle,
}: {
  tool: ToolDefinition;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="button button-secondary tool-favorite"
      aria-pressed={active}
      onClick={onToggle}
    >
      <span aria-hidden="true">{active ? "★" : "☆"}</span>
      <span className="visually-hidden">
        {tool.name} {active ? "aus den Favoriten entfernen" : "zu den Favoriten"}
      </span>
    </button>
  );
}

function ToolCard({
  tool,
  favorite,
  onToggle,
}: {
  tool: ToolDefinition;
  favorite: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="tool-card">
      <div className="tool-card-head">
        <Link to={`${TOOLS_PATH}/${tool.id}`} className="row-title">
          {tool.name}
        </Link>
        <FavoriteButton tool={tool} active={favorite} onToggle={onToggle} />
      </div>
      <p className="small">{tool.description}</p>
    </li>
  );
}

/** IT-Tools › Übersicht: alle Tools oder die einer Kategorie, mit Suche und Favoriten. */
export function ToolsOverviewPage({ category }: { category?: ToolCategory }) {
  const [query, setQuery] = useState("");
  const [favorites, toggleFavorite] = useFavorites();
  const hits = useMemo(
    () => searchTools(query).filter((tool) => !category || tool.category === category),
    [query, category],
  );
  const categories = (Object.keys(CATEGORY_LABELS) as ToolCategory[]).filter((entry) =>
    hits.some((tool) => tool.category === entry),
  );
  const favoriteTools = hits.filter((tool) => favorites.includes(tool.id));
  const { recent } = useToolPrefs();
  const recentTools = query
    ? []
    : recent
        .map((id) => findTool(id))
        .filter((tool): tool is ToolDefinition => tool !== undefined)
        .filter((tool) => !category || tool.category === category);

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">IT-Tools</p>
        <h1>{category ? CATEGORY_LABELS[category] : "IT-Tools"}</h1>
        <p className="page-sub">
          {category
            ? "Die Tools dieser Kategorie. Alle rechnen in deinem Browser; deine Eingaben verlassen den Rechner nicht."
            : "Kleine Werkzeuge für den Alltag in der IT. Alle rechnen in deinem Browser; deine Eingaben verlassen den Rechner nicht."}
        </p>
      </header>

      <label className="tool-search">
        Tool suchen
        <input
          type="search"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="small" role="status">
        {hits.length === 1 ? "1 Tool" : `${hits.length} Tools`}
      </p>

      {hits.length === 0 && <p className="panel panel-empty">Kein Tool passt zu dieser Suche.</p>}

      {recentTools.length > 0 && (
        <section aria-labelledby="tools-zuletzt">
          <h2 id="tools-zuletzt">Zuletzt genutzt</h2>
          <ul className="tool-cards">
            {recentTools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                favorite={favorites.includes(tool.id)}
                onToggle={() => toggleFavorite(tool.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {favoriteTools.length > 0 && (
        <section aria-labelledby="tools-favoriten">
          <h2 id="tools-favoriten">Favoriten</h2>
          <ul className="tool-cards">
            {favoriteTools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                favorite
                onToggle={() => toggleFavorite(tool.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {categories.map((entry) => (
        <section key={entry} aria-labelledby={`tools-${entry}`}>
          <h2 id={`tools-${entry}`} className={category ? "visually-hidden" : undefined}>
            {CATEGORY_LABELS[entry]}
          </h2>
          <ul className="tool-cards">
            {hits
              .filter((tool) => tool.category === entry)
              .map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  favorite={favorites.includes(tool.id)}
                  onToggle={() => toggleFavorite(tool.id)}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Die letzten Einstellungen dieses Tools aus dem eigenen Verlauf, zum Wiederöffnen. */
function ToolHistory({ tool }: { tool: ToolDefinition }) {
  const entries = useHistory(tool.id, 5);
  const [open, setOpen] = useState(false);
  if (!entries || entries.length === 0) {
    return null;
  }
  return (
    <details
      className="panel tool-history"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Zuletzt verwendete Einstellungen ({entries.length})</summary>
      <ul className="tool-history-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link to={entryLink(entry)}>{entry.summary || "Einstellungen"}</Link>
            <span className="small"> · {timeAgo(entry.created_at)}</span>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                deleteHistoryEntry(entry.id).catch(() => undefined);
              }}
            >
              Löschen<span className="visually-hidden">: {entry.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small">
        <Link to={TOOLS_HISTORY_PATH}>Ganzer Verlauf</Link>
      </p>
    </details>
  );
}

/** Ein einzelnes Tool. Unbekannte Kennungen führen zurück zur Übersicht. */
export function ToolPage({ id }: { id: string }) {
  const tool = findTool(id);
  const [favorites, toggleFavorite] = useFavorites();
  useEffect(() => {
    if (tool) {
      recordRecent(tool.id);
    }
  }, [tool]);
  const back = (
    <p className="back back-always">
      <Link to={TOOLS_PATH}>Zurück zu den IT-Tools</Link>
    </p>
  );
  if (!tool) {
    return (
      <div className="page">
        <header className="page-head">
          <p className="module-label">IT-Tools</p>
          <h1>Tool nicht gefunden</h1>
        </header>
        <p>Dieses Tool gibt es nicht.</p>
        {back}
      </div>
    );
  }
  return (
    <div className="page">
      {back}
      <header className="page-head tool-head">
        <div>
          <p className="module-label">IT-Tools › {CATEGORY_LABELS[tool.category]}</p>
          <h1>{tool.name}</h1>
          <p className="page-sub">{tool.description}</p>
        </div>
        <FavoriteButton
          tool={tool}
          active={favorites.includes(tool.id)}
          onToggle={() => toggleFavorite(tool.id)}
        />
      </header>
      <ToolHistory tool={tool} />
      <section className="panel tool-panel" aria-label={tool.name}>
        <Suspense fallback={<p role="status">Wird geladen …</p>}>
          <tool.component />
        </Suspense>
      </section>
    </div>
  );
}
