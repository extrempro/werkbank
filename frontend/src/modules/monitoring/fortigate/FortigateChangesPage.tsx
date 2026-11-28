import { useEffect, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../../api";
import { Field } from "../../../components/Field";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import {
  fetchFgChanges,
  fetchFgCompare,
  fetchFgSnapshots,
  type FgChange,
  type FgChanges,
  type FgCompare,
} from "./api";

/* IT-Monitoring › FortiGate › Änderungen: was sich zwischen zwei Abrufen geändert hat. */

const KIND_LABELS: Record<string, string> = {
  policy: "Policy",
  adresse: "Adresse",
  gruppe: "Gruppe",
  dienst: "Dienst",
  route: "Route",
  sonstiges: "Sonstiges",
};
const PERIODS = [
  { value: "7", label: "Letzte 7 Tage" },
  { value: "30", label: "Letzte 30 Tage" },
  { value: "0", label: "Ganze Aufbewahrung" },
];
const KIND_CLASS: Record<FgChange["kind"], string> = {
  neu: "pill pill-ok",
  entfernt: "pill pill-bad",
  geändert: "pill pill-info",
};

function initial(name: string, fallback = ""): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export function FortigateChangesPage() {
  const [device, setDevice] = useState(() => initial("geraet"));
  const [kind, setKind] = useState("");
  const [days, setDays] = useState("30");
  const [data, setData] = useState<FgChanges | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchFgChanges(device, kind, days).then(
      (value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      },
      (caught: unknown) =>
        active && setError(errorText(caught, "Die Änderungen konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [device, kind, days]);

  const total = data ? data.entries.reduce((sum, entry) => sum + entry.changes.length, 0) : 0;
  const moreActive = [device, days !== "30" ? days : ""].filter(Boolean).length;

  return (
    <div className="page page-wide fg-page">
      <header className="page-head fg-head">
        <div>
          <p className="module-label">IT-Monitoring · FortiGate</p>
          <h1>Änderungen</h1>
          <p className="page-sub">
            Was sich an der Konfiguration geändert hat, je Abruf mit neuem Stand. Mit dem
            FortiAnalyzer steht dabei, wer es geändert hat.
          </p>
        </div>
      </header>
      <FilterBar<string>
        status={{
          label: "Art",
          value: kind,
          onChange: setKind,
          options: [
            { value: "", label: "Alle Arten", count: null },
            ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label, count: null })),
          ],
        }}
        statusSelect
        moreActive={moreActive}
        onReset={
          moreActive || kind
            ? () => {
                setDevice("");
                setKind("");
                setDays("30");
              }
            : undefined
        }
        more={
          <>
            <label className="filter-field">
              Gerät
              <select value={device} onChange={(event) => setDevice(event.target.value)}>
                <option value="">Alle Geräte</option>
                {(data?.devices ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Zeitraum
              <select value={days} onChange={(event) => setDays(event.target.value)}>
                {PERIODS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {data && (
        <p className="small fg-count" role="status">
          {total === 1 ? "1 Änderung" : `${total} Änderungen`} in{" "}
          {data.entries.length === 1 ? "1 Abruf" : `${data.entries.length} Abrufen`} · Ältere Abrufe
          werden nach der eingestellten Aufbewahrung gelöscht.
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && data.entries.length === 0 && (
        <p className="empty">Keine Änderung passt zur Auswahl.</p>
      )}
      {data?.entries.map((entry) => (
        <section
          key={entry.snapshot_id}
          className="panel fg-change"
          aria-labelledby={`fg-stand-${entry.snapshot_id}`}
        >
          <div className="panel-head">
            <h2 id={`fg-stand-${entry.snapshot_id}`}>
              {entry.device} · {formatDateTime(entry.at)}
            </h2>
            <span className="small fg-muted">
              geändert zwischen {formatDateTime(entry.since)} und {formatDateTime(entry.at)}
            </span>
          </div>
          {entry.analyzer_error && (
            <p className="hint-box hint-warn">„Geändert von“ fehlt: {entry.analyzer_error}</p>
          )}
          <ChangeList changes={entry.changes} analyzer={entry.analyzer} />
        </section>
      ))}
      {data && <CompareSection devices={data.devices} />}
    </div>
  );
}

function ChangeList({ changes, analyzer }: { changes: FgChange[]; analyzer: boolean }) {
  return (
    <ul className="fg-change-list">
      {changes.map((change) => (
        <li key={`${change.section}-${change.key}-${change.kind}`}>
          <details>
            <summary>
              <span className={KIND_CLASS[change.kind]}>{change.kind}</span> {change.label}{" "}
              <strong>{change.title}</strong>
              {change.who.length > 0 ? (
                <span className="fg-sub">
                  von {[...new Set(change.who.map((who) => `${who.user} (${who.ui})`))].join(", ")}
                </span>
              ) : (
                analyzer && <span className="fg-sub">im FortiAnalyzer nicht gefunden</span>
              )}
            </summary>
            <table className="fg-diff" aria-label={`Felder von ${change.label} ${change.title}`}>
              <thead>
                <tr>
                  <th scope="col">Feld</th>
                  <th scope="col">Vorher</th>
                  <th scope="col">Nachher</th>
                </tr>
              </thead>
              <tbody>
                {change.fields.map((item) => (
                  <tr key={item.field}>
                    <th scope="row">{item.field}</th>
                    <td className="fg-diff-before">
                      <span className="visually-hidden">vorher: </span>
                      {item.before}
                    </td>
                    <td className="fg-diff-after">
                      <span className="visually-hidden">nachher: </span>
                      {item.after}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </li>
      ))}
    </ul>
  );
}

function CompareSection({ devices }: { devices: string[] }) {
  const [device, setDevice] = useState("");
  const [snapshots, setSnapshots] = useState<{ id: number; taken_at: string }[]>([]);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [result, setResult] = useState<FgCompare | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseDevice = (name: string) => {
    setDevice(name);
    setResult(null);
    setFirst("");
    setSecond("");
    setSnapshots([]);
    if (!name) {
      return;
    }
    fetchFgSnapshots(name).then(
      (value) => {
        setSnapshots(value.snapshots);
        setSecond(String(value.snapshots[0]?.id ?? ""));
        setFirst(String(value.snapshots[1]?.id ?? ""));
      },
      (caught: unknown) => setError(errorText(caught, "Die Abrufe konnten nicht geladen werden.")),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!device || !first || !second || first === second) {
      setError("Bitte wähle ein Gerät und zwei verschiedene Abrufe.");
      return;
    }
    setError(null);
    fetchFgCompare(device, Number(first), Number(second)).then(setResult, (caught: unknown) =>
      setError(errorText(caught, "Die Abrufe konnten nicht verglichen werden.")),
    );
  };

  return (
    <section className="panel" aria-labelledby="fg-vergleich">
      <div className="panel-head">
        <h2 id="fg-vergleich">
          Zwei Abrufe vergleichen <InfoTip term="fortigate.abruf-vergleich" />
        </h2>
      </div>
      <form className="detail-body fg-compare-form" noValidate onSubmit={submit}>
        <Field label="Gerät">
          {(control) => (
            <select
              {...control}
              value={device}
              onChange={(event) => chooseDevice(event.target.value)}
            >
              <option value="">bitte wählen</option>
              {devices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Älterer Abruf">
          {(control) => (
            <select
              {...control}
              value={first}
              disabled={snapshots.length < 2}
              onChange={(event) => setFirst(event.target.value)}
            >
              {snapshots.map((snap) => (
                <option key={snap.id} value={snap.id}>
                  {formatDateTime(snap.taken_at)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Neuerer Abruf">
          {(control) => (
            <select
              {...control}
              value={second}
              disabled={snapshots.length < 2}
              onChange={(event) => setSecond(event.target.value)}
            >
              {snapshots.map((snap) => (
                <option key={snap.id} value={snap.id}>
                  {formatDateTime(snap.taken_at)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="actions">
          <button type="submit" className="button button-secondary">
            Vergleichen
          </button>
        </div>
        {device && snapshots.length < 2 && (
          <p className="small">Für dieses Gerät gibt es nur einen Stand.</p>
        )}
      </form>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {result && (
        <div className="detail-body" role="status">
          <p className="small">
            Vergleich {result.device}: {formatDateTime(result.from.taken_at)} →{" "}
            {formatDateTime(result.to.taken_at)} ·{" "}
            {result.changes.length === 1 ? "1 Änderung" : `${result.changes.length} Änderungen`}
          </p>
          {result.changes.length > 0 && <ChangeList changes={result.changes} analyzer={false} />}
        </div>
      )}
    </section>
  );
}
