import { useEffect, useState } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { PlanView } from "./PlanView";
import {
  fetchFloor,
  formatDate,
  hardwarePath,
  locationPath,
  modelLabel,
  type DeviceLocation,
  type Floor,
  type HardwareEvent,
  type HardwareSummary,
} from "./api";

/** Verlauf als Zeitleiste; Texte erzeugt die Werkbank, Darstellung nur als Text. */
export function EventPanel({ id, events }: { id: string; events: HardwareEvent[] }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>Verlauf</h2>
      </div>
      <div className="detail-body">
        {events.length === 0 ? (
          <p className="empty">Noch keine Einträge.</p>
        ) : (
          <ol className="timeline">
            {events.map((event, index) => (
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

/** Liste von Geräten mit Link, Art, Modell und Inventurnummer. */
export function DeviceList({ devices, empty }: { devices: HardwareSummary[]; empty: string }) {
  if (devices.length === 0) {
    return <p className="empty">{empty}</p>;
  }
  return (
    <ul className="link-list">
      {devices.map((device) => (
        <li key={device.id}>
          <Link to={hardwarePath(device.id)}>{device.name}</Link>
          <span className="small">
            {[device.kind, modelLabel(device), device.inventory_no ?? ""]
              .filter((part) => part && part !== "–")
              .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Grundriss der Etage mit hervorgehobenem Raum, nur zum Ansehen. */
export function RoomPlanPanel({
  id,
  location,
  emptyText,
}: {
  id: string;
  location: DeviceLocation | null;
  emptyText: string;
}) {
  const floorId = location?.floor_id ?? null;
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

  const shown = floor && floor.id === floorId ? floor : null;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>Standort</h2>
        {location && (
          <Link to={locationPath(location.floor_id, location.room_id)}>Bei Standorte öffnen</Link>
        )}
      </div>
      <div className="detail-body">
        {!location && <p>{emptyText}</p>}
        {location && (
          <p>
            <strong>Raum {location.room}</strong>
            <br />
            <span className="small">
              {location.city} › {location.site} › {location.section} › {location.floor}
            </span>
          </p>
        )}
        {failed && (
          <p role="alert" className="hint-box hint-bad">
            {failed}
          </p>
        )}
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
