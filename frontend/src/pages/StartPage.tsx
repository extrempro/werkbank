import type { Me, Task } from "../api";
import { Link } from "../components/Link";
import { greeting } from "../user";
import { ModuleTiles } from "./ModuleTiles";
import { RecentActivity } from "./RecentActivity";

interface StartPageProps {
  me: Me;
  /** `null`, solange die Aufgaben noch geladen werden. */
  tasks: Task[] | null;
  /** Nur für Tests: fester Zeitpunkt statt der aktuellen Uhrzeit. */
  now?: Date;
}

function moduleClass(module: string): string {
  if (module.startsWith("M365")) {
    return "module-tag module-tag-m365";
  }
  return module === "Evergreen" ? "module-tag module-tag-evergreen" : "module-tag";
}

function summary(tasks: Task[] | null): string {
  if (tasks === null) {
    return "";
  }
  const total = tasks.reduce((sum, task) => sum + task.count, 0);
  if (total === 0) {
    return " · keine offenen Aufgaben";
  }
  return total === 1 ? " · 1 offene Aufgabe" : ` · ${total} offene Aufgaben`;
}

export function StartPage({ me, tasks, now = new Date() }: StartPageProps) {
  const date = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <div className="start">
      <header className="page-head">
        <h1>
          {greeting(now)}, {me.display_name}
        </h1>
        <p className="page-sub">
          {date}
          {summary(tasks)}
        </p>
      </header>
      <div className="start-columns">
        <section className="panel start-tasks" aria-labelledby="aufgaben-titel">
          <div className="panel-head">
            <h2 id="aufgaben-titel">Meine Aufgaben</h2>
            <span className="small">aus allen Modulen</span>
          </div>
          {tasks === null && (
            <p role="status" className="panel-empty">
              Wird geladen …
            </p>
          )}
          {tasks !== null && tasks.length === 0 && (
            <p className="panel-empty">Keine offenen Aufgaben.</p>
          )}
          {tasks !== null && tasks.length > 0 && (
            <ul className="tasks">
              {tasks.map((task) => (
                <li key={`${task.module}-${task.title}`}>
                  <span className={moduleClass(task.module)}>{task.module}</span>
                  <span className="task-text">
                    <Link to={task.link} className="task-title">
                      {task.title}
                      {task.count > 1 && ` (${task.count})`}
                    </Link>
                    {task.subtitle && <span className="small">{task.subtitle}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <ModuleTiles roles={me.roles} />
        <RecentActivity />
      </div>
    </div>
  );
}
