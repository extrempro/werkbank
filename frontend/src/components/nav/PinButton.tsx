import { togglePin, useNavPrefs } from "../../navPrefs";
import { Icon } from "../Icon";

interface PinButtonProps {
  path: string;
  label: string;
  className?: string;
}

/** Stern zum Anheften einer Seite. Angeheftete Seiten stehen im Start-Bereich unter „Angeheftet“. */
export function PinButton({ path, label, className = "" }: PinButtonProps) {
  const { pinned } = useNavPrefs();
  const on = pinned.includes(path);
  return (
    <button
      type="button"
      className={["pin", on ? "pin-on" : "", className].filter(Boolean).join(" ")}
      aria-pressed={on}
      aria-label={`${label} anheften`}
      title={on ? "Angeheftet – zum Lösen klicken" : "Anheften"}
      onClick={() => void togglePin(path)}
    >
      <Icon name="stern" filled={on} />
    </button>
  );
}
