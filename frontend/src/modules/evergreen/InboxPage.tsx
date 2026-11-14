import { useEffect, useState, type FormEvent } from "react";
import { ApiError, formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import {
  adoptMessage,
  categoryLabel,
  fetchMessages,
  setMessageStatus,
  type Message,
} from "./api";

const VIEWS = [
  { value: "neu", label: "Neu" },
  { value: "ignoriert", label: "Beiseitegelegt" },
  { value: "alle", label: "Alle" },
];

type Notice = { kind: "status" | "alert"; text: string };

export function InboxPage() {
  const [draft, setDraft] = useState("neu");
  const [view, setView] = useState("neu");
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;
    fetchMessages(view, 0)
      .then((page) => {
        if (active) {
          setEntries(page.entries);
          setHasMore(page.has_more);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setStatus(error instanceof ApiError && error.status === 403 ? "forbidden" : "error");
        }
      });
    return () => {
      active = false;
    };
  }, [view, reloadKey]);

  const loadMore = () => {
    fetchMessages(view, entries.length)
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
    setNotice(null);
    setView(draft);
    setReloadKey((key) => key + 1);
  };

  const fail = (error: unknown, fallback: string) => {
    const detail = error instanceof ApiError ? error.detail : null;
    setNotice({ kind: "alert", text: detail ?? fallback });
  };

  const onAdopt = (message: Message) => {
    adoptMessage(message.id)
      .then((item) => {
        setNotice({ kind: "status", text: `Vorgang ${item.number} ist angelegt.` });
        setReloadKey((key) => key + 1);
      })
      .catch((error: unknown) => fail(error, "Der Vorgang konnte nicht angelegt werden."));
  };

  const onStatus = (message: Message, target: "neu" | "ignoriert") => {
    setMessageStatus(message.id, target)
      .then(() => {
        setNotice({
          kind: "status",
          text:
            target === "ignoriert"
              ? `${message.message_id} ist beiseitegelegt.`
              : `${message.message_id} liegt wieder im Eingang.`,
        });
        setReloadKey((key) => key + 1);
      })
      .catch((error: unknown) => fail(error, "Die Meldung konnte nicht geändert werden."));
  };

  return (
    <>
      <p className="module-label">Evergreen</p>
      <h1>Eingang</h1>
      <p className="lead">
        Meldungen aus dem Nachrichtencenter von Microsoft. Größere Änderungen und Meldungen mit
        Frist werden automatisch zu Vorgängen. Alle anderen kannst du hier übernehmen oder
        beiseitelegen.
      </p>

      <form className="filter card" onSubmit={onFilter} aria-label="Meldungen filtern">
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
        </div>
      </form>

      {notice && <p role={notice.kind}>{notice.text}</p>}
      {status === "forbidden" && <p>Keine Berechtigung. Den Eingang sehen IT und Evergreen-Team.</p>}
      {status === "error" && <p role="alert">Die Meldungen konnten nicht geladen werden.</p>}
      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "ready" && entries.length === 0 && (
        <p className="empty">Keine Meldungen für diese Auswahl.</p>
      )}
      {entries.length > 0 && (
        <ul className="messages">
          {entries.map((message) => (
            <li key={message.id} className="card">
              <h2>{message.title}</h2>
              <p className="small">
                {message.message_id} · {message.services.join(", ") || "ohne Dienst"} ·{" "}
                {categoryLabel(message.category)} · veröffentlicht{" "}
                {formatDateTime(message.published_at)}
              </p>
              <p>
                {message.major_change && <span className="badge first">Größere Änderung</span>}
                {message.action_required_by && (
                  <span className="badge first">
                    Handlungsbedarf bis {formatDateTime(message.action_required_by)}
                  </span>
                )}
              </p>
              <details>
                <summary>Text der Meldung anzeigen</summary>
                <p className="text">{message.body ?? "Die Meldung enthält keinen Text."}</p>
              </details>
              <div className="filter-actions actions">
                {message.item_id !== null ? (
                  <Link to={`/evergreen/${message.item_id}`}>Zum Vorgang</Link>
                ) : (
                  <>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => onAdopt(message)}
                    >
                      Als Vorgang übernehmen
                      <span className="visually-hidden">: {message.title}</span>
                    </button>
                    {message.status === "ignoriert" ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => onStatus(message, "neu")}
                      >
                        Zurück in den Eingang
                        <span className="visually-hidden">: {message.title}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => onStatus(message, "ignoriert")}
                      >
                        Beiseitelegen
                        <span className="visually-hidden">: {message.title}</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <button type="button" className="button button-secondary load-more" onClick={loadMore}>
          Weitere laden
        </button>
      )}
    </>
  );
}
