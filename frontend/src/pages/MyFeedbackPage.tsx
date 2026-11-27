import { useEffect, useState } from "react";
import { errorText } from "../api";
import { FEEDBACK_KIND_LABELS, FEEDBACK_STATUS, fetchMyFeedback, type Feedback } from "../feedback";

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "–"
    : `${date.toLocaleDateString("de-DE")}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Konto › Meine Rückmeldungen: eigene Fehler und Ideen mit Stand und Antworten der IT. */
export function MyFeedbackPage({ onNew }: { onNew: () => void }) {
  const [entries, setEntries] = useState<Feedback[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchMyFeedback().then(
      (result) => active && setEntries(result),
      (problem: unknown) =>
        active &&
        setFailed(errorText(problem, "Deine Rückmeldungen konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-head project-head">
        <div>
          <p className="module-label">Konto</p>
          <h1>Meine Rückmeldungen</h1>
          <p className="page-sub">Was du gemeldet hast, mit Stand und Antworten der IT.</p>
        </div>
        <button type="button" className="button button-primary" onClick={onNew}>
          Neue Rückmeldung
        </button>
      </header>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!entries && !failed && <p role="status">Wird geladen …</p>}
      {entries && entries.length === 0 && (
        <p className="panel panel-empty">
          Du hast noch keine Rückmeldung gegeben. Den Knopf dafür findest du oben rechts.
        </p>
      )}
      {entries && entries.length > 0 && (
        <div className="form-stack">
          {entries.map((entry) => (
            <section key={entry.id} className="panel" aria-labelledby={`rm-${entry.id}`}>
              <div className="panel-head">
                <h2 id={`rm-${entry.id}`}>
                  <span className={`pill ${entry.kind === "fehler" ? "pill-todo" : "pill-info"}`}>
                    {FEEDBACK_KIND_LABELS[entry.kind]}
                  </span>{" "}
                  {entry.title}
                </h2>
                <span className={`pill ${FEEDBACK_STATUS[entry.status].pill}`}>
                  {FEEDBACK_STATUS[entry.status].label}
                </span>
              </div>
              <div className="detail-body form-stack">
                <p className="small">
                  <span className="mono">{entry.number}</span> · {when(entry.created_at)}
                  {entry.page ? ` · ${entry.page}` : ""}
                </p>
                <p className="pre-line">{entry.text}</p>
                {entry.reply_list.map((reply) => (
                  <div key={reply.id} className="feedback-reply">
                    <p className="small">
                      <strong>Antwort der IT</strong> · {when(reply.created_at)}
                    </p>
                    <p>{reply.text}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
