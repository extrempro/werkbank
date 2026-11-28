import { formatDateTime } from "../../../api";
import type { NbEvent } from "./api";

/* Ereignisse aus dem Protokoll von NetBird als Tabelle (Übersicht und Richtlinien & Ereignisse). */

export function NbEventTable({ events, label }: { events: NbEvent[]; label: string }) {
  return (
    <div className="table-wrap card-wrap">
      <table className="table-cards fg-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Zeit</th>
            <th scope="col">Ereignis</th>
            <th scope="col">Objekt</th>
            <th scope="col">Ausgelöst von</th>
            <th scope="col">Änderung</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td data-label="Zeit">{formatDateTime(event.at)}</td>
              <th scope="row" data-label="Ereignis">
                {event.label}
              </th>
              <td data-label="Objekt" className="nb-break">
                {event.object}
              </td>
              <td data-label="Ausgelöst von">{event.initiator}</td>
              <td data-label="Änderung">{event.change}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
