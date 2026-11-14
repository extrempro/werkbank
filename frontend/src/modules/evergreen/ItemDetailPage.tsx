import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiError, formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import {
  fetchItem,
  formatDate,
  isUrgent,
  performAction,
  rolloutText,
  updateItem,
  type ItemDetail,
} from "./api";

interface ItemDetailPageProps {
  id: number;
}

type Message = { kind: "status" | "alert"; text: string };

export function ItemDetailPage({ id }: ItemDetailPageProps) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [comment, setComment] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [feedback, setFeedback] = useState("");
  const [rollout, setRollout] = useState("");
  const [notControllable, setNotControllable] = useState(false);
  const commentHintId = useId();

  useEffect(() => {
    let active = true;
    fetchItem(id)
      .then((result) => {
        if (active) {
          setDetail(result);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const missing = error instanceof ApiError && [404, 422].includes(error.status);
          setStatus(missing ? "missing" : "error");
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  const back = (
    <p>
      <Link to="/evergreen">Zurück zu den Vorgängen</Link>
    </p>
  );

  if (status !== "ready" || !detail) {
    return (
      <>
        <p className="module-label">Evergreen</p>
        <h1>Vorgang</h1>
        {status === "loading" && <p role="status">Wird geladen …</p>}
        {status === "missing" && (
          <p>Diesen Vorgang gibt es nicht oder er ist für dich nicht sichtbar.</p>
        )}
        {status === "error" && <p role="alert">Der Vorgang konnte nicht geladen werden.</p>}
        {back}
      </>
    );
  }

  const { item, steps, actions, events } = detail;
  const onBehalf = actions.some((action) => action.on_behalf);
  const currentIndex = steps.findIndex((step) => step.id === item.step);

  const startEditing = () => {
    setSummary(detail.summary ?? "");
    setFeedback(detail.departments_feedback ?? "");
    setRollout(item.rollout_date ?? "");
    setNotControllable(detail.not_controllable);
    setMessage(null);
    setEditing(true);
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    updateItem(id, {
      summary,
      departments_feedback: feedback,
      rollout_date: rollout || null,
      not_controllable: notControllable,
    })
      .then((result) => {
        setDetail(result);
        setEditing(false);
        setMessage({ kind: "status", text: "Die Angaben sind gespeichert." });
      })
      .catch((failure: unknown) => {
        const text = failure instanceof ApiError ? failure.detail : null;
        setMessage({
          kind: "alert",
          text: text ?? "Die Angaben konnten nicht gespeichert werden.",
        });
      });
  };

  const onAction = (actionId: string, title: string, commentRequired: boolean) => {
    if (commentRequired && comment.trim() === "") {
      setMessage({
        kind: "alert",
        text: onBehalf
          ? "Bitte den Inhalt des Beschlusses eintragen."
          : `Für „${title}“ ist ein Kommentar nötig.`,
      });
      return;
    }
    if (onBehalf && sessionDate === "") {
      setMessage({ kind: "alert", text: "Bitte das Datum der Sitzung eintragen." });
      return;
    }
    setMessage(null);
    performAction(id, actionId, item.step, comment.trim(), onBehalf ? sessionDate : "")
      .then((result) => {
        setDetail(result);
        setComment("");
        setSessionDate("");
        setMessage({
          kind: "status",
          text: `„${title}“ ist erfasst. Neuer Schritt: ${result.item.step_title}.`,
        });
      })
      .catch((failure: unknown) => {
        const text = failure instanceof ApiError ? failure.detail : null;
        setMessage({ kind: "alert", text: text ?? "Die Aktion konnte nicht ausgeführt werden." });
      });
  };

  return (
    <>
      <p className="module-label">Evergreen · {item.number}</p>
      <h1>{item.title}</h1>
      {back}

      <section aria-labelledby="ablauf-titel">
        <h2 id="ablauf-titel" className="visually-hidden">
          Stand im Ablauf
        </h2>
        <ol className="steps">
          {steps.map((step, index) => {
            const current = step.id === item.step;
            const done = !item.finished && index < currentIndex;
            return (
              <li
                key={step.id}
                className={current ? "step current" : done ? "step done" : "step"}
                aria-current={current ? "step" : undefined}
              >
                {step.title}
                {current && <span className="visually-hidden"> (aktueller Schritt)</span>}
              </li>
            );
          })}
        </ol>
        {item.finished && (
          <p className="notice-neutral">
            <strong>{item.step_title}.</strong> An diesem Vorgang ist nichts mehr zu tun.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="angaben-titel">
        <h2 id="angaben-titel">Angaben</h2>
        {editing ? (
          <form className="meta-form" onSubmit={onSave} aria-label="Angaben bearbeiten">
            <label>
              Zusammenfassung
              <textarea
                value={summary}
                maxLength={8000}
                rows={5}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>
            <label>
              Rückmeldungen der Fachabteilungen
              <textarea
                value={feedback}
                maxLength={8000}
                rows={4}
                onChange={(event) => setFeedback(event.target.value)}
              />
            </label>
            <label>
              Rollout-Datum
              <input
                type="date"
                value={rollout}
                onChange={(event) => setRollout(event.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={notControllable}
                onChange={(event) => setNotControllable(event.target.checked)}
              />
              Nicht steuerbar (lässt sich nicht abschalten oder einschränken)
            </label>
            <div className="filter-actions">
              <button type="submit" className="button button-primary">
                Speichern
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditing(false)}
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>Schritt</dt>
                <dd>{item.step_title}</dd>
              </div>
              <div>
                <dt>Rollout</dt>
                <dd className={isUrgent(item) ? "urgent" : undefined}>{rolloutText(item)}</dd>
              </div>
              <div>
                <dt>Dienst</dt>
                <dd>{item.service ?? "–"}</dd>
              </div>
              <div>
                <dt>Einordnung</dt>
                <dd>
                  {item.major_change ? "Größere Änderung" : "Normale Änderung"}
                  {detail.not_controllable && ", nicht steuerbar"}
                </dd>
              </div>
            </dl>
            <h3>Zusammenfassung</h3>
            <p className="text">{detail.summary ?? "Noch keine Zusammenfassung."}</p>
            <h3>Rückmeldungen der Fachabteilungen</h3>
            <p className="text">{detail.departments_feedback ?? "Noch keine Rückmeldungen."}</p>
            {detail.can_edit && (
              <p className="actions">
                <button type="button" className="button button-secondary" onClick={startEditing}>
                  Angaben bearbeiten
                </button>
              </p>
            )}
          </>
        )}
      </section>

      {actions.length > 0 && (
        <section className="card review" aria-labelledby="entscheidung-titel">
          <h2 id="entscheidung-titel">
            {onBehalf ? "Beschluss im Auftrag erfassen" : `Entscheidung: ${item.step_title}`}
          </h2>
          {onBehalf && (
            <>
              <p className="note">
                Du erfasst den Beschluss stellvertretend aus einem Sitzungsprotokoll. Im Protokoll
                des Vorgangs steht dein Name mit dem Zusatz „im Auftrag“.
              </p>
              <label>
                Datum der Sitzung
                <input
                  type="date"
                  value={sessionDate}
                  onChange={(event) => setSessionDate(event.target.value)}
                />
              </label>
            </>
          )}
          <label>
            {onBehalf ? "Inhalt des Beschlusses" : "Kommentar"}
            <textarea
              value={comment}
              maxLength={4000}
              rows={3}
              aria-describedby={commentHintId}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <p className="small" id={commentHintId}>
            {onBehalf
              ? "Pflichtangabe."
              : actions.some((action) => action.comment_required)
                ? `Pflicht bei: ${actions
                    .filter((action) => action.comment_required)
                    .map((action) => action.title)
                    .join(", ")}.`
                : "Freiwillig."}
          </p>
          <div className="filter-actions">
            {actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={index === 0 ? "button button-primary" : "button button-secondary"}
                onClick={() => onAction(action.id, action.title, action.comment_required)}
              >
                {action.title}
              </button>
            ))}
          </div>
        </section>
      )}
      {message && <p role={message.kind}>{message.text}</p>}

      <section aria-labelledby="protokoll-titel">
        <h2 id="protokoll-titel">Protokoll</h2>
        {events.length === 0 ? (
          <p className="empty">
            Noch keine Entscheidung. Angelegt am {formatDateTime(item.created_at)}.
          </p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Protokoll">
            <table>
              <caption className="visually-hidden">
                Entscheidungen in zeitlicher Reihenfolge
              </caption>
              <thead>
                <tr>
                  <th scope="col">Zeitpunkt</th>
                  <th scope="col">Schritt</th>
                  <th scope="col">Entscheidung</th>
                  <th scope="col">Person</th>
                  <th scope="col">Kommentar</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="nowrap">{formatDateTime(event.occurred_at)}</td>
                    <td>{event.step_title}</td>
                    <td>
                      {event.action_title}
                      <span className="small path">weiter zu: {event.target_title}</span>
                    </td>
                    <td>
                      {event.user ?? "automatisch"}
                      {event.on_behalf_of && (
                        <span className="small path">
                          im Auftrag: {event.on_behalf_of}
                          {event.session_date && `, Sitzung vom ${formatDate(event.session_date)}`}
                        </span>
                      )}
                    </td>
                    <td className="text">{event.comment ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
