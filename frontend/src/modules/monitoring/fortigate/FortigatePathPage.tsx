import { useEffect, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../../api";
import {
  ErrorSummary,
  Field,
  RequiredNote,
  Segmented,
  problemFor,
  type Problem,
} from "../../../components/Field";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { MONITORING_FORTIGATE_FINDINGS_PATH } from "../../../navigation";
import { SeverityPill } from "./FortigateFindingsPage";
import { replaceParams } from "./params";
import {
  fetchFgOverview,
  fetchFgPath,
  type FgHop,
  type FgPath,
  type FgPathQuery,
  type FgProto,
} from "./api";

/* IT-Monitoring › FortiGate › Pfad-Analyse: berechnet aus dem letzten Abruf, ohne Datenverkehr. */

const PROTOCOLS: { value: FgProto; label: string }[] = [
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "icmp", label: "ICMP" },
];
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
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function fromUrl(): FgPathQuery {
  const query = new URLSearchParams(window.location.search);
  const proto = query.get("protokoll");
  return {
    src: query.get("quelle") ?? "",
    dst: query.get("ziel") ?? "",
    proto: proto === "udp" || proto === "icmp" ? proto : "tcp",
    port: query.get("port") ?? "443",
    device: query.get("geraet") ?? "",
    check: false,
  };
}

function problemsOf(query: FgPathQuery): Problem[] {
  const out: Problem[] = [];
  if (!IPV4.test(query.src.trim())) {
    out.push({ id: "fg-pfad-quelle", label: "Quelle", text: "eine IPv4-Adresse, z. B. 10.0.0.5" });
  }
  if (!IPV4.test(query.dst.trim())) {
    out.push({ id: "fg-pfad-ziel", label: "Ziel", text: "eine IPv4-Adresse" });
  }
  const port = Number(query.port);
  if (query.proto !== "icmp" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    out.push({ id: "fg-pfad-port", label: "Port", text: "eine Zahl von 1 bis 65535" });
  }
  return out;
}

