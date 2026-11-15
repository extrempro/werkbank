import { lazy, Suspense, useMemo, useState, type ComponentType } from "react";
import { Link } from "../components/Link";
import {
  CATEGORY_LABELS,
  findTool,
  readFavorites,
  saveFavorites,
  searchTools,
  type ToolCategory,
  type ToolDefinition,
} from "./index";

export const TOOLS_PATH = "/it-tools";

// Jede Oberfläche wird nur einmal als nachladbare Komponente angelegt.
const loaded = new Map<string, ComponentType>();
function componentFor(tool: ToolDefinition): ComponentType {
  let component = loaded.get(tool.id);
  if (!component) {
    component = lazy(tool.load);
    loaded.set(tool.id, component);
  }
  return component;
}

function useFavorites(): [string[], (id: string) => void] {
  const [favorites, setFavorites] = useState(readFavorites);
  const toggle = (id: string) => {
    const next = favorites.includes(id)
      ? favorites.filter((entry) => entry !== id)
      : [...favorites, id];
    setFavorites(next);
    saveFavorites(next);
  };
  return [favorites, toggle];
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

/** IT-Tools › Übersicht: alle Tools mit Suche und Favoriten. */
export function ToolsOverviewPage() {
  const [query, setQuery] = useState("");
  const [favorites, toggleFavorite] = useFavorites();
  const hits = useMemo(() => searchTools(query), [query]);
  const categories = (Object.keys(CATEGORY_LABELS) as ToolCategory[]).filter((category) =>
    hits.some((tool) => tool.category === category),
  );
  const favoriteTools = hits.filter((tool) => favorites.includes(tool.id));

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">IT-Tools</p>
        <h1>IT-Tools</h1>
        <p className="page-sub">
          Kleine Werkzeuge für den Alltag in der IT. Alle rechnen in deinem Browser; deine Eingaben
          verlassen den Rechner nicht.
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

      {categories.map((category) => (
        <section key={category} aria-labelledby={`tools-${category}`}>
          <h2 id={`tools-${category}`}>{CATEGORY_LABELS[category]}</h2>
          <ul className="tool-cards">
            {hits
              .filter((tool) => tool.category === category)
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

/** Ein einzelnes Tool. Unbekannte Kennungen führen zurück zur Übersicht. */
export function ToolPage({ id }: { id: string }) {
  const tool = findTool(id);
  const [favorites, toggleFavorite] = useFavorites();
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
  const Component = componentFor(tool);
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
      <section className="panel tool-panel" aria-label={tool.name}>
        <Suspense fallback={<p role="status">Wird geladen …</p>}>
          <Component />
        </Suspense>
      </section>
    </div>
  );
}
