import { useEffect, useState } from "react";
import { ApiError, formatDateTime } from "../../api";
import { LineChart, formatDay } from "../../components/LineChart";
import { Link } from "../../components/Link";
import { LICENSES_PATH } from "../../navigation";
import {
  fetchLicense,
  fetchLicenses,
  formatCount,
  licenseNotes,
  type License,
  type LicenseDetail,
  type LicenseList,
} from "./api";
import { PeriodSelect } from "./PeriodSelect";

function Notes({ license, now }: { license: License; now: number }) {
  const notes = licenseNotes(license, now);
  if (notes.length === 0) {
    return <span className="pill pill-ok">in Ordnung</span>;
  }
  return (
    <span className="badges">
      {notes.map((note) => (
        <span key={note.text} className={`pill pill-${note.tone}`}>
          {note.text}
        </span>
      ))}
    </span>
  );
}

function lifecycleDay(license: License): string {
  return license.next_lifecycle ? formatDay(license.next_lifecycle.slice(0, 10)) : "–";
}

/** Microsoft 365 › Tenant › Lizenzen: Stand je Lizenz, auf Wunsch mit Verlauf. */
export function LicensesPage({ selectedId }: { selectedId?: number }) {
  // Der Zeitpunkt wird einmal je Seitenaufruf festgehalten, damit die Anzeige stabil bleibt.
  const [now] = useState(() => Date.now());
  if (selectedId !== undefined) {
    return <LicenseDetailPage key={selectedId} id={selectedId} now={now} />;
  }
  return <LicenseListPage now={now} />;
}

function LicenseListPage({ now }: { now: number }) {
  const [list, setList] = useState<LicenseList | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLicenses()
      .then((result) => {
        if (active) {
          setList(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const entries = list?.entries ?? [];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">Microsoft 365 › Tenant</p>
        <h1>Lizenzen</h1>
        <p className="page-sub">
          Gekaufte und zugewiesene Lizenzen deines Tenants. Der Stand wird täglich festgehalten;
          ein Klick auf eine Lizenz zeigt den Verlauf.
        </p>
      </header>

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Lizenzen konnten nicht geladen werden.
        </p>
      )}
      {!failed && !list && <p role="status">Wird geladen …</p>}
      {list && entries.length === 0 && (
        <p className="panel panel-empty">
          {list.enabled
            ? "Es wurden noch keine Lizenzen gelesen. Der erste Abruf läuft innerhalb einer Stunde nach dem Einschalten."
            : "Der Abruf von Lizenzen und Benutzerzahlen ist in dieser Installation nicht eingeschaltet (siehe Anleitung zur Einrichtung)."}
        </p>
      )}
      {list && entries.length > 0 && (
        <>
          <dl className="kpis">
            <div className="kpi">
              <dt>Lizenzarten</dt>
              <dd className="kpi-number">{formatCount(entries.length)}</dd>
            </div>
            <div className="kpi">
              <dt>Gekauft</dt>
              <dd className="kpi-number">{formatCount(list.total)}</dd>
            </div>
            <div className="kpi">
              <dt>Zugewiesen</dt>
              <dd className="kpi-number">{formatCount(list.consumed)}</dd>
            </div>
          </dl>
          <p className="small" role="status">
            Stand {formatDateTime(list.fetched_at)}
          </p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Lizenzen">
            <table>
              <caption className="visually-hidden">Lizenzen des Tenants</caption>
              <thead>
                <tr>
                  <th scope="col">Lizenz</th>
                  <th scope="col" className="number">
                    Gekauft
                  </th>
                  <th scope="col" className="number">
                    Zugewiesen
                  </th>
                  <th scope="col" className="number">
                    Frei
                  </th>
                  <th scope="col">Stichtag</th>
                  <th scope="col">Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((license) => (
                  <tr key={license.id}>
                    <th scope="row">
                      <Link to={`${LICENSES_PATH}/${license.id}`} className="row-title">
                        {license.name}
                      </Link>
                      {license.name !== license.part_number && (
                        <span className="small mono tenant-part">{license.part_number}</span>
                      )}
                    </th>
                    <td className="number">{formatCount(license.total)}</td>
                    <td className="number">{formatCount(license.consumed)}</td>
                    <td className="number">{formatCount(license.free)}</td>
                    <td>{lifecycleDay(license)}</td>
                    <td>
                      <Notes license={license} now={now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">
            Der Stichtag ist der Tag, an dem ein Abo dieser Lizenz verlängert wird oder ausläuft.
            Welcher Fall zutrifft, steht im Microsoft 365 Admin Center.
          </p>
        </>
      )}
    </div>
  );
}

type DetailState =
  | { status: "loading" }
  | { status: "missing" | "error" }
  | { status: "ready"; days: number; detail: LicenseDetail };

function LicenseDetailPage({ id, now }: { id: number; now: number }) {
  const [days, setDays] = useState(90);
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    fetchLicense(id, days)
      .then((detail) => {
        if (active) {
          setState({ status: "ready", days, detail });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: error instanceof ApiError && error.status === 404 ? "missing" : "error",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [id, days]);

  const back = (
    <p className="back back-always">
      <Link to={LICENSES_PATH}>Zurück zu den Lizenzen</Link>
    </p>
  );
  if (state.status !== "ready") {
    return (
      <div className="page">
        {back}
        <header className="page-head">
          <p className="module-label">Microsoft 365 › Tenant › Lizenzen</p>
          <h1>{state.status === "missing" ? "Lizenz nicht gefunden" : "Lizenz"}</h1>
        </header>
        {state.status === "loading" && <p role="status">Wird geladen …</p>}
        {state.status === "missing" && <p>Diese Lizenz gibt es nicht.</p>}
        {state.status === "error" && (
          <p role="alert">Die Lizenz konnte nicht geladen werden.</p>
        )}
      </div>
    );
  }

  const { license, samples } = state.detail;
  return (
    <div className="page">
      {back}
      <header className="page-head">
        <p className="module-label">Microsoft 365 › Tenant › Lizenzen</p>
        <h1>{license.name}</h1>
        <p className="page-sub">
          <span className="mono">{license.part_number}</span>
          {!license.active && " · im letzten Abruf nicht mehr vorhanden"}
        </p>
      </header>
      <dl className="kpis">
        <div className="kpi">
          <dt>Gekauft</dt>
          <dd className="kpi-number">{formatCount(license.total)}</dd>
        </div>
        <div className="kpi">
          <dt>Zugewiesen</dt>
          <dd className="kpi-number">{formatCount(license.consumed)}</dd>
        </div>
        <div className="kpi">
          <dt>Frei</dt>
          <dd className="kpi-number">{formatCount(license.free)}</dd>
        </div>
        <div className="kpi">
          <dt>Stichtag</dt>
          <dd className="kpi-number">{lifecycleDay(license)}</dd>
        </div>
      </dl>
      <p>
        <Notes license={license} now={now} />{" "}
        <span className="small">Stand {formatDateTime(state.detail.fetched_at)}</span>
      </p>
      <section className="panel" aria-labelledby="lizenz-verlauf">
        <div className="panel-head">
          <h2 id="lizenz-verlauf">Verlauf</h2>
          <PeriodSelect days={days} onChange={setDays} />
        </div>
        <LineChart
          title={`Verlauf ${license.name}`}
          days={samples.map((sample) => sample.day)}
          series={[
            { id: "gekauft", label: "Gekauft", values: samples.map((sample) => sample.total) },
            {
              id: "zugewiesen",
              label: "Zugewiesen",
              values: samples.map((sample) => sample.consumed),
            },
          ]}
        />
      </section>
    </div>
  );
}
