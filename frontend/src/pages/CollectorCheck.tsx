import { useState } from "react";
import { errorText, postJson } from "../api";
import { Feedback } from "../components/Feedback";
import { InfoTip } from "../components/InfoTip";

export interface CollectorCheck {
  configured: boolean;
  collector_error: string | null;
  collector: { permission: string; purpose: string; required: boolean; granted: boolean }[];
  utcm_error: string | null;
  utcm: { resource: string; permission: string; types: string[]; granted: boolean }[];
  unknown_types: string[];
  notes: string[];
}

export function checkCollector(): Promise<CollectorCheck> {
  return postJson("/api/admin/collector/check", {}, { quiet: true });
}

function short(type: string): string {
  return type.replace(/^microsoft\./, "");
}

/** Ergebnis: Text immer dabei („vorhanden“, „fehlt“), Farbe nur zusätzlich. */
function State({ granted, required = true }: { granted: boolean; required?: boolean }) {
  if (granted) {
    return <span className="pill pill-ok">vorhanden</span>;
  }
  return required ? (
    <span className="pill pill-bad">fehlt</span>
  ) : (
    <span className="pill pill-neutral">nicht vergeben</span>
  );
}

/** Verwaltung › Verbindungen: Berechtigungen für den Abruf aus dem Tenant prüfen. */
export function CollectorCheckPanel() {
  const [result, setResult] = useState<CollectorCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const run = () => {
    setBusy(true);
    setFailed(null);
    checkCollector()
      .then(setResult)
      .catch((problem: unknown) =>
        setFailed(errorText(problem, "Die Prüfung konnte nicht ausgeführt werden.")),
      )
      .finally(() => setBusy(false));
  };

  const missingUtcm = result ? result.utcm.filter((i) => !i.granted).length : 0;
  const missingCollector = result
    ? result.collector.filter((i) => i.required && !i.granted).length
    : 0;

  return (
    <section className="panel" aria-labelledby="rechte-titel">
      <div className="panel-head">
        <h2 id="rechte-titel">
          Berechtigungen für den Abruf
          <InfoTip term="verwaltung.rechtepruefung" />
        </h2>
      </div>
      <div className="detail-body settings-form">
        <p>
          Prüft, ob die Collector-App und der Dienstprinzipal von UTCM die Rechte haben, die die
          eingetragenen Typen und eingeschalteten Funktionen brauchen. Es wird nichts geändert.
        </p>
        <div className="actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={run}>
            {busy ? "Wird geprüft …" : "Berechtigungen prüfen"}
          </button>
        </div>
        {result && !result.configured && <p className="hint-box">{result.collector_error}</p>}
        {result?.configured && (
          <div className="collector-check">
            <p role="status">
              {missingUtcm + missingCollector === 0 && !result.utcm_error && !result.collector_error
                ? "Alle geprüften Berechtigungen sind vorhanden."
                : `Es fehlen ${missingCollector} Berechtigungen bei der Collector-App und ${missingUtcm} beim Dienstprinzipal von UTCM.`}
            </p>
            <h3>Dienstprinzipal von UTCM</h3>
            {result.utcm_error ? (
              <p className="hint-box hint-bad">{result.utcm_error}</p>
            ) : (
              <div
                className="table-wrap card-wrap"
                tabIndex={0}
                role="region"
                aria-label="Rechte von UTCM"
              >
                <table className="table-cards">
                  <caption className="visually-hidden">
                    Berechtigungen des Dienstprinzipals von UTCM je Ressourcentyp
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Berechtigung</th>
                      <th scope="col">Stand</th>
                      <th scope="col">Gebraucht für</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.utcm.map((item) => (
                      <tr key={`${item.resource}-${item.permission}`}>
                        <th scope="row">
                          <code>{item.permission}</code>
                          <span className="small"> ({item.resource})</span>
                        </th>
                        <td data-label="Stand">
                          <State granted={item.granted} />
                        </td>
                        <td data-label="Gebraucht für" className="small mono collector-types">
                          {item.types.map(short).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.unknown_types.length > 0 && (
              <p className="small">
                Für diese Typen kennt die Werkbank die nötigen Rechte nicht:{" "}
                <span className="mono">{result.unknown_types.map(short).join(", ")}</span>
              </p>
            )}
            {result.notes.map((note) => (
              <p key={note} className="hint-box">
                {note}
              </p>
            ))}
            <h3>Collector-App</h3>
            {result.collector_error && (
              <p className="hint-box hint-bad">{result.collector_error}</p>
            )}
            <div
              className="table-wrap card-wrap"
              tabIndex={0}
              role="region"
              aria-label="Rechte der Collector-App"
            >
              <table className="table-cards">
                <caption className="visually-hidden">Berechtigungen der Collector-App</caption>
                <thead>
                  <tr>
                    <th scope="col">Berechtigung</th>
                    <th scope="col">Stand</th>
                    <th scope="col">Wofür</th>
                  </tr>
                </thead>
                <tbody>
                  {result.collector.map((item) => (
                    <tr key={item.permission}>
                      <th scope="row">
                        <code>{item.permission}</code>
                        {!item.required && <span className="small"> (freiwillig)</span>}
                      </th>
                      <td data-label="Stand">
                        <State granted={item.granted} required={item.required} />
                      </td>
                      <td data-label="Wofür">{item.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <Feedback
        message={failed ? { kind: "alert", text: failed } : null}
        onClose={() => setFailed(null)}
      />
    </section>
  );
}
