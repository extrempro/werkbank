import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HELP, type HelpKey } from "../help/terms";
import { useTopicLink } from "../help/HelpContext";
import { Link } from "./Link";

/** Abstand der Blase zum Rand des Fensters. */
const EDGE = 8;

/**
 * Info-Symbol „i“ mit kurzer Erklärung (design.md): Klick oder Enter öffnet die Erklärung als
 * Blase mit Spitze zum Symbol; Esc, ein Klick daneben oder ein zweiter Klick schließt sie. Die
 * Blase legt sich über den Inhalt und öffnet nach links, wenn rechts kein Platz ist. Die Texte
 * stehen zentral in `help/terms.ts`.
 *
 * Nicht in ein `label`, `legend`, `th` oder eine Überschrift setzen: deren Name enthielte
 * sonst „Erklärung: …“. Stattdessen daneben oder in ein `dt`.
 */
export function InfoTip({ term }: { term: HelpKey }) {
  const help = HELP[term];
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();
  const link = useTopicLink([help.topic]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // Reicht der Platz rechts nicht, öffnet die Blase nach links.
  useLayoutEffect(() => {
    if (!open || !bubble.current || !wrap.current) {
      return;
    }
    const width = bubble.current.offsetWidth;
    const left = wrap.current.getBoundingClientRect().left;
    setSide(left + width + EDGE > window.innerWidth ? "left" : "right");
  }, [open]);

  return (
    <span className="info-tip" ref={wrap}>
      <button
        type="button"
        className="info-tip-button"
        aria-label={`Erklärung: ${help.term}`}
        aria-expanded={open}
        aria-controls={bubbleId}
        onClick={() => setOpen(!open)}
      >
        {/* Das „i“ kommt aus dem CSS, damit es nicht im Text der Umgebung steht. */}
        <span className="info-tip-i" aria-hidden="true" />
      </button>
      {/* Immer vorhanden, damit Screenreader die Erklärung beim Öffnen vorlesen. */}
      <span id={bubbleId} role="status" className="info-tip-live">
        {open && (
          <span ref={bubble} className={`info-bubble info-bubble-${side}`}>
            <span className="info-bubble-text">{help.text}</span>
            {link && (
              <Link to={link} className="info-bubble-link">
                Mehr im Handbuch ›
              </Link>
            )}
          </span>
        )}
      </span>
    </span>
  );
}
