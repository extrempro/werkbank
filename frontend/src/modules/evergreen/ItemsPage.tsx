import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../../api";
import { Link } from "../../components/Link";
import { navigate } from "../../router";
import {
  createItem,
  fetchItems,
  isUrgent,
  rolloutShort,
  stepClass,
  type Item,
  type ItemCounts,
  type NewItem,
} from "./api";
import { ItemDetailPage } from "./ItemDetailPage";

const VIEWS: { value: keyof ItemCounts; label: string }[] = [
  { value: "offen", label: "Offen" },
  { value: "meine", label: "Wartet auf mich" },
  { value: "abgeschlossen", label: "Abgeschlossen" },
  { value: "alle", label: "Alle" },
];

interface ItemsPageProps {
  /** Geöffneter Vorgang. Auf breiten Bildschirmen steht er neben der Liste. */
  selectedId?: number;
}

const EMPTY_ITEM: NewItem = {
  title: "",
  service: "",
  summary: "",
  rollout_date: "",
  major_change: false,
};

export function ItemsPage({ selectedId }: ItemsPageProps) {
  const [view, setView] = useState("offen");
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<Item[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [counts, setCounts] = useState<ItemCounts | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [creating, setCreating] = useState(false);
  const [newItem, setNewItem] = useState<NewItem>(EMPTY_ITEM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchItems(view, 0)
      .then((page) => {
        if (active) {
          setEntries(page.entries);
          setHasMore(page.has_more);
          setCanCreate(page.can_create);
          setCounts(page.counts ?? null);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [view, reloadKey]);

  const loadMore = () => {
    fetchItems(view, entries.length)
      .then((page) => {
        setEntries((previous) => [...previous, ...page.entries]);
        setHasMore(page.has_more);
      })
      .catch(() => {
        setStatus("error");
      });
  };

  const pickView = (value: string) => {
    if (value !== view) {
      setStatus("loading");
      setView(value);
    }
  };

  // Nach einer Entscheidung im Vorgang stimmt die Liste nicht mehr: neu laden.
  const onItemChanged = useCallback(() => setReloadKey((key) => key + 1), []);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    if (newItem.title.trim().length < 3) {
      setError("Bitte einen Titel mit mindestens 3 Zeichen eintragen.");
      return;
    }
    setError(null);
    createItem({ ...newItem, title: newItem.title.trim() })
      .then((item) => {
        navigate(`/evergreen/${item.id}`);
      })
      .catch((failure: unknown) => {
        const detail = failure instanceof ApiError ? failure.detail : null;
        setError(detail ?? "Der Vorgang konnte nicht angelegt werden.");
      });
  };

  const hasDetail = selectedId !== undefined;

  return (
    <div className={hasDetail ? "page page-wide has-detail" : "page page-wide"}>
      <header className="page-head list-only">
        <p className="module-label">Evergreen</p>
        {hasDetail ? <p className="page-title">Vorgänge</p> : <h1>Vorgänge</h1>}
        <p className="page-sub">
          Neuerungen in Microsoft 365: bewerten, mit Betriebsrat und Geschäftsführung abstimmen,
          umsetzen.
        </p>
      </header>

      <div className="toolbar list-only">
        <div className="chips" role="group" aria-label="Vorgänge filtern">
          {VIEWS.map((option) => (
            <button
              type="button"
              key={option.value}
              className="chip chip-filter"
              aria-pressed={view === option.value}
              onClick={() => pickView(option.value)}
            >
              {option.label}
              {counts && ` (${counts[option.value]})`}
            </button>
          ))}
        </div>
        {canCreate && !creating && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setCreating(true)}
          >
            Vorgang anlegen
          </button>
        )}
      </div>

      {creating && (
        <section className="card list-only" aria-labelledby="neu-titel">
          <h2 id="neu-titel">Neuer Vorgang</h2>
          <form className="meta-form" onSubmit={onCreate}>
            <label>
              Titel
              <input
                type="text"
                value={newItem.title}
                maxLength={300}
                required
                onChange={(event) => setNewItem({ ...newItem, title: event.target.value })}
              />
            </label>
            <label>
              Dienst (z. B. Teams, Exchange)
              <input
                type="text"
                value={newItem.service}
                maxLength={100}
                onChange={(event) => setNewItem({ ...newItem, service: event.target.value })}
              />
            </label>
            <label>
              Zusammenfassung
              <textarea
                value={newItem.summary}
                maxLength={8000}
                rows={4}
                onChange={(event) => setNewItem({ ...newItem, summary: event.target.value })}
              />
            </label>
            <label>
              Rollout-Datum
              <input
                type="date"
                value={newItem.rollout_date}
                onChange={(event) => setNewItem({ ...newItem, rollout_date: event.target.value })}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={newItem.major_change}
                onChange={(event) => setNewItem({ ...newItem, major_change: event.target.checked })}
              />
              Größere Änderung (Major Change)
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="filter-actions">
              <button type="submit" className="button button-primary">
                Anlegen
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
              >
                Abbrechen
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="split">
        <div className="split-list split-narrow list-only">
          {status === "error" && <p role="alert">Die Vorgänge konnten nicht geladen werden.</p>}
          {status === "loading" && <p role="status">Wird geladen …</p>}
          {status === "ready" && entries.length === 0 && (
            <p className="panel panel-empty">Keine Vorgänge für diese Auswahl.</p>
          )}
          {entries.length > 0 && (
            <ul className="item-cards" aria-label="Vorgänge">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to={`/evergreen/${entry.id}`}
                    className={
                      entry.id === selectedId ? "item-card item-card-current" : "item-card"
                    }
                    aria-current={entry.id === selectedId ? "page" : undefined}
                  >
                    <span className="small">
                      {entry.number}
                      {entry.service && ` · ${entry.service}`}
                    </span>
                    <span className="item-card-title">{entry.title}</span>
                    <span className="badges">
                      <span className={stepClass(entry)}>{entry.step_title}</span>
                      {entry.waiting_for_me && (
                        <span className="pill pill-todo">Wartet auf mich</span>
                      )}
                      {entry.major_change && (
                        <span className="pill pill-bad">Größere Änderung</span>
                      )}
                    </span>
                    <span
                      className={isUrgent(entry) ? "item-card-due urgent-text" : "item-card-due"}
                    >
                      {rolloutShort(entry)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <button type="button" className="button button-secondary load-more" onClick={loadMore}>
              Weitere laden
            </button>
          )}
        </div>

        {hasDetail && (
          <div className="split-detail split-wide">
            <ItemDetailPage key={selectedId} id={selectedId} onChanged={onItemChanged} />
          </div>
        )}
      </div>
    </div>
  );
}
