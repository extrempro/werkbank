import { useEffect, useState, type FormEvent } from "react";
import {
  ErrorSummary,
  Field,
  problemFor,
  RequiredNote,
  Segmented,
  type Problem,
} from "../../components/Field";
import { ListChoice } from "../../components/ListChoice";
import { errorText } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { FilterBar } from "../../components/FilterBar";
import { Link } from "../../components/Link";
import { INVENTORY_MASTER_PATH } from "../../navigation";
import { navigate } from "../../router";
import {
  createHardware,
  fetchHardwareList,
  fetchMasterData,
  hardwarePath,
  INVENTORY_EDITOR_ROLE,
  modelLabel,
  SOURCE_LABELS,
  today,
  type HardwareList,
  type HardwareSummary,
  type LookupItem,
  type ListState,
  type MasterData,
} from "./api";
import { LookupPicker } from "./LookupPicker";
import { MoreButton, useDebounced, usePagedList } from "./paged";

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
  room: LookupItem | null;
  /** Zuordnung: an eine Stelle, an einen Arbeitsplatz oder an niemanden */
  holderKind: HolderKind;
  holder: LookupItem | null;
}

export type HolderKind = "" | "stelle" | "arbeitsplatz";

const HOLDER_KINDS: { value: HolderKind; label: string }[] = [
  { value: "", label: "Niemandem" },
  { value: "stelle", label: "Stelle" },
  { value: "arbeitsplatz", label: "Arbeitsplatz" },
];

/** Leere Felder für ein neues Gerät. */
export const EMPTY_DEVICE: DeviceFields = {
  kindId: "",
  modelId: "",
  name: "",
  serial: "",
  hostname: "",
  note: "",
  purchasedOn: "",
  room: null,
  holderKind: "",
  holder: null,
};

