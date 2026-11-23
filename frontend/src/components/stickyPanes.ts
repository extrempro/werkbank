import { useEffect } from "react";

/**
 * Ansichten neben einer Liste (rechts) ohne eigenen Scrollbalken: Sie laufen mit der Seite mit
 * und bleiben stehen, sobald ihr Ende im Fenster ist; nach oben ebenso, bis ihr Anfang wieder
 * unter der Kopfzeile steht. Passt eine Ansicht ganz ins Fenster, bleibt sie oben stehen.
 *
 * Technisch: Die Ansichten sind per CSS `position: sticky` mit einem `top`; hier wird `top` beim
 * Scrollen zwischen diesem Wert und „Ende am unteren Fensterrand“ mitgeführt.
 */
export const STICKY_PANES = ".case-main, .split-detail, .ticket-side";

/** Abstand des Endes einer Ansicht zum unteren Fensterrand in Pixeln */
const BOTTOM_GAP = 16;

interface PaneState {
  /** `top` aus dem CSS, ohne unsere Anpassung */
  base: number;
  /** aktuell gesetztes `top` */
  top: number;
}

/** Neues `top`: um die Scrollstrecke verschoben, aber nie über `base` und nie so weit, dass das
 *  Ende der Ansicht über dem unteren Fensterrand steht. */
export function nextTop(state: PaneState, delta: number, height: number, viewport: number): number {
  const lowest = viewport - height - BOTTOM_GAP;
  if (lowest >= state.base) {
    return state.base;
  }
  return Math.min(state.base, Math.max(lowest, state.top - delta));
}

export function useStickyPanes(): void {
  useEffect(() => {
    // Ohne diese Schnittstellen (sehr alte Browser, Testumgebung) bleibt es bei CSS allein.
    if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const states = new WeakMap<HTMLElement, PaneState>();
    let lastY = window.scrollY;
    let frame = 0;

    const stateOf = (pane: HTMLElement): PaneState | null => {
      const known = states.get(pane);
      if (known) {
        return known;
      }
      pane.style.removeProperty("top");
      const style = getComputedStyle(pane);
      if (style.position !== "sticky") {
        return null;
      }
      const base = parseFloat(style.top);
      if (Number.isNaN(base)) {
        return null;
      }
      const fresh = { base, top: base };
      states.set(pane, fresh);
      return fresh;
    };

    const update = () => {
      frame = 0;
      const delta = window.scrollY - lastY;
      lastY = window.scrollY;
      for (const pane of document.querySelectorAll<HTMLElement>(STICKY_PANES)) {
        resized.observe(pane);
        const state = stateOf(pane);
        if (!state) {
          continue;
        }
        const top = nextTop(state, delta, pane.offsetHeight, window.innerHeight);
        if (top !== state.top || pane.style.top === "") {
          state.top = top;
          pane.style.top = `${top}px`;
        }
      }
    };
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(update);
      }
    };
    // Bei anderer Fenstergröße gelten die CSS-Werte neu (z. B. kein sticky mehr auf dem Handy).
    const reset = () => {
      for (const pane of document.querySelectorAll<HTMLElement>(STICKY_PANES)) {
        states.delete(pane);
        pane.style.removeProperty("top");
      }
      schedule();
    };
    // Ändert sich die Höhe einer Ansicht (Formular geöffnet, Inhalt geladen) oder kommt eine
    // neue dazu, passt `top` sich an.
    const resized = new ResizeObserver(schedule);
    const added = new MutationObserver(schedule);
    added.observe(document.body, { childList: true, subtree: true });
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", reset);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", reset);
      added.disconnect();
      resized.disconnect();
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);
}
