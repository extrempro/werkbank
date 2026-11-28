import { useEffect, useState } from "react";
import { errorText, formatDateTime } from "../../../api";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { ADMIN_NETBIRD_PATH } from "../../../navigation";
import { LEVEL_LABELS, LevelPill, NbDataBar, NbHead, useLoaded } from "./NetbirdPages";
import { NbEventTable } from "./NetbirdEvents";
import {
  fetchNbEvents,
  fetchNbPolicies,
  type NbEvent,
  type NbLevel,
  type NbPolicies,
  type NbSetupKey,
} from "./api";

/* IT-Monitoring › NetBird › Richtlinien & Ereignisse. Nur lesend. */

const FINDINGS_SHOWN = 6;
const ROWS_SHOWN = 20;
const EVENTS_PAGE = 50;
const EVENT_DAYS = [7, 30, 90] as const;
const KEY_TYPES: Record<string, string> = {
  reusable: "wiederverwendbar",
  "one-off": "einmalig",
};
const KEY_STATES: Record<string, string> = {
  valid: "gültig",
  expired: "abgelaufen",
  revoked: "widerrufen",
  overused: "aufgebraucht",
};

export function NetbirdPoliciesPage() {
  const { data, error } = useLoaded<NbPolicies>(
    fetchNbPolicies,
    "Richtlinien und Setup-Keys konnten nicht geladen werden.",
    [],
  );
  return (
    <div className="page page-wide nb-page">
      <NbHead
        title="Richtlinien & Ereignisse"
        sub="Prüfung der Richtlinien, Setup-Keys und das Ereignisprotokoll von NetBird."
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      <NbDataBar data={data} />
      {data?.configured && data.data_at && (
        <>
          <Findings data={data} />
          <SetupKeys data={data} />
          <Policies data={data} />
          <Events data={data} />
        </>
      )}
    </div>
  );
}

