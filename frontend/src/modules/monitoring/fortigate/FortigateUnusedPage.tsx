import { useEffect, useState } from "react";
import { errorText, formatDateTime } from "../../../api";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { MONITORING_FORTIGATE_OBJECTS_PATH } from "../../../navigation";
import {
  downloadCleanupList,
  fetchFgUnused,
  unusedCsvUrl,
  type FgUnused,
  type FgUnusedFilter,
  type FgUnusedKind,
  type FgUnusedRow,
} from "./api";

/* IT-Monitoring › FortiGate › Unbenutzte Objekte: zum Aufräumen, gelöscht wird nichts. */

const KIND_LABELS: Record<FgUnusedKind, string> = {
  addresses: "Adresse",
  address_groups: "Adressgruppe",
  services: "Dienst",
  service_groups: "Dienstgruppe",
  vips: "VIP",
  ippools: "IP-Pool",
};
const KINDS = Object.keys(KIND_LABELS) as FgUnusedKind[];
const DAYS = [
  { value: "", label: "egal" },
  { value: "30", label: "30 Tagen" },
  { value: "90", label: "90 Tagen" },
  { value: "365", label: "1 Jahr" },
];

function key(row: FgUnusedRow): string {
  return `${row.kind}|${row.name}`;
}

export function FortigateUnusedPage() {
  const [filter, setFilter] = useState<FgUnusedFilter>({
    device: "",
    kind: "",
    days: "",
    disabled: true,
    groups: true,
    defaults: false,
  });
  const [data, setData] = useState<FgUnused | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<FeedbackMessage | null>(null);

  useEffect(() => {
    let active = true;
    fetchFgUnused(filter).then(
      (value) => {
        if (active) {
          setData(value);
          setError(null);
          setPicked(new Set());
        }
      },
      (caught: unknown) =>
        active &&
        setError(errorText(caught, "Die unbenutzten Objekte konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [filter]);

  const change = (next: Partial<FgUnusedFilter>) =>
    setFilter((current) => ({ ...current, ...next }));
  const rows = data?.rows ?? [];
  const allPicked = rows.length > 0 && rows.every((row) => picked.has(key(row)));
  const moreActive = [filter.device, filter.days].filter(Boolean).length;

  const exportPicked = () => {
    const items = rows
      .filter((row) => picked.has(key(row)))
      .map((row) => ({ kind: row.kind, name: row.name }));
    downloadCleanupList(items, filter).then(
      () =>
        setMessage({
          kind: "status",
          text: `Die Aufräumliste mit ${items.length} Objekten ist heruntergeladen. Gelöscht wurde nichts.`,
        }),
      (caught: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(caught, "Die Aufräumliste konnte nicht erstellt werden."),
        }),
    );
  };

  return (
    <div className="page page-wide fg-page">
      <header className="page-head fg-head">
        <div>
          <p className="module-label">IT-Monitoring · FortiGate</p>
          <h1>Unbenutzte Objekte</h1>
          <p className="page-sub">
            Adressen, Gruppen, Dienste, VIPs und IP-Pools, die nirgends gebraucht werden. Die
            Werkbank löscht nichts; die Liste hilft beim Aufräumen auf den Geräten.
          </p>
        </div>
        <div className="fg-head-actions">
          <Link className="button button-secondary" to={MONITORING_FORTIGATE_OBJECTS_PATH}>
            Alle Objekte anzeigen
          </Link>
          <a className="button button-secondary" href={unusedCsvUrl(filter)} download>
            CSV exportieren
          </a>
        </div>
      </header>
      <FilterBar<string>
        status={{
          label: "Art",
          value: filter.kind,
          onChange: (value) => change({ kind: value }),
          options: [
            { value: "", label: "Alle", count: data ? data.rows.length : null },
            ...KINDS.map((value) => ({
              value,
              label: KIND_LABELS[value],
              count: data ? data.counts[value] : null,
            })),
          ],
        }}
        statusSelect
        moreActive={moreActive}
        onReset={
          moreActive || filter.kind ? () => change({ device: "", days: "", kind: "" }) : undefined
        }
        more={
          <>
            <label className="filter-field">
              Gerät
              <select
                value={filter.device}
                onChange={(event) => change({ device: event.target.value })}
              >
                <option value="">Alle Geräte</option>
                {(data?.devices ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Unbenutzt seit mindestens
              <select
                value={filter.days}
                onChange={(event) => change({ days: event.target.value })}
              >
                {DAYS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      <div className="fg-switches">
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={filter.disabled}
            onChange={(event) => change({ disabled: event.target.checked })}
          />
          Nur in deaktivierten Policies zählt als unbenutzt
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={filter.groups}
            onChange={(event) => change({ groups: event.target.checked })}
          />
          Nur in unbenutzten Gruppen zählt als unbenutzt
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={filter.defaults}
            onChange={(event) => change({ defaults: event.target.checked })}
          />
          Standardobjekte von FortiOS zeigen
        </label>
      </div>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {data && (
        <p className="small fg-count" role="status">
          {rows.length === 1 ? "1 unbenutztes Objekt" : `${rows.length} unbenutzte Objekte`} ·
          Fabric-Objekte zählen erst, wenn sie auf keinem Gerät genutzt werden.
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && rows.length === 0 && (
        <p className="empty">Kein unbenutztes Objekt passt zur Auswahl.</p>
      )}
      {rows.length > 0 && (
        <>
          <div className="table-wrap card-wrap">
            <table className="table-cards fg-table" aria-label="Unbenutzte Objekte">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      className="check"
                      aria-label="Alle auswählen"
                      checked={allPicked}
                      onChange={(event) =>
                        setPicked(event.target.checked ? new Set(rows.map(key)) : new Set())
                      }
                    />
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Art</th>
                  <th scope="col">Wert</th>
                  <th scope="col">Geräte</th>
                  <th scope="col">
                    Unbenutzt seit <InfoTip term="fortigate.unbenutzt-seit" />
                  </th>
                  <th scope="col">Grund</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={key(row)} className={picked.has(key(row)) ? "is-selected" : undefined}>
                    <td data-label="Auswahl">
                      <input
                        type="checkbox"
                        className="check"
                        aria-label={`${row.name} für die Aufräumliste wählen`}
                        checked={picked.has(key(row))}
                        onChange={(event) =>
                          setPicked((current) => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(key(row));
                            } else {
                              next.delete(key(row));
                            }
                            return next;
                          })
                        }
                      />
                    </td>
                    <th scope="row">
                      {row.name}
                      {row.fabric && <span className="fg-sub">Fabric-Objekt</span>}
                    </th>
                    <td data-label="Art">{KIND_LABELS[row.kind]}</td>
                    <td data-label="Wert">{row.value || "–"}</td>
                    <td data-label="Geräte">{row.devices.join(", ")}</td>
                    <td data-label="Unbenutzt seit">
                      {row.since ? formatDateTime(row.since) : "–"}
                    </td>
                    <td data-label="Grund">{row.reasons.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions fg-cleanup">
            <button
              type="button"
              className="button button-primary"
              disabled={picked.size === 0}
              onClick={exportPicked}
            >
              Auswahl als Aufräumliste ({picked.size})
            </button>
            <span className="small">Lädt eine CSV-Liste herunter. Gelöscht wird nichts.</span>
          </div>
        </>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
