import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import {
  createTask,
  deleteTask,
  fetchTasks,
  formatDay,
  updateTask,
  type Task,
  type TaskUpdate,
} from "./api";

function asUpdate(task: Task, done: boolean): TaskUpdate {
  return { text: task.text, owner: task.owner, due_on: task.due_on, done };
}

/** Grobe Aufgabenliste: nur zur Orientierung, die eigentlichen Aufgaben laufen woanders. */
export function TasksTab({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    fetchTasks(projectId).then(
      (result) => active && setTasks(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Aufgaben konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [projectId, round]);

  const reload = () => setRound((value) => value + 1);

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) {
      setMessage({ kind: "alert", text: "Bitte eine Aufgabe eintragen." });
      return;
    }
    setBusy(true);
    setMessage(null);
    createTask(projectId, {
      text: text.trim(),
      owner: owner.trim(),
      due_on: due || null,
      done: false,
    })
      .then(() => {
        setText("");
        setOwner("");
        setDue("");
        setMessage({ kind: "status", text: "Die Aufgabe ist hinzugefügt." });
        reload();
      })
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Aufgabe konnte nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const onToggle = (task: Task) => {
    setMessage(null);
    updateTask(projectId, task.id, asUpdate(task, !task.done))
      .then(reload)
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Aufgabe konnte nicht geändert werden."),
        }),
      );
  };

  const onDelete = (task: Task) => {
    setMessage(null);
    deleteTask(projectId, task.id)
      .then(() => {
        setMessage({ kind: "status", text: `„${task.text}“ ist gelöscht.` });
        reload();
      })
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Aufgabe konnte nicht gelöscht werden."),
        }),
      );
  };

  const shown = (tasks ?? []).filter((task) => showDone || !task.done);
  const doneCount = (tasks ?? []).filter((task) => task.done).length;

  return (
    <section className="panel project-narrow" aria-labelledby="aufgaben-titel">
      <div className="panel-head">
        <h2 id="aufgaben-titel">Aufgaben</h2>
        <div className="chips" role="group" aria-label="Anzeige">
          <button
            type="button"
            className="chip chip-filter"
            aria-pressed={!showDone}
            onClick={() => setShowDone(false)}
          >
            Offen
          </button>
          <button
            type="button"
            className="chip chip-filter"
            aria-pressed={showDone}
            onClick={() => setShowDone(true)}
          >
            Alle{doneCount > 0 ? ` (${doneCount} erledigt)` : ""}
          </button>
        </div>
      </div>
      <div className="detail-body">
        <p className="small">
          Nur zur groben Orientierung. Die eigentlichen Aufgaben laufen in der Regel in anderen
          Werkzeugen.
        </p>
        {canEdit && (
          <form className="settings-form" onSubmit={onAdd} noValidate>
            <div className="tool-row">
              <label className="project-grow">
                Neue Aufgabe
                <input
                  type="text"
                  value={text}
                  maxLength={300}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <label className="narrow">
                Zuständig (freiwillig)
                <input
                  type="text"
                  value={owner}
                  maxLength={120}
                  onChange={(event) => setOwner(event.target.value)}
                />
              </label>
              <label className="narrow">
                Bis (freiwillig)
                <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
              </label>
              <button type="submit" className="button button-primary" disabled={busy}>
                Hinzufügen
              </button>
            </div>
          </form>
        )}
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "small"}
          >
            {message.text}
          </p>
        )}
        {failed && (
          <p role="alert" className="hint-box hint-bad">
            {failed}
          </p>
        )}
        {!failed && !tasks && <p role="status">Wird geladen …</p>}
        {tasks && shown.length === 0 && (
          <p className="small">
            {tasks.length === 0 ? "Noch keine Aufgaben." : "Keine offenen Aufgaben."}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="project-tasks">
            {shown.map((task) => (
              <li key={task.id} className={task.done ? "project-task-done" : undefined}>
                {canEdit ? (
                  <label className="check-label project-task-text">
                    <input type="checkbox" checked={task.done} onChange={() => onToggle(task)} />
                    <span>{task.text}</span>
                  </label>
                ) : (
                  <span className="project-task-text">
                    {task.done && <span className="visually-hidden">erledigt: </span>}
                    {task.text}
                  </span>
                )}
                <span className="small">
                  {[task.owner, task.due_on ? `bis ${formatDay(task.due_on)}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-label={`Aufgabe ${task.text} löschen`}
                    onClick={() => onDelete(task)}
                  >
                    Löschen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
