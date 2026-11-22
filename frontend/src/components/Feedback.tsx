import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Rückmeldung nach einer Aktion, immer im sichtbaren Bereich (docs/design.md › Rückmeldungen):
 * unten mittig, auf dem Handy über der Leiste unten.
 *
 * - kind "status": Erfolg, verschwindet nach einigen Sekunden von selbst (Pause, solange die
 *   Maus darauf steht oder der Fokus darin ist).
 * - kind "alert": Fehler, bleibt bis zum Schließen oder bis eine neue Meldung kommt.
 *
 * Die Seite behält ihren Zustand (message); onClose setzt ihn zurück.
 */
export interface FeedbackMessage {
  kind: "status" | "alert";
  text: string;
}

export const FEEDBACK_SECONDS = 6;

let region: HTMLElement | null = null;

/** Ein gemeinsamer Bereich für alle Meldungen, damit sie sich stapeln statt überlappen. */
function feedbackRegion(): HTMLElement {
  if (region && document.body.contains(region)) {
    return region;
  }
  region = document.createElement("div");
  region.className = "feedback-region";
  document.body.appendChild(region);
  return region;
}

export function Feedback({
  message,
  onClose,
}: {
  message: FeedbackMessage | null;
  onClose: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  const kind = message?.kind;
  const text = message?.text;
  // Am Inhalt festgemacht, nicht am Objekt: Seiten bauen die Meldung oft bei jedem Rendern neu
  useEffect(() => {
    if (kind !== "status" || paused) {
      return;
    }
    const timer = window.setTimeout(() => close.current(), FEEDBACK_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [kind, text, paused]);

  if (!message || typeof document === "undefined") {
    return null;
  }
  const bad = message.kind === "alert";
  return createPortal(
    <div
      role={message.kind}
      className={bad ? "feedback feedback-bad" : "feedback"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="feedback-icon" aria-hidden="true">
        {bad ? "!" : "✓"}
      </span>
      <span className="feedback-text">{message.text}</span>
      <button
        type="button"
        className="feedback-close"
        aria-label="Meldung schließen"
        onClick={() => close.current()}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>,
    feedbackRegion(),
  );
}
