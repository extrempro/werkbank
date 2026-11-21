import type { CSSProperties } from "react";

/** Phase mit Beginn und Ende als Monat „JJJJ-MM“. */
export interface TimelinePhase {
  name: string;
  start: string;
  end: string;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];
// Mehr Spalten werden zu schmal; ältere Monate fallen dann vorne weg
const MAX_MONTHS = 18;

function toIndex(month: string): number {
  const [year, number] = month.split("-").map(Number);
  return (year ?? 0) * 12 + ((number ?? 1) - 1);
}

function fromIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const index = toIndex(month);
  return `${MONTH_NAMES[index % 12] ?? ""} ${Math.floor(index / 12)}`;
}

function span(phase: TimelinePhase): string {
  return phase.start === phase.end
    ? monthLabel(phase.start)
    : `${monthLabel(phase.start)} bis ${monthLabel(phase.end)}`;
}

type PhaseState = "done" | "running" | "planned";

function stateOf(phase: TimelinePhase, today: number): PhaseState {
  if (toIndex(phase.end) < today) {
    return "done";
  }
  return toIndex(phase.start) <= today ? "running" : "planned";
}

const STATE_TEXT: Record<PhaseState, string> = {
  done: "abgeschlossen",
  running: "läuft",
  planned: "geplant",
};

/**
 * Zeitstrahl (design.md): Monate als Spalten, ein Balken je Phase, „heute“ als Linie.
 * Erledigt gefüllt, kommend umrandet, ein früherer Plan schraffiert. Die Grafik ist für
 * Screenreader verborgen; dieselben Angaben stehen als Liste darunter.
 */
export function Timeline({
  phases,
  previous = [],
  today = new Date(),
  label,
}: {
  phases: readonly TimelinePhase[];
  previous?: readonly TimelinePhase[];
  today?: Date;
  label: string;
}) {
  const todayIndex = today.getFullYear() * 12 + today.getMonth();
  const all = [...previous, ...phases];
  const first = Math.min(todayIndex, ...all.map((phase) => toIndex(phase.start)));
  const last = Math.max(todayIndex, ...all.map((phase) => toIndex(phase.end)));
  const from = Math.max(first, last - MAX_MONTHS + 1);
  const count = last - from + 1;
  const months = Array.from({ length: count }, (_, offset) => fromIndex(from + offset));
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const todayLeft = ((todayIndex - from + (today.getDate() - 0.5) / daysInMonth) / count) * 100;
  const rows = [
    ...previous.map((phase) => ({ phase, state: "old" as const })),
    ...phases.map((phase) => ({ phase, state: stateOf(phase, todayIndex) })),
  ];

  return (
    <div className="timeline-chart">
      <div
        className="timeline-grid"
        aria-hidden="true"
        style={{ "--timeline-months": count } as CSSProperties}
      >
        {months.map((month) => (
          <span key={month} className="timeline-month">
            {monthLabel(month)}
          </span>
        ))}
        {rows.map(({ phase, state }, index) => {
          const start = Math.max(toIndex(phase.start), from) - from + 1;
          const end = Math.max(toIndex(phase.end), from) - from + 2;
          return (
            <span
              key={`${state}-${index}`}
              className={`timeline-bar timeline-bar-${state}`}
              style={{ gridColumn: `${start} / ${end}`, gridRow: index + 2 }}
            >
              {phase.name}
            </span>
          );
        })}
        <span className="timeline-today" style={{ left: `${todayLeft}%` }}>
          <span>heute</span>
        </span>
      </div>
      <ul className="timeline-list" aria-label={label}>
        {previous.map((phase, index) => (
          <li key={`old-${index}`}>
            <s>
              {phase.name}: {span(phase)}
            </s>{" "}
            <span className="small">(vorher geplant)</span>
          </li>
        ))}
        {phases.map((phase, index) => (
          <li key={`now-${index}`}>
            {phase.name}: {span(phase)}{" "}
            <span className="small">({STATE_TEXT[stateOf(phase, todayIndex)]})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
