import { useId } from "react";
import { InfoTip } from "../../components/InfoTip";
import type { SolutionInput, SolutionType } from "./api";

/**
 * Lösung beim Wechsel auf „Gelöst“: Lösungsart (wenn der Bereich welche hat), Text und ob beides
 * in der Mail an den Melder steht. Alles freiwillig.
 */
export function SolutionFields({
  types,
  value,
  onChange,
  mailHint = true,
}: {
  types: SolutionType[];
  value: SolutionInput;
  onChange: (next: SolutionInput) => void;
  /** Hinweis, dass die Lösung in der Mail steht (nur, wenn eine Mail rausgeht) */
  mailHint?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="ticket-solution">
      <legend>
        Lösung <span className="small">(freiwillig)</span>
      </legend>
      <InfoTip term="tickets.loesung" />
      {types.length > 0 && (
        <label htmlFor={`${id}-art`}>
          Lösungsart
          <select
            id={`${id}-art`}
            value={value.type_id ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                type_id: event.target.value ? Number(event.target.value) : null,
              })
            }
          >
            <option value="">Keine</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label htmlFor={`${id}-text`}>
        Was wurde gemacht?
        <textarea
          id={`${id}-text`}
          rows={2}
          maxLength={2000}
          value={value.text}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={value.public}
          onChange={(event) => onChange({ ...value, public: event.target.checked })}
        />{" "}
        {mailHint ? "In der Mail an den Melder zeigen" : "Für den Melder sichtbar (in Mails)"}
      </label>
    </fieldset>
  );
}
