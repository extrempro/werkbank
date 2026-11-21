import {
  useCallback,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useModal } from "./nav/useModal";

export interface ConfirmOptions {
  /** Frage als Überschrift, z. B. „Rechnung buchen?“ */
  title: string;
  /** Was genau passiert, in ein bis zwei Sätzen. */
  text: ReactNode;
  /** Beschriftung des Knopfs, der ausführt: ein Verb, z. B. „Buchen“ oder „Löschen“. */
  action: string;
  /** Lässt sich nicht rückgängig machen: roter Knopf, Warnsymbol und Hinweis. */
  danger?: boolean;
}

/** So weit muss das Blatt am Handy nach unten gezogen werden, damit es abbricht. */
const SWIPE_CLOSE = 80;

/**
 * Bestätigungsdialog (design.md, „Bestätigen“): am PC und Tablet ein Fenster in der Mitte,
 * am Handy ein Blatt von unten. Der Fokus startet auf „Abbrechen“; Esc, Klick daneben und
 * am Handy Wischen nach unten brechen ab. Solange die Aktion läuft, bleibt der Dialog offen.
 */
export function ConfirmDialog({
  options,
  busy,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();
  const [drag, setDrag] = useState<{ start: number; offset: number } | null>(null);
  const close = useCallback(() => {
    if (!busy) {
      onCancel();
    }
  }, [busy, onCancel]);
  useModal(box, true, close, cancel);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ start: event.clientY, offset: 0 });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) {
      setDrag({ ...drag, offset: Math.max(0, event.clientY - drag.start) });
    }
  };
  const onPointerUp = () => {
    if (drag && drag.offset > SWIPE_CLOSE) {
      close();
    }
    setDrag(null);
  };

  return createPortal(
    <div className="confirm-backdrop" onClick={close}>
      <div
        ref={box}
        className={options.danger ? "confirm-dialog confirm-danger" : "confirm-dialog"}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        style={drag && drag.offset > 0 ? { transform: `translateY(${drag.offset}px)` } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="confirm-grip"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          <span />
        </div>
        <div className="confirm-head">
          <span className="confirm-icon" aria-hidden="true">
            {options.danger ? (
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8h.01M11 12h1v4h1" />
              </svg>
            )}
          </span>
          <div className="confirm-copy">
            <h2 id={titleId} className="confirm-title">
              {options.title}
            </h2>
            <div id={textId} className="confirm-text">
              {options.text}
              {options.danger && (
                <p className="confirm-warning">Das lässt sich nicht rückgängig machen.</p>
              )}
            </div>
          </div>
        </div>
        <div className="confirm-actions">
          <button
            ref={cancel}
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={close}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className={options.danger ? "button confirm-button-danger" : "button button-primary"}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {options.action}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Run = () => unknown;

/**
 * Bestätigen per Dialog an beliebiger Stelle: `ask(options, run)` öffnet den Dialog und führt
 * `run` erst nach „OK“ aus. Gibt `run` ein Promise zurück, bleibt der Dialog bis zum Ende offen.
 * Das gelieferte Element muss die Komponente mit ausgeben.
 */
export function useConfirm(): [(options: ConfirmOptions, run: Run) => void, ReactNode] {
  const [open, setOpen] = useState<{ options: ConfirmOptions; run: Run } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useCallback((options: ConfirmOptions, run: Run) => setOpen({ options, run }), []);
  const onCancel = useCallback(() => setOpen(null), []);
  const element = open ? (
    <ConfirmDialog
      options={open.options}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        let result: unknown;
        try {
          result = open.run();
        } catch (problem) {
          setOpen(null);
          throw problem;
        }
        if (result instanceof Promise) {
          setBusy(true);
          result
            .catch(() => undefined)
            .finally(() => {
              setBusy(false);
              setOpen(null);
            });
        } else {
          setOpen(null);
        }
      }}
    />
  ) : null;
  return [ask, element];
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">;

/**
 * Knopf mit Bestätigung: öffnet den Dialog und führt `onConfirm` erst nach „OK“ aus.
 * Alle anderen Angaben gehen an den Knopf selbst.
 */
export function ConfirmButton({
  confirm,
  onConfirm,
  children,
  ...button
}: ButtonProps & { confirm: ConfirmOptions; onConfirm: Run; children: ReactNode }) {
  const [ask, dialog] = useConfirm();
  return (
    <>
      <button type="button" {...button} onClick={() => ask(confirm, onConfirm)}>
        {children}
      </button>
      {dialog}
    </>
  );
}
