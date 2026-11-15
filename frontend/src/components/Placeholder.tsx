import type { ReactNode } from "react";

/**
 * Schraffierte Fläche für den Detailbereich, solange in der Liste nichts gewählt ist.
 * Erscheint nur, wo Liste und Detail nebeneinander stehen (breite Bildschirme).
 */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="placeholder">
      <p>{children}</p>
    </div>
  );
}
