import { PERIODS } from "./api";

/** Auswahl des Zeitraums für einen Verlauf. */
export function PeriodSelect({
  days,
  onChange,
  periods = PERIODS,
}: {
  days: number;
  onChange: (days: number) => void;
  periods?: { days: number; label: string }[];
}) {
  return (
    <div className="chips" role="group" aria-label="Zeitraum">
      {periods.map((period) => (
        <button
          type="button"
          key={period.days}
          className="chip chip-filter"
          aria-pressed={days === period.days}
          onClick={() => onChange(period.days)}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
