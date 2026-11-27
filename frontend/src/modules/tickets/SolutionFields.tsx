import { Field } from "../../components/Field";
import { ListChoice } from "../../components/ListChoice";
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
  return (
    <fieldset className="ticket-solution">
      <legend>
        Lösung <span className="small">(freiwillig)</span> <InfoTip term="tickets.loesung" />
      </legend>
      {types.length > 0 && (
        <ListChoice
          label="Lösungsart"
          none="Keine"
          unit="Lösungsarten"
          placeholder="Name der Lösungsart …"
          options={types.map((type) => ({ id: type.id, label: type.name }))}
          value={value.type_id === null ? "" : String(value.type_id)}
          onChange={(next) => onChange({ ...value, type_id: next ? Number(next) : null })}
        />
      )}
      <Field label="Was wurde gemacht?">
        {(control) => (
          <textarea
            {...control}
            rows={3}
            maxLength={2000}
            value={value.text}
            onChange={(event) => onChange({ ...value, text: event.target.value })}
          />
        )}
      </Field>
      <label className="check-label ticket-solution-public">
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