function Findings({ data }: { data: NbPolicies }) {
  const [level, setLevel] = useState("");
  const [all, setAll] = useState(false);
  const shown = data.findings.filter((item) => !level || item.level === level);
  const visible = all ? shown : shown.slice(0, FINDINGS_SHOWN);
  return (
    <section className="panel" aria-labelledby="nb-pruefung">
      <div className="panel-head nb-panel-head">
        <h2 id="nb-pruefung">
          Prüfung der Richtlinien <InfoTip term="netbird.pruefung" />
        </h2>
        <label className="filter-field">
          Stufe
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">Alle ({data.findings.length})</option>
            {(["kritisch", "warnung", "info"] as NbLevel[]).map((key) => (
              <option key={key} value={key}>
                {LEVEL_LABELS[key]} ({data.findings.filter((item) => item.level === key).length})
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data.policies_available ? (
        <p className="empty">
          NetBird liefert keine Richtlinien. Hat das API-Token Leserecht auf Richtlinien?
        </p>
      ) : shown.length === 0 ? (
        <p className="empty">Keine Auffälligkeiten.</p>
      ) : (
        <ul className="nb-hints">
          {visible.map((item) => (
            <li key={item.key}>
              <LevelPill level={item.level} />
              <div>
                <strong>{item.title}</strong>
                <p className="small">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown.length > FINDINGS_SHOWN && (
        <p className="detail-body">
          <button type="button" className="button button-secondary" onClick={() => setAll(!all)}>
            {all ? "Weniger anzeigen" : `${shown.length - FINDINGS_SHOWN} weitere anzeigen`}
          </button>
        </p>
      )}
      {data.policies_available && data.server_groups.length === 0 && (
        <p className="detail-body small">
          Für die Prüfung „Zugriff auf Server ohne Posture Check“ trägt ein Admin die Server-Gruppen
          in der Verwaltung unter <Link to={ADMIN_NETBIRD_PATH}>NetBird</Link> ein.
        </p>
      )}
    </section>
  );
}

function expiresText(key: NbSetupKey): string {
  if (key.expires === null || key.days_left === null) {
    return "kein Ablauf";
  }
  if (key.days_left < 0) {
    return `abgelaufen am ${formatDateTime(key.expires)}`;
  }
  if (key.days_left === 0) {
    return "heute";
  }
  return key.days_left === 1 ? "in 1 Tag" : `in ${key.days_left} Tagen`;
}

function SetupKeys({ data }: { data: NbPolicies }) {
  const [all, setAll] = useState(false);
  const rows = all ? data.setup_keys : data.setup_keys.slice(0, ROWS_SHOWN);
  return (
    <section className="panel" aria-labelledby="nb-setupkeys">
      <div className="panel-head">
        <h2 id="nb-setupkeys">
          Setup-Keys <InfoTip term="netbird.setupkey" />
        </h2>
      </div>
      {!data.setup_keys_available ? (
        <p className="empty">NetBird liefert keine Setup-Keys.</p>
      ) : data.setup_keys.length === 0 ? (
        <p className="empty">In NetBird sind keine Setup-Keys angelegt.</p>
      ) : (
        <div className="table-wrap card-wrap">
          <table className="table-cards fg-table" aria-label="Setup-Keys">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Art</th>
                <th scope="col">Gruppen</th>
                <th scope="col">Ablauf</th>
                <th scope="col" className="number">
                  Nutzung
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((key) => (
                <tr key={key.id}>
                  <th scope="row">
                    {key.name}
                    {!key.active && (
                      <span className="fg-sub">{KEY_STATES[key.state] ?? key.state}</span>
                    )}
                  </th>
                  <td data-label="Art">
                    {KEY_TYPES[key.type] ?? key.type}
                    {key.ephemeral && <span className="fg-sub">kurzlebige Peers</span>}
                  </td>
                  <td data-label="Gruppen">{key.groups.join(", ") || "–"}</td>
                  <td
                    data-label="Ablauf"
                    className={
                      key.active && key.days_left !== null && key.days_left <= 7
                        ? "nb-bad"
                        : key.active && key.days_left !== null && key.days_left <= 30
                          ? "nb-warn"
                          : undefined
                    }
                  >
                    {expiresText(key)}
                  </td>
                  <td data-label="Nutzung" className="number">
                    {key.usage_limit > 0
                      ? `${key.used_times} von ${key.usage_limit}`
                      : key.used_times}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.setup_keys.length > ROWS_SHOWN && (
        <p className="detail-body">
          <button type="button" className="button button-secondary" onClick={() => setAll(!all)}>
            {all ? "Weniger anzeigen" : `${data.setup_keys.length - ROWS_SHOWN} weitere anzeigen`}
          </button>
        </p>
      )}
    </section>
  );
}

function Policies({ data }: { data: NbPolicies }) {
  const [all, setAll] = useState(false);
  const rows = all ? data.policies : data.policies.slice(0, ROWS_SHOWN);
  if (!data.policies_available) {
    return null;
  }
  return (
    <section className="panel" aria-labelledby="nb-richtlinien">
      <div className="panel-head">
        <h2 id="nb-richtlinien">Richtlinien</h2>
      </div>
      {data.policies.length === 0 ? (
        <p className="empty">In NetBird sind keine Richtlinien angelegt.</p>
      ) : (
        <div className="table-wrap card-wrap">
          <table className="table-cards fg-table" aria-label="Richtlinien">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Quelle</th>
                <th scope="col">Ziel</th>
                <th scope="col">Protokoll · Ports</th>
                <th scope="col">
                  Posture Checks <InfoTip term="netbird.posture" />
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  Geändert <InfoTip term="netbird.geaendert" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((policy) => (
                <tr key={policy.id}>
                  <th scope="row">{policy.name}</th>
                  <td data-label="Quelle">{policy.sources.join(", ") || "–"}</td>
                  <td data-label="Ziel">{policy.destinations.join(", ") || "–"}</td>
                  <td data-label="Protokoll · Ports">{policy.ports}</td>
                  <td data-label="Posture Checks">
                    {policy.posture_checks.join(", ") || "keiner"}
                  </td>
                  <td data-label="Status">
                    {policy.enabled ? (
                      <span className="pill pill-ok">aktiv</span>
                    ) : (
                      <span className="pill pill-neutral">
                        {policy.disabled_days !== null && policy.disabled_days > 0
                          ? `deaktiviert seit ${policy.disabled_days} ${policy.disabled_days === 1 ? "Tag" : "Tagen"}`
                          : "deaktiviert"}
                      </span>
                    )}
                  </td>
                  <td data-label="Geändert">
                    {policy.changed_at ? formatDateTime(policy.changed_at) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.policies.length > ROWS_SHOWN && (
        <p className="detail-body">
          <button type="button" className="button button-secondary" onClick={() => setAll(!all)}>
            {all ? "Weniger anzeigen" : `${data.policies.length - ROWS_SHOWN} weitere anzeigen`}
          </button>
        </p>
      )}
    </section>
  );
}

function Events({ data }: { data: NbPolicies }) {
  const [kind, setKind] = useState("");
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<NbEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchNbEvents({ kind, days, offset: 0, limit: EVENTS_PAGE }).then(
      (value) => {
        if (active) {
          setEvents(value.items);
          setTotal(value.total);
          setError(null);
        }
      },
      (caught: unknown) =>
        active && setError(errorText(caught, "Die Ereignisse konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [kind, days, data.data_at]);
  const more = () => {
    setBusy(true);
    fetchNbEvents({ kind, days, offset: events?.length ?? 0, limit: EVENTS_PAGE })
      .then((value) => {
        setEvents([...(events ?? []), ...value.items]);
        setTotal(value.total);
      })
      .catch((caught: unknown) =>
        setError(errorText(caught, "Die Ereignisse konnten nicht geladen werden.")),
      )
      .finally(() => setBusy(false));
  };
  return (
    <section className="panel" aria-labelledby="nb-ereignisse">
      <div className="panel-head">
        <h2 id="nb-ereignisse">
          Ereignisprotokoll <InfoTip term="netbird.ereignisse" />
        </h2>
      </div>
      {!data.events_available ? (
        <p className="empty">
          NetBird liefert kein Ereignisprotokoll. Hat das API-Token Leserecht auf Ereignisse?
        </p>
      ) : (
        <>
          <FilterBar<string>
            plain
            statusSelect
            status={{
              label: "Art",
              value: kind,
              onChange: (value) => {
                setKind(value);
              },
              options: [
                { value: "", label: "Alle Arten" },
                ...data.categories.map((item) => ({ value: item.value, label: item.label })),
              ],
            }}
            moreActive={days !== 7 ? 1 : 0}
            more={
              <label className="filter-field">
                Zeitraum
                <select
                  value={days}
                  onChange={(event) => {
                    setDays(Number(event.target.value));
                  }}
                >
                  {EVENT_DAYS.map((value) => (
                    <option key={value} value={value}>
                      {value} Tage
                    </option>
                  ))}
                </select>
              </label>
            }
            onReset={
              kind || days !== 7
                ? () => {
                    setKind("");
                    setDays(7);
                  }
                : undefined
            }
          />
          {error && (
            <p role="alert" className="hint-box hint-bad">
              {error}
            </p>
          )}
          {events === null && !error ? (
            <p role="status">Wird geladen …</p>
          ) : events && events.length === 0 ? (
            <p className="empty">Keine Ereignisse in diesem Zeitraum.</p>
          ) : (
            events && <NbEventTable events={events} label="Ereignisse" />
          )}
          {events && total > events.length && (
            <p className="detail-body">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={more}
              >
                Mehr anzeigen ({total - events.length} weitere)
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
