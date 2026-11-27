import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../api";
import { Feedback } from "../components/Feedback";
import { Field } from "../components/Field";
import { FilterBar } from "../components/FilterBar";
import { FixedChoice } from "../components/ListChoice";
import {
  FEEDBACK_ADMIN_PATH,
  FEEDBACK_FILTERS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS,
  feedbackAdminPath,
  fetchFeedback,
  fetchFeedbackList,
  replyFeedback,
  screenshotUrl,
  setFeedbackStatus,
  type Feedback as FeedbackEntry,
  type FeedbackFilter,
  type FeedbackStatus,
  type FeedbackSummary,
} from "../feedback";
import { navigate } from "../router";

function when(value: string | null): string {
  if (!value) {
    return "–";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "–"
    : `${date.toLocaleDateString("de-DE")}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Eine Rückmeldung: Text, Seite, technische Angaben, Bildschirmfoto, Stand und Antwort. */
function FeedbackDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [entry, setEntry] = useState<FeedbackEntry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchFeedback(id).then(
      (result) => active && setEntry(result),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Rückmeldung konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [id]);

  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!entry || entry.id !== id) {
    return <p role="status">Wird geladen …</p>;
  }

  const done = (next: FeedbackEntry, text: string) => {
    setEntry(next);
    setBusy(false);
    setNotice({ kind: "status", text });
    onChanged();
  };
  const fail = (problem: unknown) => {
    setBusy(false);
    setNotice({ kind: "alert", text: errorText(problem, "Das hat nicht geklappt.") });
  };
  const onReply = (event: FormEvent) => {
    event.preventDefault();
    if (!reply.trim()) {
      setNotice({ kind: "alert", text: "Die Antwort ist leer." });
      return;
    }
    setBusy(true);
    replyFeedback(entry.id, reply.trim()).then((next) => {
      setReply("");
      done(
        next,
        `Die Antwort ist gesendet. ${entry.user_name || "Die Person"} sieht sie unter „Meine Rückmeldungen“.`,
      );
    }, fail);
  };
  const tech = entry.technical;

  return (
    <section className="panel" aria-labelledby="rm-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">
            <span className="mono">{entry.number}</span> · {FEEDBACK_KIND_LABELS[entry.kind]} · von{" "}
            {entry.user_name || "unbekannt"} · {when(entry.created_at)}
          </p>
          <h2 id="rm-titel">{entry.title}</h2>
        </div>
        <span className={`pill ${FEEDBACK_STATUS[entry.status].pill}`}>
          {FEEDBACK_STATUS[entry.status].label}
        </span>
      </div>
      <div className="detail-body form-stack">
        <Feedback message={notice} onClose={() => setNotice(null)} />
        <p className="pre-line">{entry.text}</p>
        {entry.page && (
          <p className="small">
            Seite:{" "}
            <a
              href={entry.page}
              onClick={(event) => {
                event.preventDefault();
                navigate(entry.page);
              }}
            >
              {entry.page}
            </a>
          </p>
        )}
        {entry.kind === "fehler" && (
          <dl className="facts">
            <div>
              <dt>Version</dt>
              <dd>{tech.version ?? "–"}</dd>
            </div>
            <div>
              <dt>Fenster</dt>
              <dd>{tech.window ?? "–"}</dd>
            </div>
            <div>
              <dt>Browser</dt>
              <dd className="small">{tech.browser ?? "–"}</dd>
            </div>
            <div>
              <dt>Fehler im Browser</dt>
              <dd>
                {tech.browser_errors && tech.browser_errors.length > 0 ? (
                  <ul className="link-list">
                    {tech.browser_errors.map((line, index) => (
                      <li key={index} className="mono small">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "keine"
                )}
              </dd>
            </div>
          </dl>
        )}
        {entry.has_screenshot && (
          <a href={screenshotUrl(entry.id)} target="_blank" rel="noreferrer">
            <img
              className="feedback-screenshot"
              src={screenshotUrl(entry.id)}
              alt={`Bildschirmfoto zu ${entry.number}`}
            />
          </a>
        )}
        <FixedChoice<FeedbackStatus>
          label="Stand"
          value={entry.status}
          options={(Object.keys(FEEDBACK_STATUS) as FeedbackStatus[]).map((value) => ({
            value,
            label: FEEDBACK_STATUS[value].label,
          }))}
          disabled={busy}
          onChange={(status) => {
            setBusy(true);
            setFeedbackStatus(entry.id, status).then(
              (next) => done(next, `Der Stand ist jetzt „${FEEDBACK_STATUS[status].label}“.`),
              fail,
            );
          }}
          hint="Wechselt der Stand, bekommt die Person eine Benachrichtigung an der Glocke."
        />
        {entry.reply_list.length > 0 && (
          <div className="form-stack">
            <h3 className="sub-head">Antworten</h3>
            {entry.reply_list.map((item) => (
              <div key={item.id} className="feedback-reply">
                <p className="small">
                  <strong>{item.author}</strong> · {when(item.created_at)}
                </p>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        )}
        <form className="form-stack" onSubmit={onReply} noValidate>
          <Field
            label={`Antwort an ${entry.user_name || "die Person"}`}
            hint="Die Person bekommt eine Benachrichtigung ohne Inhalt und liest die Antwort unter „Meine Rückmeldungen“."
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                maxLength={2000}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
              />
            )}
          </Field>
          <div className="project-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              Antwort senden
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

/** Verwaltung › Rückmeldungen: Fehler und Ideen aus der Werkbank bearbeiten. */
export function FeedbackAdminPage({ id }: { id: number | null }) {
  const [filter, setFilter] = useState<FeedbackFilter>("offen");
  const [list, setList] = useState<{ entries: FeedbackSummary[]; open: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    fetchFeedbackList(filter).then(
      (result) => active && setList(result),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Rückmeldungen konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [filter, reload]);

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">Verwaltung</p>
        <h1>Rückmeldungen</h1>
        <p className="page-sub">
          Fehler und Ideen aus der Werkbank. Bildschirmfotos werden 30 Tage nach Abschluss gelöscht.
        </p>
      </header>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      <div className={id === null ? "case-layout" : "case-layout case-layout-detail"}>
        <nav className="panel case-list" aria-label="Rückmeldungen">
          <div className="case-filters">
            <FilterBar
              plain
              status={{
                label: "Anzeigen",
                value: filter,
                onChange: setFilter,
                options: FEEDBACK_FILTERS.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  count: entry.id === "offen" && list ? list.open : null,
                })),
              }}
            />
          </div>
          <div className="case-scroll">
            {!list && !failed && <p role="status">Wird geladen …</p>}
            {list && list.entries.length === 0 && (
              <p className="empty">Keine Rückmeldungen in dieser Liste.</p>
            )}
            {list && list.entries.length > 0 && (
              <ul>
                {list.entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="case-item"
                      aria-current={entry.id === id ? "true" : undefined}
                      onClick={() => navigate(feedbackAdminPath(entry.id))}
                    >
                      <span className="case-item-head">
                        <span className="mono">{entry.number}</span>
                        <span className={`pill ${FEEDBACK_STATUS[entry.status].pill}`}>
                          {FEEDBACK_STATUS[entry.status].label}
                        </span>
                      </span>
                      <strong>{entry.title}</strong>
                      <span className="small">
                        {FEEDBACK_KIND_LABELS[entry.kind]} · {entry.user_name || "unbekannt"}
                        {entry.has_screenshot ? " · mit Bildschirmfoto" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>
        <div className="case-main">
          {id !== null && (
            <a
              className="case-back"
              href={FEEDBACK_ADMIN_PATH}
              onClick={(event) => {
                event.preventDefault();
                navigate(FEEDBACK_ADMIN_PATH);
              }}
            >
              ‹ Zur Liste
            </a>
          )}
          {id === null ? (
            <p className="panel panel-empty">Wähle links eine Rückmeldung.</p>
          ) : (
            <FeedbackDetail key={id} id={id} onChanged={() => setReload(reload + 1)} />
          )}
        </div>
      </div>
    </div>
  );
}
