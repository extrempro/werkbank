import { useEffect, useId, useState } from "react";
import { errorText } from "../../api";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import { BAR_LIMITS, loadTicketBar, saveBarPrefs, useTicketBar, type BarLimit } from "./ticketBar";

/** Konto › Tickets: Höchstzahl der geöffneten Tickets und Ansicht der Leiste (je Konto). */
export function TicketBarSettings() {
  const bar = useTicketBar();
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const limitName = useId();
  const viewName = useId();

  useEffect(() => {
    void loadTicketBar();
  }, []);

  const save = (limit: BarLimit, compact: boolean) => {
    const shorter = limit < bar.limit && bar.recent.length > limit;
    saveBarPrefs(limit, compact).then(
      () =>
        setMessage({
          kind: "status",
          text: shorter
            ? "Gespeichert. Die ältesten Tickets ohne Stern sind aus der Liste gefallen."
            : "Gespeichert.",
        }),
      (problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Einstellung konnte nicht gespeichert werden."),
        }),
    );
  };

  const current = (BAR_LIMITS as readonly number[]).includes(bar.limit)
    ? (bar.limit as BarLimit)
    : 15;

  return (
    <section className="panel" aria-labelledby="konto-tickets">
      <div className="panel-head">
        <h2 id="konto-tickets">
          Tickets <InfoTip term="tickets.leiste" />
        </h2>
        <span className="small">gilt für dein Konto auf allen Geräten</span>
      </div>
      <div className="detail-body">
        <fieldset className="theme-switch" disabled={!bar.loaded}>
          <legend>Geöffnete Tickets in der Leiste</legend>
          <div className="theme-options">
            {BAR_LIMITS.map((limit) => (
              <label key={limit}>
                <input
                  type="radio"
                  name={limitName}
                  value={limit}
                  checked={current === limit}
                  onChange={() => save(limit, bar.compact)}
                />
                <span>{limit}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="small">
          Favoriten zählen nicht mit. Ist die Liste voll, fällt das älteste Ticket ohne Stern
          heraus.
        </p>
        <fieldset className="theme-switch" disabled={!bar.loaded}>
          <legend>Ansicht der Leiste</legend>
          <div className="theme-options">
            <label>
              <input
                type="radio"
                name={viewName}
                value="kompakt"
                checked={bar.compact}
                onChange={() => save(current, true)}
              />
              <span>Kompakt</span>
            </label>
            <label>
              <input
                type="radio"
                name={viewName}
                value="normal"
                checked={!bar.compact}
                onChange={() => save(current, false)}
              />
              <span>Normal</span>
            </label>
          </div>
        </fieldset>
        <p className="small">
          Kompakt zeigt den Status als farbigen Punkt, Normal schreibt ihn unter den Betreff.
        </p>
      </div>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </section>
  );
}
