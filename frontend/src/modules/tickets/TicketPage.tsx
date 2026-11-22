import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { ApiError, errorText, formatDateTime } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import {
  addNote,
  attachmentUrl,
  changeDetails,
  changeTicket,
  CHANNEL_LABELS,
  fetchTicket,
  formatSize,
  moveTicket,
  PRIORITY_LABELS,
  SETTABLE_STATUSES,
  STATUS_LABELS,
  ticketLabel,
  TICKETS_PATH,
  sendReply,
  type Entry,
  type StatusAfter,
  type Participant,
  type Priority,
  type Ticket,
  type TicketStatus,
} from "./api";
import { TICKET_ACCESS_CHANGED } from "./useTicketAccess";

/** So viele Einträge stehen nach der ursprünglichen Meldung, der Rest ist eingeklappt. */
export const RECENT_ENTRIES = 4;
/** Längere Nachrichten werden gekürzt. */
export const LONG_MESSAGE = 700;

type EntryFilter = "all" | "messages" | "internal";
const FILTER_LABELS: Record<EntryFilter, string> = {
  all: "Alles",
  messages: "Nur Nachrichten",
  internal: "Nur intern",
};

/** Kennzeichnung eines Eintrags (Text, nicht nur Farbe). */
export function entryMarker(entry: Entry, ticket: Ticket): string {
  if (entry.kind === "note") {
    return "Intern";
  }
  if (entry.kind === "reply") {
    return "an Melder gesendet";
  }
  if (entry.kind === "inbound" && entry.original && ticket.channel === "phone") {
    return "Anruf erfasst";
  }
  return "vom Melder";
}

function matches(entry: Entry, filter: EntryFilter): boolean {
  if (filter === "messages") {
    return entry.kind === "inbound" || entry.kind === "reply";
  }
  if (filter === "internal") {
    return entry.kind === "note" || entry.kind === "system";
  }
  return true;
}

/** Verlauf: ursprüngliche Meldung oben, ältere eingeklappt, dann die letzten Einträge. */
export function splitEntries(
  entries: Entry[],
  showAll: boolean,
): { original: Entry | null; hidden: number; shown: Entry[] } {
  const original = entries.find((entry) => entry.original) ?? null;
  const rest = entries.filter((entry) => entry !== original);
  if (showAll || rest.length <= RECENT_ENTRIES) {
    return { original, hidden: 0, shown: rest };
  }
  return {
    original,
    hidden: rest.length - RECENT_ENTRIES,
    shown: rest.slice(-RECENT_ENTRIES),
  };
}