/** Felder eines Geräts; beim Anlegen und Bearbeiten gleich. */
export function DeviceFormFields({
  master,
  value,
  onChange,
  fromNinja = false,
  problems = [],
}: {
  master: MasterData;
  /** Hostname und Seriennummer kommen aus NinjaOne und sind dann nur lesbar. */
  fromNinja?: boolean;
  value: DeviceFields;
  onChange: (next: DeviceFields) => void;
  /** Fehlende oder falsche Angaben nach dem Absenden (`deviceProblems`) */
  problems?: readonly Problem[];
}) {
  const set = (patch: Partial<DeviceFields>) => onChange({ ...value, ...patch });
  const models = master.makers.flatMap((maker) =>
    maker.models.map((model) => ({
      id: model.id,
      label: `${maker.name} ${model.name}`,
      detail: maker.name,
    })),
  );
  return (
    <div className="form-grid">
      <Field
        label="Bezeichnung"
        id="geraet-name"
        required
        error={problemFor(problems, "geraet-name")}
      >
        {(control) => (
          <input
            {...control}
            type="text"
            value={value.name}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => set({ name: event.target.value })}
          />
        )}
      </Field>
      <ListChoice
        label="Art"
        id="geraet-art"
        required
        unit="Arten"
        placeholder="Art des Geräts …"
        options={master.kinds.map((kind) => ({ id: kind.id, label: kind.name }))}
        value={value.kindId}
        onChange={(kindId) => set({ kindId })}
        error={problemFor(problems, "geraet-art")}
      />
      <ListChoice
        label="Hersteller und Modell"
        none="Kein Modell"
        unit="Modelle"
        placeholder="Hersteller oder Modell …"
        hint="freiwillig"
        options={models}
        value={value.modelId}
        onChange={(modelId) => set({ modelId })}
      />
      <Field label="Seriennummer" hint={fromNinja ? "Kommt aus NinjaOne." : undefined}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={value.serial}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            readOnly={fromNinja}
            onChange={(event) => set({ serial: event.target.value })}
          />
        )}
      </Field>
      <Field label="Hostname" hint={fromNinja ? "Kommt aus NinjaOne." : "freiwillig"}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={value.hostname}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            readOnly={fromNinja}
            onChange={(event) => set({ hostname: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="Angeschafft am"
        id="geraet-angeschafft"
        hint="freiwillig"
        error={problemFor(problems, "geraet-angeschafft")}
      >
        {(control) => (
          <input
            {...control}
            type="date"
            value={value.purchasedOn}
            min="1990-01-01"
            max={today()}
            onChange={(event) => set({ purchasedOn: event.target.value })}
          />
        )}
      </Field>
      <Field label="Notiz" hint="freiwillig" wide>
        {(control) => (
          <input
            {...control}
            type="text"
            value={value.note}
            maxLength={500}
            onChange={(event) => set({ note: event.target.value })}
          />
        )}
      </Field>
      <div className="field-wide">
        <LookupPicker
          kind="room"
          label="Raum"
          hint="freiwillig"
          placeholder="Raum, Etage oder Standort …"
          value={value.room}
          onChange={(room) => set({ room })}
        />
      </div>
      <Segmented
        label="Zugeordnet zu"
        wide
        value={value.holderKind}
        options={HOLDER_KINDS}
        onChange={(holderKind) =>
          holderKind !== value.holderKind && set({ holderKind, holder: null })
        }
      />
      {value.holderKind !== "" && (
        <div className="field-wide">
          <LookupPicker
            kind={value.holderKind === "stelle" ? "position" : "workplace"}
            label={value.holderKind === "stelle" ? "Stelle" : "Arbeitsplatz"}
            id="geraet-zuordnung"
            required
            placeholder={
              value.holderKind === "stelle" ? "Nummer, Name oder Person …" : "Nummer oder Raum …"
            }
            value={value.holder}
            onChange={(holder) => set({ holder })}
            error={problemFor(problems, "geraet-zuordnung")}
          />
        </div>
      )}
    </div>
  );
}

/** Prüft die Felder; liefert die fehlenden oder falschen Angaben (leer: alles in Ordnung). */
export function deviceProblems(value: DeviceFields): Problem[] {
  const problems: Problem[] = [];
  if (!value.name.trim()) {
    problems.push({ id: "geraet-name", label: "Bezeichnung", text: "Trag eine Bezeichnung ein." });
  }
  if (!value.kindId) {
    problems.push({ id: "geraet-art", label: "Art", text: "Wähle die Art." });
  }
  if (value.purchasedOn && (value.purchasedOn < "1990-01-01" || value.purchasedOn > today())) {
    problems.push({
      id: "geraet-angeschafft",
      label: "Angeschafft am",
      text: "Das Datum liegt nicht in einem sinnvollen Bereich.",
    });
  }
  if (value.holderKind !== "" && !value.holder) {
    problems.push(
      value.holderKind === "stelle"
        ? { id: "geraet-zuordnung", label: "Stelle", text: "Wähle die Stelle oder „Niemandem“." }
        : {
            id: "geraet-zuordnung",
            label: "Arbeitsplatz",
            text: "Wähle den Arbeitsplatz oder „Niemandem“.",
          },
    );
  }
  return problems;
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
    room_id: value.room ? value.room.id : null,
    position_id: value.holderKind === "stelle" && value.holder ? value.holder.id : null,
    workplace_id: value.holderKind === "arbeitsplatz" && value.holder ? value.holder.id : null,
  };
}

