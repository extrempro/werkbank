import { useEffect, useState } from "react";
import { errorText, formatDateTime } from "../../../api";
import { InfoTip } from "../../../components/InfoTip";
import { NbDataBar } from "./NetbirdPages";
import { fetchNbNetworks, type NbNetworkState, type NbNetworks, type NbTcp } from "./api";

/* IT-Monitoring › NetBird › Netze & Dienste. Nur lesend. */

const REFRESH_MS = 60_000;
const SERVICES_SHOWN = 20;
const DAY = 24 * 3600 * 1000;

const CROWDSEC_LABELS: Record<string, string> = {
  off: "aus",
  observe: "beobachten",
  enforce: "sperren",
};

const STATE_CLASS: Record<NbNetworkState, string> = {
  erreichbar: "pill pill-ok",
  ohne_ausfallweg: "pill pill-todo",
  nicht_erreichbar: "pill pill-bad",
  ohne_router: "pill pill-neutral",
};

export function NetbirdNetworksPage() {
  const [data, setData] = useState<NbNetworks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allServices, setAllServices] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  useEffect(() => {
    let active = true;
    const run = () =>
      fetchNbNetworks().then(
        (value) => {
          if (active) {
            setData(value);
            setError(null);
            setLoadedAt(Date.now());
          }
        },
        (caught: unknown) =>
          active && setError(errorText(caught, "Netze und Dienste konnten nicht geladen werden.")),
      );
    void run();
    const timer = window.setInterval(() => void run(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const services = data?.services ?? [];
  const shown = allServices ? services : services.slice(0, SERVICES_SHOWN);
  return (
    <div className="page page-wide fg-page">
      <header className="page-head fg-head">
        <div>
          <p className="module-label">IT-Monitoring · NetBird</p>
          <h1>Netze &amp; Dienste</h1>
          <p className="page-sub">
            Server-Komponenten, Netze mit ihren Routing-Peers und die Dienste am Reverse Proxy.
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <NbDataBar data={data} />
      {data?.configured && data.data_at && (
        <>
          <section aria-labelledby="nb-komponenten">
            <h2 id="nb-komponenten" className="nb-section-title">
              Server-Komponenten <InfoTip term="netbird.komponenten" />
            </h2>
            <dl className="kpis">
              <div className="kpi">
                <dt>Management</dt>
                <dd className={data.components.management.ok ? "nb-ok" : "nb-bad"}>
                  {data.components.management.ok ? "antwortet" : "Fehler beim Abruf"}
                </dd>
                <dd className="small">
                  {data.components.management.ms !== null
                    ? `API in ${data.components.management.ms} ms`
                    : "–"}
                </dd>
              </div>
              <TcpKpi label="Signal" value={data.components.signal} />
              <TcpKpi label="Relay" value={data.components.relay} />
              <CrowdSecKpi data={data} />
              <div className="kpi">
                <dt>Reverse Proxy</dt>
                <dd>
                  {data.components.proxy.services}{" "}
                  {data.components.proxy.services === 1 ? "Dienst" : "Dienste"}
                </dd>
                <dd className={data.components.proxy.errors > 0 ? "small nb-bad" : "small"}>
                  {data.components.proxy.errors > 0
                    ? `${data.components.proxy.errors} mit Fehler`
                    : data.components.proxy.online === false
                      ? "Proxy nicht verbunden"
                      : "alle antworten"}
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel" aria-labelledby="nb-netze">
            <div className="panel-head nb-panel-head">
              <h2 id="nb-netze">
                Netze <InfoTip term="netbird.erreichbar" />
              </h2>
              <span className="small">
                {data.ping_enabled
                  ? "Mit Ping in die Netze: „erreichbar“ prüft zusätzlich das Testziel."
                  : "Ping ist aus: „erreichbar“ folgt aus dem Status der Routing-Peers."}
              </span>
            </div>
            {data.networks.length === 0 ? (
              <p className="empty">In NetBird sind keine Netze angelegt.</p>
            ) : (
              <div className="table-wrap card-wrap">
                <table className="table-cards fg-table" aria-label="Netze">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Bereich</th>
                      <th scope="col">Routing-Peers</th>
                      <th scope="col">
                        Ausfallweg <InfoTip term="netbird.ausfallweg" />
                      </th>
                      {data.ping_enabled && <th scope="col">Testziel</th>}
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.networks.map((network) => (
                      <tr key={network.id}>
                        <th scope="row">
                          {network.name}
                          {network.kind === "route" && <span className="fg-sub">Route</span>}
                        </th>
                        <td data-label="Bereich">{network.ranges.join(", ") || "–"}</td>
                        <td data-label="Routing-Peers">
                          {network.routers.length === 0
                            ? "–"
                            : network.routers.map((router) => (
                                <span key={router.id} className="nb-router">
                                  {router.name}{" "}
                                  <span className={router.connected ? "nb-ok" : "nb-bad"}>
                                    {router.connected ? "verbunden" : "offline"}
                                  </span>
                                </span>
                              ))}
                        </td>
                        <td data-label="Ausfallweg">
                          {network.total ? `${network.connected} von ${network.total}` : "–"}
                        </td>
                        {data.ping_enabled && (
                          <td data-label="Testziel">
                            {network.target ? (
                              <>
                                {network.target}
                                <span className="fg-sub">
                                  {network.ping === null
                                    ? "Ping nicht verfügbar"
                                    : network.ping
                                      ? "antwortet"
                                      : "antwortet nicht"}
                                </span>
                              </>
                            ) : (
                              "kein Testziel"
                            )}
                          </td>
                        )}
                        <td data-label="Status">
                          <span className={STATE_CLASS[network.state]}>{network.state_label}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel" aria-labelledby="nb-dienste">
            <div className="panel-head nb-panel-head">
              <h2 id="nb-dienste">Dienste am Reverse Proxy</h2>
              <span className="small">
                HTTPS-Abruf der Werkbank alle 5 Minuten; Dienste „nur NetBird“ werden nicht geprüft.
              </span>
            </div>
            {services.length === 0 ? (
              <p className="empty">Am Reverse Proxy sind keine Dienste eingerichtet.</p>
            ) : (
              <div className="table-wrap card-wrap">
                <table className="table-cards fg-table" aria-label="Dienste am Reverse Proxy">
                  <thead>
                    <tr>
                      <th scope="col">Domain</th>
                      <th scope="col">Ziel</th>
                      <th scope="col">
                        HTTP <InfoTip term="netbird.http" />
                      </th>
                      <th scope="col" className="number">
                        Antwortzeit
                      </th>
                      <th scope="col" className="number">
                        Verfügbar 30 T. <InfoTip term="netbird.verfuegbarkeit" />
                      </th>
                      <th scope="col">Zertifikat bis</th>
                      <th scope="col">Zugriff</th>
                      <th scope="col">
                        CrowdSec <InfoTip term="netbird.crowdsec" />
                      </th>
                      {data.proxy_log_available && (
                        <th scope="col" className="number">
                          Abgewiesen 24 h <InfoTip term="netbird.abgewiesen" />
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((service) => {
                      const days = service.cert_expires
                        ? Math.round((new Date(service.cert_expires).getTime() - loadedAt) / DAY)
                        : null;
                      return (
                        <tr
                          key={service.id}
                          className={service.answered === false ? "nb-row-bad" : undefined}
                        >
                          <th scope="row">{service.domain}</th>
                          <td data-label="Ziel">{service.target || "–"}</td>
                          <td data-label="HTTP">
                            {service.private ? (
                              <span className="small">nicht geprüft</span>
                            ) : service.answered === null ? (
                              "–"
                            ) : (
                              <>
                                <span
                                  className={service.answered ? "pill pill-ok" : "pill pill-bad"}
                                >
                                  {service.status_code ?? "keine Antwort"}
                                </span>
                                {service.error && <span className="fg-sub">{service.error}</span>}
                              </>
                            )}
                          </td>
                          <td data-label="Antwortzeit" className="number">
                            {service.ms !== null ? `${service.ms} ms` : "–"}
                          </td>
                          <td data-label="Verfügbar 30 T." className="number">
                            {service.availability !== null
                              ? `${service.availability.toLocaleString("de-DE")} %`
                              : "–"}
                          </td>
                          <td data-label="Zertifikat bis">
                            {service.cert_expires ? (
                              <span className={days !== null && days <= 30 ? "nb-warn" : undefined}>
                                {formatDateTime(service.cert_expires).split(",")[0]}
                                {days !== null && days <= 30 ? ` · in ${days} Tagen` : ""}
                              </span>
                            ) : (
                              "–"
                            )}
                          </td>
                          <td data-label="Zugriff">{service.access}</td>
                          <td data-label="CrowdSec">
                            {service.private ? (
                              "–"
                            ) : (
                              <>
                                <span
                                  className={
                                    service.crowdsec_mode === "off" && !service.crowdsec_exempt
                                      ? "nb-warn"
                                      : undefined
                                  }
                                >
                                  {CROWDSEC_LABELS[service.crowdsec_mode] ?? service.crowdsec_mode}
                                </span>
                                {service.crowdsec_mode === "off" && service.crowdsec_exempt && (
                                  <span className="fg-sub">bewusst ohne</span>
                                )}
                              </>
                            )}
                          </td>
                          {data.proxy_log_available && (
                            <td data-label="Abgewiesen 24 h" className="number">
                              {service.blocked_24h}
                              {service.observed_24h > 0 && (
                                <span className="fg-sub">{service.observed_24h} wären</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {services.length > SERVICES_SHOWN && (
                  <p className="detail-body">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setAllServices(!allServices)}
                    >
                      {allServices
                        ? "Weniger anzeigen"
                        : `${services.length - SERVICES_SHOWN} weitere anzeigen`}
                    </button>
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function CrowdSecKpi({ data }: { data: NbNetworks }) {
  const value = data.components.crowdsec;
  const blocked =
    value.blocked_24h !== null
      ? `${value.blocked_24h} abgewiesen in 24 h${value.observed_24h ? ` · ${value.observed_24h} wären` : ""}`
      : "";
  return (
    <div className="kpi">
      <dt>
        CrowdSec <InfoTip term="netbird.crowdsec" />
      </dt>
      {!value.configured ? (
        <>
          <dd>nicht eingetragen</dd>
          <dd className="small">{blocked || "Local API in Verwaltung › NetBird"}</dd>
        </>
      ) : value.ok ? (
        <>
          <dd className="nb-ok">{value.total ?? 0} aktive Sperren</dd>
          <dd className="small">
            davon {value.own ?? 0} eigene{blocked ? ` · ${blocked}` : ""}
          </dd>
        </>
      ) : (
        <>
          <dd className="nb-bad">nicht lesbar</dd>
          <dd className="small">{value.error}</dd>
        </>
      )}
    </div>
  );
}

function TcpKpi({ label, value }: { label: string; value: NbTcp | null }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      {value ? (
        <>
          <dd className={value.ok ? "nb-ok" : "nb-bad"}>
            {value.ok ? "erreichbar" : "nicht erreichbar"}
          </dd>
          <dd className="small">
            TCP {value.target}
            {value.ms !== null ? ` · ${value.ms} ms` : ""}
          </dd>
        </>
      ) : (
        <>
          <dd>nicht eingetragen</dd>
          <dd className="small">Adresse in Verwaltung › NetBird</dd>
        </>
      )}
    </div>
  );
}
