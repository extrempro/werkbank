import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { errorText } from "../../api";
import { fileSize } from "../budget/api";
import {
  createMeeting,
  deleteFile,
  deleteMeeting,
  fetchMeeting,
  fetchMeetings,
  FILE_MAX_MB,
  FILES_MAX,
  fileUrl,
  formatDay,
  updateMeeting,
  uploadFile,
  type Meeting,
  type MeetingSummary,
} from "./api";
import { Markdown, MarkdownEditor } from "./Markdown";
import { Feedback } from "../../components/Feedback";

const BODY_MAX = 50_000;

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type Message = { kind: "status" | "alert"; text: string } | null;

interface FormProps {
  projectId: number;
  /** null: neuer Eintrag. */
  meeting: Meeting | null;
  onSaved: (meeting: Meeting) => void;
  onCancel: () => void;
}

function MeetingForm({ projectId, meeting, onSaved, onCancel }: FormProps) {
  const id = useId();
  const [heldOn, setHeldOn] = useState(meeting?.held_on ?? today());
  const [title, setTitle] = useState(meeting?.title ?? "Jour Fixe");
  const [body, setBody] = useState(meeting?.body ?? "");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!heldOn || !title.trim()) {
      setError("Bitte trag Datum und Titel ein.");
      return;
    }
    setBusy(true);
    setError(null);
    const update = { held_on: heldOn, title: title.trim(), body };
    (meeting ? updateMeeting(projectId, meeting.id, update) : createMeeting(projectId, update))
      .then(onSaved)
      .catch((problem: unknown) => {
        setError(errorText(problem, "Der Eintrag konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  return (
    <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
      <div className="tool-row">
        <label className="narrow">
          Datum
          <input type="date" value={heldOn} onChange={(event) => setHeldOn(event.target.value)} />
        </label>
        <label className="project-grow">
          Titel
          <input
            type="text"
            value={title}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      </div>
      <div className="project-editor-head">
        <label htmlFor={`${id}-text`}>Protokoll</label>
        <div className="chips" role="group" aria-label="Ansicht des Protokolls">
          <button
            type="button"
            className="chip chip-filter"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            Bearbeiten
          </button>
          <button
            type="button"
            className="chip chip-filter"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            Vorschau
          </button>
        </div>
      </div>
      {preview ? (
        <div className="project-preview">
          <Markdown source={body} />
        </div>
      ) : (
        <MarkdownEditor
          id={`${id}-text`}
          value={body}
          onChange={setBody}
          maxLength={BODY_MAX}
          describedBy={`${id}-hilfe`}
        />
      )}
      <p className="small" id={`${id}-hilfe`}>
        Markdown: # Überschrift, - Liste, - [ ] Punkt zum Abhaken, **fett**, *kursiv*,
        [Text](https://…) für Links. Die Leiste setzt die Zeichen für dich.
      </p>
      {!meeting && <p className="small">PDF-Anhänge fügst du nach dem Speichern hinzu.</p>}
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Speichern
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

interface FilesProps {
  projectId: number;
  meeting: Meeting;
  canEdit: boolean;
  onChanged: (meeting: Meeting) => void;
}

function Files({ projectId, meeting, canEdit, onChanged }: FilesProps) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > FILE_MAX_MB * 1024 * 1024) {
      setMessage({ kind: "alert", text: `Die Datei ist größer als ${FILE_MAX_MB} MB.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    uploadFile(projectId, meeting.id, file)
      .then((result) => {
        setMessage({ kind: "status", text: `${file.name} ist angehängt.` });
        onChanged(result);
      })
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Datei konnte nicht angehängt werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const onRemove = (fileId: number, name: string) => {
    setMessage(null);
    return deleteFile(projectId, meeting.id, fileId)
      .then((result) => {
        setMessage({ kind: "status", text: `${name} ist entfernt.` });
        onChanged(result);
      })
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Der Anhang konnte nicht entfernt werden."),
        }),
      );
  };

  if (!canEdit && meeting.files.length === 0) {
    return null;
  }
  return (
    <div className="project-files">
      <h3>Anhänge</h3>
      {meeting.files.length === 0 ? (
        <p className="small">Keine Anhänge.</p>
      ) : (
        <ul className="project-file-list">
          {meeting.files.map((file) => (
            <li key={file.id}>
              <a href={fileUrl(projectId, meeting.id, file.id)} download={file.name}>
                {file.name}
              </a>
              <span className="small">PDF, {fileSize(file.size)}</span>
              {canEdit && (
                <ConfirmButton
                  className="button button-secondary"
                  aria-label={`Anhang ${file.name} entfernen`}
                  confirm={{
                    title: "Anhang entfernen?",
                    text: `${file.name} wird aus dem Jour Fixe gelöscht.`,
                    action: "Entfernen",
                    danger: true,
                  }}
                  onConfirm={() => onRemove(file.id, file.name)}
                >
                  Entfernen
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && meeting.files.length < FILES_MAX && (
        <div className="settings-form">
          <label htmlFor={`${id}-datei`}>PDF anhängen (bis {FILE_MAX_MB} MB)</label>
          <input
            id={`${id}-datei`}
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={onPick}
          />
        </div>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}

/** Jour Fixe: Einträge mit Datum, Protokoll in Markdown und PDF-Anhängen. */
export function MeetingsTab({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const [list, setList] = useState<MeetingSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new">("view");
  const [message, setMessage] = useState<Message>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    fetchMeetings(projectId).then(
      (result) => active && setList(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Einträge konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [projectId, round]);

  // Ohne Auswahl gilt der neueste Eintrag.
  const shownId = selectedId ?? list?.[0]?.id ?? null;

  useEffect(() => {
    if (shownId === null) {
      return;
    }
    let active = true;
    fetchMeeting(projectId, shownId).then(
      (result) => active && setSelected(result),
      (error: unknown) =>
        active &&
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Eintrag konnte nicht geladen werden."),
        }),
    );
    return () => {
      active = false;
    };
  }, [projectId, shownId, round]);

  const current = selected && selected.id === shownId ? selected : null;

  const onSaved = (meeting: Meeting) => {
    setMessage({
      kind: "status",
      text: `Der Eintrag vom ${formatDay(meeting.held_on)} ist gespeichert.`,
    });
    setSelectedId(meeting.id);
    setSelected(meeting);
    setMode("view");
    setRound((value) => value + 1);
  };

  const onDelete = () => {
    if (!current) {
      return;
    }
    return deleteMeeting(projectId, current.id)
      .then(() => {
        setMessage({
          kind: "status",
          text: `Der Eintrag vom ${formatDay(current.held_on)} ist gelöscht.`,
        });
        setSelectedId(null);
        setSelected(null);
        setRound((value) => value + 1);
      })
      .catch((problem: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(problem, "Der Eintrag konnte nicht gelöscht werden."),
        });
      });
  };

  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!list) {
    return <p role="status">Wird geladen …</p>;
  }

  return (
    <div className="project-split">
      <aside className="project-aside" aria-label="Einträge">
        {canEdit && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setMessage(null);
              setMode("new");
            }}
          >
            Neuer Eintrag
          </button>
        )}
        {list.length === 0 ? (
          <p className="small">Noch kein Jour Fixe eingetragen.</p>
        ) : (
          <ul className="project-meeting-list">
            {list.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={
                    entry.id === shownId && mode !== "new"
                      ? "project-meeting project-meeting-on"
                      : "project-meeting"
                  }
                  aria-current={entry.id === shownId && mode !== "new" ? "true" : undefined}
                  onClick={() => {
                    setMessage(null);
                    setMode("view");
                    setSelectedId(entry.id);
                  }}
                >
                  <strong>{formatDay(entry.held_on)}</strong>
                  <span className="small">
                    {entry.title}
                    {entry.files > 0 ? ` · ${entry.files} PDF` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="panel project-main" aria-labelledby="jf-titel">
        {mode === "new" && (
          <>
            <div className="panel-head">
              <h2 id="jf-titel">Neuer Eintrag</h2>
            </div>
            <MeetingForm
              projectId={projectId}
              meeting={null}
              onSaved={onSaved}
              onCancel={() => setMode("view")}
            />
          </>
        )}
        {mode === "edit" && current && (
          <>
            <div className="panel-head">
              <h2 id="jf-titel">Eintrag vom {formatDay(current.held_on)} bearbeiten</h2>
            </div>
            <MeetingForm
              key={current.id}
              projectId={projectId}
              meeting={current}
              onSaved={onSaved}
              onCancel={() => setMode("view")}
            />
            <div className="detail-body">
              <Files
                projectId={projectId}
                meeting={current}
                canEdit={canEdit}
                onChanged={setSelected}
              />
            </div>
          </>
        )}
        {mode === "view" && current && (
          <>
            <div className="panel-head">
              <h2 id="jf-titel">
                {formatDay(current.held_on)} · {current.title}
              </h2>
              {canEdit && (
                <div className="project-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setMessage(null);
                      setMode("edit");
                    }}
                  >
                    Bearbeiten
                  </button>
                  <ConfirmButton
                    className="button button-secondary"
                    aria-label={`Eintrag vom ${formatDay(current.held_on)} löschen`}
                    confirm={{
                      title: "Jour Fixe löschen?",
                      text: `Der Eintrag vom ${formatDay(current.held_on)} wird mit seinen Anhängen gelöscht.`,
                      action: "Löschen",
                      danger: true,
                    }}
                    onConfirm={onDelete}
                  >
                    Löschen
                  </ConfirmButton>
                </div>
              )}
            </div>
            <div className="detail-body">
              <Markdown source={current.body} />
              <Files
                projectId={projectId}
                meeting={current}
                canEdit={false}
                onChanged={setSelected}
              />
            </div>
          </>
        )}
        {mode !== "new" && !current && (
          <div className="detail-body">
            <h2 id="jf-titel" className="visually-hidden">
              Eintrag
            </h2>
            <p className="small">
              {list.length === 0
                ? "Hier erscheint das Protokoll, sobald es einen Eintrag gibt."
                : "Wird geladen …"}
            </p>
          </div>
        )}
        <Feedback message={message} onClose={() => setMessage(null)} />
      </section>
    </div>
  );
}
