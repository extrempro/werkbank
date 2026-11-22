import { useEffect, useId, useState } from "react";
import { Link } from "../../components/Link";
import { STATUS_LABELS, ticketLabel, ticketPath, type HardwareTickets } from "./api";

/** Tickets zu einem Gerät oder einer Stelle im IT-Bestand: eigene Bereiche einzeln, die übrigen
 * nur als Anzahl. Ohne Tickets oder ohne Zugriff erscheint nichts. */
export function RelatedTickets({
  load,
  title = "Tickets",
}: {
  load: () => Promise<HardwareTickets>;
  title?: string;
}) {
  const [data, setData] = useState<HardwareTickets | null>(null);
  const headingId = useId();
  useEffect(() => {
    let active = true;
    load().then(
      (result) => active && setData(result),
      () => active && setData(null),
    );
    return () => {
      active = false;
    };
    // Die Ladefunktion hängt am Objekt, das die Seite ohnehin neu aufbaut
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data || (data.items.length === 0 && data.hidden === 0)) {
    return null;
  }
  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel-head">
        <h2 id={headingId}>{title}</h2>
      </div>
      <div className="detail-body">
        <ul className="plain ticket-pick-list">
          {data.items.map((t) => (
            <li key={t.number}>
              <Link to={ticketPath(t.number)}>
                {ticketLabel(t.number)} {t.subject}
              </Link>
              <span className="small"> · {STATUS_LABELS[t.status]}</span>
            </li>
          ))}
        </ul>
        {data.hidden > 0 && (
          <p className="small">
            {data.hidden === 1
              ? "Ein weiteres Ticket liegt in einem Bereich, den du nicht siehst."
              : `${data.hidden} weitere Tickets liegen in Bereichen, die du nicht siehst.`}
          </p>
        )}
      </div>
    </section>
  );
}