function EntryItem({ entry, ticket }: { entry: Entry; ticket: Ticket }) {
  const [full, setFull] = useState(false);
  if (entry.kind === "system") {
    return (
      <li className="ticket-entry ticket-entry-system">
        <span>{entry.body}</span>
        <span className="small">
          {entry.author_name} · {formatDateTime(entry.created_at)}
        </span>
      </li>
    );
  }
  const long = entry.body.length > LONG_MESSAGE;
  const text = long && !full ? `${entry.body.slice(0, LONG_MESSAGE).trimEnd()} …` : entry.body;
  const marker = entryMarker(entry, ticket);
  return (
    <li className={`ticket-entry ticket-entry-${entry.kind}`}>
      <div className="ticket-entry-head">
        <span className="ticket-marker">
          {entry.kind === "note" && <Icon name="schloss" />}
          {entry.kind === "reply" && <Icon name="brief" />}
          {marker}
        </span>
        <span className="small">
          {entry.kind === "inbound" ? ticket.reporter_name || entry.author_name : entry.author_name}{" "}
          · {formatDateTime(entry.created_at)}
          {entry.original && " · ursprüngliche Meldung"}
        </span>
      </div>
      <p className="ticket-entry-body">{text}</p>
      {long && (
        <button type="button" className="row-button" onClick={() => setFull(!full)}>
          {full ? "Nachricht kürzen" : "Ganze Nachricht anzeigen"}
        </button>
      )}
      {entry.quote && (
        <details className="ticket-quote">
          <summary>Zitat aus früheren Mails anzeigen</summary>
          <p className="ticket-entry-body">{entry.quote}</p>
        </details>
      )}
      {entry.attachments.length > 0 && (
        <ul className="plain ticket-attachments" aria-label="Anhänge">
          {entry.attachments.map((att) => (
            <li key={att.id}>
              {att.removed_reason ? (
                <span className="small">
                  {att.filename}: entfernt ({att.removed_reason})
                </span>
              ) : (
                <a href={attachmentUrl(ticket.number, att.id)} download>
                  {att.original ? "Original-Mail (.eml)" : att.filename}
                  <span className="small"> · {formatSize(att.size)}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Timeline({ ticket }: { ticket: Ticket }) {
  const [filter, setFilter] = useState<EntryFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const visible = ticket.entries.filter((entry) => matches(entry, filter) || entry.original);
  const { original, hidden, shown } = splitEntries(visible, showAll);
  return (
    <section className="ticket-timeline" aria-labelledby="ticket-verlauf">
      <div className="ticket-timeline-head">
        <h2 id="ticket-verlauf">Verlauf</h2>
        <div className="chips" role="group" aria-label="Verlauf filtern">
          {(Object.keys(FILTER_LABELS) as EntryFilter[]).map((id) => (
            <button
              key={id}
              type="button"
              className="chip chip-filter"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {FILTER_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
      <ol className="ticket-entries">
        {original && <EntryItem entry={original} ticket={ticket} />}
        {hidden > 0 && (
          <li className="ticket-entry-more">
            <button type="button" className="button" onClick={() => setShowAll(true)}>
              {hidden === 1 ? "1 älteren Eintrag anzeigen" : `${hidden} ältere Einträge anzeigen`}
            </button>
          </li>
        )}
        {shown.map((entry) => (
          <EntryItem key={entry.id} entry={entry} ticket={ticket} />
        ))}
      </ol>
    </section>
  );
}

type ComposerMode = "reply" | "note" | null;

const STATUS_AFTER_LABELS: Record<StatusAfter, string> = {
  "": "unverändert",
  waiting: "Wartet auf Rückmeldung",
  solved: "Gelöst",
};

function Composer({
  ticket,
  onSaved,
  onMessage,
}: {
  ticket: Ticket;
  onSaved: (ticket: Ticket) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [mode, setMode] = useState<ComposerMode>(null);
  // Entwürfe bleiben beim Einklappen erhalten
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [statusAfter, setStatusAfter] = useState<StatusAfter>("");
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const afterId = useId();
  const reporter = ticket.reporter_name || ticket.reporter_mail || "Der Melder";
  const copies = ticket.participants.map((p) => p.mail);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = mode === "reply" ? reply : note;
    if (!text.trim()) {
      return;
    }
    setBusy(true);
    const request =
      mode === "reply" ? sendReply(ticket.number, text, statusAfter) : addNote(ticket.number, text);
    request
      .then((result) => {
        if (mode === "reply") {
          setReply("");
          setStatusAfter("");
        } else {
          setNote("");
        }
        setMode(null);
        onSaved(result);
        onMessage({
          kind: "status",
          text:
            mode === "reply"
              ? `Die Antwort an ${reporter} wurde gesendet.`
              : "Die interne Notiz wurde gespeichert.",
        });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(
            problem,
            mode === "reply"
              ? "Die Antwort konnte nicht gesendet werden."
              : "Die Notiz konnte nicht gespeichert werden.",
          ),
        }),
      )
      .finally(() => setBusy(false));
  };

  if (!ticket.permissions.note) {
    return null;
  }
  if (mode === null) {
    return (
      <div className="ticket-composer">
        <div className="ticket-composer-buttons">
          {ticket.permissions.edit && (
            <button
              type="button"
              className="button ticket-reply-button"
              disabled={!ticket.can_reply}
              aria-describedby={ticket.can_reply ? undefined : `${fieldId}-hint`}
              onClick={() => setMode("reply")}
            >
              <Icon name="brief" />
              Antwort an {reporter} schreiben
              {reply.trim() && <span className="small"> (Entwurf)</span>}
            </button>
          )}
          <button
            type="button"
            className="button ticket-note-button"
            onClick={() => setMode("note")}
          >
            <Icon name="schloss" />
            Interne Notiz schreiben
            {note.trim() && <span className="small"> (Entwurf)</span>}
          </button>
        </div>
        {ticket.permissions.edit && !ticket.can_reply && ticket.reply_hint && (
          <p className="small" id={`${fieldId}-hint`}>
            Antwort per Mail nicht möglich: {ticket.reply_hint}
          </p>
        )}
      </div>
    );
  }
  const isReply = mode === "reply";
  return (
    <div className="ticket-composer">
      <form className={isReply ? "ticket-reply-form" : "ticket-note-form"} onSubmit={submit}>
        <label htmlFor={fieldId} className="ticket-note-label">
          <Icon name={isReply ? "brief" : "schloss"} />
          {isReply ? `Antwort an ${reporter}` : "Interne Notiz"}
          {!isReply && <InfoTip term="tickets.notiz" />}
        </label>
        <p className="small">
          {isReply
            ? `Geht per E-Mail an: ${ticket.reporter_mail}${copies.length > 0 ? ` (Kopie an ${copies.join(", ")})` : ""}`
            : `${reporter} sieht diesen Text nicht und bekommt keine Mail.`}
        </p>
        <textarea
          id={fieldId}
          rows={5}
          value={isReply ? reply : note}
          maxLength={20000}
          onChange={(event) => (isReply ? setReply : setNote)(event.target.value)}
        />
        <div className="actions ticket-composer-actions">
          {isReply && (
            <label htmlFor={afterId} className="ticket-after">
              <span>Status danach</span>
              <select
                id={afterId}
                value={statusAfter}
                onChange={(event) => setStatusAfter(event.target.value as StatusAfter)}
              >
                {(Object.keys(STATUS_AFTER_LABELS) as StatusAfter[]).map((key) => (
                  <option key={key} value={key}>
                    {STATUS_AFTER_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || !(isReply ? reply : note).trim()}
          >
            {busy
              ? isReply
                ? "Wird gesendet …"
                : "Wird gespeichert …"
              : isReply
                ? `An ${reporter} senden`
                : "Interne Notiz speichern"}
          </button>
          <button type="button" className="button button-secondary" onClick={() => setMode(null)}>
            Einklappen
          </button>
        </div>
      </form>
    </div>
  );
}

function Participants({
  ticket,
  onSaved,
  onMessage,
}: {
  ticket: Ticket;
  onSaved: (ticket: Ticket) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [mail, setMail] = useState("");
  const [busy, setBusy] = useState(false);
  const mailId = useId();
  const save = (participants: Participant[], done: string) => {
    setBusy(true);
    changeDetails(ticket.number, { priority: ticket.priority, participants })
      .then((result) => {
        onSaved(result);
        setMail("");
        onMessage({ kind: "status", text: done });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Die Beteiligten konnten nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="ticket-fact">
      <span className="ticket-fact-label">
        Beteiligte
        <InfoTip term="tickets.beteiligte" />
      </span>
      {ticket.participants.length === 0 && <span>–</span>}
      <ul className="plain ticket-participants">
        {ticket.participants.map((p) => (
          <li key={p.mail}>
            <span>{p.name ? `${p.name} (${p.mail})` : p.mail}</span>
            {ticket.permissions.edit && (
              <button
                type="button"
                className="row-button"
                disabled={busy}
                aria-label={`${p.mail} entfernen`}
                onClick={() =>
                  save(
                    ticket.participants.filter((other) => other.mail !== p.mail),
                    "Die Person wurde entfernt.",
                  )
                }
              >
                Entfernen
              </button>
            )}
          </li>
        ))}
      </ul>
      {ticket.permissions.edit && (
        <form
          className="ticket-participant-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (mail.trim()) {
              save(
                [...ticket.participants, { name: "", mail: mail.trim() }],
                "Die Person wurde hinzugefügt.",
              );
            }
          }}
        >
          <label htmlFor={mailId} className="visually-hidden">
            Mailadresse einer beteiligten Person
          </label>
          <input
            id={mailId}
            type="email"
            placeholder="name@example.com"
            value={mail}
            maxLength={320}
            onChange={(event) => setMail(event.target.value)}
          />
          <button type="submit" className="button" disabled={busy || !mail.trim()}>
            Hinzufügen
          </button>
        </form>
      )}
    </div>
  );
}

function Facts({
  ticket,
  onSaved,
  onMoved,
  onMessage,
}: {
  ticket: Ticket;
  onSaved: (ticket: Ticket) => void;
  onMoved: (visible: boolean, ticket: Ticket | null, areaName: string) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [ask, dialog] = useConfirm();
  const priorityId = useId();
  const areaId = useId();
  const [target, setTarget] = useState("");

  const changePriority = (priority: Priority) => {
    changeDetails(ticket.number, { priority, participants: ticket.participants })
      .then((result) => {
        onSaved(result);
        onMessage({ kind: "status", text: "Die Priorität wurde geändert." });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Die Priorität konnte nicht geändert werden."),
        }),
      );
  };

  const move = () => {
    const area = ticket.move_targets.find((a) => String(a.id) === target);
    if (!area) {
      return;
    }
    const losesAccess = area.role === null;
    ask(
      {
        title: `Ticket nach „${area.name}“ verschieben?`,
        text: losesAccess
          ? `Du bist im Bereich „${area.name}“ nicht Mitglied. Nach dem Verschieben siehst du das Ticket nicht mehr.`
          : `Das Ticket gehört danach zum Bereich „${area.name}“. Die Zuständigkeit wird neu vergeben.`,
        action: "Verschieben",
      },
      () =>
        moveTicket(ticket.number, area.id)
          .then((result) => onMoved(result.visible, result.ticket, area.name))
          .catch((problem: unknown) =>
            onMessage({
              kind: "alert",
              text: errorText(problem, "Das Ticket konnte nicht verschoben werden."),
            }),
          ),
    );
  };

  return (
    <aside className="ticket-side" aria-label="Angaben zum Ticket">
      <div className="ticket-facts">
        <div className="ticket-fact">
          <span className="ticket-fact-label">Bereich</span>
          <span>{ticket.area.name}</span>
          {ticket.permissions.move && ticket.move_targets.length > 0 && (
            <div className="ticket-move">
              <label htmlFor={areaId} className="visually-hidden">
                Verschieben nach
              </label>
              <select
                id={areaId}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Verschieben nach …</option>
                {ticket.move_targets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button type="button" className="button" disabled={!target} onClick={move}>
                Verschieben
              </button>
            </div>
          )}
        </div>
        <div className="ticket-fact">
          <label htmlFor={priorityId} className="ticket-fact-label">
            Priorität
          </label>
          {ticket.permissions.edit ? (
            <select
              id={priorityId}
              value={ticket.priority}
              onChange={(event) => changePriority(event.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          ) : (
            <span id={priorityId}>{PRIORITY_LABELS[ticket.priority]}</span>
          )}
        </div>
        <Participants ticket={ticket} onSaved={onSaved} onMessage={onMessage} />
      </div>
      {dialog}
    </aside>
  );
}

/** Zusammenfassung der noch nicht bestätigten Änderungen, z. B. „Status: A → B · Zuständig: C → D“. */
export function changeSummary(
  ticket: Ticket,
  status: TicketStatus,
  assignee: string | null,
): string {
  const parts: string[] = [];
  if (status !== ticket.status) {
    parts.push(`Status: ${STATUS_LABELS[ticket.status]} → ${STATUS_LABELS[status]}`);
  }
  if ((assignee ?? null) !== (ticket.assignee_oid ?? null)) {
    const name = (oid: string | null) =>
      oid === null ? "niemand" : (ticket.assignees.find((p) => p.oid === oid)?.name ?? "?");
    parts.push(`Zuständig: ${name(ticket.assignee_oid)} → ${name(assignee)}`);
  }
  return parts.join(" · ");
}

export function TicketPage({ number }: { number: number }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  // Noch nicht bestätigte Änderungen im Kopf (verfallen beim Wechsel des Tickets)
  const [status, setStatus] = useState<TicketStatus>("new");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const statusId = useId();
  const assigneeId = useId();
  const noteId = useId();
  // Eigene Objekt-ID kommt vom Server (für „Mir zuweisen“)
  const meOid = ticket?.me_oid || null;

  const accept = (next: Ticket) => {
    setTicket(next);
    setStatus(next.status);
    setAssignee(next.assignee_oid);
    setNote("");
  };

  useEffect(() => {
    let active = true;
    fetchTicket(number).then(
      (result) => active && accept(result),
      (problem: unknown) =>
        active &&
        setFailed(
          problem instanceof ApiError && problem.status === 404
            ? "Dieses Ticket gibt es nicht, oder du hast keinen Zugriff auf seinen Bereich."
            : errorText(problem, "Das Ticket konnte nicht geladen werden."),
        ),
    );
    return () => {
      active = false;
    };
  }, [number]);

  const summary = ticket ? changeSummary(ticket, status, assignee) : "";
  const handover =
    ticket !== null &&
    assignee !== null &&
    assignee !== ticket.assignee_oid &&
    ticket.assignee_oid !== null;

  const statusOptions = useMemo(() => {
    if (!ticket) {
      return [];
    }
    const list = [...SETTABLE_STATUSES];
    if (!list.includes(ticket.status)) {
      list.unshift(ticket.status);
    }
    return list;
  }, [ticket]);

  if (moved !== null) {
    return (
      <div className="page">
        <p className="hint-box" role="status">
          Das Ticket liegt jetzt im Bereich „{moved}“. Dort bist du nicht Mitglied, deshalb siehst
          du es nicht mehr.
        </p>
        <Link to={TICKETS_PATH}>Zu allen Tickets</Link>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="page">
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
        <Link to={TICKETS_PATH}>Zu allen Tickets</Link>
      </div>
    );
  }
  if (!ticket) {
    return (
      <p className="page-message" role="status">
        Wird geladen …
      </p>
    );
  }

  const canEdit = ticket.permissions.edit && ticket.status !== "merged";
  // Wer darf welche Person wählen? Bereichsverwaltung alle; sonst sich selbst ein freies
  // Ticket nehmen oder das eigene übergeben (der Server prüft das noch einmal).
  const mayChooseAssignee =
    canEdit &&
    (ticket.permissions.assign_any ||
      ticket.assignee_oid === null ||
      (meOid !== null && ticket.assignee_oid === meOid));
  const assigneeChoices =
    ticket.permissions.assign_any || ticket.assignee_oid === meOid
      ? ticket.assignees
      : ticket.assignees.filter((p) => p.oid === meOid);

  const confirm = () => {
    setBusy(true);
    changeTicket(ticket.number, {
      expected_status: ticket.status,
      expected_assignee_oid: ticket.assignee_oid,
      status: status !== ticket.status ? status : null,
      change_assignee: assignee !== ticket.assignee_oid,
      assignee_oid: assignee,
      handover_note: handover ? note : "",
    })
      .then((result) => {
        accept(result);
        setMessage({ kind: "status", text: "Die Änderung wurde gespeichert." });
        window.dispatchEvent(new Event(TICKET_ACCESS_CHANGED));
      })
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Änderung konnte nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="ticket-page">
      <header className="ticket-head">
        <div className="ticket-head-row">
          <Link to={TICKETS_PATH} className="ticket-back">
            <Icon name="zurueck" />
            <span className="visually-hidden">Zurück zu allen Tickets</span>
          </Link>
          <h1 className="ticket-title">
            <span className="mono">{ticketLabel(ticket.number)}</span>{" "}
            <span className="ticket-subject" title={ticket.subject}>
              {ticket.subject}
            </span>
          </h1>
        </div>
        <div className="ticket-head-row ticket-head-fields">
          <label htmlFor={statusId} className="ticket-head-field">
            <span>Status</span>
            <select
              id={statusId}
              value={status}
              disabled={!canEdit || busy}
              onChange={(event) => setStatus(event.target.value as TicketStatus)}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s} disabled={!SETTABLE_STATUSES.includes(s)}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={assigneeId} className="ticket-head-field">
            <span>Zuständig</span>
            <select
              id={assigneeId}
              value={assignee ?? ""}
              disabled={!mayChooseAssignee || busy}
              onChange={(event) => setAssignee(event.target.value || null)}
            >
              <option value="">Niemand</option>
              {assigneeChoices.map((p) => (
                <option key={p.oid} value={p.oid}>
                  {p.name}
                </option>
              ))}
              {assignee !== null && !assigneeChoices.some((p) => p.oid === assignee) && (
                <option value={assignee}>{ticket.assignee_name}</option>
              )}
            </select>
          </label>
          {canEdit && meOid !== null && ticket.assignee_oid === null && assignee !== meOid && (
            <button type="button" className="button" onClick={() => setAssignee(meOid)}>
              Mir zuweisen
            </button>
          )}
          <p className="ticket-head-meta small">
            {ticket.reporter_name}
            {ticket.reporter_mail && ` (${ticket.reporter_mail})`} ·{" "}
            {CHANNEL_LABELS[ticket.channel]} · {formatDateTime(ticket.created_at)}
          </p>
        </div>
        {summary && (
          <div className="ticket-pending" role="status">
            <p>
              <strong>Noch nicht gespeichert:</strong> {summary}
            </p>
            {handover && (
              <div className="ticket-handover">
                <label htmlFor={noteId}>Übergabenotiz (freiwillig, wird interne Notiz)</label>
                <textarea
                  id={noteId}
                  rows={2}
                  value={note}
                  maxLength={20000}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            )}
            <div className="actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={confirm}
              >
                {busy ? "Wird gespeichert …" : "Bestätigen"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setStatus(ticket.status);
                  setAssignee(ticket.assignee_oid);
                  setNote("");
                }}
              >
                Verwerfen
              </button>
            </div>
          </div>
        )}
      </header>
      <div className="ticket-layout">
        <div className="ticket-main">
          <Timeline ticket={ticket} />
          <Composer ticket={ticket} onSaved={accept} onMessage={setMessage} />
        </div>
        <Facts
          ticket={ticket}
          onSaved={accept}
          onMessage={setMessage}
          onMoved={(visible, next, areaName) => {
            if (visible && next) {
              accept(next);
              setMessage({
                kind: "status",
                text: `Das Ticket liegt jetzt im Bereich „${areaName}“.`,
              });
            } else {
              setMoved(areaName);
            }
            window.dispatchEvent(new Event(TICKET_ACCESS_CHANGED));
          }}
        />
      </div>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
