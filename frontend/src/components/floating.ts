import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** Abstand zwischen Feld und Fenster sowie zum Bildschirmrand */
const GAP = 4;
/** Darunter klappt das Fenster lieber nach oben auf */
const MIN_BELOW = 220;
/** Höchste Höhe des schwebenden Fensters */
export const FLOATING_MAX_HEIGHT = 360;

/** Unterkante des freien Bereichs: über der Leiste „Schnellzugriff“ am Handy, sonst das Fenster. */
function viewportBottom(): number {
  const bar = document.querySelector<HTMLElement>('nav[aria-label="Schnellzugriff"]');
  // Die Leiste ist „fixed“: offsetParent ist dann immer null, sichtbar heißt „hat Fläche“
  if (bar && bar.getClientRects().length > 0) {
    return Math.min(bar.getBoundingClientRect().top, window.innerHeight);
  }
  return window.innerHeight;
}

/** Unterkante der festen Kopfzeile; darüber darf das Fenster nicht liegen. */
function viewportTop(): number {
  return document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
}

/**
 * Lage eines schwebenden Fensters unter (oder, wenn dort kein Platz ist, über) einem Feld.
 * „fixed“ statt „absolute“: So schneidet kein umgebender Kasten mit `overflow` das Fenster ab.
 * Folgt beim Scrollen und bei Größenänderungen.
 */
export function useFloating(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ display: "none" });
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const place = () => {
      const element = anchor.current;
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const below = viewportBottom() - rect.bottom - 2 * GAP;
      const above = rect.top - viewportTop() - 2 * GAP;
      const down = below >= Math.min(MIN_BELOW, FLOATING_MAX_HEIGHT) || below >= above;
      const room = Math.max(Math.min(down ? below : above, FLOATING_MAX_HEIGHT), 120);
      setStyle({
        position: "fixed",
        left: rect.left,
        width: rect.width,
        maxHeight: room,
        ...(down ? { top: rect.bottom + GAP } : { bottom: window.innerHeight - rect.top + GAP }),
      });
    };
    place();
    window.addEventListener("resize", place);
    // Auch Scrollen in Kästen (z. B. einer Ansicht rechts) verschiebt das Feld
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, open]);
  return open ? style : { display: "none" };
}
