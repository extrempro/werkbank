import { useState } from "react";
import { errorText, formatDateTime } from "../api";
import { ConfirmButton } from "../components/ConfirmDialog";
import { Link } from "../components/Link";
import {
  deleteHistory,
  deleteHistoryEntry,
  entryLink,
  setHistoryEnabled,
  useHistory,
  groupByDay,
  useToolPrefs,
} from "./account";
import { findTool } from "./index";
import { Feedback } from "../components/Feedback";

/** IT-Tools › Verlauf: eigene Einstellungen der letzten 90 Tage, wieder öffnen oder löschen. */
export function ToolsHistoryPage() {
  const entries = useHistory(undefined, 200);
  const prefs = useToolPrefs();
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  const onSwitch = (enabled: boolean) => {
    setMessage(null);
    setHistoryEnabled(enabled).then(
      () =>
        setMessage({
          kind: "status",
          text: enabled
            ? "Der Verlauf wird gespeichert."
            : "Der Verlauf wird nicht mehr gespeichert.",
        }),
      (error: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellung konnte nicht gespeichert werden."),
        }),
    );
  };

  const onDeleteAll = () =>
    deleteHistory().then(
      () => setMessage({ kind: "status", text: "Der Verlauf ist gelöscht." }),
      (error: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Verlauf konnte nicht gelöscht werden."),
        }),
    );

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">IT-Tools</p>
        <h1>Verlauf</h1>
        <p className="page-sub">
          Die Einstellungen deiner Tools aus den letzten 90 Tagen, mit einem Klick wieder geöffnet.
          Gespeichert wird nur, was ohnehin in der Adresszeile steht, nie Kennwörter oder
          eingegebene Texte. Den Verlauf siehst nur du.
        </p>
      </header>

      <section className="panel" aria-labelledby="verlauf-einstellungen">
        <div className="panel-head">
          <h2 id="verlauf-einstellungen">Einstellungen</h2>
        </div>
        <div className="detail-body settings-form">
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={prefs.history_enabled}
              onChange={(event) => onSwitch(event.target.checked)}
            />
            Verlauf speichern
          </label>
          <p className="small">
            Favoriten und zuletzt genutzte Tools gelten für dein Konto, also auf jedem Gerät.
          </p>
          <div className="actions">
            <ConfirmButton
              className="button button-secondary"
              disabled={!entries || entries.length === 0}
              confirm={{
                title: "Ganzen Verlauf löschen?",
                text: "Alle gespeicherten Einstellungen deiner Tools werden gelöscht. Favoriten bleiben.",
                action: "Verlauf löschen",
                danger: true,
              }}
              onConfirm={onDeleteAll}
            >
              Ganzen Verlauf löschen
            </ConfirmButton>
          </div>
          <Feedback message={message} onClose={() => setMessage(null)} />
        </div>
      </section>

      {!entries && <p role="status">Wird geladen …</p>}
      {entries && entries.length === 0 && (
        <p className="panel panel-empty">
          Noch kein Verlauf. Sobald du in einem Tool Einstellungen änderst, erscheinen sie hier.
        </p>
      )}
      {entries &&
        groupByDay(entries).map(([day, list]) => (
          <section key={day} className="panel" aria-labelledby={`verlauf-${list[0]?.id}`}>
            <div className="panel-head">
              <h2 id={`verlauf-${list[0]?.id}`}>{day}</h2>
            </div>
            <ul className="tool-history-list detail-body">
              {list.map((entry) => (
                <li key={entry.id}>
                  <Link to={entryLink(entry)}>{findTool(entry.tool)?.name ?? entry.tool}</Link>
                  <span> · {entry.summary}</span>
                  <span className="small">
                    {" "}
                    ·{" "}
                    <time dateTime={entry.created_at}>
                      {new Date(entry.created_at).toLocaleTimeString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </span>
                  <button
                    type="button"
                    className="button button-quiet"
                    title={formatDateTime(entry.created_at)}
                    onClick={() => {
                      deleteHistoryEntry(entry.id).catch(() => undefined);
                    }}
                  >
                    Löschen
                    <span className="visually-hidden">
                      : {findTool(entry.tool)?.name ?? entry.tool}, {entry.summary}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
