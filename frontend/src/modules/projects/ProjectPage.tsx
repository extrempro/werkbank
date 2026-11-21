import { InfoTip } from "../../components/InfoTip";
import { useEffect, useState } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_ITEMS_PATH, PROJECTS_PATH } from "../../navigation";
import { formatEuro } from "../budget/api";
import {
  budgetShares,
  fetchProject,
  fetchProjectBudget,
  formatDay,
  initials,
  periodText,
  PROJECT_EDITOR_ROLE,
  projectPath,
  STATUS_LABELS,
  STATUS_PILLS,
  TABS,
  type BudgetSums,
  type Person,
  type Project,
  type ProjectBudget,
  type ProjectTab,
} from "./api";
import { plainExcerpt } from "./markdown";
import { MeetingsTab } from "./ProjectMeetings";
import { SettingsTab } from "./ProjectSettings";
import { TasksTab } from "./ProjectTasks";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function money(cents: number | null): string {
  return cents === null ? "nicht hinterlegt" : formatEuro(cents);
}

/** Kennzahlen des Budgets: veranschlagt, geplant, Ist und verbleibend. */
export function BudgetKpis({ sums }: { sums: BudgetSums }) {
  const over = sums.remaining_cents !== null && sums.remaining_cents < 0;
  return (
    <dl className="kpis project-kpis">
      <div className="kpi">
        <dt>
          Veranschlagt <InfoTip term="projekte.veranschlagt" />
        </dt>
        <dd>
          <span className="kpi-number">{money(sums.budget_cents)}</span>
          <span className="small">im Projekt hinterlegt</span>
        </dd>
      </div>
      <div className="kpi">
        <dt>Geplant (ohne Rechnung)</dt>
        <dd>
          <span className="kpi-number">{formatEuro(sums.planned_cents)}</span>
          <span className="small">aus {sums.items} Budgetposten</span>
        </dd>
      </div>
      <div className="kpi">
        <dt>
          Ist (gebuchte Rechnungen) <InfoTip term="projekte.ist" />
        </dt>
        <dd>
          <span className="kpi-number">{formatEuro(sums.actual_cents)}</span>
        </dd>
      </div>
      <div className="kpi">
        <dt>Verbleibend</dt>
        <dd>
          <span className={over ? "kpi-number kpi-todo" : "kpi-number"}>
            {sums.remaining_cents === null ? "–" : formatEuro(sums.remaining_cents)}
          </span>
          <span className="small">veranschlagt − geplant − Ist</span>
        </dd>
      </div>
    </dl>
  );
}

/** Balken: Anteil von Ist und geplant am veranschlagten Budget. */
function BudgetBar({ sums }: { sums: BudgetSums }) {
  const shares = budgetShares(sums);
  if (!shares) {
    return null;
  }
  return (
    <div className="project-bar-wrap">
      <div
        className="project-bar"
        role="img"
        aria-label={`Ist ${formatEuro(sums.actual_cents)}, geplant ${formatEuro(
          sums.planned_cents,
        )} von ${money(sums.budget_cents)} veranschlagt`}
      >
        <span className="project-bar-actual" style={{ width: `${shares.actual}%` }} />
        <span className="project-bar-planned" style={{ width: `${shares.planned}%` }} />
      </div>
      <p className="small project-legend" aria-hidden="true">
        <span>
          <span className="project-swatch project-bar-actual" /> Ist
        </span>
        <span>
          <span className="project-swatch project-bar-planned" /> Geplant
        </span>
        <span>
          <span className="project-swatch project-swatch-rest" /> Verbleibend
        </span>
      </p>
    </div>
  );
}

