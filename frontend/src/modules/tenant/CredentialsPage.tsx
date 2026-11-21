import { useEffect, useState } from "react";
import { FilterBar } from "../../components/FilterBar";
import { formatDateTime } from "../../api";
import { formatDay } from "../../components/LineChart";
import {
  credentialKind,
  fetchCredentials,
  formatCount,
  LEVEL_INFO,
  remainingText,
  type CredentialList,
} from "./api";
import { Honeycomb } from "./Honeycomb";

type View = "handlungsbedarf" | "alle";
type Display = "liste" | "waben";

/** Microsoft 365 › Tenant › Zertifikate und Secrets: Ablaufdaten der Anwendungen im Tenant. */
export function CredentialsPage() {
  const [list, setList] = useState<CredentialList | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("handlungsbedarf");
  const [display, setDisplay] = useState<Display>("liste");

  useEffect(() => {
    let active = true;
    fetchCredentials()
      .then((result) => {
        if (active) {
          setList(result);
          // Ohne Handlungsbedarf ist die Liste leer; die Waben zeigen dann den Überblick.
          if (result.attention === 0 && result.entries.length > 0) {
            setDisplay("waben");
          }
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

  const all = list?.entries ?? [];
  const shown = view === "alle" ? all : all.filter((entry) => entry.level !== "ok");
  const [notice = 60, warn = 30, urgent = 7] = list?.warn_days ?? [];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">Microsoft 365 › Tenant</p>
        <h1>Zertifikate und Secrets</h1>
        <p className="page-sub">
          Ablaufdaten der Zertifikate und Secrets von App-Registrierungen und der
          Signaturzertifikate von Unternehmensanwendungen (SAML). Die Werkbank liest nur Bezeichnung
          und Daten, nie den geheimen Wert.
        </p>
      </header>

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Zertifikate und Secrets konnten nicht geladen werden.
        </p>
      )}
      {!failed && !list && <p role="status">Wird geladen …</p>}
      {list && all.length === 0 && (
        <p className="panel panel-empty">
          {list.enabled
            ? "Es wurden noch keine Zertifikate und Secrets gelesen. Der erste Abruf läuft innerhalb einer Stunde nach dem Einschalten."
            : "Der Abruf von Zertifikaten und Secrets ist in dieser Installation nicht eingeschaltet (siehe Anleitung zur Einrichtung)."}
        </p>
      )}
      {list && all.length > 0 && (
        <>
          <dl className="kpis">
            <div className="kpi">
              <dt>Einträge</dt>
              <dd className="kpi-number">{formatCount(list.total)}</dd>
            </div>
            <div className={list.attention > 0 ? "kpi kpi-warn" : "kpi kpi-ok"}>
              <dt>Handlungsbedarf</dt>
              <dd className="kpi-number">{formatCount(list.attention)}</dd>
            </div>
          </dl>
          <p className="small" role="status">
            Stand {formatDateTime(list.fetched_at)} · Hinweis ab {notice} Tagen, Warnung ab {warn},
            dringend ab {urgent} Tagen vor dem Ablauf
          </p>
          <div className="chips" role="group" aria-label="Ansicht">
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={display === "liste"}
              onClick={() => setDisplay("liste")}
            >
              Liste
            </button>
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={display === "waben"}
              onClick={() => setDisplay("waben")}
            >
              Waben
            </button>
          </div>
          {display === "waben" && <Honeycomb entries={all} />}
          {display === "liste" && (
            <>
              <FilterBar
                status={{
                  label: "Einträge filtern",
                  value: view,
                  onChange: setView,
                  options: [
                    { value: "handlungsbedarf", label: "Handlungsbedarf", count: list.attention },
                    { value: "alle", label: "Alle", count: list.total },
                  ],
                }}
              />
              {shown.length === 0 ? (
                <p className="panel panel-empty">
                  Kein Handlungsbedarf: In den nächsten {notice} Tagen läuft nichts ab.
                </p>
              ) : (
                <div
                  className="table-wrap card-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Zertifikate und Secrets"
                >
                  <table className="table-cards">
                    <caption className="visually-hidden">
                      Zertifikate und Secrets nach Ablauf
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Anwendung</th>
                        <th scope="col">Art</th>
                        <th scope="col">Bezeichnung</th>
                        <th scope="col">Läuft ab</th>
                        <th scope="col">Restlaufzeit</th>
                        <th scope="col">Stand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((entry) => (
                        <tr key={entry.id}>
                          <th scope="row">
                            {entry.owner_name}
                            {entry.app_id && (
                              <span className="small mono tenant-part">{entry.app_id}</span>
                            )}
                          </th>
                          <td data-label="Art">{credentialKind(entry)}</td>
                          <td data-label="Bezeichnung">{entry.name ?? "–"}</td>
                          <td data-label="Läuft ab">
                            {entry.expires_at ? formatDay(entry.expires_at.slice(0, 10)) : "–"}
                          </td>
                          <td data-label="Restlaufzeit">{remainingText(entry.days_left)}</td>
                          <td data-label="Stand">
                            <span className={`pill pill-${LEVEL_INFO[entry.level].tone}`}>
                              {LEVEL_INFO[entry.level].text}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <p className="small">
            Erneuert wird in Entra bei der jeweiligen Anwendung. Ein neues Secret oder Zertifikat
            erscheint hier nach dem nächsten Abruf; das alte verschwindet, sobald es in Entra
            entfernt ist.
          </p>
        </>
      )}
    </div>
  );
}
