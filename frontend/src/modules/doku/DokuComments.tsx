import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Editor } from "@tiptap/react";
import { errorText, formatDateTime } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import type { FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import {
  createThread,
  deleteComment,
  fetchMentionable,
  fetchThreads,
  replyThread,
  resolveThread,
  type DokuThread,
  type Mentionable,
} from "./api";
import { anchorFromSelection, anchorRange, type Anchor } from "./commentMarks";

/** So oft holt die Seite neue Kommentare anderer Personen. */
const POLL_MS = 30_000;

/** Erwähnte Personen, deren „@Name“ noch im Text steht. */
export function mentionsIn(text: string, chosen: Map<string, string>): string[] {
  return [...chosen.entries()].filter(([, name]) => text.includes(`@${name}`)).map(([oid]) => oid);
}

/** Text der laufenden Erwähnung am Ende („@ma“ → „ma“); null, wenn gerade keine läuft. */
export function mentionQuery(text: string): string | null {
  const match = /(?:^|\s)@([^\s@]{0,30})$/.exec(text);
  return match ? (match[1] ?? "") : null;
}

/** Textfeld mit Vorschlägen für @-Erwähnungen (nur Personen, die die Seite lesen dürfen). */
function MentionField({
  pageId,
  label,
  value,
  onChange,
  chosen,
  autoFocus,
}: {
  pageId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  chosen: Map<string, string>;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [people, setPeople] = useState<Mentionable[]>([]);
  const query = mentionQuery(value);
  useEffect(() => {
    if (query === null) {
      return undefined;
    }
    let active = true;
    const wait = window.setTimeout(() => {
      fetchMentionable(pageId, query).then(
        (found) => active && setPeople(found),
        () => active && setPeople([]),
      );
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(wait);
    };
  }, [pageId, query]);
  const pick = (person: Mentionable) => {
    chosen.set(person.oid, person.name);
    onChange(value.replace(/@([^\s@]{0,30})$/, `@${person.name} `));
  };
  return (
    <div className="doku-mention">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={3}
        value={value}
        maxLength={2000}
        autoFocus={autoFocus}
        placeholder="Mit @ erwähnst du jemanden"
        aria-describedby={`${id}-hinweis`}
        onChange={(event) => onChange(event.target.value)}
      />
      {query !== null && people.length > 0 && (
        <ul className="doku-mention-list" aria-label="Personen erwähnen">
          {people.map((person) => (
            <li key={person.oid}>
              <button type="button" onClick={() => pick(person)}>
                {person.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p id={`${id}-hinweis`} className="small">
        Erwähnte Personen bekommen eine Benachrichtigung ohne Inhalt.
      </p>
    </div>
  );
}

function CommentForm({
  pageId,
  label,
  action,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  pageId: string;
  label: string;
  action: string;
  autoFocus?: boolean;
  onSubmit: (text: string, mentions: string[]) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Gewählte Erwähnungen (Objekt-ID → Name); dieselbe Map über die ganze Lebensdauer
  const [chosen] = useState(() => new Map<string, string>());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) {
      return;
    }
    setBusy(true);
    onSubmit(value, mentionsIn(value, chosen))
      .then(() => {
        setText("");
        chosen.clear();
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <form className="doku-comment-form" onSubmit={submit}>
      <MentionField
        pageId={pageId}
        label={label}
        value={text}
        onChange={setText}
        chosen={chosen}
        autoFocus={autoFocus}
      />
      <div className="doku-comment-actions">
        <button type="submit" className="button button-primary" disabled={busy || !text.trim()}>
          {action}
        </button>
        {onCancel && (
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Kommentare der Seite: an Textstellen, mit Antworten, Erwähnungen und „Erledigt“.
 * Kommentieren darf jede Person, die die Seite lesen darf (nicht in archivierten Bereichen).
 */
export function DokuComments({
  pageId,
  editor,
  canComment,
  activeId,
  onActive,
  onThreads,
  onFeedback,
}: {
  pageId: string;
  editor: Editor | null;
  canComment: boolean;
  activeId: string | null;
  onActive: (id: string | null) => void;
  onThreads: (threads: DokuThread[]) => void;
  onFeedback: (message: FeedbackMessage) => void;
}) {
  const [threads, setThreads] = useState<DokuThread[] | null>(null);
  const [view, setView] = useState<"offen" | "erledigt">("offen");
  const [draft, setDraft] = useState<{ anchor: Anchor; quote: string } | null>(null);
  const [, setTick] = useState(0);
  const [ask, dialog] = useConfirm();
  const report = useRef(onThreads);
  useEffect(() => {
    report.current = onThreads;
  }, [onThreads]);

  const load = useCallback(() => {
    fetchThreads(pageId).then(
      (found) => {
        setThreads(found);
        report.current(found);
      },
      () => undefined,
    );
  }, [pageId]);
  useEffect(() => {
    load();
    const every = window.setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(every);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  // „Kommentieren“ nur mit markiertem Text: bei Änderung der Auswahl neu zeichnen
  useEffect(() => {
    if (!editor) {
      return undefined;
    }
    const update = () => setTick((tick) => tick + 1);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  const replace = (thread: DokuThread) => {
    const next = (threads ?? []).some((t) => t.id === thread.id)
      ? (threads ?? []).map((t) => (t.id === thread.id ? thread : t))
      : [...(threads ?? []), thread];
    setThreads(next);
    report.current(next);
  };
  const fail = (fallback: string) => (problem: unknown) => {
    onFeedback({ kind: "alert", text: errorText(problem, fallback) });
    throw problem;
  };

  const selection = editor && !editor.isDestroyed ? anchorFromSelection(editor) : null;
  const shown = (threads ?? []).filter((t) => (view === "offen" ? !t.resolved_at : t.resolved_at));
  const open = (threads ?? []).filter((t) => !t.resolved_at).length;

  const jump = (thread: DokuThread) => {
    onActive(thread.id);
    if (!editor || editor.isDestroyed || !thread.anchor) {
      return;
    }
    const range = anchorRange(editor.state, thread.anchor);
    if (range) {
      editor.commands.setTextSelection(range.from);
      editor.commands.scrollIntoView();
    }
  };

  return (
    <section className="panel doku-side-panel doku-comments" aria-labelledby="doku-kommentare">
      <div className="doku-comments-head">
        <h2 id="doku-kommentare">
          Kommentare <InfoTip term="doku.kommentare" />
        </h2>
        {canComment && (
          <button
            type="button"
            className="button button-secondary"
            disabled={!selection}
            title={selection ? undefined : "Markiere zuerst Text auf der Seite."}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selection && setDraft(selection)}
          >
            Kommentieren
          </button>
        )}
      </div>
      {canComment && !selection && !draft && (
        <p className="small">Markiere Text auf der Seite, um ihn zu kommentieren.</p>
      )}
      {draft && (
        <div className="doku-thread doku-thread-new">
          <p className="doku-thread-quote">„{draft.quote}“</p>
          <CommentForm
            pageId={pageId}
            label="Neuer Kommentar"
            action="Kommentar speichern"
            autoFocus
            onCancel={() => setDraft(null)}
            onSubmit={(text, mentions) =>
              createThread(pageId, { ...draft, text, mentions }).then((thread) => {
                replace(thread);
                setDraft(null);
                setView("offen");
                onActive(thread.id);
                onFeedback({ kind: "status", text: "Der Kommentar ist gespeichert." });
              }, fail("Der Kommentar konnte nicht gespeichert werden."))
            }
          />
        </div>
      )}
      <div className="chips" role="group" aria-label="Kommentare filtern">
        <button
          type="button"
          className="chip chip-filter"
          aria-pressed={view === "offen"}
          onClick={() => setView("offen")}
        >
          Offen · {open}
        </button>
        <button
          type="button"
          className="chip chip-filter"
          aria-pressed={view === "erledigt"}
          onClick={() => setView("erledigt")}
        >
          Erledigt · {(threads ?? []).length - open}
        </button>
      </div>
      {threads === null && (
        <p className="small" role="status">
          Wird geladen …
        </p>
      )}
      {threads !== null && shown.length === 0 && (
        <p className="small">
          {view === "offen" ? "Keine offenen Kommentare." : "Keine erledigten Kommentare."}
        </p>
      )}
      <ul className="doku-threads">
        {shown.map((thread) => {
          const active = thread.id === activeId;
          const found = editor && thread.anchor ? anchorRange(editor.state, thread.anchor) : null;
          return (
            <li key={thread.id}>
              <article
                className={active ? "doku-thread doku-thread-active" : "doku-thread"}
                aria-label={`Kommentar zu „${thread.quote}“`}
              >
                <button type="button" className="doku-thread-quote" onClick={() => jump(thread)}>
                  „{thread.quote || "…"}“
                  {editor && !found && <span className="small"> (Textstelle nicht mehr da)</span>}
                </button>
                <ol className="doku-thread-posts">
                  {thread.comments.map((comment) => (
                    <li key={comment.id}>
                      <p className="small">
                        <strong>{comment.author_name}</strong> ·{" "}
                        {formatDateTime(comment.created_at)}
                        {comment.own && canComment && (
                          <button
                            type="button"
                            className="button-link doku-comment-delete"
                            onClick={() =>
                              ask(
                                {
                                  title: "Kommentar löschen?",
                                  text: "Dein Beitrag wird gelöscht. War es der einzige, verschwindet der ganze Kommentar.",
                                  action: "Löschen",
                                  danger: true,
                                },
                                () =>
                                  deleteComment(comment.id).then(() => {
                                    load();
                                    onFeedback({
                                      kind: "status",
                                      text: "Der Kommentar ist gelöscht.",
                                    });
                                  }, fail("Der Kommentar konnte nicht gelöscht werden.")),
                              )
                            }
                          >
                            Löschen
                          </button>
                        )}
                      </p>
                      <p className="doku-comment-text">{comment.text}</p>
                    </li>
                  ))}
                </ol>
                {thread.resolved_at && (
                  <p className="small">
                    Erledigt von {thread.resolved_by_name} am {formatDateTime(thread.resolved_at)}
                  </p>
                )}
                {canComment && !active && (
                  <button type="button" className="button-link" onClick={() => jump(thread)}>
                    Antworten
                  </button>
                )}
                {canComment && active && (
                  <>
                    {!thread.resolved_at && (
                      <CommentForm
                        pageId={pageId}
                        label="Antwort"
                        action="Antworten"
                        onSubmit={(text, mentions) =>
                          replyThread(thread.id, { text, mentions }).then(
                            replace,
                            fail("Die Antwort konnte nicht gespeichert werden."),
                          )
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        resolveThread(thread.id, !thread.resolved_at)
                          .then((next) => {
                            replace(next);
                            onFeedback({
                              kind: "status",
                              text: next.resolved_at
                                ? "Der Kommentar ist erledigt."
                                : "Der Kommentar ist wieder offen.",
                            });
                          }, fail("Das hat nicht geklappt."))
                          .catch(() => undefined)
                      }
                    >
                      {thread.resolved_at ? "Wieder öffnen" : "Erledigt"}
                    </button>
                  </>
                )}
              </article>
            </li>
          );
        })}
      </ul>
      {dialog}
    </section>
  );
}
