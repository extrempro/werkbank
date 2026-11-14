import type { Me, Task } from "../api";
import { Link } from "../components/Link";

interface StartPageProps {
  me: Me;
  /** `null`, solange die Aufgaben noch geladen werden. */
  tasks: Task[] | null;
}

export function StartPage({ me, tasks }: StartPageProps) {
  return (
    <>
      <h1>Guten Tag, {me.display_name}</h1>
      <section className="card" aria-labelledby="aufgaben-titel">
        <h2 id="aufgaben-titel">Meine Aufgaben</h2>
        {tasks === null && <p role="status">Wird geladen …</p>}
        {tasks !== null && tasks.length === 0 && (
          <p className="empty">Keine offenen Aufgaben.</p>
        )}
        {tasks !== null && tasks.length > 0 && (
          <ul className="tasks">
            {tasks.map((task) => (
              <li key={`${task.module}-${task.title}`}>
                <span className="module-label">{task.module}</span>
                <Link to={task.link} className="task-title">
                  {task.title}
                  {task.count > 1 && ` (${task.count})`}
                </Link>
                {task.subtitle && <span className="small">{task.subtitle}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