export function FortigatePathPage() {
  const [query, setQuery] = useState<FgPathQuery>(fromUrl);
  const [devices, setDevices] = useState<string[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [result, setResult] = useState<FgPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchFgOverview().then(
      (overview) => active && setDevices(overview.devices.map((device) => device.name)),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  const change = (next: Partial<FgPathQuery>) => setQuery((current) => ({ ...current, ...next }));

  const run = (current: FgPathQuery) => {
    const found = problemsOf(current);
    setProblems(found);
    if (found.length > 0) {
      return;
    }
    setBusy(true);
    setError(null);
    replaceParams({
      quelle: current.src.trim(),
      ziel: current.dst.trim(),
      protokoll: current.proto,
      port: current.proto === "icmp" ? "" : current.port.trim(),
      geraet: current.device,
    });
    fetchFgPath(current)
      .then(setResult, (caught: unknown) => {
        setResult(null);
        setError(errorText(caught, "Der Pfad konnte nicht berechnet werden."));
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    // Mit Angaben in der Adresse (z. B. aus „Internet-Ausgang“) gleich rechnen
    const initial = fromUrl();
    if (!initial.src || !initial.dst || problemsOf(initial).length > 0) {
      return;
    }
    let active = true;
    fetchFgPath(initial).then(
      (value) => active && setResult(value),
      (caught: unknown) =>
        active && setError(errorText(caught, "Der Pfad konnte nicht berechnet werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run(query);
  };

  return (
    <div className="page page-wide fg-page">
      <header className="page-head fg-head">
        <div>
          <p className="module-label">IT-Monitoring · FortiGate</p>
          <h1>Pfad-Analyse</h1>
          <p className="page-sub">
            Welche Firewalls passiert eine Verbindung, und welche Policy greift jeweils zuerst?
            Berechnet aus dem letzten Abruf; es wird kein Datenverkehr erzeugt.
          </p>
        </div>
      </header>
      <section className="panel" aria-labelledby="fg-pfad-form">
        <div className="panel-head">
          <h2 id="fg-pfad-form">Verbindung</h2>
        </div>
        <form className="detail-body fg-path-form" noValidate onSubmit={submit}>
          <RequiredNote />
          <ErrorSummary problems={problems} />
          <Field
            id="fg-pfad-quelle"
            label="Quelle"
            required
            error={problemFor(problems, "fg-pfad-quelle")}
          >
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="10.0.0.5"
                value={query.src}
                onChange={(event) => change({ src: event.target.value })}
              />
            )}
          </Field>
          <Field
            id="fg-pfad-ziel"
            label="Ziel"
            required
            error={problemFor(problems, "fg-pfad-ziel")}
          >
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="203.0.113.10"
                value={query.dst}
                onChange={(event) => change({ dst: event.target.value })}
              />
            )}
          </Field>
          <Segmented<FgProto>
            label="Protokoll"
            value={query.proto}
            options={PROTOCOLS}
            onChange={(proto) => change({ proto })}
          />
          {query.proto !== "icmp" && (
            <Field
              id="fg-pfad-port"
              label="Port"
              required
              error={problemFor(problems, "fg-pfad-port")}
            >
              {(control) => (
                <input
                  {...control}
                  inputMode="numeric"
                  autoComplete="off"
                  value={query.port}
                  onChange={(event) => change({ port: event.target.value })}
                />
              )}
            </Field>
          )}
          <Field
            label="Startgerät"
            hint="Automatisch: das Gerät mit dem Netz der Quelle. Für Quellen von außen wähle das Gerät, an dem die Verbindung ankommt."
          >
            {(control) => (
              <select
                {...control}
                value={query.device}
                onChange={(event) => change({ device: event.target.value })}
              >
                <option value="">automatisch</option>
                {devices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="fg-field-tip">
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={query.check}
                onChange={(event) => change({ check: event.target.checked })}
              />
              Mit Policy-Lookup der Geräte gegenprüfen
            </label>
            <InfoTip term="fortigate.policy-lookup" />
          </div>
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "Wird berechnet …" : "Pfad berechnen"}
            </button>
          </div>
        </form>
      </section>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {result && <PathResult result={result} />}
    </div>
  );
}

function PathResult({ result }: { result: FgPath }) {
  return (
    <section className="fg-path" aria-labelledby="fg-pfad-ergebnis">
      <h2 id="fg-pfad-ergebnis" className="visually-hidden">
        Ergebnis
      </h2>
      <p
        role="status"
        className={
          result.allowed ? "hint-box hint-ok fg-path-verdict" : "hint-box hint-bad fg-path-verdict"
        }
      >
        <strong>{result.allowed ? "Erlaubt" : "Nicht erlaubt"}</strong> · {result.verdict}
        {result.data_at && (
          <span className="fg-sub">Stand der Daten {formatDateTime(result.data_at)}</span>
        )}
      </p>
      <ol className="fg-hops">
        {result.hops.map((hop, index) => (
          <HopCard key={`${hop.device}-${index}`} hop={hop} index={index} />
        ))}
      </ol>
      <p className="small fg-muted">
        <strong>Grenzen der Berechnung:</strong> {result.limits}
      </p>
    </section>
  );
}

function HopCard({ hop, index }: { hop: FgHop; index: number }) {
  const profiles = Object.entries(hop.profiles);
  return (
    <li className="panel fg-hop">
      <div className="panel-head fg-hop-head">
        <h3>
          <span className="fg-hop-number" aria-hidden="true">
            {index + 1}
          </span>{" "}
          {hop.device}
        </h3>
        {hop.findings.length > 0 ? (
          <span>
            {hop.findings.map((finding) => (
              <SeverityPill key={finding.code} severity={finding.severity} />
            ))}
          </span>
        ) : (
          <span className="small fg-muted">ohne Befund</span>
        )}
      </div>
      <dl className="facts detail-body">
        <div>
          <dt>Eingang</dt>
          <dd>
            {hop.ingress}
            <span className="fg-sub">
              {hop.src} → {hop.dst}
            </span>
          </dd>
        </div>
        {hop.dnat && (
          <div>
            <dt>Ziel-NAT</dt>
            <dd>{hop.dnat}</dd>
          </div>
        )}
        <div>
          <dt>Route</dt>
          <dd>{hop.route || "–"}</dd>
        </div>
        <div>
          <dt>Greift zuerst</dt>
          <dd>
            {hop.policy ? (
              <>
                <Link
                  to={`/monitoring/fortigate/policies?geraet=${encodeURIComponent(hop.device)}&q=%23${hop.policy.id}&auswahl=${encodeURIComponent(`${hop.device}:${hop.policy.id}`)}`}
                >
                  Policy #{hop.policy.id}
                  {hop.policy.name ? ` ${hop.policy.name}` : ""}
                </Link>{" "}
                · {hop.policy.action}
              </>
            ) : (
              "keine Policy"
            )}
          </dd>
        </div>
        {(hop.why.length > 0 || hop.skipped.length > 0) && (
          <div>
            <dt>Warum diese</dt>
            <dd>
              {hop.why.join(", ")}
              {hop.skipped.map((line) => (
                <span key={line} className="fg-sub">
                  {line}
                </span>
              ))}
            </dd>
          </div>
        )}
        {hop.policy && (
          <div>
            <dt>NAT · Profile</dt>
            <dd>
              {hop.snat || "kein NAT"} ·{" "}
              {profiles.length === 0
                ? "keine Profile"
                : profiles
                    .map(([key, value]) => `${PROFILE_LABELS[key] ?? key}: ${value}`)
                    .join(", ")}
            </dd>
          </div>
        )}
        {hop.check && (
          <div>
            <dt>Gegenprüfung</dt>
            <dd>
              <span className={hop.check.ok ? "pill pill-ok" : "pill pill-todo"}>
                {hop.check.ok ? "bestätigt" : "abweichend"}
              </span>{" "}
              {hop.check.text}
            </dd>
          </div>
        )}
        {hop.findings.length > 0 && (
          <div>
            <dt>Befunde</dt>
            <dd>
              {hop.findings.map((finding) => (
                <span key={finding.code} className="fg-sub">
                  <Link
                    to={`${MONITORING_FORTIGATE_FINDINGS_PATH}?geraet=${encodeURIComponent(hop.device)}&auswahl=${encodeURIComponent(`${hop.device}|${finding.code}|policy:${hop.policy?.id ?? ""}`)}`}
                  >
                    {finding.rule}
                  </Link>
                </span>
              ))}
            </dd>
          </div>
        )}
        {hop.notes.length > 0 && (
          <div>
            <dt>Hinweise</dt>
            <dd>
              {hop.notes.map((note) => (
                <span key={note} className="fg-sub">
                  {note}
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>Ergebnis</dt>
          <dd>{hop.outcome}</dd>
        </div>
      </dl>
    </li>
  );
}
