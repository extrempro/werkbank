import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
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
  fetchMergeCandidates,
  fetchTicket,
  fetchTicketTemplates,
  fillTemplate,
  mergeTicket,
  clearHold,
  RETENTION_ACTION_LABELS,
  retentionText,
  setHold,
  searchDevices,
  setDevice,
  ticketPath,
  formatSize,
  moveTicket,
  PRIORITY_LABELS,
  SETTABLE_STATUSES,
  STATUS_LABELS,
  ticketLabel,
  TICKETS_PATH,
  sendReply,
  type Candidate,
  type Entry,
  type StatusAfter,
  type Participant,
  type Priority,
  type Sla,
  type Template,
  type TemplatesForTicket,
  type Ticket,
  type TicketStatus,
} from "./api";
import { hardwarePath } from "../inventory/api";
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
          {entry.from_number !== null && (
            <span className="small ticket-from"> · aus T-{entry.from_number}</span>
          )}
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

/** Kürzel direkt vor der Schreibmarke, z. B. „/druck“ → „druck“ (sonst null). */
export function shortcutAt(text: string, caret: number): { start: number; word: string } | null {
  const match = /(^|\s)\/([\p{L}\p{N}_-]{0,30})$/u.exec(text.slice(0, caret));
  if (!match) {
    return null;
  }
  const word = match[2] ?? "";
  return { start: caret - word.length - 1, word };
}

