import { useEffect, useState } from "react";
import { ApiError, formatDateTime, type Me } from "../../api";
import { Link } from "../../components/Link";
import { fetchOverview, snapshotLabel, startCollect, type Overview } from "./api";

interface OverviewPageProps {
  me: Me;
}

const numbers = new Intl.NumberFormat("de-DE");

export function OverviewPage({ me }: OverviewPageProps) {
  const [overview, setOverview] = useState<Overview | null>(null);
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
    <>
      <p className="module-label">M365-Konfiguration</p>
      <h1>Übersicht</h1>
      <p className="lead">Einstellungen des Tenants, ihr Verlauf und erkannte Änderungen.</p>

      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "error" && <p role="alert">Die Übersicht konnte nicht geladen werden.</p>}
      {status === "ready" && overview && (
        <>
          {!overview.collector_configured && (
            <p className="note card">
              Der Abruf aus dem Tenant ist noch nicht eingerichtet. Solange erscheinen hier keine
              Einstellungen.
            </p>
          )}
          <dl className="stats">
            <div className="card">
              <dt>Offene Änderungen</dt>
              <dd>
                <span className="stat-number">{numbers.format(overview.open_changes)}</span>
                <Link to="/m365/aenderungen">Änderungen ansehen</Link>
              </dd>
            </div>
            <div className="card">
              <dt>Abweichungen vom Soll-Wert</dt>
              <dd>
                <span className="stat-number">{numbers.format(overview.deviations)}</span>
                <span className="small">
                  In den Einstellungen mit „Nur Abweichungen vom Soll-Wert“ filtern
                </span>
              </dd>
            </div>
            <div className="card">
              <dt>Einstellungen</dt>
              <dd>
                <span className="stat-number">{numbers.format(overview.settings_total)}</span>
                <Link to="/m365/einstellungen">Einstellungen ansehen</Link>
              </dd>
            </div>
            <div className="card">
              <dt>Letzter Abruf</dt>
              <dd>
                <span className="stat-number">
                  {overview.last_snapshot
                    ? snapshotLabel(overview.last_snapshot.status)
                    : "Noch keiner"}
                </span>
                <span className="small">
                  {overview.last_snapshot
                    ? formatDateTime(overview.last_snapshot.started_at)
                    : "Sobald der Abruf eingerichtet ist"}
                </span>
              </dd>
            </div>
            <div className="card">
              <dt>Gelesene Objekte in diesem Monat</dt>
              <dd>
                <span className="stat-number">{numbers.format(overview.resources_this_month)}</span>
                <span className="small">
                  von höchstens {numbers.format(overview.monthly_limit)} (Grenze von Microsoft)
                </span>
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
          {message && <p role={message.kind}>{message.text}</p>}
        </>
      )}
    </>
  );
}
