import { useConfirm } from "../../components/ConfirmDialog";
import { DokuBacklinks } from "../doku/DokuBacklinks";
import { InfoTip } from "../../components/InfoTip";
import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { INVENTORY_HARDWARE_PATH } from "../../navigation";
import {
  fetchHardware,
  fetchMasterData,
  formatDate,
  formatDay,
  HARDWARE_TABS,
  hardwarePath,
  INVENTORY_EDITOR_ROLE,
  loanPath,
  locationPath,
  modelLabel,
  ninjaFactRows,
  positionPath,
  psrefHighlights,
  PSREF_STATUS_LABELS,
  refreshPsref,
  reactivateHardware,
  retireHardware,
  setInventoryNo,
  SOURCE_LABELS,
  today,
  updateHardware,
  WHEREABOUTS_LABELS,
  workplacePath,
  type Hardware,
  type HardwareTab,
  type MasterData,
  type Whereabouts,
  locationItem,
} from "./api";
import { deviceInput, DeviceFormFields, deviceProblem, type DeviceFields } from "./HardwarePage";
import { LocationPanel, PlaceLine } from "./PlaceInfo";
import { Feedback } from "../../components/Feedback";

type Mode = "ansicht" | "bearbeiten" | "inventur" | "ausmustern";

function ErrorBox({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="hint-box hint-bad">
      {text}
    </p>
  ) : null;
}