/** Bausteine zum Kürzel: zuerst Treffer am Anfang, dann im Namen. Höchstens 8. */
export function matchTemplates(templates: Template[], word: string): Template[] {
  const q = word.toLowerCase();
  const starts = templates.filter((t) => t.shortcut.toLowerCase().startsWith(q));
  const rest = templates.filter(
    (t) => !starts.includes(t) && `${t.shortcut} ${t.name}`.toLowerCase().includes(q),
  );
  return [...starts, ...rest].slice(0, 8);
}

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
  const [templates, setTemplates] = useState<TemplatesForTicket | null>(null);
  const [slash, setSlash] = useState<{ start: number; word: string } | null>(null);
  const [active, setActive] = useState(0);
  const fieldId = useId();
  const afterId = useId();
  const listId = useId();

  useEffect(() => {
    if (mode === null || templates !== null) {
      return;
    }
    let alive = true;
    fetchTicketTemplates(ticket.number).then(
      (result) => alive && setTemplates(result),
      // Ohne Bausteine geht das Schreiben trotzdem
      () => alive && setTemplates({ templates: [], values: {}, signature: "" }),
    );
    return () => {
      alive = false;
    };
  }, [mode, templates, ticket.number]);

  const kindTemplates = (templates?.templates ?? []).filter((t) => t.kind === mode);
  const suggestions = slash ? matchTemplates(kindTemplates, slash.word) : [];
  const showList = slash !== null && suggestions.length > 0;

  const track = (element: HTMLTextAreaElement) => {
    const next = shortcutAt(element.value, element.selectionStart);
    setSlash(next);
    if (next?.word !== slash?.word) {
      setActive(0);
    }
  };

  const insert = (template: Template, element: HTMLTextAreaElement | null) => {
    if (!slash) {
      return;
    }
    const current = mode === "reply" ? reply : note;
    const text = fillTemplate(template.body, templates?.values ?? {});
    const end = slash.start + 1 + slash.word.length;
    const next = current.slice(0, slash.start) + text + current.slice(end);
    (mode === "reply" ? setReply : setNote)(next);
    if (mode === "reply" && template.status_after) {
      setStatusAfter(template.status_after);
    }
    setSlash(null);
    if (element) {
      const caret = slash.start + text.length;
      window.requestAnimationFrame(() => {
        element.focus();
        element.setSelectionRange(caret, caret);
      });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showList) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const chosen = suggestions[active];
      if (chosen) {
        event.preventDefault();
        insert(chosen, event.currentTarget);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSlash(null);
    }
  };
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
        <div className="ticket-template-anchor">
          <textarea
            id={fieldId}
            rows={5}
            value={isReply ? reply : note}
            maxLength={20000}
            aria-describedby={kindTemplates.length > 0 ? `${fieldId}-tpl` : undefined}
            aria-controls={showList ? listId : undefined}
            aria-autocomplete="list"
            onChange={(event) => {
              (isReply ? setReply : setNote)(event.target.value);
              track(event.target);
            }}
            onKeyDown={onKeyDown}
            onClick={(event) => track(event.currentTarget)}
            onBlur={() => window.setTimeout(() => setSlash(null), 150)}
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Textbausteine"
              className="ticket-template-list"
            >
              {suggestions.map((t, index) => (
                <li
                  key={t.id}
                  id={`${listId}-${t.id}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insert(t, document.getElementById(fieldId) as HTMLTextAreaElement | null);
                  }}
                >
                  <span className="mono">/{t.shortcut}</span> {t.name}
                  {t.status_after && (
                    <span className="small"> · danach {STATUS_AFTER_LABELS[t.status_after]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="visually-hidden" aria-live="polite">
          {showList
            ? `${suggestions.length} Textbausteine passen. Pfeiltasten wählen, Eingabe übernimmt, Escape schließt.`
            : ""}
        </p>
        {kindTemplates.length > 0 && (
          <p className="small" id={`${fieldId}-tpl`}>
            Textbausteine: Schrägstrich und Kürzel tippen, zum Beispiel /
            {kindTemplates[0]?.shortcut}
            .
            <InfoTip term="tickets.textbausteine" />
          </p>
        )}
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
    changeDetails(ticket.number, {
      priority: ticket.priority,
      participants,
      category_id: ticket.category_id,
    })
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

/** Frist (nur bei Bereichen mit Fristen): fällig am, eingehalten, ruht. Text, nicht nur Farbe. */
function SlaFact({ sla }: { sla: Sla }) {
  const due = sla.solution_due ? new Date(sla.solution_due) : null;
  const overdue = due !== null && sla.solution_met === null && !sla.paused && due < new Date();
  let state = "";
  if (sla.paused) {
    state = "ruht (Wartet auf Rückmeldung)";
  } else if (sla.solution_met === true) {
    state = "eingehalten";
  } else if (sla.solution_met === false) {
    state = "nicht eingehalten";
  } else if (overdue) {
    state = "überschritten";
  }
  return (
    <div className="ticket-fact">
      <span className="ticket-fact-label">
        Frist
        <InfoTip term="tickets.frist" />
      </span>
      <span>
        Lösung bis {formatDateTime(sla.solution_due)}
        {state && (
          <span
            className={
              overdue || sla.solution_met === false ? "pill pill-bad" : "pill pill-neutral"
            }
          >
            {state}
          </span>
        )}
      </span>
      {sla.response_due && (
        <span className="small">
          Erste Reaktion bis {formatDateTime(sla.response_due)}
          {sla.response_met === true && " · eingehalten"}
          {sla.response_met === false && " · nicht eingehalten"}
        </span>
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
  const categoryId = useId();
  const areaId = useId();
  const [target, setTarget] = useState("");

  const changeFacts = (priority: Priority, categoryId: number | null, what: string) => {
    changeDetails(ticket.number, {
      priority,
      participants: ticket.participants,
      category_id: categoryId,
    })
      .then((result) => {
        onSaved(result);
        onMessage({ kind: "status", text: `${what} wurde geändert.` });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, `${what} konnte nicht geändert werden.`),
        }),
      );
  };
  const changePriority = (priority: Priority) =>
    changeFacts(priority, ticket.category_id, "Die Priorität");

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
        {(ticket.categories.length > 0 || ticket.category_id !== null) && (
          <div className="ticket-fact">
            <label htmlFor={categoryId} className="ticket-fact-label">
              Kategorie
            </label>
            {ticket.permissions.edit ? (
              <select
                id={categoryId}
                value={ticket.category_id ?? ""}
                onChange={(event) =>
                  changeFacts(
                    ticket.priority,
                    event.target.value ? Number(event.target.value) : null,
                    "Die Kategorie",
                  )
                }
              >
                <option value="">Keine</option>
                {ticket.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span id={categoryId}>{ticket.category || "–"}</span>
            )}
          </div>
        )}
        {ticket.sla && <SlaFact sla={ticket.sla} />}
        <Participants ticket={ticket} onSaved={onSaved} onMessage={onMessage} />
        {ticket.devices_enabled && (
          <DeviceSection ticket={ticket} onSaved={onSaved} onMessage={onMessage} />
        )}
        {ticket.permissions.edit && ticket.status !== "merged" && (
          <MergeSection ticket={ticket} onSaved={onSaved} onMessage={onMessage} />
        )}
        {(ticket.retention.active || ticket.retention.hold_until !== null) && (
          <RetentionSection ticket={ticket} onSaved={onSaved} onMessage={onMessage} />
        )}
      </div>
      {dialog}
    </aside>
  );
}

/** Aufbewahrung am Ticket: Frist des Bereichs, Ausnahme setzen, bestätigen, aufheben. */
function RetentionSection({
  ticket,
  onSaved,
  onMessage,
}: {
  ticket: Ticket;
  onSaved: (ticket: Ticket) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [ask, dialog] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const r = ticket.retention;
  const held = r.hold_until !== null;
  const rule =
    r.active && r.action
      ? `${retentionText(r.months)} nach dem Schließen ${RETENTION_ACTION_LABELS[r.action]}`
      : "keine Frist im Bereich";

  const save = (event: FormEvent) => {
    event.preventDefault();
    setHold(ticket.number, reason)
      .then((result) => {
        onSaved(result);
        setEditing(false);
        onMessage({
          kind: "status",
          text: held
            ? "Die Ausnahme wurde für ein weiteres Jahr bestätigt."
            : "Die Ausnahme wurde gesetzt.",
        });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Die Ausnahme konnte nicht gespeichert werden."),
        }),
      );
  };

  const remove = () =>
    ask(
      {
        title: "Ausnahme aufheben?",
        text: r.active
          ? `Danach gilt wieder die Frist des Bereichs (${rule}). Ist sie schon abgelaufen, ist das Ticket beim nächsten Lauf dran.`
          : "Danach gilt wieder die Regel des Bereichs.",
        action: "Aufheben",
      },
      () =>
        clearHold(ticket.number)
          .then((result) => {
            onSaved(result);
            onMessage({ kind: "status", text: "Die Ausnahme wurde aufgehoben." });
          })
          .catch((problem: unknown) =>
            onMessage({
              kind: "alert",
              text: errorText(problem, "Die Ausnahme konnte nicht aufgehoben werden."),
            }),
          ),
    );

  return (
    <div className="ticket-fact">
      <span className="ticket-fact-label">
        Aufbewahrung
        <InfoTip term="tickets.aufbewahrung" />
      </span>
      <span className="small">{rule}</span>
      {held && (
        <span>
          Ausnahme bis {formatDateTime(r.hold_until)}
          <span className="small">
            {" "}
            · {r.hold_reason}
            {r.hold_by && ` (${r.hold_by})`}
          </span>
        </span>
      )}
      {r.can_manage && !editing && (
        <div className="actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setReason(r.hold_reason);
              setEditing(true);
            }}
          >
            {held ? "Ausnahme bestätigen" : "Ausnahme setzen"}
          </button>
          {held && (
            <button type="button" className="button button-secondary" onClick={remove}>
              Aufheben
            </button>
          )}
        </div>
      )}
      {r.can_manage && editing && (
        <form className="ticket-template-form" onSubmit={save}>
          <label htmlFor={reasonId}>Begründung (Pflicht)</label>
          <textarea
            id={reasonId}
            rows={2}
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="small">
            Gilt ein Jahr; danach muss sie bestätigt werden, sonst verfällt sie.
          </p>
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={!reason.trim()}>
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
      )}
      {dialog}
    </div>
  );
}

/** Suche mit kurzer Verzögerung, damit nicht jeder Tastendruck eine Anfrage auslöst. */
function useSearch<T>(load: (q: string) => Promise<T[]>, active: boolean) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) {
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      load(query.trim()).then(
        (result) => {
          if (alive) {
            setItems(result);
            setFailed(false);
          }
        },
        () => alive && setFailed(true),
      );
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // load ändert sich mit dem Ticket; die Suche hängt nur an Text und Sichtbarkeit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, active]);
  return { query, setQuery, items, failed };
}

/** Gerät aus dem IT-Bestand verknüpfen (höchstens 5 Treffer, Vorschläge des Melders zuerst). */
function DeviceSection({
  ticket,
  onSaved,
  onMessage,
}: {
  ticket: Ticket;
  onSaved: (ticket: Ticket) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [open, setOpen] = useState(false);
  const searchId = useId();
  const canEdit = ticket.permissions.edit && ticket.status !== "merged";
  const search = useSearch((q) => searchDevices(ticket.number, q), open && canEdit);

  const save = (hardwareId: number | null) =>
    setDevice(ticket.number, hardwareId)
      .then((result) => {
        onSaved(result);
        setOpen(false);
        onMessage({
          kind: "status",
          text: hardwareId === null ? "Das Gerät wurde gelöst." : "Das Gerät wurde verknüpft.",
        });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Das Gerät konnte nicht gespeichert werden."),
        }),
      );

  const device = ticket.device;
  return (
    <div className="ticket-fact">
      <span className="ticket-fact-label">
        Gerät
        <InfoTip term="tickets.geraet" />
      </span>
      {device ? (
        <span>
          <Link to={hardwarePath(device.id)}>{device.name}</Link>
          <span className="small">
            {" "}
            · {device.kind}
            {device.inventory_no && ` · ${device.inventory_no}`}
          </span>
        </span>
      ) : (
        <span>–</span>
      )}
      {canEdit && (
        <details
          className="ticket-device"
          open={open}
          onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>{device ? "Anderes Gerät wählen" : "Gerät verknüpfen"}</summary>
          <label htmlFor={searchId}>Name, Inventar- oder Seriennummer</label>
          <input
            id={searchId}
            type="search"
            value={search.query}
            maxLength={100}
            onChange={(event) => search.setQuery(event.target.value)}
          />
          {search.failed && (
            <p className="small" role="alert">
              Die Suche hat nicht geklappt.
            </p>
          )}
          <ul className="ticket-pick-list" aria-live="polite">
            {search.items.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="button button-link"
                  onClick={() => void save(d.id)}
                >
                  {d.name}
                </button>
                <span className="small">
                  {" "}
                  · {d.kind}
                  {d.inventory_no && ` · ${d.inventory_no}`}
                  {d.reporter && " · gehört dem Melder"}
                </span>
              </li>
            ))}
            {!search.failed && search.items.length === 0 && (
              <li className="small">Keine passenden Geräte.</li>
            )}
          </ul>
          {device && (
            <button type="button" className="button" onClick={() => void save(null)}>
              Gerät lösen
            </button>
          )}
        </details>
      )}
    </div>
  );
}

/** In ein anderes Ticket zusammenführen: Vorschläge, Suche, Bestätigung. */
function MergeSection({
  ticket,
  onSaved,
  onMessage,
}: {
  ticket: Ticket;
  onSaved: (ticket: Ticket) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [ask, dialog] = useConfirm();
  const [open, setOpen] = useState(false);
  const [notify, setNotify] = useState(true);
  const searchId = useId();
  const search = useSearch((q) => fetchMergeCandidates(ticket.number, q), open);

  const merge = (target: Candidate) =>
    ask(
      {
        title: `${ticketLabel(ticket.number)} in ${ticketLabel(target.number)} zusammenführen?`,
        text: `Der Verlauf wandert nach ${ticketLabel(target.number)} („${target.subject}“), dieses Ticket wird geschlossen. Das lässt sich nicht rückgängig machen.${notify ? " Der Melder bekommt eine Mail." : ""}`,
        action: "Zusammenführen",
      },
      () =>
        mergeTicket(ticket.number, target.number, notify)
          // Der Server liefert das Ziel; hier bleibt das alte Ticket mit Hinweis auf das Ziel.
          .then(() => fetchTicket(ticket.number))
          .then((result) => {
            onSaved(result);
            setOpen(false);
            onMessage({
              kind: "status",
              text: `Das Ticket wurde in ${ticketLabel(target.number)} zusammengeführt.`,
            });
          })
          .catch((problem: unknown) =>
            onMessage({
              kind: "alert",
              text: errorText(problem, "Die Tickets konnten nicht zusammengeführt werden."),
            }),
          ),
    );

  return (
    <div className="ticket-fact">
      <details
        className="ticket-merge"
        open={open}
        onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Zusammenführen</summary>
        <p className="small">
          Verlauf in ein anderes Ticket verschieben; dieses wird geschlossen.
          <InfoTip term="tickets.zusammenfuehren" />
        </p>
        <label htmlFor={searchId}>Ticketnummer oder Betreff</label>
        <input
          id={searchId}
          type="search"
          value={search.query}
          maxLength={200}
          onChange={(event) => search.setQuery(event.target.value)}
        />
        <p className="small">
          {search.query.trim() ? "Treffer" : "Vorschläge (gleicher Melder oder ähnlicher Betreff)"}
        </p>
        {search.failed && (
          <p className="small" role="alert">
            Die Suche hat nicht geklappt.
          </p>
        )}
        <ul className="ticket-pick-list" aria-live="polite">
          {search.items.map((c) => (
            <li key={c.number}>
              <button type="button" className="button button-link" onClick={() => merge(c)}>
                {ticketLabel(c.number)} {c.subject}
              </button>
              <span className="small">
                {" "}
                · {c.reporter_name} · {STATUS_LABELS[c.status]}
              </span>
            </li>
          ))}
          {!search.failed && search.items.length === 0 && (
            <li className="small">Keine passenden Tickets.</li>
          )}
        </ul>
        <label className="check-label">
          <input
            type="checkbox"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
          />{" "}
          Melder benachrichtigen
        </label>
      </details>
      {dialog}
    </div>
  );
}

/** Zusammenfassung der noch nicht bestätigten Änderungen, z. B. „Status: A → B · Zuständig: C → D“. */
export function changeSummary(
  ticket: Ticket,
  status: TicketStatus,
  assignee: string | null,
  reminderAt = "",
): string {
  const parts: string[] = [];
  if (status !== ticket.status) {
    const when = status === "reminder" && reminderAt ? ` am ${formatDateTime(reminderAt)}` : "";
    parts.push(`Status: ${STATUS_LABELS[ticket.status]} → ${STATUS_LABELS[status]}${when}`);
  }
  if ((assignee ?? null) !== (ticket.assignee_oid ?? null)) {
    const name = (oid: string | null) =>
      oid === null ? "niemand" : (ticket.assignees.find((p) => p.oid === oid)?.name ?? "?");
    parts.push(`Zuständig: ${name(ticket.assignee_oid)} → ${name(assignee)}`);
  }
  return parts.join(" · ");
}

/** Liegt der Zeitpunkt in der Zukunft? (Leer zählt als nein.) */
export function inFuture(iso: string): boolean {
  return iso !== "" && new Date(iso).getTime() > Date.now();
}

/** Datum (JJJJ-MM-TT) und Uhrzeit (HH:MM) in Ortszeit als ISO-Zeitpunkt. */
export function reminderIso(date: string, time: string): string {
  const local = new Date(`${date}T${time || "08:00"}:00`);
  return Number.isNaN(local.getTime()) ? "" : local.toISOString();
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
  const [notifyAssignee, setNotifyAssignee] = useState(true);
  const [reminderDate, setReminderDate] = useState("");
  const [reminderTime, setReminderTime] = useState("08:00");
  const [reminderNote, setReminderNote] = useState("");
  const [busy, setBusy] = useState(false);
  const statusId = useId();
  const reminderDateId = useId();
  const reminderTimeId = useId();
  const reminderNoteId = useId();
  const assigneeId = useId();
  const noteId = useId();
  // Eigene Objekt-ID kommt vom Server (für „Mir zuweisen“)
  const meOid = ticket?.me_oid || null;

  const accept = (next: Ticket) => {
    setTicket(next);
    setStatus(next.status);
    setAssignee(next.assignee_oid);
    setNote("");
    setNotifyAssignee(true);
    setReminderDate("");
    setReminderTime("08:00");
    setReminderNote("");
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

  const reminderAt = reminderDate ? reminderIso(reminderDate, reminderTime) : "";
  const summary = ticket ? changeSummary(ticket, status, assignee, reminderAt) : "";
  const handover =
    ticket !== null &&
    assignee !== null &&
    assignee !== ticket.assignee_oid &&
    ticket.assignee_oid !== null;
  // Jemand anderes bekommt das Ticket: auf Wunsch benachrichtigen
  const assigningOther =
    ticket !== null && assignee !== null && assignee !== ticket.assignee_oid && assignee !== meOid;
  const wantsReminder = ticket !== null && status === "reminder" && status !== ticket.status;
  const reminderMissing = wantsReminder && !inFuture(reminderAt);

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
      notify_assignee: assigningOther && notifyAssignee,
      reminder_at: wantsReminder ? reminderAt : null,
      reminder_note: wantsReminder ? reminderNote.trim() : "",
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
        {ticket.anonymized_at !== null && (
          <p className="hint-box" role="note">
            Dieses Ticket wurde am {formatDateTime(ticket.anonymized_at)} nach der
            Aufbewahrungsfrist anonymisiert. Melder, Texte und Anhänge sind gelöscht.
          </p>
        )}
        {ticket.merged_into !== null && (
          <p className="hint-box" role="note">
            Zusammengeführt in{" "}
            <Link to={ticketPath(ticket.merged_into)}>{ticketLabel(ticket.merged_into)}</Link>. Neue
            Nachrichten landen dort.
          </p>
        )}
        {ticket.status === "reminder" && ticket.reminder_at && !summary && (
          <p className="small ticket-reminder-info">
            Erinnerung am {formatDateTime(ticket.reminder_at)}
            {ticket.reminder_note && ` · ${ticket.reminder_note}`}
          </p>
        )}
        {summary && (
          <div className="ticket-pending" role="status">
            <p>
              <strong>Noch nicht gespeichert:</strong> {summary}
            </p>
            {wantsReminder && (
              <div className="ticket-reminder">
                <div className="ticket-reminder-row">
                  <label htmlFor={reminderDateId}>
                    Erinnern am
                    <InfoTip term="tickets.erinnerung" />
                  </label>
                  <input
                    id={reminderDateId}
                    type="date"
                    required
                    value={reminderDate}
                    aria-invalid={reminderMissing}
                    aria-describedby={reminderMissing ? `${reminderDateId}-hint` : undefined}
                    onChange={(event) => setReminderDate(event.target.value)}
                  />
                  <label htmlFor={reminderTimeId}>um</label>
                  <input
                    id={reminderTimeId}
                    type="time"
                    value={reminderTime}
                    onChange={(event) => setReminderTime(event.target.value || "08:00")}
                  />
                </div>
                {reminderMissing && (
                  <p id={`${reminderDateId}-hint`} className="small">
                    Wähle einen Zeitpunkt in der Zukunft.
                  </p>
                )}
                <label htmlFor={reminderNoteId}>Stichwort (freiwillig)</label>
                <input
                  id={reminderNoteId}
                  type="text"
                  maxLength={200}
                  value={reminderNote}
                  onChange={(event) => setReminderNote(event.target.value)}
                />
              </div>
            )}
            {assigningOther && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={notifyAssignee}
                  onChange={(event) => setNotifyAssignee(event.target.checked)}
                />{" "}
                Person benachrichtigen
              </label>
            )}
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
                disabled={busy || reminderMissing}
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
                  setReminderDate("");
                  setReminderNote("");
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
