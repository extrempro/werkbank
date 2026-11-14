import { useId, useState } from "react";
import { saveTheme, storedTheme, type ThemeChoice } from "../theme";

const OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "auto", label: "Automatisch" },
  { value: "hell", label: "Hell" },
  { value: "dunkel", label: "Dunkel" },
];

/** Auswahl der Darstellung. „Automatisch“ folgt der Einstellung des Geräts. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);
  const name = useId();

  const pick = (value: ThemeChoice) => {
    setChoice(value);
    saveTheme(value);
  };

  return (
    <fieldset className="theme-switch">
      <legend>Darstellung</legend>
      <div className="theme-options">
        {OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={choice === option.value}
              onChange={() => pick(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
