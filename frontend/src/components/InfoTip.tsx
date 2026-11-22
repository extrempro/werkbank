import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { HELP, type HelpKey } from "../help/terms";
import { useTopicLink } from "../help/HelpContext";
import { Link } from "./Link";

/** Abstand der Blase zum Rand des Fensters. */
const EDGE = 8;
/** Abstand zwischen Symbol und Blase. */
const GAP = 8;

interface Place {
  top: number;
  left: number;
  /** Lage der Spitze, gemessen vom linken Rand der Blase */
  arrow: number;
  /** Die Blase steht über dem Symbol, weil darunter kein Platz ist. */
  above: boolean;
}

/**
 * Info-Symbol „i“ mit kurzer Erklärung (design.md): Klick oder Enter öffnet die Erklärung als
 * Blase mit Spitze zum Symbol; Esc, ein Klick daneben oder ein zweiter Klick schließt sie. Die
 * Blase liegt fest im Fenster über allem (`position: fixed`), damit Karten mit `overflow` sie
 * nicht abschneiden; sie bleibt im Fenster, rückt nach links und steht über dem Symbol, wenn
 * darunter kein Platz ist. Die Texte stehen zentral in `help/terms.ts`.
 *
 * Nicht in ein `label`, `legend`, `th` oder eine Überschrift setzen: deren Name enthielte
 * sonst „Erklärung: …“. Stattdessen daneben oder in ein `dt`.
 */
export function InfoTip({ term }: { term: HelpKey }) {
  const help = HELP[term];
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
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

  // Lage im Fenster: unter dem Symbol, sonst darüber; immer ganz im Fenster.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const update = () => {
      const button = wrap.current?.querySelector("button");
      const box = bubble.current;
      if (!button || !box) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const center = rect.left + rect.width / 2;
      const left = Math.max(EDGE, Math.min(center - 20, window.innerWidth - width - EDGE));
      const below = rect.bottom + GAP + height + EDGE <= window.innerHeight;
      const above = !below && rect.top - GAP - height >= EDGE;
      setPlace({
        top: above ? rect.top - GAP - height : rect.bottom + GAP,
        left,
        arrow: Math.max(12, Math.min(center - left, width - 12)),
        above,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
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
          <span
            ref={bubble}
            className={place?.above ? "info-bubble info-bubble-above" : "info-bubble"}
            style={
              place
                ? ({
                    top: place.top,
                    left: place.left,
                    "--pfeil-x": `${place.arrow}px`,
                  } as CSSProperties)
                : { visibility: "hidden", top: 0, left: 0 }
            }
          >
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