function PeopleList({ people }: { people: Person[] }) {
  if (people.length === 0) {
    return <p className="small">Noch niemand eingetragen.</p>;
  }
  return (
    <ul className="project-people">
      {people.map((person, index) => (
        <li key={`${person.name}-${index}`}>
          <span
            className={
              person.kind === "extern" ? "project-avatar project-avatar-extern" : "project-avatar"
            }
            aria-hidden="true"
          >
            {initials(person.name)}
          </span>
          <span>
            <strong>{person.name}</strong>
            <span className="small tenant-part">
              {[person.organisation, person.role].filter(Boolean).join(" · ")}
            </span>
            {person.contact && <span className="small tenant-part">{person.contact}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function OverviewTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const internal = project.people.filter((person) => person.kind === "intern");
  const external = project.people.filter((person) => person.kind === "extern");
  const meeting = project.last_meeting;
  return (
    <>
      <BudgetKpis sums={project.budget} />
      <BudgetBar sums={project.budget} />
      <div className="project-grid">
        <section className="panel project-wide" aria-labelledby="uebersicht-offen">
          <div className="panel-head">
            <h2 id="uebersicht-offen">Offene Punkte</h2>
            <Link to={projectPath(project.id, "aufgaben")}>Alle Aufgaben</Link>
          </div>
          <div className="detail-body">
            {project.tasks.length === 0 ? (
              <p className="small">Keine offenen Punkte.</p>
            ) : (
              <ul className="project-open">
                {project.tasks.map((task) => (
                  <li key={task.id}>
                    <span>{task.text}</span>
                    <span className="small">
                      {[task.owner, task.due_on ? `bis ${formatDay(task.due_on)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {project.open_tasks > project.tasks.length && (
              <p className="small">und {project.open_tasks - project.tasks.length} weitere</p>
            )}
          </div>
        </section>
        <section className="panel" aria-labelledby="uebersicht-links">
          <div className="panel-head">
            <h2 id="uebersicht-links">Wichtige Links</h2>
            {canEdit && <Link to={projectPath(project.id, "einstellungen")}>Verwalten</Link>}
          </div>
          <div className="detail-body">
            {project.links.length === 0 ? (
              <p className="small">Noch keine Links.</p>
            ) : (
              <ul className="project-links">
                {project.links.map((link, index) => (
                  <li key={`${link.url}-${index}`}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      {link.label}
                      <span className="visually-hidden"> (neues Fenster)</span>
                    </a>
                    <span className="small mono tenant-part">{hostOf(link.url)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="panel" aria-labelledby="uebersicht-intern">
          <div className="panel-head">
            <h2 id="uebersicht-intern">Interne Ansprechpartner</h2>
          </div>
          <div className="detail-body">
            <PeopleList people={internal} />
          </div>
        </section>
        <section className="panel" aria-labelledby="uebersicht-extern">
          <div className="panel-head">
            <h2 id="uebersicht-extern">Externe Ansprechpartner</h2>
          </div>
          <div className="detail-body">
            <PeopleList people={external} />
          </div>
        </section>
        <section className="panel" aria-labelledby="uebersicht-jf">
          <div className="panel-head">
            <h2 id="uebersicht-jf">Letzter Jour Fixe</h2>
            <Link to={projectPath(project.id, "jour-fixe")}>Alle Termine</Link>
          </div>
          <div className="detail-body">
            {meeting ? (
              <>
                <p>
                  <strong>{formatDay(meeting.held_on)}</strong> · {meeting.title}
                </p>
                <ul className="small project-excerpt">
                  {plainExcerpt(meeting.body).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
                {meeting.files.length > 0 && (
                  <p className="small">
                    {meeting.files.length} {meeting.files.length === 1 ? "Anhang" : "Anhänge"}
                  </p>
                )}
              </>
            ) : (
              <p className="small">Noch kein Eintrag.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function BudgetTab({ project }: { project: Project }) {
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchProjectBudget(project.id).then(
      (result) => active && setBudget(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Das Budget konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [project.id]);

  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!budget) {
    return <p role="status">Wird geladen …</p>;
  }
  const sums = budget.sums;
  const over = sums.remaining_cents !== null && sums.remaining_cents < 0;
  return (
    <>
      <BudgetKpis sums={sums} />
      {over && (
        <p className="hint-box hint-warn" role="status">
          Geplant und Ist liegen zusammen über dem veranschlagten Budget.
        </p>
      )}
      <div className="project-grid">
        <section className="panel project-wide" aria-labelledby="budget-posten">
          <div className="panel-head">
            <h2 id="budget-posten">Budgetposten aus dem IT-Budget</h2>
          </div>
          {budget.items.length === 0 ? (
            <p className="detail-body small">
              Diesem Projekt ist noch kein Budgetposten zugeordnet.
            </p>
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Budgetposten">
              <table>
                <caption className="visually-hidden">Budgetposten des Projekts</caption>
                <thead>
                  <tr>
                    <th scope="col">Budgetposten</th>
                    <th scope="col" className="betrag">
                      Geplant
                    </th>
                    <th scope="col" className="betrag">
                      Ist
                    </th>
                    <th scope="col" className="betrag">
                      Summe
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {budget.items.map((item) => (
                    <tr key={item.id}>
                      <th scope="row">
                        {item.name}
                        {!item.active && <span className="pill pill-neutral">stillgelegt</span>}
                        <span className="small tenant-part">
                          Konto {item.account_number} {item.account_name} · {budget.year_label}{" "}
                          {item.end_year_name === item.start_year_name
                            ? item.start_year_name
                            : `${item.start_year_name} bis ${item.end_year_name ?? "auf Weiteres"}`}
                        </span>
                      </th>
                      <td className="betrag">{formatEuro(item.planned_cents)}</td>
                      <td className="betrag">{formatEuro(item.actual_cents)}</td>
                      <td className="betrag">
                        {formatEuro(item.planned_cents + item.actual_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Summe</th>
                    <td className="betrag">{formatEuro(sums.planned_cents)}</td>
                    <td className="betrag">{formatEuro(sums.actual_cents)}</td>
                    <td className="betrag">{formatEuro(sums.planned_cents + sums.actual_cents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <div className="detail-body">
            <p className="hint-box">
              <strong>So kommt ein Posten hierher:</strong> Im IT-Budget beim Budgetposten das Feld
              „Projekt“ auf dieses Projekt setzen (<Link to={BUDGET_ITEMS_PATH}>Budgetposten</Link>
              ). <strong>Geplant</strong> sind die erwarteten Kosten, für die noch keine gebuchte
              Rechnung da ist; Rechnungen „zu prüfen“ zählen noch als geplant. <strong>Ist</strong>{" "}
              sind die gebuchten Rechnungen. Alle Beträge sind brutto.
            </p>
          </div>
        </section>
        <section className="panel" aria-labelledby="budget-veranschlagt">
          <div className="panel-head">
            <h2 id="budget-veranschlagt">Veranschlagtes Budget</h2>
          </div>
          <div className="detail-body">
            <p className="kpi-number">{money(sums.budget_cents)}</p>
            <p className="small">brutto, für die ganze Laufzeit</p>
            {budget.budget_approved_on && (
              <p className="small">Freigegeben am {formatDay(budget.budget_approved_on)}</p>
            )}
            {budget.budget_note && <p className="small">{budget.budget_note}</p>}
          </div>
        </section>
        {budget.years.length > 0 && (
          <section className="panel" aria-labelledby="budget-jahre">
            <div className="panel-head">
              <h2 id="budget-jahre">Nach {budget.year_label}</h2>
            </div>
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label={`Nach ${budget.year_label}`}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">{budget.year_label}</th>
                    <th scope="col" className="betrag">
                      Geplant
                    </th>
                    <th scope="col" className="betrag">
                      Ist
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {budget.years.map((year) => (
                    <tr key={year.year}>
                      <th scope="row">{year.name}</th>
                      <td className="betrag">{formatEuro(year.planned_cents)}</td>
                      <td className="betrag">{formatEuro(year.actual_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

interface PageProps {
  projectId: number;
  tab: ProjectTab;
  roles: readonly string[];
}

/** Ein IT-Projekt mit seinen Reitern Übersicht, Budget, Jour Fixe, Aufgaben, Einstellungen. */
export function ProjectPage({ projectId, tab, roles }: PageProps) {
  const canEdit = roles.includes(PROJECT_EDITOR_ROLE);
  const [project, setProject] = useState<Project | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    fetchProject(projectId).then(
      (result) => {
        if (active) {
          setProject(result);
          setFailed(null);
        }
      },
      (error: unknown) =>
        active && setFailed(errorText(error, "Das Projekt konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [projectId, round, tab]);

  if (failed) {
    return (
      <div className="page">
        <header className="page-head">
          <p className="module-label">IT-Projekte</p>
          <h1>Projekt</h1>
        </header>
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
        <p>
          <Link to={PROJECTS_PATH}>Zu allen Projekten</Link>
        </p>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="page">
        <p role="status">Wird geladen …</p>
      </div>
    );
  }

  const tabs = TABS.filter((entry) => entry.id !== "einstellungen" || canEdit);
  const period = periodText(project.starts_on, project.ends_on);
  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">
            <Link to={PROJECTS_PATH}>IT-Projekte</Link>
          </p>
          <h1>{project.name}</h1>
          {(project.description || period) && (
            <p className="page-sub">
              {[project.description, period ? `Laufzeit ${period}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <span className={STATUS_PILLS[project.status]}>{STATUS_LABELS[project.status]}</span>
      </header>
      <nav className="project-tabs" aria-label="Bereiche des Projekts">
        {tabs.map((entry) => (
          <Link
            key={entry.id}
            to={projectPath(project.id, entry.id)}
            className={entry.id === tab ? "project-tab project-tab-on" : "project-tab"}
            aria-current={entry.id === tab ? "page" : undefined}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {tab === "uebersicht" && <OverviewTab project={project} canEdit={canEdit} />}
      {tab === "budget" && <BudgetTab project={project} />}
      {tab === "jour-fixe" && <MeetingsTab projectId={project.id} canEdit={canEdit} />}
      {tab === "aufgaben" && <TasksTab projectId={project.id} canEdit={canEdit} />}
      {tab === "einstellungen" &&
        (canEdit ? (
          <SettingsTab project={project} onSaved={() => setRound((value) => value + 1)} />
        ) : (
          <p className="hint-box">Die Einstellungen ändern nur Personen mit Bearbeitungsrecht.</p>
        ))}
    </div>
  );
}
