import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Offene Dialoge, der oberste zuletzt. Tasten gehören nur ihm (z. B. Bestätigung über einer
// Geräte-Ansicht: Esc schließt nur die Bestätigung).
const stack: object[] = [];

/**
 * Verhalten eines modalen Dialogs: Fokus beim Öffnen hinein (auf `initial` oder das erste
 * bedienbare Element), Tab bleibt im Dialog, Esc schließt, danach kehrt der Fokus zurück.
 */
export function useModal(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  initial?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) {
      return;
    }
    const token = {};
    stack.push(token);
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = initial?.current ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.getClientRects().length > 0 || element === document.activeElement,
      );
      const start = items[0];
      const end = items[items.length - 1];
      if (!start || !end) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        start.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(token), 1);
      if (before && before.isConnected) {
        before.focus();
      }
    };
  }, [ref, open, onClose, initial]);
}
