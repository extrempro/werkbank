import { useEffect, useState } from "react";
import { errorText } from "../../../api";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { MONITORING_FORTIGATE_PATH_PATH } from "../../../navigation";
import { fetchFgExits, type FgExits, type FgTopology } from "./api";

/* IT-Monitoring › FortiGate › Internet & Topologie: Ausgang je Netz und Verbindungen. */

const PROFILE_LABELS: Record<string, string> = {
  av: "Virenschutz",
  web: "Web-Filter",
  ips: "IPS",
  app: "Anwendungen",
  dns: "DNS-Filter",
  ssl: "SSL-Prüfung",
  file: "Datei-Filter",
  group: "Profilgruppe",
};

function firstHost(network: string): string {
  const [base] = network.split("/");
  const parts = (base ?? "").split(".").map(Number);
  parts[3] = (parts[3] ?? 0) + 1;
  return parts.join(".");
}

export function FortigateInternetPage() {
  const [data, setData] = useState<FgExits | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchFgExits().then(
      (value) => active && setData(value),
      (caught: unknown) =>
        active && setError(errorText(caught, "Die Daten konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page page-wide fg-page">
      <header className="page-head fg-head">
        <div>
          <p className="module-label">IT-Monitoring · FortiGate</p>
          <h1>Internet &amp; Topologie</h1>
          <p className="page-sub">
            Über welche Firewall und welche Policies jedes interne Netz ins Internet kommt, und wie
            die Geräte miteinander verbunden sind. Berechnet aus dem letzten Abruf.
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && (
        <>
          <section className="panel" aria-labelledby="fg-internet-ausgang">
            <div className="panel-head">
              <h2 id="fg-internet-ausgang">
                Internet-Ausgang je Netz <InfoTip term="fortigate.internet-ausgang" />
              </h2>
            </div>
            <p className="small detail-body">
              Geprüft wird je Netz eine Verbindung von der ersten freien Adresse zu {data.probe}{" "}
              (TCP 443, Stellvertreter für das Internet).
            </p>
            {data.exits.length === 0 ? (
              <p className="empty">Keine internen Netze gefunden.</p>
            ) : (
              <div className="table-wrap card-wrap">
                <table className="table-cards fg-table" aria-label="Internet-Ausgang je Netz">
                  <thead>
                    <tr>
                      <th scope="col">Netz</th>
                      <th scope="col">Ins Internet</th>
                      <th scope="col">Ausgang</th>
                      <th scope="col">Policies</th>
                      <th scope="col">NAT · Profile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exits.map((row) => {
                      const profiles = Object.entries(row.profiles);
                      return (
                        <tr key={`${row.device}-${row.interface}`}>
                          <th scope="row">
                            {row.network}
                            <span className="fg-sub">
                              {row.device} · {row.interface}
                            </span>
                          </th>
                          <td data-label="Ins Internet">
                            {row.allowed ? (
                              <span className="pill pill-ok">erlaubt</span>
                            ) : (
                              <span className="pill pill-neutral">nein</span>
                            )}
                            {!row.allowed && <span className="fg-sub">{row.verdict}</span>}
                          </td>
                          <td data-label="Ausgang">
                            {row.exit || "–"}
                            {row.path.length > 1 && (
                              <span className="fg-sub">über {row.path.join(" → ")}</span>
                            )}
                          </td>
                          <td data-label="Policies">{row.policies.join(" → ") || "–"}</td>
                          <td data-label="NAT · Profile">
                            {row.snat || "kein NAT"}
                            <span className="fg-sub">
                              {profiles.length === 0
                                ? "keine Profile"
                                : profiles
                                    .map(
                                      ([key, value]) => `${PROFILE_LABELS[key] ?? key}: ${value}`,
                                    )
                                    .join(", ")}
                            </span>
                            <Link
                              className="fg-sub"
                              to={`${MONITORING_FORTIGATE_PATH_PATH}?quelle=${firstHost(row.network)}&ziel=${data.probe}&protokoll=tcp&port=443&geraet=${encodeURIComponent(row.device)}`}
                            >
                              Pfad im Detail
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel" aria-labelledby="fg-topologie">
            <div className="panel-head">
              <h2 id="fg-topologie">Topologie</h2>
            </div>
            <div className="detail-body">
              <TopologyDiagram topology={data.topology} />
              <h3 className="fg-topology-list-title">Verbindungen</h3>
              {data.topology.links.length === 0 ? (
                <p className="empty">Keine Verbindungen zwischen den Geräten erkannt.</p>
              ) : (
                <ul className="fg-topology-list">
                  {data.topology.links.map((link) => (
                    <li key={`${link.a}-${link.b}-${link.kind}-${link.label}`}>
                      {link.a} ↔ {link.b}: {link.kind} {link.label}
                    </li>
                  ))}
                  {data.topology.nodes
                    .filter((node) => node.internet.length > 0)
                    .map((node) => (
                      <li key={`${node.name}-internet`}>
                        {node.name} ↔ Internet: {node.internet.join(", ")}
                      </li>
                    ))}
                </ul>
              )}
              <p className="small fg-muted">
                Erkannt aus gemeinsamen Netzen, Gateways statischer Routen und den Gegenstellen der
                IPsec-Tunnel. {data.limits}
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const WIDTH = 720;
const BOX_W = 150;
const BOX_H = 44;

/** Einfache Skizze: Internet oben, Geräte mit Internet-Anschluss darunter, die übrigen unten. */
function TopologyDiagram({ topology }: { topology: FgTopology }) {
  const upper = topology.nodes.filter((node) => node.internet.length > 0);
  const lower = topology.nodes.filter((node) => node.internet.length === 0);
  const rows = [upper, lower].filter((row) => row.length > 0);
  const height = 70 + rows.length * 110;
  const position = new Map<string, { x: number; y: number }>();
  rows.forEach((row, rowIndex) => {
    row.forEach((node, index) => {
      position.set(node.name, {
        x: ((index + 1) * WIDTH) / (row.length + 1),
        y: 130 + rowIndex * 110,
      });
    });
  });
  const internet = { x: WIDTH / 2, y: 30 };
  return (
    <svg
      className="fg-topology"
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label="Skizze der Verbindungen zwischen den FortiGates; die Liste darunter enthält dieselben Angaben."
    >
      {upper.map((node) => {
        const at = position.get(node.name)!;
        return (
          <line
            key={`i-${node.name}`}
            x1={internet.x}
            y1={internet.y + 16}
            x2={at.x}
            y2={at.y - BOX_H / 2}
            className="fg-topology-line fg-topology-wan"
          />
        );
      })}
      {topology.links.map((link) => {
        const a = position.get(link.a);
        const b = position.get(link.b);
        if (!a || !b) {
          return null;
        }
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={`${link.a}-${link.b}-${link.kind}-${link.label}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={
                link.kind === "IPsec" ? "fg-topology-line fg-topology-vpn" : "fg-topology-line"
              }
            />
            <text x={mx} y={my - 6} textAnchor="middle" className="fg-topology-label">
              {link.kind === "IPsec" ? `IPsec ${link.label}` : link.label}
            </text>
          </g>
        );
      })}
      <g>
        <rect
          x={internet.x - 60}
          y={internet.y - 16}
          width={120}
          height={32}
          rx={16}
          className="fg-topology-cloud"
        />
        <text x={internet.x} y={internet.y + 5} textAnchor="middle" className="fg-topology-name">
          Internet
        </text>
      </g>
      {topology.nodes.map((node) => {
        const at = position.get(node.name)!;
        return (
          <g key={node.name}>
            <rect
              x={at.x - BOX_W / 2}
              y={at.y - BOX_H / 2}
              width={BOX_W}
              height={BOX_H}
              rx={8}
              className="fg-topology-box"
            />
            <text x={at.x} y={at.y + 5} textAnchor="middle" className="fg-topology-name">
              {node.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
