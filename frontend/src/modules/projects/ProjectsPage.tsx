import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { navigate } from "../../router";
import { formatEuro } from "../budget/api";
import {
  createProject,
  fetchProjects,
  filterProjects,
  formatDay,
  PROJECT_EDITOR_ROLE,
  projectPath,
  STATUS_LABELS,
  STATUS_PILLS,
  type ProjectStatus,
  type ProjectSummary,
} from "./api";

type View = "offen" | ProjectStatus | "alle";

const VIEWS: { id: View; label: string }[] = [
  { id: "offen", label: "Laufend und geplant" },
  { id: "aktiv", label: "Aktiv" },
  { id: "geplant", label: "Geplant" },
  { id: "abgeschlossen", label: "Abgeschlossen" },
  { id: "alle", label: "Alle" },
];

function money(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

/** Neues Projekt: nur das Nötigste, der Rest folgt in den Einstellungen des Projekts. */
function NewProjectForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("aktiv");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    setBusy(true);
    setError(null);
    createProject({
      name: name.trim(),
      description: description.trim(),
      status,
      starts_on: null,
      ends_on: null,
      budget_cents: null,
      budget_approved_on: null,
      budget_note: "",
      people: [],
      links: [],
    })
      .then((project) => navigate(projectPath(project.id, "einstellungen")))
      .catch((problem: unknown) => {
        setError(errorText(problem, "Das Projekt konnte nicht angelegt werden."));
        setBusy(false);
      });
  };

  return (
    <section className="panel" aria-labelledby="projekt-neu-titel">
      <div className="panel-head">
        <h2 id="projekt-neu-titel">Neues Projekt</h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label>
            Name
            <input
              type="text"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="narrow">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ProjectStatus)}
            >
              <option value="geplant">geplant</option>
              <option value="aktiv">aktiv</option>
            </select>
          </label>
        </div>
        <label>
          Kurzbeschreibung (freiwillig)
          <input
            type="text"
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p className="small">
          Rollen, Links und das veranschlagte Budget trägst du danach in den Einstellungen des
          Projekts ein.
        </p>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        <div className="project-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Projekt anlegen
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

/** IT-Projekte › Alle Projekte: Liste mit Budget, offenen Punkten und letztem Jour Fixe. */
export function ProjectsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = roles.includes(PROJECT_EDITOR_ROLE);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<View>("offen");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    fetchProjects().then(
      (result) => active && setProjects(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Projekte konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const shown = projects ? filterProjects(projects, view, query) : [];

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">IT-Projekte</p>
          <h1>Projekte</h1>
          <p className="page-sub">
            Alle IT-Projekte mit Budget, offenen Punkten und dem letzten Jour Fixe.
          </p>
        </div>
        {canEdit && !creating && (
          <button
            type="button"
            className="button button-primary"
            aria-expanded={creating}
            onClick={() => setCreating(true)}
          >
            Neues Projekt
          </button>
        )}
      </header>

      {canEdit && creating && <NewProjectForm onCancel={() => setCreating(false)} />}

      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !projects && <p role="status">Wird geladen …</p>}

      {projects && projects.length === 0 && (
        <p className="panel panel-empty">
          Es gibt noch kein Projekt.
          {canEdit ? " Lege mit „Neues Projekt“ das erste an." : ""}
        </p>
      )}

      {projects && projects.length > 0 && (
        <section className="panel" aria-labelledby="projekte-liste">
          <div className="panel-head">
            <h2 id="projekte-liste">Projekte</h2>
            <div className="chips" role="group" aria-label="Status">
              {VIEWS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="chip chip-filter"
                  aria-pressed={view === entry.id}
                  onClick={() => setView(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <div className="detail-body settings-form">
            <label className="narrow">
              Projekte suchen
              <input
                type="search"
                value={query}
                maxLength={100}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <p className="small" role="status">
              {shown.length === 0
                ? "Keine Projekte für diese Auswahl."
                : `${shown.length} von ${projects.length} Projekten`}
            </p>
          </div>
          {shown.length > 0 && (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Projektliste">
              <table>
                <caption className="visually-hidden">Projekte mit Budget und Stand</caption>
                <thead>
                  <tr>
                    <th scope="col">Projekt</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="betrag">
                      Veranschlagt
                    </th>
                    <th scope="col" className="betrag">
                      Geplant
                    </th>
                    <th scope="col" className="betrag">
                      Ist
                    </th>
                    <th scope="col">Offene Punkte</th>
                    <th scope="col">Letzter Jour Fixe</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((project) => (
                    <tr key={project.id}>
                      <th scope="row">
                        <Link to={projectPath(project.id)}>{project.name}</Link>
                        {project.description && (
                          <span className="small tenant-part">{project.description}</span>
                        )}
                      </th>
                      <td>
                        <span className={STATUS_PILLS[project.status]}>
                          {STATUS_LABELS[project.status]}
                        </span>
                      </td>
                      <td className="betrag">{money(project.budget.budget_cents)}</td>
                      <td className="betrag">{formatEuro(project.budget.planned_cents)}</td>
                      <td className="betrag">{formatEuro(project.budget.actual_cents)}</td>
                      <td>{project.open_tasks}</td>
                      <td>{formatDay(project.last_meeting_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="hint-box">
        Geplant und Ist kommen aus dem IT-Budget: Jeder Budgetposten, bei dem ein Projekt ausgewählt
        ist, zählt dort mit. Das veranschlagte Budget pflegst du im Projekt selbst.
      </p>
    </div>
  );
}
