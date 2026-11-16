import { useEffect, useState } from "react";
import { formatDateTime } from "../../api";
import { HealthCharts } from "./HealthCharts";
import {
  adminCenterUrl,
  fetchHealth,
  fetchIssue,
  HEALTH_LEVEL,
  healthLevel,
  healthStatusText,
  issueKind,
  type Health,
  type ServiceIssue,
  type ServiceIssueDetail,
} from "./api";

/** Kennung einer Meldung aus der Adresse (…#EX123456); Unbrauchbares ergibt nichts. */
function hashTarget(): string {
  const raw = window.location.hash.slice(1);
  return /^[A-Za-z0-9-]{1,32}$/.test(raw) ? raw : "";
}

const HOURS = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function duration(issue: ServiceIssue): string {
  if (!issue.start_at) {
    return "–";
  }
  const end = issue.end_at ? new Date(issue.end_at) : new Date();
  const hours = Math.max(end.getTime() - new Date(issue.start_at).getTime(), 0) / 3_600_000;
  return hours < 48 ? `${HOURS.format(hours)} Std.` : `${HOURS.format(hours / 24)} Tage`;
}

/** Eine Störung oder ein Hinweis; aufgeklappt mit den Mitteilungen von Microsoft. */
function IssueRow({ issue, initiallyOpen }: { issue: ServiceIssue; initiallyOpen: boolean }) {
  const [detail, setDetail] = useState<ServiceIssueDetail | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    if (detail || failed) {
      return;
    }
    fetchIssue(issue.issue_id).then(setDetail, () => setFailed(true));
  };

  return (
    <li id={issue.issue_id}>
      <details
        className="budget-more"
        open={initiallyOpen || undefined}
        onToggle={(event) => event.currentTarget.open && load()}
      >
        <summary>
          <span
            className={
              issue.classification === "incident" && !issue.resolved
                ? "pill pill-bad"
                : "pill pill-neutral"
            }
          >
            {issueKind(issue.classification)}
          </span>{" "}
          <strong>{issue.service_name}</strong> · {issue.title}
          <span className="small">
            {" "}
            · {issue.issue_id} · seit {formatDateTime(issue.start_at)}
            {issue.end_at && ` bis ${formatDateTime(issue.end_at)}`} · {duration(issue)} ·{" "}
            {healthStatusText(issue.status)}
          </span>
        </summary>
        <div className="budget-more-body">
          {issue.impact && <p>{issue.impact}</p>}
          {(issue.feature_group || issue.feature) && (
            <p className="small">
              Betroffen: {[issue.feature_group, issue.feature].filter(Boolean).join(" › ")}
            </p>
          )}
          <p className="small">Zuletzt aktualisiert: {formatDateTime(issue.modified_at)}</p>
          <p className="health-issue-link">
            <a href={adminCenterUrl(issue.issue_id)} target="_blank" rel="noopener noreferrer">
              {issue.issue_id} im Microsoft 365 Admin Center öffnen
              <span className="visually-hidden"> (neues Fenster, Anmeldung nötig)</span>
            </a>
          </p>
          {failed && (
            <p role="alert" className="hint-box hint-bad">
              Die Mitteilungen konnten nicht geladen werden.
            </p>
          )}
          {!detail && !failed && <p className="small">Mitteilungen werden geladen …</p>}
          {detail && detail.posts.length === 0 && (
            <p className="small">Microsoft hat noch keine Mitteilung dazu veröffentlicht.</p>
          )}
          {detail && detail.posts.length > 0 && (
            <ol className="health-posts">
              {[...detail.posts].reverse().map((post, index) => (
                <li key={`${post.at ?? ""}-${index}`}>
                  <p className="small">{formatDateTime(post.at)}</p>
                  <p className="health-post">{post.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </li>
  );
}

/** Microsoft 365 › Tenant › Dienststatus: Zustand der wichtigen Dienste und ihre Störungen. */
export function HealthPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  // Aus einer Benachrichtigung: …/dienststatus#EX123456 öffnet genau diese Meldung
  const [target, setTarget] = useState(hashTarget);

  useEffect(() => {
    let active = true;
    fetchHealth()
      .then((result) => {
        if (active) {
          setHealth(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    const onNavigate = () => setTarget(hashTarget());
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("werkbank:navigate", onNavigate);
    return () => {
      active = false;
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("werkbank:navigate", onNavigate);
    };
  }, []);

  // Sobald die Meldung da ist: dorthin springen
  useEffect(() => {
    if (health && target) {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }
  }, [health, target]);

  const years = [...new Set(health?.stats.map((entry) => entry.year) ?? [])];
  const serviceNames = [
    ...new Map(health?.stats.map((entry) => [entry.service_id, entry.service_name])).entries(),
  ];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">Microsoft 365 › Tenant</p>
        <h1>Dienststatus</h1>
        <p className="page-sub">
          Zustand von Exchange Online, Microsoft Teams, SharePoint Online und Microsoft Entra laut
          Microsoft, mit Störungen und Hinweisen. Die Werkbank fragt alle 15 Minuten nach.
          {health?.fetched_at && ` Stand: ${formatDateTime(health.fetched_at)}.`}
        </p>
      </header>

      {failed && (
        <p role="alert" className="panel panel-empty">
          Der Dienststatus konnte nicht geladen werden.
        </p>
      )}
      {!failed && !health && <p role="status">Wird geladen …</p>}
      {health && health.services.length === 0 && (
        <p className="panel panel-empty">
          {health.enabled
            ? "Der Dienststatus wurde noch nicht gelesen. Der erste Abruf läuft wenige Minuten nach dem Einschalten."
            : "Der Abruf des Dienststatus ist in dieser Installation nicht eingeschaltet (siehe Anleitung zur Einrichtung)."}
        </p>
      )}
      {health && health.services.length > 0 && (
        <>
          <dl className="kpis">
            {health.services.map((service) => {
              const level = HEALTH_LEVEL[healthLevel(service.status)];
              return (
                <div key={service.service_id} className={level.kpi}>
                  <dt>{service.name}</dt>
                  <dd className="kpi-number">{level.label}</dd>
                  <dd className="small">
                    {healthStatusText(service.status)}
                    {service.open_incidents > 0 &&
                      ` · ${service.open_incidents} ${service.open_incidents === 1 ? "Störung" : "Störungen"}`}
                    {service.open_advisories > 0 &&
                      ` · ${service.open_advisories} ${service.open_advisories === 1 ? "Hinweis" : "Hinweise"}`}
                  </dd>
                </div>
              );
            })}
          </dl>

          <section className="panel" aria-labelledby="health-offen">
            <div className="panel-head">
              <h2 id="health-offen">Offene Störungen und Hinweise</h2>
              <span className="small">{health.open.length}</span>
            </div>
            {health.open.length === 0 ? (
              <p className="detail-body">Zurzeit meldet Microsoft nichts zu diesen Diensten.</p>
            ) : (
              <ul className="detail-body health-issues">
                {health.open.map((issue) => (
                  <IssueRow
                    key={`${issue.issue_id}-${target === issue.issue_id}`}
                    issue={issue}
                    initiallyOpen={target === issue.issue_id}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="health-beendet">
            <div className="panel-head">
              <h2 id="health-beendet">In den letzten 30 Tagen beendet</h2>
              <span className="small">{health.recent.length}</span>
            </div>
            {health.recent.length === 0 ? (
              <p className="detail-body">Keine.</p>
            ) : (
              <ul className="detail-body health-issues">
                {health.recent.map((issue) => (
                  <IssueRow
                    key={`${issue.issue_id}-${target === issue.issue_id}`}
                    issue={issue}
                    initiallyOpen={target === issue.issue_id}
                  />
                ))}
              </ul>
            )}
          </section>

          <HealthCharts health={health} />

          <section className="panel" aria-labelledby="health-auswertung">
            <div className="panel-head">
              <h2 id="health-auswertung">Ausfälle je Dienst und Jahr</h2>
              <span className="small">nach Jahr des Beginns</span>
            </div>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Ausfälle je Dienst">
              <table>
                <caption className="visually-hidden">
                  Störungen, Stunden mit Störung und Hinweise je Dienst und Jahr
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Dienst</th>
                    {years.map((year) => (
                      <th key={year} scope="col" className="betrag">
                        {year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {serviceNames.map(([serviceId, name]) => (
                    <tr key={serviceId}>
                      <th scope="row">{name}</th>
                      {years.map((year) => {
                        const entry = health.stats.find(
                          (stat) => stat.year === year && stat.service_id === serviceId,
                        );
                        return (
                          <td key={year} className="betrag">
                            {entry
                              ? `${entry.incidents} Störungen, ${HOURS.format(entry.incident_hours)} Std. · ${entry.advisories} Hinweise`
                              : "–"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="detail-body small">
              Gezählt wird, was Microsoft seit dem Einschalten des Abrufs gemeldet hat. Die Werkbank
              bewahrt Störungen und Hinweise drei Jahre auf.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
