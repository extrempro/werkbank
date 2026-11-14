import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../../api";
import { Link } from "../../components/Link";
import { navigate } from "../../router";
import { createItem, fetchItems, isUrgent, rolloutText, type Item, type NewItem } from "./api";

const VIEWS = [
  { value: "offen", label: "Offen" },
  { value: "meine", label: "Wartet auf mich" },
  { value: "abgeschlossen", label: "Abgeschlossen" },
  { value: "alle", label: "Alle" },
];

const EMPTY_ITEM: NewItem = {
  title: "",
  service: "",
  summary: "",
  rollout_date: "",
  major_change: false,
};

export function ItemsPage() {
  const [draft, setDraft] = useState("offen");
  const [view, setView] = useState("offen");
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<Item[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
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

  const onFilter = (event: FormEvent) => {
    event.preventDefault();
    setStatus("loading");
    setView(draft);
    setReloadKey((key) => key + 1);
  };

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

  return (
    <>
      <p className="module-label">Evergreen</p>
      <h1>Vorgänge</h1>
      <p className="lead">
        Neuerungen in Microsoft 365: bewerten, mit Betriebsrat und Geschäftsführung abstimmen,
        umsetzen.
      </p>

      <form className="filter card" onSubmit={onFilter} aria-label="Vorgänge filtern">
        <label>
          Ansicht
          <select value={draft} onChange={(event) => setDraft(event.target.value)}>
            {VIEWS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit" className="button button-primary">
            Anzeigen
          </button>
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
      </form>

      {creating && (
        <section className="card" aria-labelledby="neu-titel">
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

      {status === "error" && <p role="alert">Die Vorgänge konnten nicht geladen werden.</p>}
      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="empty">Keine Vorgänge für diese Auswahl.</p>
      )}
      {entries.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Vorgänge">
          <table>
            <caption className="visually-hidden">Vorgänge</caption>
            <thead>
              <tr>
                <th scope="col">Nummer</th>
                <th scope="col">Titel</th>
                <th scope="col">Dienst</th>
                <th scope="col">Schritt</th>
                <th scope="col">Rollout</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="nowrap mono">{entry.number}</td>
                  <td>
                    <Link to={`/evergreen/${entry.id}`}>{entry.title}</Link>
                    {entry.major_change && <span className="badge">Größere Änderung</span>}
                  </td>
                  <td>{entry.service ?? "–"}</td>
                  <td>
                    {entry.step_title}
                    {entry.waiting_for_me && <span className="badge">Wartet auf mich</span>}
                  </td>
                  <td className={isUrgent(entry) ? "urgent" : undefined}>{rolloutText(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button type="button" className="button button-secondary load-more" onClick={loadMore}>
          Weitere laden
        </button>
      )}
    </>
  );
}