/** Neues Gerät von Hand; mit Inventurnummer erst nach einer Rückfrage. */
function NewDeviceForm({ master, onCancel }: { master: MasterData; onCancel: () => void }) {
  const [fields, setFields] = useState<DeviceFields>(EMPTY_DEVICE);
  const [inventoryNo, setInventoryNo] = useState("");
  const [ask, dialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const problems = tried ? deviceProblems(fields) : [];

  const save = () => {
    setBusy(true);
    setError(null);
    return createHardware({ ...deviceInput(fields), inventory_no: inventoryNo.trim() || null })
      .then((device) => navigate(hardwarePath(device.id)))
      .catch((problem: unknown) => {
        setError(errorText(problem, "Das Gerät konnte nicht angelegt werden."));
        setBusy(false);
      });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (deviceProblems(fields).length > 0) {
      return;
    }
    if (inventoryNo.trim()) {
      setError(null);
      ask(
        {
          title: `Inventurnummer ${inventoryNo.trim()} eintragen?`,
          text: "Bitte vergleiche sie mit dem Aufkleber am Gerät. Später lässt sie sich nur mit Bestätigung ändern.",
          action: "Gerät anlegen",
        },
        save,
      );
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
        <RequiredNote />
        <ErrorSummary problems={problems} />
        <DeviceFormFields master={master} value={fields} onChange={setFields} problems={problems} />
        <Field label="Inventurnummer" hint="freiwillig; vergleiche sie mit dem Aufkleber am Gerät">
          {(control) => (
            <input
              {...control}
              type="text"
              value={inventoryNo}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setInventoryNo(event.target.value)}
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Gerät anlegen
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
        {dialog}
      </form>
    </section>
  );
}

/** IT-Bestand › Hardware: alle Geräte mit Suche und Filtern. */
export function HardwarePage({ roles }: { roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [state, setState] = useState<ListState>("aktiv");
  const [master, setMaster] = useState<MasterData | null>(null);
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
    return () => {
      active = false;
    };
  }, []);

  const search = useDebounced(query);
  const paged = usePagedList<HardwareSummary, { kinds: HardwareList["kinds"] }>(
    `${state}|${kindId ?? ""}|${search}`,
    0,
    (offset, limit) =>
      fetchHardwareList(state, search, kindId, offset, limit).then((result) => ({
        items: result.items,
        total: result.total,
        extra: { kinds: result.kinds },
      })),
    "Die Hardware konnte nicht geladen werden.",
  );
  const shown = paged.items;
  const kindsInList = paged.extra?.kinds ?? [];
  const listFailed = paged.error;

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
        <NewDeviceForm master={master} onCancel={() => setCreating(false)} />
      )}

      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}

      <section className="panel" aria-labelledby="hardware-liste">
        <div className="panel-head">
          <h2 id="hardware-liste">Geräte</h2>
        </div>
        <FilterBar<ListState>
          plain
          search={{
            label: "Suchen",
            value: query,
            placeholder: "Bezeichnung, Seriennummer, Inventurnummer …",
            onChange: setQuery,
            hits: (shown ?? []).map((device) => ({
              key: device.id,
              title: device.name,
              extra: [device.kind, device.place].filter(Boolean).join(" · "),
              meta: device.inventory_no ?? device.serial ?? undefined,
              href: hardwarePath(device.id),
            })),
            total: paged.total,
          }}
          status={{
            label: "Status",
            value: state,
            onChange: setState,
            options: STATES.map((entry) => ({ value: entry.id, label: entry.label })),
          }}
          moreActive={kindId === null ? 0 : 1}
          onReset={
            query !== "" || state !== "aktiv" || kindId !== null
              ? () => {
                  setQuery("");
                  setState("aktiv");
                  setKindId(null);
                }
              : undefined
          }
          more={
            <label className="filter-field">
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
          }
        />
        <div className="detail-body settings-form">
          {listFailed && (
            <p role="alert" className="hint-box hint-bad">
              {listFailed}
            </p>
          )}
          {!listFailed && !shown && <p role="status">Wird geladen …</p>}
          {shown && shown.length === 0 && (
            <p className="small" role="status">
              Keine Geräte für diese Auswahl.
            </p>
          )}
        </div>
        {shown && shown.length > 0 && (
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
        {shown && (
          <MoreButton
            shown={shown.length}
            total={paged.total}
            loading={paged.loadingMore}
            onMore={paged.more}
          />
        )}
      </section>
    </div>
  );
}
