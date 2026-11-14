import { useEffect, useState, type FormEvent } from "react";
import { ApiError, formatDateTime, type Me } from "../../api";
import { Link } from "../../components/Link";
import {
  fetchChanges,
  formatValue,
  kindLabel,
  reviewChanges,
  settingTitle,
  statusLabel,
  type Change,
  type ReviewStatus,
} from "./api";

interface ChangesPageProps {
  me: Me;
}

const FILTERS = [
  { value: "offen", label: "Offen" },
  { value: "ungewollt", label: "Ungewollt" },
  { value: "gewollt", label: "Gewollt" },
  { value: "", label: "Alle" },
];

export function ChangesPage({ me }: ChangesPageProps) {
  const [draft, setDraft] = useState("offen");
  const [filter, setFilter] = useState("offen");
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<Change[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<number[]>([]);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const canReview = me.roles.includes("Config.Reviewer");

  useEffect(() => {
    let active = true;
    fetchChanges(filter, 0)
      .then((page) => {
        if (active) {
          setEntries(page.entries);
          setHasMore(page.has_more);
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
  }, [filter, reloadKey]);

  const loadMore = () => {
    fetchChanges(filter, entries.length)
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
    setSelected([]);
    setMessage(null);
    setFilter(draft);
    setReloadKey((key) => key + 1);
  };

  const toggle = (id: number) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const review = (target: ReviewStatus) => {
    if (selected.length === 0) {
      setMessage({ kind: "alert", text: "Bitte zuerst mindestens eine Änderung auswählen." });
      return;
    }
    if (target === "ungewollt" && comment.trim() === "") {
      setMessage({ kind: "alert", text: "Für „ungewollt“ ist ein Kommentar nötig." });
      return;
    }
    setMessage(null);
    reviewChanges(selected, target, comment.trim())
      .then((result) => {
        const text =
          target === "offen"
            ? `${result.updated} Bewertung(en) zurückgesetzt.`
            : `${result.updated} Änderung(en) als ${statusLabel(target).toLowerCase()} bewertet.`;
        setMessage({ kind: "status", text });
        setSelected([]);
        setComment("");
        setReloadKey((key) => key + 1);
      })
      .catch((error: unknown) => {
        const detail = error instanceof ApiError ? error.detail : null;
        setMessage({ kind: "alert", text: detail ?? "Die Bewertung konnte nicht gespeichert werden." });
      });
  };

  return (
    <>
      <p className="module-label">M365-Konfiguration</p>
      <h1>Änderungen</h1>
      <p className="lead">
        Erkannte Änderungen an Einstellungen des Tenants. Jede Änderung wird als gewollt oder
        ungewollt bewertet.
      </p>

      <form className="filter card" onSubmit={onFilter} aria-label="Änderungen filtern">
        <label>
          Bewertung
          <select value={draft} onChange={(event) => setDraft(event.target.value)}>
            {FILTERS.map((option) => (
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
        </div>
      </form>

      {status === "error" && <p role="alert">Die Änderungen konnten nicht geladen werden.</p>}
      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="empty">Keine Änderungen für diese Auswahl.</p>
      )}
      {entries.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Änderungen">
          <table>
            <caption className="visually-hidden">Änderungen, neueste zuerst</caption>
            <thead>
              <tr>
                {canReview && <th scope="col">Auswahl</th>}
                <th scope="col">Erkannt</th>
                <th scope="col">Einstellung</th>
                <th scope="col">Art</th>
                <th scope="col">Vorher</th>
                <th scope="col">Nachher</th>
                <th scope="col">Geändert von</th>
                <th scope="col">Bewertung</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  {canReview && (
                    <td>
                      <input
                        type="checkbox"
                        className="check"
                        checked={selected.includes(entry.id)}
                        onChange={() => toggle(entry.id)}
                        aria-label={`${settingTitle(entry)} auswählen`}
                      />
                    </td>
                  )}
                  <td className="nowrap">{formatDateTime(entry.detected_at)}</td>
                  <td>
                    <Link to={`/m365/einstellungen/${entry.setting_id}`}>
                      {settingTitle(entry)}
                    </Link>
                    <span className="mono small path">{entry.path}</span>
                  </td>
                  <td>{kindLabel(entry.kind)}</td>
                  <td className="value">{formatValue(entry.old_value)}</td>
                  <td className="value">{formatValue(entry.new_value)}</td>
                  <td>{entry.changed_by ?? "unbekannt"}</td>
                  <td>
                    {statusLabel(entry.status)}
                    {entry.reviewed_by && (
                      <span className="small path">
                        {entry.reviewed_by}, {formatDateTime(entry.reviewed_at)}
                      </span>
                    )}
                    {entry.comment && <span className="small path">{entry.comment}</span>}
                  </td>
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

      {canReview && entries.length > 0 && (
        <section className="card review" aria-labelledby="bewerten-titel">
          <h2 id="bewerten-titel">Auswahl bewerten</h2>
          <p className="small">{selected.length} ausgewählt</p>
          <label>
            Kommentar (Pflicht bei „ungewollt“)
            <textarea
              value={comment}
              maxLength={2000}
              rows={3}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <div className="filter-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => review("gewollt")}
            >
              Als gewollt bewerten
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => review("ungewollt")}
            >
              Als ungewollt bewerten
            </button>
            <button type="button" className="button button-quiet" onClick={() => review("offen")}>
              Bewertung zurücksetzen
            </button>
          </div>
        </section>
      )}
      {message && <p role={message.kind}>{message.text}</p>}
    </>
  );
}
