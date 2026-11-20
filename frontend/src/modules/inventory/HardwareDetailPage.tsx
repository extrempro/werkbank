import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { INVENTORY_HARDWARE_PATH } from "../../navigation";
import {
  fetchAssignees,
  fetchFloor,
  fetchHardware,
  fetchLocations,
  fetchMasterData,
  formatDate,
  formatDay,
  HARDWARE_TABS,
  hardwarePath,
  INVENTORY_EDITOR_ROLE,
  loanPath,
  locationPath,
  holderValue,
  modelLabel,
  ninjaFactRows,
  positionPath,
  psrefGroups,
  psrefHighlights,
  PSREF_STATUS_LABELS,
  reactivateHardware,
  refreshPsref,
  retireHardware,
  setInventoryNo,
  SOURCE_LABELS,
  today,
  updateHardware,
  WHEREABOUTS_LABELS,
  workplacePath,
  type Assignees,
  type Floor,
  type Hardware,
  type PsrefInfo,
  type HardwareTab,
  type Locations,
  type MasterData,
  type Whereabouts,
} from "./api";
import { deviceInput, DeviceFormFields, deviceProblem, type DeviceFields } from "./HardwarePage";
import { PlanView } from "./PlanView";

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
  locations,
  assignees,
  onDone,
}: {
  device: Hardware;
  master: MasterData;
  locations: Locations | null;
  assignees: Assignees | null;
  onDone: (next: Hardware | null) => void;
}) {
  const [fields, setFields] = useState<DeviceFields>({
    kindId: String(device.kind_id),
    modelId: device.model_id === null ? "" : String(device.model_id),
    name: device.name,
    serial: device.serial,
    hostname: device.hostname,
    note: device.note,
    roomId: device.location ? String(device.location.room_id) : "",
    holder: holderValue(device.position_id, device.workplace_id),
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
        locations={locations}
        assignees={assignees}
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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = value.trim();

  const save = () => {
    setBusy(true);
    setInventoryNo(device.id, next || null).then(onDone, (problem: unknown) => {
      setError(errorText(problem, "Die Inventurnummer konnte nicht gespeichert werden."));
      setConfirming(false);
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
    setConfirming(true);
  };

  let question: string;
  if (!next) {
    question = `Inventurnummer ${device.inventory_no ?? ""} wirklich entfernen?`;
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
          disabled={confirming}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="small">Leer lassen, um die Inventurnummer zu entfernen.</p>
      <ErrorBox text={error} />
      {confirming ? (
        <div className="hint-box hint-warn confirm-box">
          <p>
            {question} Bitte mit dem Aufkleber am Gerät vergleichen. Die Änderung steht danach im
            Verlauf.
          </p>
          <div className="project-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              autoFocus
              onClick={save}
            >
              Ja, übernehmen
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setConfirming(false)}
            >
              Zurück
            </button>
          </div>
        </div>
      ) : (
        <div className="project-actions">
          <button type="submit" className="button button-primary">
            Weiter
          </button>
          <button type="button" className="button button-secondary" onClick={() => onDone(null)}>
            Abbrechen
          </button>
        </div>
      )}
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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!reasonId) {
      setError("Bitte einen Grund wählen.");
      return;
    }
    if (!whereabouts) {
      setError("Bitte den Verbleib wählen.");
      return;
    }
    if (!day) {
      setError("Bitte ein Datum eintragen.");
      return;
    }
    if (device.has_storage && !wiped) {
      setError("Bitte bestätige, dass der Datenträger gelöscht oder vernichtet ist.");
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const save = () => {
    if (!whereabouts) {
      return;
    }
    setBusy(true);
    retireHardware(device.id, {
      reason_id: Number(reasonId),
      whereabouts,
      retired_on: day,
      wiped: device.has_storage ? wiped : false,
      note: note.trim(),
    }).then(onDone, (problem: unknown) => {
      setError(errorText(problem, "Das Gerät konnte nicht ausgemustert werden."));
      setConfirming(false);
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
            disabled={confirming}
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
            disabled={confirming}
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
            disabled={confirming}
            onChange={(event) => setDay(event.target.value)}
          />
        </label>
      </div>
      {device.has_storage && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={wiped}
            disabled={confirming}
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
          disabled={confirming}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <ErrorBox text={error} />
      {confirming ? (
        <div className="hint-box hint-warn confirm-box">
          <p>
            „{device.name}“ wirklich ausmustern? Das Gerät verschwindet aus der Liste „Im Bestand“
            und bleibt mit seinem Verlauf unter „Ausgemustert“ erhalten.
          </p>
          <div className="project-actions">
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              autoFocus
              onClick={save}
            >
              Ja, ausmustern
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setConfirming(false)}
            >
              Zurück
            </button>
          </div>
        </div>
      ) : (
        <div className="project-actions">
          <button type="submit" className="button button-primary">
            Weiter
          </button>
          <button type="button" className="button button-secondary" onClick={() => onDone(null)}>
            Abbrechen
          </button>
        </div>
      )}
    </form>
  );
}

function Overview({
  device,
  master,
  locations,
  assignees,
  canEdit,
  onChange,
}: {
  device: Hardware;
  master: MasterData | null;
  locations: Locations | null;
  assignees: Assignees | null;
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
                <dt>Datenträger</dt>
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
              <dt>Inventurnummer</dt>
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
              <dt>Herkunft</dt>
              <dd>{SOURCE_LABELS[device.source] ?? device.source}</dd>
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
          <EditForm
            device={device}
            master={master}
            locations={locations}
            assignees={assignees}
            onDone={done}
          />
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
  const [failed, setFailed] = useState<string | null>(null);
  const psref: PsrefInfo | null = device.psref;
  const lenovo = (device.maker ?? "").toLowerCase() === "lenovo";
  if (!psref && !(canEdit && lenovo)) {
    return null;
  }

  async function refresh() {
    setBusy(true);
    setFailed(null);
    try {
      onChange(await refreshPsref(device.id));
    } catch (error) {
      setFailed(errorText(error, "Die Daten konnten nicht aus PSREF geholt werden."));
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
        <p className="small">Für dieses Modell wurden noch keine Daten aus PSREF geholt.</p>
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
          {psrefGroups(psref.specs).map((group, index) => (
            <div key={`${group.group}-${index}`}>
              <h4 className="small">{group.group}</h4>
              <dl className="facts">
                {group.rows.map((row, rowIndex) => (
                  <div key={`${row.name}-${rowIndex}`}>
                    <dt>{row.name}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </details>
      )}
      <ErrorBox text={failed} />
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
        <PsrefSection device={device} canEdit={canEdit} onChange={onChange} />
      </div>
    </section>
  );
}

/** Reiter Standort: Grundriss der Etage, der Raum des Geräts ist hervorgehoben. */
function LocationTab({ device }: { device: Hardware }) {
  const floorId = device.location?.floor_id ?? null;
  const [floor, setFloor] = useState<Floor | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (floorId === null) {
      return;
    }
    let active = true;
    fetchFloor(floorId).then(
      (result) => active && setFloor(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Der Grundriss konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [floorId]);

  const location = device.location;
  const shown = floor && floor.id === floorId ? floor : null;
  return (
    <section className="panel" aria-labelledby="standort-titel">
      <div className="panel-head">
        <h2 id="standort-titel">Standort</h2>
        {location && (
          <Link to={locationPath(location.floor_id, location.room_id)}>Bei Standorte öffnen</Link>
        )}
      </div>
      <div className="detail-body">
        {!location && <p>Diesem Gerät ist kein Raum zugeordnet.</p>}
        {location && (
          <p>
            <strong>Raum {location.room}</strong>
            <br />
            <span className="small">
              {location.city} › {location.site} › {location.section} › {location.floor}
            </span>
          </p>
        )}
        <ErrorBox text={failed} />
        {location && !failed && !shown && <p role="status">Wird geladen …</p>}
        {location && shown && (
          <PlanView
            floor={shown}
            selectedId={location.room_id}
            label={`Grundriss ${location.floor}, Raum ${location.room} hervorgehoben`}
          />
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
  const [locations, setLocations] = useState<Locations | null>(null);
  const [assignees, setAssignees] = useState<Assignees | null>(null);
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
      fetchLocations().then(
        (result) => active && setLocations(result),
        () => undefined,
      );
      fetchAssignees().then(
        (result) => active && setAssignees(result),
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
            <Overview
              device={device}
              master={master}
              locations={locations}
              assignees={assignees}
              canEdit={canEdit}
              onChange={setDevice}
            />
          )}
          {tab === "standort" && <LocationTab device={device} />}
          {tab === "technik" && <TechTab device={device} canEdit={canEdit} onChange={setDevice} />}
          {tab === "verlauf" && <History device={device} />}
        </>
      )}
    </div>
  );
}
