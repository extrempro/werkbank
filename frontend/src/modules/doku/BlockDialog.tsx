import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../../components/nav/useModal";

/**
 * Fenster für Bausteine (Live-Baustein, Verweis, Tabelle): immer in der Mitte, am Handy als
 * Blatt von unten. Titel und Knöpfe bleiben stehen, nur der Inhalt dazwischen scrollt; mit
 * `tall` hat das Fenster eine feste Höhe, damit es beim Wechsel der Art nicht springt.
 * Esc und Klick daneben schließen, Tab bleibt im Fenster.
 */
export function BlockDialog({
  label,
  tall = false,
  onClose,
  children,
}: {
  label: string;
  tall?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useModal(box, true, onClose);
  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        ref={box}
        className={
          tall
            ? "confirm-dialog doku-block-dialog doku-block-dialog-tall"
            : "confirm-dialog doku-block-dialog"
        }
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
