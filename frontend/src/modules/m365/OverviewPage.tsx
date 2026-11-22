import { InfoTip } from "../../components/InfoTip";
import { useEffect, useState } from "react";
import { ApiError, formatDateTime, type Me } from "../../api";
import { Link } from "../../components/Link";
import {
  fetchChanges,
  fetchOverview,
  kindLabel,
  settingTitle,
  snapshotLabel,
  startCollect,
  statusClass,
  statusLabel,
  workloadLabel,
  type Change,
  type Overview,
} from "./api";
import { ChangesChart } from "./ChangesChart";
import { Feedback } from "../../components/Feedback";

interface OverviewPageProps {
  me: Me;
}

const numbers = new Intl.NumberFormat("de-DE");

export function OverviewPage({ me }: OverviewPageProps) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recent, setRecent] = useState<Change[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const isAdmin = me.roles.includes("Werkbank.Admin");

  useEffect(() => {
    let active = true;
    fetchOverview()
      .then((result) => {
        if (active) {
          setOverview(result);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });
    fetchChanges("", 0, 6)
      .then((page) => {
        if (active && Array.isArray(page.entries)) {
          setRecent(page.entries);
        }
      })
      .catch(() => {
        // Ohne Liste bleibt der Bereich leer; die Kennzahlen stehen trotzdem.
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const onCollect = () => {
    setMessage(null);
    startCollect()
      .then((result) => {
        setMessage({
          kind: "status",
          text: result.queued
            ? "Der Abruf ist angestoßen. Das Ergebnis erscheint in einigen Minuten unter Snapshots."
            : "Es läuft bereits ein Abruf.",
        });
        setReloadKey((key) => key + 1);
      })
      .catch((error: unknown) => {
        const detail = error instanceof ApiError ? error.detail : null;
        setMessage({ kind: "alert", text: detail ?? "Der Abruf konnte nicht angestoßen werden." });
      });
  };

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">M365-Konfiguration</p>
        <h1>Übersicht</h1>
        <p className="page-sub">Einstellungen des Tenants, ihr Verlauf und erkannte Änderungen.</p>
      </header>

      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "error" && <p role="alert">Die Übersicht konnte nicht geladen werden.</p>}
      {status === "ready" && overview && (
        <>
          {!overview.collector_configured && (
            <p className="hint-box hint-warn">
              Der Abruf aus dem Tenant ist noch nicht eingerichtet. Solange erscheinen hier keine
              Einstellungen.
            </p>
          )}

          <dl className="kpis">
            <div className="kpi">
              <dt>Offene Änderungen</dt>
              <dd>
                <span className={overview.open_changes > 0 ? "kpi-number kpi-todo" : "kpi-number"}>
                  {numbers.format(overview.open_changes)}
                </span>
                <span className="small">
                  davon kritisch: {numbers.format(overview.open_critical)}
                </span>
                <Link to="/m365/aenderungen">Änderungen ansehen</Link>
              </dd>
            </div>
            <div className="kpi">
              <dt>Letzte 7 Tage</dt>
              <dd>
                <span className="kpi-number">{numbers.format(overview.changes_last_7_days)}</span>
                <span className="small">erkannte Änderungen</span>
              </dd>
            </div>
            <div className="kpi">
              <dt>Letzte 30 Tage</dt>
              <dd>
                <span className="kpi-number">{numbers.format(overview.changes_last_30_days)}</span>
                <span className="small">erkannte Änderungen</span>
              </dd>
            </div>
            <div className="kpi">
              <dt>
                Überwachte Einstellungen <InfoTip term="m365.ueberwacht" />
              </dt>
              <dd>
                <span className="kpi-number">{numbers.format(overview.settings_total)}</span>
                <span className="small">
                  davon beschrieben: {numbers.format(overview.described_total)}
                </span>
                <Link to="/m365/einstellungen">Einstellungen ansehen</Link>
              </dd>
            </div>
          </dl>

          <div className="overview-columns">
            <ChangesChart days={overview.changes_per_day ?? []} />

            <section className="panel" aria-labelledby="letzte-titel">
              <div className="panel-head">
                <h2 id="letzte-titel">Letzte Änderungen</h2>
                <Link to="/m365/aenderungen">Alle Änderungen</Link>
              </div>
              {recent.length === 0 ? (
                <p className="panel-empty">Noch keine Änderungen erkannt.</p>
              ) : (
                <ul className="rows">
                  {recent.map((change) => (
                    <li key={change.id}>
                      <span className="row-main">
                        <Link to={`/m365/einstellungen/${change.setting_id}`} className="row-title">
                          {settingTitle(change)}
                        </Link>
                        <span className="small">
                          {workloadLabel(change.workload)} · {kindLabel(change.kind)} ·{" "}
                          {formatDateTime(change.detected_at)}
                        </span>
                      </span>
                      <span className={statusClass(change.status)}>
                        {statusLabel(change.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <dl className="facts panel">
            <div>
              <dt>
                Abweichungen vom Soll-Wert <InfoTip term="m365.abweichung" />
              </dt>
              <dd>{numbers.format(overview.deviations)}</dd>
            </div>
            <div>
              <dt>Letzter Abruf</dt>
              <dd>
                {overview.last_snapshot
                  ? `${snapshotLabel(overview.last_snapshot.status)}, ${formatDateTime(overview.last_snapshot.started_at)}`
                  : "Noch keiner"}
              </dd>
            </div>
            <div>
              <dt>
                Gelesene Objekte in diesem Monat <InfoTip term="m365.objekte" />
              </dt>
              <dd>
                {numbers.format(overview.resources_this_month)} von höchstens{" "}
                {numbers.format(overview.monthly_limit)} (Grenze von Microsoft)
              </dd>
            </div>
          </dl>

          {isAdmin && overview.collector_configured && (
            <p>
              <button
                type="button"
                className="button button-secondary"
                onClick={onCollect}
                disabled={overview.collect_pending}
              >
                Jetzt abrufen
              </button>
              {overview.collect_pending && <span className="small"> Ein Abruf läuft gerade.</span>}
            </p>
          )}
          <Feedback message={message} onClose={() => setMessage(null)} />
        </>
      )}
    </div>
  );
}