function EditForm({
  device,
  master,
  onDone,
}: {
  device: Hardware;
  master: MasterData;
  onDone: (next: Hardware | null) => void;
}) {
  const [fields, setFields] = useState<DeviceFields>({
    kindId: String(device.kind_id),
    modelId: device.model_id === null ? "" : String(device.model_id),
    name: device.name,
    serial: device.serial,
    hostname: device.hostname,
    note: device.note,
    purchasedOn: device.purchased_on ?? "",
    room: device.location ? locationItem(device.location) : null,
    holderKind: device.holder_ref?.kind ?? "",
    holder: device.holder_ref
      ? { id: device.holder_ref.id, label: device.holder_ref.label, detail: "" }
      : null,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const problem = deviceProblem(fields);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    updateHardware(device.id, deviceInput(fields)).then(onDone, (problem: unknown) => {
      setError(errorText(problem, "Die Änderung konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  return (
    <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
      <DeviceFormFields
        master={master}
        fromNinja={device.ninja?.ninja_id != null}
        value={fields}
        onChange={setFields}
      />
      <ErrorBox text={error} />
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Speichern
        </button>
        <button type="button" className="button button-secondary" onClick={() => onDone(null)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

/** Inventurnummer setzen, ändern oder entfernen – immer mit Rückfrage. */
function InventoryNoForm({
  device,
  onDone,
}: {
  device: Hardware;
  onDone: (next: Hardware | null) => void;
}) {
  const [value, setValue] = useState(device.inventory_no ?? "");
  const [ask, dialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = value.trim();

  const save = () => {
    setBusy(true);
    return setInventoryNo(device.id, next || null).then(onDone, (problem: unknown) => {
      setError(errorText(problem, "Die Inventurnummer konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (next === (device.inventory_no ?? "")) {
      onDone(null);
      return;
    }
    setError(null);
    ask(
      {
        title: question,
        text: "Bitte vergleiche sie mit dem Aufkleber am Gerät. Die Änderung steht danach im Verlauf.",
        action: next ? "Übernehmen" : "Entfernen",
      },
      save,
    );
  };

  let question: string;
  if (!next) {
    question = `Inventurnummer ${device.inventory_no ?? ""} entfernen?`;
  } else if (device.inventory_no) {
    question = `Inventurnummer von ${device.inventory_no} auf ${next} ändern?`;
  } else {
    question = `Inventurnummer ${next} für dieses Gerät eintragen?`;
  }

  return (
    <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
      <label className="narrow">
        Inventurnummer
        <input
          type="text"
          value={value}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="small">Leer lassen, um die Inventurnummer zu entfernen.</p>
      <ErrorBox text={error} />
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Weiter
        </button>
        <button type="button" className="button button-secondary" onClick={() => onDone(null)}>
          Abbrechen
        </button>
      </div>
      {dialog}
    </form>
  );
}

function RetireForm({
  device,
  master,
  onDone,
}: {
  device: Hardware;
  master: MasterData;
  onDone: (next: Hardware | null) => void;
}) {
  const [reasonId, setReasonId] = useState("");
  const [whereabouts, setWhereabouts] = useState<Whereabouts | "">("");
  const [day, setDay] = useState(today());
  const [wiped, setWiped] = useState(false);
  const [note, setNote] = useState("");
  const [ask, dialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!reasonId) {
      setError("Bitte wähle einen Grund.");
      return;
    }
    if (!whereabouts) {
      setError("Bitte wähle den Verbleib.");
      return;
    }
    if (!day) {
      setError("Bitte trag ein Datum ein.");
      return;
    }
    if (device.has_storage && !wiped) {
      setError("Bitte bestätige, dass der Datenträger gelöscht oder vernichtet ist.");
      return;
    }
    setError(null);
    ask(
      {
        title: `„${device.name}“ ausmustern?`,
        text: "Das Gerät verschwindet aus der Liste „Im Bestand“ und bleibt mit seinem Verlauf unter „Ausgemustert“ erhalten.",
        action: "Ausmustern",
      },
      save,
    );
  };

  const save = () => {
    if (!whereabouts) {
      return;
    }
    setBusy(true);
    return retireHardware(device.id, {
      reason_id: Number(reasonId),
      whereabouts,
      retired_on: day,
      wiped: device.has_storage ? wiped : false,
      note: note.trim(),
    }).then(onDone, (problem: unknown) => {
      setError(errorText(problem, "Das Gerät konnte nicht ausgemustert werden."));
      setBusy(false);
    });
  };

  return (
    <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
      <div className="tool-row">
        <label>
          Grund
          <select
            value={reasonId}
            disabled={busy}
            onChange={(event) => setReasonId(event.target.value)}
          >
            <option value="">Bitte wählen</option>
            {master.reasons.map((reason) => (
              <option key={reason.id} value={String(reason.id)}>
                {reason.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Verbleib
          <select
            value={whereabouts}
            disabled={busy}
            onChange={(event) => setWhereabouts(event.target.value as Whereabouts | "")}
          >
            <option value="">Bitte wählen</option>
            {(Object.keys(WHEREABOUTS_LABELS) as Whereabouts[]).map((key) => (
              <option key={key} value={key}>
                {WHEREABOUTS_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="narrow">
          Datum
          <input
            type="date"
            value={day}
            max={today()}
            disabled={busy}
            onChange={(event) => setDay(event.target.value)}
          />
        </label>
      </div>
      {device.has_storage && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={wiped}
            disabled={busy}
            onChange={(event) => setWiped(event.target.checked)}
          />
          Der Datenträger ist gelöscht oder vernichtet.
        </label>
      )}
      <label>
        Notiz (freiwillig), z. B. Nummer des Entsorgungsnachweises
        <input
          type="text"
          value={note}
          maxLength={300}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <ErrorBox text={error} />
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Weiter
        </button>
        <button type="button" className="button button-secondary" onClick={() => onDone(null)}>
          Abbrechen
        </button>
      </div>
      {dialog}
    </form>
  );
}

function Overview({
  device,
  master,
  canEdit,
  onChange,
}: {
  device: Hardware;
  master: MasterData | null;
  canEdit: boolean;
  onChange: (next: Hardware) => void;
}) {
  const [mode, setMode] = useState<Mode>("ansicht");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retired = device.status === "ausgemustert";

  const done = (next: Hardware | null) => {
    if (next) {
      onChange(next);
    }
    setMode("ansicht");
  };

  const reactivate = () => {
    setBusy(true);
    setError(null);
    reactivateHardware(device.id)
      .then(onChange, (problem: unknown) =>
        setError(errorText(problem, "Das Gerät konnte nicht wieder in Betrieb genommen werden.")),
      )
      .finally(() => setBusy(false));
  };

  const titles: Record<Mode, string> = {
    ansicht: "Übersicht",
    bearbeiten: "Gerät bearbeiten",
    inventur: "Inventurnummer",
    ausmustern: "Gerät ausmustern",
  };

  return (
    <>
      {device.loan && (
        <p className="hint-box">
          Verliehen an {device.loan.person_name} bis {formatDay(device.loan.due_on)} ·{" "}
          <Link to={loanPath(device.loan.id)}>Verleih {device.loan.number} öffnen</Link>
        </p>
      )}
      {retired && device.retire && (
        <section className="panel" aria-labelledby="ausgemustert-titel">
          <div className="panel-head">
            <h2 id="ausgemustert-titel">Ausgemustert</h2>
            {canEdit && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={reactivate}
              >
                Wieder in Betrieb nehmen
              </button>
            )}
          </div>
          <dl className="facts">
            <div>
              <dt>Datum</dt>
              <dd>{formatDay(device.retire.retired_on)}</dd>
            </div>
            <div>
              <dt>Grund</dt>
              <dd>{device.retire.reason}</dd>
            </div>
            <div>
              <dt>Verbleib</dt>
              <dd>
                {device.retire.whereabouts ? WHEREABOUTS_LABELS[device.retire.whereabouts] : "–"}
              </dd>
            </div>
            {device.retire.wiped !== null && (
              <div>
                <dt>
                  Datenträger <InfoTip term="bestand.datentraeger" />
                </dt>
                <dd>{device.retire.wiped ? "gelöscht oder vernichtet" : "nicht bestätigt"}</dd>
              </div>
            )}
            {device.retire.note && (
              <div>
                <dt>Notiz</dt>
                <dd>{device.retire.note}</dd>
              </div>
            )}
          </dl>
          <ErrorBox text={error} />
        </section>
      )}

      <section className="panel" aria-labelledby="geraet-daten">
        <div className="panel-head">
          <h2 id="geraet-daten">{titles[mode]}</h2>
          {canEdit && mode === "ansicht" && master && (
            <div className="project-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setMode("bearbeiten")}
              >
                Bearbeiten
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setMode("inventur")}
              >
                Inventurnummer
              </button>
              {!retired && (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setMode("ausmustern")}
                >
                  Ausmustern
                </button>
              )}
            </div>
          )}
        </div>
        {mode === "ansicht" && (
          <dl className="facts">
            <div>
              <dt>Art</dt>
              <dd>{device.kind}</dd>
            </div>
            <div>
              <dt>Hersteller und Modell</dt>
              <dd>{modelLabel(device)}</dd>
            </div>
            <div>
              <dt>Seriennummer</dt>
              <dd className="mono">{device.serial || "–"}</dd>
            </div>
            <div>
              <dt>
                Inventurnummer <InfoTip term="bestand.inventurnummer" />
              </dt>
              <dd className="mono">{device.inventory_no ?? "keine"}</dd>
            </div>
            <div>
              <dt>Standort</dt>
              <dd>
                {device.location ? (
                  <Link to={locationPath(device.location.floor_id, device.location.room_id)}>
                    {device.place}
                  </Link>
                ) : (
                  "–"
                )}
              </dd>
            </div>
            <div>
              <dt>Zugeordnet zu</dt>
              <dd>
                {device.holder_ref ? (
                  <Link
                    to={
                      device.holder_ref.kind === "stelle"
                        ? positionPath(device.holder_ref.id)
                        : workplacePath(device.holder_ref.id)
                    }
                  >
                    {device.holder_ref.kind === "stelle" ? "Stelle " : "Arbeitsplatz "}
                    {device.holder_ref.label}
                  </Link>
                ) : (
                  "–"
                )}
              </dd>
            </div>
            <div>
              <dt>Hostname</dt>
              <dd className="mono">{device.hostname || "–"}</dd>
            </div>
            <div>
              <dt>
                Herkunft <InfoTip term="bestand.herkunft" />
              </dt>
              <dd>{SOURCE_LABELS[device.source] ?? device.source}</dd>
            </div>
            <div>
              <dt>Angeschafft am</dt>
              <dd>{device.purchased_on ? formatDay(device.purchased_on) : "unbekannt"}</dd>
            </div>
            <div>
              <dt>Erfasst am</dt>
              <dd>{formatDate(device.created_at)}</dd>
            </div>
            {device.note && (
              <div>
                <dt>Notiz</dt>
                <dd>{device.note}</dd>
              </div>
            )}
          </dl>
        )}
        {mode === "bearbeiten" && master && (
          <EditForm device={device} master={master} onDone={done} />
        )}
        {mode === "inventur" && <InventoryNoForm device={device} onDone={done} />}
        {mode === "ausmustern" && master && (
          <RetireForm device={device} master={master} onDone={done} />
        )}
      </section>
    </>
  );
}

function History({ device }: { device: Hardware }) {
  return (
    <section className="panel" aria-labelledby="geraet-verlauf">
      <div className="panel-head">
        <h2 id="geraet-verlauf">Verlauf</h2>
      </div>
      <div className="detail-body">
        {device.events.length === 0 ? (
          <p className="empty">Noch keine Einträge.</p>
        ) : (
          <ol className="timeline">
            {device.events.map((event, index) => (
              <li key={`${event.occurred_at}-${index}`}>
                <div className="timeline-head">
                  <strong>{formatDate(event.occurred_at)}</strong>
                  <span className="small">{event.who}</span>
                </div>
                <span>{event.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** Reiter Technik: Kenndaten aus NinjaOne, nur lesend. */
/** Technische Daten des Modells aus Lenovo PSREF, mit Link und Abruf auf Zuruf. */
function PsrefSection({
  device,
  canEdit,
  onChange,
}: {
  device: Hardware;
  canEdit: boolean;
  onChange: (device: Hardware) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const psref = device.psref;
  const lenovo = (device.maker ?? "").trim().toLowerCase() === "lenovo";
  if (!psref && !(canEdit && lenovo)) {
    return null;
  }

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await refreshPsref(device.id);
      onChange(next);
      setMessage({
        kind: next.psref?.status === "fehler" ? "alert" : "status",
        text:
          next.psref?.status === "ok"
            ? "Die Daten aus PSREF sind aktuell."
            : next.psref?.status === "nicht_gefunden"
              ? "PSREF kennt dieses Modell nicht."
              : "Der Abruf aus PSREF ist fehlgeschlagen.",
      });
    } catch (error) {
      setMessage({
        kind: "alert",
        text: errorText(error, "Die Daten konnten nicht aus PSREF geholt werden."),
      });
    } finally {
      setBusy(false);
    }
  }

  const highlights = psref ? psrefHighlights(psref) : [];
  const link = psref && psref.url.startsWith("https://psref.lenovo.com/") ? psref.url : null;
  return (
    <div className="psref">
      <h3 className="sub-head">Lenovo PSREF</h3>
      {psref ? (
        <p className="small">
          {psref.name || "Modell"} · {PSREF_STATUS_LABELS[psref.status]}
          {psref.checked_at && ` · abgefragt ${formatDate(psref.checked_at)}`}
          {link && (
            <>
              {" · "}
              <a href={link} target="_blank" rel="noopener noreferrer">
                Bei PSREF öffnen
                <span className="visually-hidden"> (öffnet in neuem Tab)</span>
              </a>
            </>
          )}
        </p>
      ) : (
        <p className="small">
          Für dieses Modell wurden noch keine Daten aus PSREF geholt. Abgefragt werden
          Lenovo-Geräte, deren Modell ein Maschinentyp ist, z. B. 10T700BTGE.
        </p>
      )}
      {psref?.status === "fehler" && psref.error && (
        <p className="field-error">Grund: {psref.error}</p>
      )}
      {highlights.length > 0 && (
        <dl className="facts">
          {highlights.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {psref && psref.specs.length > 0 && (
        <details>
          <summary>Alle Merkmale ({psref.specs.length})</summary>
          <dl className="facts">
            {psref.specs.map((row, index) => (
              <div key={`${row.name}-${index}`}>
                <dt>{row.name}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {canEdit && lenovo && (
        <p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void refresh()}
            disabled={busy}
          >
            {busy ? "Wird abgerufen …" : "Bei PSREF abrufen"}
          </button>
        </p>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}

function TechTab({
  device,
  canEdit,
  onChange,
}: {
  device: Hardware;
  canEdit: boolean;
  onChange: (device: Hardware) => void;
}) {
  const ninja = device.ninja;
  return (
    <section className="panel" aria-labelledby="geraet-technik">
      <div className="panel-head">
        <h2 id="geraet-technik">Technik</h2>
        <span className="small">nur lesend, aus NinjaOne und Lenovo PSREF</span>
      </div>
      <div className="detail-body tech-list">
        <PsrefSection device={device} canEdit={canEdit} onChange={onChange} />
        {device.connected_to && (
          <p>
            Angeschlossen an{" "}
            <Link to={hardwarePath(device.connected_to.id)}>
              {device.connected_to.hostname || device.connected_to.name}
            </Link>{" "}
            <span className="small">· erkannt über das Custom Field in NinjaOne</span>
          </p>
        )}
        {device.monitors.length > 0 && (
          <div>
            <h3 className="sub-head">Angeschlossene Monitore</h3>
            <ul className="link-list">
              {device.monitors.map((monitor) => (
                <li key={monitor.id}>
                  <Link to={hardwarePath(monitor.id)}>{monitor.name}</Link>
                  {monitor.serial && <span className="small mono">{monitor.serial}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!ninja ? (
          <p className="empty">
            Für dieses Gerät gibt es keine technischen Daten: Es ist nicht mit NinjaOne verknüpft.
          </p>
        ) : (
          <>
            {ninja.missing_since && (
              <p className="hint-box hint-warn">
                Seit {formatDate(ninja.missing_since)} nicht mehr in NinjaOne.
              </p>
            )}
            <p className="small">
              Stand des letzten Abgleichs
              {ninja.seen_at ? ` vom ${formatDate(ninja.seen_at)}` : ""}
              {ninja.ninja_id !== null && (
                <>
                  {" "}
                  · ID in NinjaOne <span className="mono">{ninja.ninja_id}</span>
                </>
              )}
            </p>
            <dl className="facts">
              {ninjaFactRows(ninja.facts).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd className={row.mono ? "mono" : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </section>
  );
}

/** IT-Bestand › Hardware › Gerät: Übersicht mit Aktionen und Verlauf. */
export function HardwareDetailPage({
  hardwareId,
  tab,
  roles,
}: {
  hardwareId: number;
  tab: HardwareTab;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [device, setDevice] = useState<Hardware | null>(null);
  const [master, setMaster] = useState<MasterData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchHardware(hardwareId).then(
      (result) => active && setDevice(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Das Gerät konnte nicht geladen werden.")),
    );
    if (canEdit) {
      fetchMasterData().then(
        (result) => active && setMaster(result),
        () => undefined,
      );
    }
    return () => {
      active = false;
    };
  }, [hardwareId, canEdit]);

  return (
    <div className="page page-wide">
      <p className="small">
        <Link to={INVENTORY_HARDWARE_PATH}>← Alle Geräte</Link>
      </p>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !device && <p role="status">Wird geladen …</p>}
      {device && (
        <>
          <header className="page-head project-head">
            <div>
              <p className="module-label">IT-Bestand · {device.kind}</p>
              <h1>{device.name}</h1>
              <p className="page-sub">
                {[modelLabel(device), device.serial && `SN ${device.serial}`]
                  .filter((part) => part && part !== "–")
                  .join(" · ") || "Ohne Modell und Seriennummer"}
                {device.status === "ausgemustert" && (
                  <>
                    {" "}
                    <span className="pill pill-neutral">ausgemustert</span>
                  </>
                )}
              </p>
              <PlaceLine
                kind="geraet"
                id={device.id}
                reload={
                  (device.location?.room_id ?? 0) * 100000 +
                  (device.workplace_id ?? 0) * 100 +
                  (device.position_id ?? 0)
                }
              />
            </div>
          </header>
          <nav className="project-tabs" aria-label="Bereiche des Geräts">
            {HARDWARE_TABS.map((entry) => (
              <Link
                key={entry.id}
                to={hardwarePath(device.id, entry.id)}
                className={entry.id === tab ? "project-tab project-tab-on" : "project-tab"}
                aria-current={entry.id === tab ? "page" : undefined}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
          {tab === "uebersicht" && (
            <>
              <Overview device={device} master={master} canEdit={canEdit} onChange={setDevice} />
              <DokuBacklinks kind="hardware" id={device.id} />
            </>
          )}
          {tab === "standort" && (
            <LocationPanel
              key={`${device.location?.room_id}-${device.workplace_id}-${device.position_id}`}
              id="standort-titel"
              kind="geraet"
              objectId={device.id}
              emptyText="Diesem Gerät ist kein Raum zugeordnet, auch nicht über einen Arbeitsplatz oder eine Stelle."
            />
          )}
          {tab === "technik" && <TechTab device={device} canEdit={canEdit} onChange={setDevice} />}
          {tab === "verlauf" && <History device={device} />}
        </>
      )}
    </div>
  );
}
