import { useEffect, useState } from "react";
import { formatDateTime } from "../../api";
import { LineChart } from "../../components/LineChart";
import { fetchUsers, formatCount, type Users } from "./api";
import { PeriodSelect } from "./PeriodSelect";

/** Microsoft 365 › Tenant › Benutzer: Zahl der Konten mit Verlauf. Nur Summen, keine Personen. */
export function UsersPage() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Users | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchUsers(days)
      .then((result) => {
        if (active) {
          setData(result);
          setFailed(false);
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
  }, [days]);

  const current = data?.current ?? null;
  const samples = data?.samples ?? [];
  const tiles: [string, number | null, string][] = current
    ? [
        ["Konten gesamt", current.total, "Mitglieder und Gäste"],
        ["Mitglieder", current.members, "eigene Konten"],
        ["Gäste", current.guests, `${formatCount(current.guests_disabled)} deaktiviert`],
        ["Aktiv", current.enabled, "Anmeldung erlaubt"],
        ["Deaktiviert", current.disabled, "Anmeldung gesperrt"],
        ["Mit Lizenz", current.licensed, "mindestens eine Lizenz"],
      ]
    : [];

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">Microsoft 365 › Tenant</p>
        <h1>Benutzer</h1>
        <p className="page-sub">
          Zahl der Konten in deinem Tenant. Die Werkbank liest und speichert nur Summen, keine
          Namen. Der Stand wird täglich festgehalten.
        </p>
      </header>

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Benutzerzahlen konnten nicht geladen werden.
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && !current && (
        <p className="panel panel-empty">
          {data.enabled
            ? "Es wurden noch keine Benutzerzahlen gelesen. Der erste Abruf läuft innerhalb einer Stunde nach dem Einschalten."
            : "Der Abruf von Lizenzen und Benutzerzahlen ist in dieser Installation nicht eingeschaltet (siehe Anleitung zur Einrichtung)."}
        </p>
      )}
      {data && current && (
        <>
          <dl className="kpis">
            {tiles.map(([label, value, hint]) => (
              <div className="kpi" key={label}>
                <dt>{label}</dt>
                <dd className="kpi-number">{value === null ? "–" : formatCount(value)}</dd>
                <dd className="small">{hint}</dd>
              </div>
            ))}
          </dl>
          <p className="small" role="status">
            Stand {formatDateTime(data.fetched_at)}
          </p>
          <section className="panel" aria-labelledby="benutzer-verlauf">
            <div className="panel-head">
              <h2 id="benutzer-verlauf">Verlauf</h2>
              <PeriodSelect days={days} onChange={setDays} />
            </div>
            <LineChart
              title="Verlauf der Benutzerzahlen"
              days={samples.map((sample) => sample.day)}
              series={[
                {
                  id: "mitglieder",
                  label: "Mitglieder",
                  values: samples.map((sample) => sample.members),
                },
                { id: "gaeste", label: "Gäste", values: samples.map((sample) => sample.guests) },
                {
                  id: "lizenz",
                  label: "Mit Lizenz",
                  values: samples.map((sample) => sample.licensed),
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}
