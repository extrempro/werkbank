import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { INVENTORY_MASTER_PATH } from "../../navigation";
import { navigate } from "../../router";
import {
  createHardware,
  fetchAssignees,
  fetchHardwareList,
  fetchLocations,
  fetchMasterData,
  filterHardware,
  hardwarePath,
  INVENTORY_EDITOR_ROLE,
  modelLabel,
  parseHolder,
  roomChoices,
  SOURCE_LABELS,
  today,
  type Assignees,
  type HardwareSummary,
  type ListState,
  type Locations,
  type MasterData,
} from "./api";

const STATES: { id: ListState; label: string }[] = [
  { id: "aktiv", label: "Im Bestand" },
  { id: "ausgemustert", label: "Ausgemustert" },
  { id: "alle", label: "Alle" },
];

export interface DeviceFields {
  kindId: string;
  modelId: string;
  name: string;
  serial: string;
  hostname: string;
  note: string;
  /** Anschaffungsdatum JJJJ-MM-TT, leer = unbekannt */
  purchasedOn: string;
  roomId: string;
  /** „s:4“ für Stelle 4, „w:2“ für Arbeitsplatz 2, leer ohne Zuordnung */
  holder: string;
}

/** Felder eines Geräts; beim Anlegen und Bearbeiten gleich. */
export function DeviceFormFields({
  master,
  locations,
  assignees,
  value,
  onChange,
  fromNinja = false,
}: {
  master: MasterData;
  /** Hostname und Seriennummer kommen aus NinjaOne und sind dann nur lesbar. */
  fromNinja?: boolean;
  /** Standorte für die Raumauswahl; null, solange sie laden oder fehlen. */
  locations: Locations | null;
  /** Stellen und Arbeitsplätze für „Zugeordnet zu“; null, solange sie laden oder fehlen. */
  assignees: Assignees | null;
  value: DeviceFields;
  onChange: (next: DeviceFields) => void;
}) {
  const set = (patch: Partial<DeviceFields>) => onChange({ ...value, ...patch });
  const groups = locations ? roomChoices(locations) : [];
  return (
    <>
      <div className="tool-row">
        <label>
          Bezeichnung
          <input
            type="text"
            value={value.name}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label className="narrow">
          Art
          <select value={value.kindId} onChange={(event) => set({ kindId: event.target.value })}>
            <option value="">Bitte wählen</option>
            {master.kinds.map((kind) => (
              <option key={kind.id} value={String(kind.id)}>
                {kind.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tool-row">
        <label>
          Hersteller und Modell (freiwillig)
          <select value={value.modelId} onChange={(event) => set({ modelId: event.target.value })}>
            <option value="">kein Modell</option>
            {master.makers
              .filter((maker) => maker.models.length > 0)
              .map((maker) => (
                <optgroup key={maker.id} label={maker.name}>
                  {maker.models.map((model) => (
                    <option key={model.id} value={String(model.id)}>
                      {maker.name} {model.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </label>
        <label className="narrow">
          Seriennummer
          <input
            type="text"
            value={value.serial}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            readOnly={fromNinja}
            onChange={(event) => set({ serial: event.target.value })}
          />
        </label>
      </div>
      <div className="tool-row">
        <label className="narrow">
          Hostname (freiwillig)
          <input
            type="text"
            value={value.hostname}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            readOnly={fromNinja}
            onChange={(event) => set({ hostname: event.target.value })}
          />
        </label>
        {fromNinja && <p className="small">Hostname und Seriennummer kommen aus NinjaOne.</p>}
        <label>
          Angeschafft am (freiwillig)
          <input
            type="date"
            value={value.purchasedOn}
            min="1990-01-01"
            max={today()}
            onChange={(event) => set({ purchasedOn: event.target.value })}
          />
        </label>
        <label>
          Notiz (freiwillig)
          <input
            type="text"
            value={value.note}
            maxLength={500}
            onChange={(event) => set({ note: event.target.value })}
          />
        </label>
      </div>
      <label>
        Raum (freiwillig)
        <select value={value.roomId} onChange={(event) => set({ roomId: event.target.value })}>
          <option value="">kein Raum</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.rooms.map((room) => (
                <option key={room.id} value={String(room.id)}>
                  {room.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {locations && groups.length === 0 && (
        <p className="small">Räume lassen sich unter Standorte auf einem Grundriss anlegen.</p>
      )}
      <label>
        Zugeordnet zu (freiwillig)
        <select value={value.holder} onChange={(event) => set({ holder: event.target.value })}>
          <option value="">niemandem</option>
          {assignees && assignees.positions.length > 0 && (
            <optgroup label="Stellen">
              {assignees.positions.map((entry) => (
                <option key={entry.id} value={`s:${entry.id}`}>
                  {entry.number} {entry.name}
                  {entry.person_name ? ` (${entry.person_name})` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {assignees && assignees.workplaces.length > 0 && (
            <optgroup label="Arbeitsplätze">
              {assignees.workplaces.map((entry) => (
                <option key={entry.id} value={`w:${entry.id}`}>
                  {entry.number} {entry.name}
                  {entry.place ? ` (${entry.place})` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
    </>
  );
}

/** Prüft die Felder; liefert einen Fehlertext oder null. */
export function deviceProblem(value: DeviceFields): string | null {
  if (!value.name.trim()) {
    return "Bitte eine Bezeichnung eintragen.";
  }
  if (!value.kindId) {
    return "Bitte die Art wählen.";
  }
  if (value.purchasedOn && (value.purchasedOn < "1990-01-01" || value.purchasedOn > today())) {
    return "Das Anschaffungsdatum liegt nicht in einem sinnvollen Bereich.";
  }
  return null;
}

export function deviceInput(value: DeviceFields) {
  return {
    kind_id: Number(value.kindId),
    model_id: value.modelId ? Number(value.modelId) : null,
    name: value.name.trim(),
    serial: value.serial.trim(),
    hostname: value.hostname.trim(),
    note: value.note.trim(),
    purchased_on: value.purchasedOn || null,
    room_id: value.roomId ? Number(value.roomId) : null,
    ...parseHolder(value.holder),
  };
}

/** Neues Gerät von Hand; mit Inventurnummer erst nach einer Rückfrage. */
function NewDeviceForm({
  master,
  locations,
  assignees,
  onCancel,
}: {
  master: MasterData;
  locations: Locations | null;
  assignees: Assignees | null;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<DeviceFields>({
    kindId: "",
    modelId: "",
    name: "",
    serial: "",
    hostname: "",
    note: "",
    purchasedOn: "",
    roomId: "",
    holder: "",
  });
  const [inventoryNo, setInventoryNo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    setBusy(true);
    setError(null);
    createHardware({ ...deviceInput(fields), inventory_no: inventoryNo.trim() || null })
      .then((device) => navigate(hardwarePath(device.id)))
      .catch((problem: unknown) => {
        setError(errorText(problem, "Das Gerät konnte nicht angelegt werden."));
        setConfirming(false);
        setBusy(false);
      });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const problem = deviceProblem(fields);
    if (problem) {
      setError(problem);
      return;
    }
    if (inventoryNo.trim()) {
      setError(null);
      setConfirming(true);
      return;
    }
    save();
  };

  return (
    <section className="panel" aria-labelledby="geraet-neu-titel">
      <div className="panel-head">
        <h2 id="geraet-neu-titel">Gerät erfassen</h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <DeviceFormFields
          master={master}
          locations={locations}
          assignees={assignees}
          value={fields}
          onChange={setFields}
        />
        <label className="narrow">
          Inventurnummer (freiwillig)
          <input
            type="text"
            value={inventoryNo}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            disabled={confirming}
            onChange={(event) => setInventoryNo(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        {confirming ? (
          <div className="hint-box hint-warn confirm-box">
            <p>
              Inventurnummer <strong className="mono">{inventoryNo.trim()}</strong> für dieses Gerät
              eintragen? Bitte mit dem Aufkleber am Gerät vergleichen. Später lässt sie sich nur mit
              Bestätigung ändern.
            </p>
            <div className="project-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                autoFocus
                onClick={save}
              >
                Ja, Gerät anlegen
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
            <button type="submit" className="button button-primary" disabled={busy}>
              Gerät anlegen
            </button>
            <button type="button" className="button button-secondary" onClick={onCancel}>
              Abbrechen
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

/** IT-Bestand › Hardware: alle Geräte mit Suche und Filtern. */
export function HardwarePage({ roles }: { roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [state, setState] = useState<ListState>("aktiv");
  // Geladene Liste mit dem Status, für den sie gilt; beim Umschalten zählt sie als „lädt“.
  const [loaded, setLoaded] = useState<{ state: ListState; items: HardwareSummary[] } | null>(null);
  const list = loaded && loaded.state === state ? loaded.items : null;
  const [master, setMaster] = useState<MasterData | null>(null);
  const [locations, setLocations] = useState<Locations | null>(null);
  const [assignees, setAssignees] = useState<Assignees | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindId, setKindId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMasterData().then(
      (result) => active && setMaster(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Stammdaten konnten nicht geladen werden.")),
    );
    // Ohne Standorte bleibt die Raumauswahl leer; das ist kein Fehler der Seite.
    fetchLocations().then(
      (result) => active && setLocations(result),
      () => undefined,
    );
    fetchAssignees().then(
      (result) => active && setAssignees(result),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchHardwareList(state).then(
      (result) => active && setLoaded({ state, items: result }),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Hardware konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [state]);

  const shown = list ? filterHardware(list, query, kindId) : [];
  const kindsInList = master
    ? master.kinds.filter((kind) => list?.some((device) => device.kind_id === kind.id))
    : [];

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Hardware</h1>
          <p className="page-sub">
            Alle Geräte mit Inventurnummer, Seriennummer und Verlauf. Ausgemusterte Geräte bleiben
            mit ihrem Verlauf erhalten.
          </p>
        </div>
        {canEdit && !creating && master && (
          <button
            type="button"
            className="button button-primary"
            aria-expanded={creating}
            onClick={() => setCreating(true)}
          >
            Gerät erfassen
          </button>
        )}
      </header>

      {canEdit && creating && master && master.kinds.length === 0 && (
        <p className="hint-box hint-warn">
          Lege zuerst unter <Link to={INVENTORY_MASTER_PATH}>Stammdaten</Link> mindestens eine
          Hardware-Art an.
        </p>
      )}
      {canEdit && creating && master && master.kinds.length > 0 && (
        <NewDeviceForm
          master={master}
          locations={locations}
          assignees={assignees}
          onCancel={() => setCreating(false)}
        />
      )}

      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}

      <section className="panel" aria-labelledby="hardware-liste">
        <div className="panel-head">
          <h2 id="hardware-liste">Geräte</h2>
          <div className="chips" role="group" aria-label="Status">
            {STATES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="chip chip-filter"
                aria-pressed={state === entry.id}
                onClick={() => setState(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div className="detail-body settings-form">
          <div className="tool-row">
            <label>
              Geräte durchsuchen
              <input
                type="search"
                value={query}
                maxLength={100}
                autoComplete="off"
                placeholder="Bezeichnung, Seriennummer, Inventurnummer …"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="narrow">
              Nach Art filtern
              <select
                value={kindId === null ? "" : String(kindId)}
                onChange={(event) =>
                  setKindId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">Alle Arten</option>
                {kindsInList.map((kind) => (
                  <option key={kind.id} value={String(kind.id)}>
                    {kind.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!failed && !list && <p role="status">Wird geladen …</p>}
          {list && (
            <p className="small" role="status">
              {shown.length === 0
                ? "Keine Geräte für diese Auswahl."
                : `${shown.length} von ${list.length} Geräten`}
            </p>
          )}
        </div>
        {list && shown.length > 0 && (
          <div className="table-wrap card-wrap">
            <table className="table-cards" role="table">
              <caption className="visually-hidden">Geräte im IT-Bestand</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    Gerät
                  </th>
                  <th scope="col" role="columnheader">
                    Art
                  </th>
                  <th scope="col" role="columnheader">
                    Hersteller und Modell
                  </th>
                  <th scope="col" role="columnheader">
                    Seriennummer
                  </th>
                  <th scope="col" role="columnheader">
                    Inventurnummer
                  </th>
                  <th scope="col" role="columnheader">
                    Standort
                  </th>
                  <th scope="col" role="columnheader">
                    Herkunft
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {shown.map((device) => (
                  <tr key={device.id} role="row">
                    <th scope="row" role="rowheader">
                      <Link to={hardwarePath(device.id)}>{device.name}</Link>
                      {device.hostname && (
                        <span className="small tenant-part mono">{device.hostname}</span>
                      )}
                      {device.status === "ausgemustert" && (
                        <span className="pill pill-neutral">ausgemustert</span>
                      )}
                    </th>
                    <td role="cell" data-label="Art">
                      {device.kind}
                    </td>
                    <td role="cell" data-label="Hersteller und Modell">
                      {modelLabel(device)}
                    </td>
                    <td role="cell" data-label="Seriennummer" className="mono">
                      {device.serial || "–"}
                    </td>
                    <td role="cell" data-label="Inventurnummer" className="mono">
                      {device.inventory_no ?? "–"}
                    </td>
                    <td role="cell" data-label="Standort">
                      {device.place ?? "–"}
                    </td>
                    <td role="cell" data-label="Herkunft">
                      {SOURCE_LABELS[device.source] ?? device.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
