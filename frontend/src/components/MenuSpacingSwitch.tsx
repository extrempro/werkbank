import { useId, useState } from "react";
import { saveMenuSpacing, storedMenuSpacing, type MenuSpacing } from "../menuSize";

const OPTIONS: readonly { value: MenuSpacing; label: string }[] = [
  { value: "kompakt", label: "Kompakt" },
  { value: "normal", label: "Normal" },
  { value: "weit", label: "Weiträumig" },
];

/** Auswahl der Abstände im Menü. Mit dem Finger bleiben Einträge mindestens 44 px hoch. */
export function MenuSpacingSwitch() {
  const [choice, setChoice] = useState<MenuSpacing>(storedMenuSpacing);
  const name = useId();

  const pick = (value: MenuSpacing) => {
    setChoice(value);
    saveMenuSpacing(value);
  };

  return (
    <fieldset className="theme-switch">
      <legend>Abstände im Menü</legend>
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
