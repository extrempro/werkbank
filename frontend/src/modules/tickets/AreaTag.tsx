import { areaColorClass } from "./areaColors";

/** Bereich mit Farbpunkt; der Name steht immer daneben, die Farbe ist nur Zusatz. */
export function AreaTag({ name, color }: { name: string; color: string | undefined }) {
  return (
    <span className={`area-tag ${areaColorClass(color)}`}>
      <span className="area-dot" aria-hidden="true" />
      {name}
    </span>
  );
}
