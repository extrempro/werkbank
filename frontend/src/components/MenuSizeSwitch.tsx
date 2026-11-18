import { useId, useState } from "react";
import { saveMenuSize, storedMenuSize, type MenuSize } from "../menuSize";

const OPTIONS: readonly { value: MenuSize; label: string }[] = [
  { value: "klein", label: "Klein" },
  { value: "normal", label: "Normal" },
  { value: "gross", label: "Groß" },
  { value: "sehr-gross", label: "Sehr groß" },
];

/** Auswahl der Schriftgröße im Menü. Die Seiten selbst bleiben, wie sie sind. */
export function MenuSizeSwitch() {
  const [choice, setChoice] = useState<MenuSize>(storedMenuSize);
  const name = useId();

  const pick = (value: MenuSize) => {
    setChoice(value);
    saveMenuSize(value);
  };

  return (
    <fieldset className="theme-switch">
      <legend>Schriftgröße im Menü</legend>
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
