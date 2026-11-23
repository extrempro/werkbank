import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import {
  fetchFloor,
  fetchPlaceInfo,
  locationPath,
  placeLine,
  positionPath,
  setWorkplaceSpot,
  spotInRoom,
  workplacePath,
  type Floor,
  type PlaceInfo,
  type PlaceKind,
  type Workplace,
} from "./api";
import { planSpots, PlanView, type PlanSpot } from "./PlanView";

function usePlaceInfo(kind: PlaceKind, id: number, reload: number) {
  const [state, setState] = useState<{ key: string; data: PlaceInfo } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${kind}/${id}/${reload}`;
  useEffect(() => {
    let active = true;
    fetchPlaceInfo(kind, id).then(
      (data) => {
        if (active) {
          setFailed(null);
          setState({ key: `${kind}/${id}/${reload}`, data });
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Der Standort konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [kind, id, reload]);
  return { data: state && state.key === key ? state.data : null, failed };
}

/**
 * Ortszeile unter dem Titel einer Detailseite: „Raum 2.14 · 1. OG · …“ mit Link zu
 * „Standorte“. Bei mehreren Räumen der erste und die Zahl der übrigen.
 */
export function PlaceLine({
  kind,
  id,
  reload = 0,
}: {
  kind: PlaceKind;
  id: number;
  reload?: number;
}) {
  const { data } = usePlaceInfo(kind, id, reload);
  if (!data) {
    return null;
  }
  const rooms = data.floors.flatMap((floor) => floor.rooms);
  const first = rooms[0];
  if (!first) {
    return <p className="place-line small">Kein Raum zugeordnet</p>;
  }
  return (
    <p className="place-line small">
      <Icon name="standort" />
      <Link to={locationPath(first.floor_id, first.room_id)}>{placeLine(first)}</Link>
      {rooms.length === 2 && " und 1 weiterer Raum"}
      {rooms.length > 2 && ` und ${rooms.length - 1} weitere Räume`}
      {data.via &&
        ` (über ${data.via.kind === "stelle" ? "Stelle" : "Arbeitsplatz"} ${data.via.label})`}
    </p>
  );
}

/** Platz im Raum setzen: Klick in den Raum oder Zahlen eingeben. */
function SpotEditor({
  workplace,
  floor,
  placing,
  setPlacing,
  onChange,
}: {
  workplace: Workplace;
  floor: Floor;
  placing: boolean;
  setPlacing: (value: boolean) => void;
  onChange: (next: Workplace) => void;
}) {
  const xId = useId();
  const yId = useId();
  const [x, setX] = useState(workplace.spot_x === null ? "" : String(workplace.spot_x));
  const [y, setY] = useState(workplace.spot_y === null ? "" : String(workplace.spot_y));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const room = floor.rooms.find((entry) => entry.id === workplace.room_id);
  if (!room) {
    return null;
  }

  const save = (spot: { x: number; y: number } | null) => {
    setBusy(true);
    setError(null);
    setWorkplaceSpot(workplace.id, spot).then(
      (next) => {
        setBusy(false);
        setPlacing(false);
        setX(next.spot_x === null ? "" : String(next.spot_x));
        setY(next.spot_y === null ? "" : String(next.spot_y));
        onChange(next);
      },
      (problem: unknown) => {
        setBusy(false);
        setError(errorText(problem, "Der Platz konnte nicht gespeichert werden."));
      },
    );
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const left = Number(x.replace(",", "."));
    const top = Number(y.replace(",", "."));
    if (x === "" || y === "" || !Number.isFinite(left) || !Number.isFinite(top)) {
      setError("Bitte trag beide Werte zwischen 0 und 100 ein.");
      return;
    }
    if (left < 0 || left > 100 || top < 0 || top > 100) {
      setError("Bitte trag beide Werte zwischen 0 und 100 ein.");
      return;
    }
    save({ x: left, y: top });
  };

  return (
    <div className="spot-editor">
      <div className="project-actions">
        <button
          type="button"
          className={placing ? "button button-primary" : "button button-secondary"}
          aria-pressed={placing}
          onClick={() => setPlacing(!placing)}
          disabled={busy}
        >
          {placing ? "Klick in den Raum … (abbrechen)" : "Platz im Grundriss setzen"}
        </button>
        {workplace.spot_x !== null && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => save(null)}
            disabled={busy}
          >
            Platz entfernen
          </button>
        )}
      </div>
      {placing && (
        <p className="small" role="status">
          Klick im Grundriss auf die Stelle in Raum {room.name}, an der der Arbeitsplatz steht.
        </p>
      )}
      <details>
        <summary>Platz mit Zahlen eingeben</summary>
        <form className="settings-form tool-row" onSubmit={onSubmit} noValidate>
          <label htmlFor={xId}>
            Von links im Raum (%)
            <input
              id={xId}
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="decimal"
              value={x}
              onChange={(event) => setX(event.target.value)}
            />
          </label>
          <label htmlFor={yId}>
            Von oben im Raum (%)
            <input
              id={yId}
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="decimal"
              value={y}
              onChange={(event) => setY(event.target.value)}
            />
          </label>
          <button type="submit" className="button button-secondary" disabled={busy}>
            Speichern
          </button>
        </form>
      </details>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Grundriss mit den Räumen und Plätzen einer Stelle, eines Arbeitsplatzes oder eines Geräts.
 * Liegen sie auf mehreren Etagen, wählt man die Etage oben. Für einen Arbeitsplatz können
 * Bearbeiter den Platz im Raum setzen.
 */
export function LocationPanel({
  id,
  kind,
  objectId,
  emptyText,
  workplace,
  canEdit = false,
  onWorkplaceChange,
}: {
  id: string;
  kind: PlaceKind;
  objectId: number;
  emptyText: string;
  /** nur beim Arbeitsplatz: zum Setzen des Platzes */
  workplace?: Workplace;
  canEdit?: boolean;
  onWorkplaceChange?: (next: Workplace) => void;
}) {
  const [reload, setReload] = useState(0);
  const { data, failed } = usePlaceInfo(kind, objectId, reload);
  const [floorIndex, setFloorIndex] = useState(0);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [floorFailed, setFloorFailed] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);

  const places = data ? (data.floors[floorIndex] ?? data.floors[0] ?? null) : null;
  const floorId = places ? places.floor_id : null;

  useEffect(() => {
    if (floorId === null) {
      return;
    }
    let active = true;
    fetchFloor(floorId).then(
      (result) => active && setFloor(result),
      (problem: unknown) =>
        active && setFloorFailed(errorText(problem, "Der Grundriss konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [floorId, reload]);

  const shown = floor && floor.id === floorId ? floor : null;
  const spots: PlanSpot[] = shown
    ? planSpots(shown).map((spot) => ({
        ...spot,
        on: places ? places.workplace_ids.includes(spot.id) : false,
      }))
    : [];
  const missing = places
    ? places.workplace_ids.filter((wid) => !spots.some((spot) => spot.id === wid))
    : [];
  const first = places?.rooms[0] ?? null;

  const changed = (next: Workplace) => {
    onWorkplaceChange?.(next);
    setReload(reload + 1);
  };

  const onPlace = (point: { x: number; y: number }) => {
    if (!workplace || !shown) {
      return;
    }
    const room = shown.rooms.find((entry) => entry.id === workplace.room_id);
    const spot = room ? spotInRoom(point, room) : null;
    if (!spot) {
      setPlaceError(`Bitte klicke innerhalb von Raum ${room?.name ?? ""}.`);
      return;
    }
    setPlaceError(null);
    setWorkplaceSpot(workplace.id, spot).then(
      (next) => {
        setPlacing(false);
        changed(next);
      },
      (problem: unknown) =>
        setPlaceError(errorText(problem, "Der Platz konnte nicht gespeichert werden.")),
    );
  };

  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>Standort</h2>
        {first && (
          <Link to={locationPath(first.floor_id, first.room_id)}>Bei Standorte öffnen</Link>
        )}
      </div>
      <div className="detail-body">
        {failed && (
          <p role="alert" className="hint-box hint-bad">
            {failed}
          </p>
        )}
        {!data && !failed && <p role="status">Wird geladen …</p>}
        {data && data.floors.length === 0 && <p>{emptyText}</p>}
        {data?.via && (
          <p className="small">
            Kein eigener Raum. Der Ort kommt über{" "}
            <Link
              to={
                data.via.kind === "stelle"
                  ? positionPath(data.via.id, "standort")
                  : workplacePath(data.via.id, "standort")
              }
            >
              {data.via.kind === "stelle" ? "Stelle" : "Arbeitsplatz"} {data.via.label}
            </Link>
            .
          </p>
        )}
        {data && data.floors.length > 1 && (
          <div className="chips" role="group" aria-label="Etage">
            {data.floors.map((entry, index) => (
              <button
                key={entry.floor_id}
                type="button"
                className="chip chip-filter"
                aria-pressed={entry.floor_id === floorId}
                onClick={() => setFloorIndex(index)}
              >
                {entry.rooms[0]?.floor ?? "Etage"} · {entry.rooms[0]?.site ?? ""}
              </button>
            ))}
          </div>
        )}
        {places && (
          <ul className="place-list">
            {places.rooms.map((room) => (
              <li key={room.room_id}>
                <strong>Raum {room.room}</strong>{" "}
                <span className="small">
                  {room.city} › {room.site} › {room.section} › {room.floor}
                </span>
              </li>
            ))}
          </ul>
        )}
        {floorFailed && (
          <p role="alert" className="hint-box hint-bad">
            {floorFailed}
          </p>
        )}
        {places && !floorFailed && !shown && <p role="status">Grundriss wird geladen …</p>}
        {places && shown && (
          <>
            <PlanView
              floor={shown}
              selectedId={null}
              highlighted={places.rooms.map((room) => room.room_id)}
              spots={spots}
              placing={placing}
              label={`Grundriss ${first?.floor ?? ""}: ${places.rooms
                .map((room) => `Raum ${room.room}`)
                .join(", ")} hervorgehoben${
                spots.some((spot) => spot.on)
                  ? `; Platz von ${spots
                      .filter((spot) => spot.on)
                      .map((spot) => spot.label)
                      .join(", ")} markiert`
                  : ""
              }`}
              onPlace={onPlace}
            />
            {spots.some((spot) => spot.on) && (
              <p className="small">
                <span className="plan-spot-key" aria-hidden="true" /> Platz von{" "}
                {spots
                  .filter((spot) => spot.on)
                  .map((spot) => spot.label)
                  .join(", ")}
              </p>
            )}
            {missing.length > 0 && kind !== "arbeitsplatz" && (
              <p className="small">
                Ohne gesetzten Platz im Raum: {missing.length} Arbeitsplatz
                {missing.length === 1 ? "" : "e"}.
              </p>
            )}
            {kind === "arbeitsplatz" && workplace && workplace.spot_x === null && (
              <p className="small">Der Platz im Raum ist noch nicht gesetzt.</p>
            )}
            {placeError && (
              <p role="alert" className="hint-box hint-bad">
                {placeError}
              </p>
            )}
            {kind === "arbeitsplatz" && workplace && canEdit && (
              <SpotEditor
                key={`${workplace.spot_x}-${workplace.spot_y}`}
                workplace={workplace}
                floor={shown}
                placing={placing}
                setPlacing={setPlacing}
                onChange={changed}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
