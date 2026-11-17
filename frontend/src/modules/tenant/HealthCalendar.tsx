import { useEffect, useId, useRef, useState } from "react";
import { calendarSummary, weekColumns, type DayLevel } from "./api";

const dayFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const longDay = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: "UTC" });

export const LEVEL_TEXT: Record<DayLevel, string> = {
  ok: "keine Meldung",
  hinweis: "Hinweis",
  stoerung: "Störung",
};

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

interface CalendarProps {
  /** Tage als ISO-Datum (UTC), aufsteigend */
  days: readonly string[];
  /** Schwerste Meldung je Tag, gleich lang wie days */
  levels: readonly DayLevel[];
  /** Monatsnamen über den Spalten */
  showMonths?: boolean;
}

/** Kalender: Wochen als Spalten, Montag oben. Nur Bild; den Text liefert CalendarText. */
export function CalendarGrid({ days, levels, showMonths = true }: CalendarProps) {
  const columns = weekColumns([...days]);
  const first = days[0] ?? "";
  const monthKeys = columns.map((column) => {
    const index = column.find((entry) => entry !== null);
    return index !== null && index !== undefined ? (days[index] ?? "").slice(0, 7) : "";
  });
  const months = monthKeys.map((key, index) =>
    key && key !== monthKeys[index - 1] ? monthName.format(day(`${key}-01`)) : "",
  );
  return (
    <span className="health-cal-body" aria-hidden="true">
      {showMonths && (
        <span className="health-cal-months">
          {months.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </span>
      )}
      <span className="health-cal-grid">
        {columns.flatMap((column, columnIndex) =>
          Array.from({ length: 7 }, (_, row) => {
            const index = column[row];
            if (index === null || index === undefined) {
              return (
                <span key={`${columnIndex}-${row}`} className="health-cal-cell health-cal-leer" />
              );
            }
            const level = levels[index] ?? "ok";
            return (
              <span
                key={`${columnIndex}-${row}`}
                className={`health-cal-cell health-cal-${level}`}
                title={`${longDay.format(day(days[index] ?? first))}: ${LEVEL_TEXT[level]}`}
              />
            );
          }),
        )}
      </span>
    </span>
  );
}

/** Die Tage mit Meldung als Text für Screenreader. */
export function CalendarText({ days, levels }: CalendarProps) {
  const first = days[0] ?? "";
  const text = levels
    .map((level, index) =>
      level === "ok" ? null : `${dayFormat.format(day(days[index] ?? first))} ${LEVEL_TEXT[level]}`,
    )
    .filter(Boolean)
    .join("; ");
  return <span className="visually-hidden">{text}</span>;
}

/** 3 × 3 Kästchen als Symbol für den Kalender in der Kachel. */
function CubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      {[0, 6, 12].flatMap((y) =>
        [0, 6, 12].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1" fill="currentColor" />
        )),
      )}
    </svg>
  );
}

/**
 * Würfel in der Kachel eines Dienstes: zeigt die letzten Tage als Kalender.
 * Maus: beim Darüberfahren; Tastatur und Handy: Antippen öffnet und schließt, Escape schließt.
 */
export function ServiceCube({ name, days, levels }: { name: string } & CalendarProps) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) {
        setPinned(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [pinned]);

  if (days.length === 0) {
    return null;
  }
  return (
    <span
      className="health-cube"
      ref={wrap}
      onPointerEnter={(event) => event.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHover(false)}
    >
      <button
        type="button"
        className="health-cube-button"
        aria-expanded={open}
        aria-controls={panelId}
        title={`Letzte ${days.length} Tage`}
        onClick={() => setPinned((value) => !value)}
      >
        <CubeIcon />
        <span className="visually-hidden">
          Letzte {days.length} Tage für {name} {open ? "ausblenden" : "anzeigen"}
        </span>
      </button>
      {/* Inhalt nur, wenn offen: sonst stünde der Text doppelt auf der Seite */}
      <span id={panelId} className="health-cube-panel" hidden={!open}>
        {open && (
          <>
            <span className="health-cube-title">
              {name}: letzte {days.length} Tage
            </span>
            <CalendarGrid days={days} levels={levels} />
            <span className="small">{calendarSummary(levels)}</span>
            <CalendarText days={days} levels={levels} />
          </>
        )}
      </span>
    </span>
  );
}
