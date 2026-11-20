import { Link } from "../../components/Link";
import {
  formatDate,
  hardwarePath,
  modelLabel,
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
