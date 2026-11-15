import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiError, formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import { PlanSection } from "./PlanSection";
import {
  categoryLabel,
  fetchItem,
  formatDate,
  isUrgent,
  performAction,
  rolloutText,
  sourceLabel,
  stepClass,
  updateItem,
  type ItemDetail,
} from "./api";

interface ItemDetailPageProps {
  id: number;
  /** Wird nach einer Entscheidung oder Änderung aufgerufen, z. B. um die Liste neu zu laden. */
  onChanged?: () => void;
}

type Message = { kind: "status" | "alert"; text: string };

export function ItemDetailPage({ id, onChanged }: ItemDetailPageProps) {
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
    <p className="back">
      <Link to="/evergreen">Zurück zu den Vorgängen</Link>
    </p>
  );

  if (status !== "ready" || !detail) {
    return (
      <div className="page">
        <p className="module-label">Evergreen</p>
        <h1>Vorgang</h1>
        {status === "loading" && <p role="status">Wird geladen …</p>}
        {status === "missing" && (
          <p>Diesen Vorgang gibt es nicht oder er ist für dich nicht sichtbar.</p>
        )}
        {status === "error" && <p role="alert">Der Vorgang konnte nicht geladen werden.</p>}
        {back}
      </div>
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
        onChanged?.();
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
        onChanged?.();
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

  const urgent = isUrgent(item);
  const onUpdate = (next: ItemDetail) => {
    setDetail(next);
    onChanged?.();
  };

  return (
    <div className="page">
      {back}
      <article className="panel setting" aria-labelledby="vorgang-titel">
        <header className="setting-head">
          <p className="module-label">Evergreen</p>
          <p className="small">
            {item.number}
            {item.service && ` · ${item.service}`} · Quelle: {sourceLabel(item.source)}
          </p>
          <h1 id="vorgang-titel">{item.title}</h1>
          <p className="badges">
            <span className={stepClass({ ...item, waiting_for_me: actions.length > 0 })}>
              {item.step_title}
            </span>
            {item.major_change && <span className="pill pill-bad">Größere Änderung</span>}
            {detail.not_controllable && <span className="pill pill-neutral">Nicht steuerbar</span>}
          </p>
        </header>

        {!item.finished && item.rollout_date && (
          <div className={urgent ? "hint-box hint-bad" : "hint-box hint-warn"}>
            <p className="hint-title">Rollout: {rolloutText(item)}</p>
            {detail.provisional_hint && (
              <p role="status">
                <strong>Der Rollout steht kurz bevor und es gibt noch keinen Beschluss.</strong>{" "}
                Lässt sich die Funktion abschalten, sollte die IT eine vorläufige Sperre in der
                geplanten Umsetzung eintragen.
              </p>
            )}
          </div>
        )}

        <section aria-labelledby="ablauf-titel">
          <h2 id="ablauf-titel" className="visually-hidden">
            Stand im Ablauf
          </h2>
          <div className="stepper-wrap">
            <ol className="stepper">
              {steps.map((step, index) => {
                const current = step.id === item.step;
                const done = !item.finished && index < currentIndex;
                return (
                  <li
                    key={step.id}
                    className={current ? "current" : done ? "done" : undefined}
                    aria-current={current ? "step" : undefined}
                  >
                    <span className="stepper-mark" aria-hidden="true">
                      {done ? "✓" : index + 1}
                    </span>
                    {step.title}
                    {done && <span className="visually-hidden"> (erledigt)</span>}
                    {current && <span className="visually-hidden"> (aktueller Schritt)</span>}
                  </li>
                );
              })}
            </ol>
          </div>
          {item.finished && (
            <p className="hint-box hint-neutral">
              <strong>{item.step_title}.</strong> An diesem Vorgang ist nichts mehr zu tun.
            </p>
          )}
        </section>

        <section className="setting-section" aria-labelledby="angaben-titel">
          <div className="section-head">
            <h2 id="angaben-titel">Was ändert sich?</h2>
            {detail.can_edit && !editing && (
              <button type="button" className="button button-secondary" onClick={startEditing}>
                Angaben bearbeiten
              </button>
            )}
          </div>
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
              <p className="text">
                {detail.summary ?? <span className="empty">Noch keine Zusammenfassung.</span>}
              </p>
              <h3>Einschätzung der Fachabteilungen</h3>
              <p className="text">
                {detail.departments_feedback ?? (
                  <span className="empty">Noch keine Rückmeldungen.</span>
                )}
              </p>
            </>
          )}
        </section>

        <PlanSection detail={detail} onChange={onUpdate} />

      {detail.message && (
        <section className="setting-section" aria-labelledby="meldung-titel">
          <h2 id="meldung-titel">Meldung von Microsoft</h2>
          {detail.message_updated && (
            <p className="hint-box hint-warn" role="status">
              <strong>Microsoft hat diese Meldung geändert</strong>, nachdem der Vorgang angelegt
              wurde (zuletzt am {formatDateTime(detail.message.modified_at)}). Bitte prüfen, ob sich
              dadurch etwas an der Bewertung ändert.
            </p>
          )}
          <p className="small">
            {detail.message.message_id} · {categoryLabel(detail.message.category)}
          </p>
          <details>
            <summary>Text der Meldung anzeigen</summary>
            <p className="text">{detail.message.body ?? "Die Meldung enthält keinen Text."}</p>
          </details>
        </section>
      )}

        {actions.length > 0 && (
          <section className="hint-box hint-warn decision" aria-labelledby="entscheidung-titel">
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
          <p className="rule" id={commentHintId}>
            {onBehalf
              ? "Pflichtangabe."
              : actions.some((action) => action.comment_required)
                ? `Pflicht bei: ${actions
                    .filter((action) => action.comment_required)
                    .map((action) => action.title)
                    .join(", ")}.`
                : "Freiwillig."}
          </p>
            <div className="actions">
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
        {message && (
          <p role={message.kind} className={message.kind === "alert" ? "hint-box hint-bad" : ""}>
            {message.text}
          </p>
        )}

        <section className="setting-section" aria-labelledby="protokoll-titel">
          <div className="section-head">
            <h2 id="protokoll-titel">Protokoll und Stellungnahmen</h2>
          </div>
          {events.length === 0 ? (
            <p className="empty">
              Noch keine Entscheidung. Angelegt am {formatDateTime(item.created_at)}.
            </p>
          ) : (
            <ol className="protocol">
              {events.map((event) => (
                <li key={event.id}>
                  <div className="protocol-head">
                    <strong>{event.step_title}</strong>
                    <span className="pill pill-neutral">{event.action_title}</span>
                    <span className="small">
                      {event.user ?? "automatisch"}
                      {event.on_behalf_of && ` – im Auftrag: ${event.on_behalf_of}`}
                      {event.session_date && `, Sitzung vom ${formatDate(event.session_date)}`} ·{" "}
                      {formatDateTime(event.occurred_at)}
                    </span>
                  </div>
                  {event.comment && <p className="text">{event.comment}</p>}
                  <p className="small">weiter zu: {event.target_title}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>
    </div>
  );
}
