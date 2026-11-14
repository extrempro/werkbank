import { useId, useState, type FormEvent } from "react";
import { ApiError } from "../../api";
import { parseTargetInput, targetInputText, updateMeta, type Meta } from "./api";

interface MetaFormProps {
  settingId: number;
  meta: Meta;
  onSaved: () => void;
  onCancel: () => void;
}

/** Formular für Beschreibung, Begründung, Kritikalität, Verantwortliche, Link und Soll-Wert. */
export function MetaForm({ settingId, meta, onSaved, onCancel }: MetaFormProps) {
  const [description, setDescription] = useState(meta.description ?? "");
  const [reasoning, setReasoning] = useState(meta.reasoning ?? "");
  const [criticality, setCriticality] = useState(meta.criticality ?? "");
  const [owner, setOwner] = useState(meta.owner ?? "");
  const [learnUrl, setLearnUrl] = useState(meta.learn_url ?? "");
  const [targetSet, setTargetSet] = useState(meta.target_set);
  const [target, setTarget] = useState(meta.target_set ? targetInputText(meta.target_value) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const targetHintId = useId();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const url = learnUrl.trim();
    if (url !== "" && !url.startsWith("https://")) {
      setError("Der Link muss mit https:// beginnen.");
      return;
    }
    if (targetSet && target.trim() === "") {
      setError("Bitte einen Soll-Wert eintragen oder das Häkchen entfernen.");
      return;
    }
    setError(null);
    setSaving(true);
    updateMeta(settingId, {
      description,
      reasoning,
      criticality: criticality === "" ? null : criticality,
      owner,
      learn_url: url,
      target_set: targetSet,
      target_value: targetSet ? parseTargetInput(target) : null,
    })
      .then(() => {
        onSaved();
      })
      .catch((failure: unknown) => {
        const detail = failure instanceof ApiError ? failure.detail : null;
        setError(detail ?? "Die Angaben konnten nicht gespeichert werden.");
        setSaving(false);
      });
  };

  return (
    <form className="meta-form" onSubmit={onSubmit} aria-label="Angaben bearbeiten">
      <label>
        Beschreibung
        <textarea
          value={description}
          maxLength={4000}
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        Warum bei uns so
        <textarea
          value={reasoning}
          maxLength={4000}
          rows={3}
          onChange={(event) => setReasoning(event.target.value)}
        />
      </label>
      <label>
        Kritikalität
        <select value={criticality} onChange={(event) => setCriticality(event.target.value)}>
          <option value="">Nicht festgelegt</option>
          <option value="niedrig">Niedrig</option>
          <option value="mittel">Mittel</option>
          <option value="hoch">Hoch</option>
        </select>
      </label>
      <label>
        Verantwortlich
        <input
          type="text"
          value={owner}
          maxLength={256}
          onChange={(event) => setOwner(event.target.value)}
        />
      </label>
      <label>
        Link zu Microsoft Learn
        <input
          type="url"
          value={learnUrl}
          maxLength={500}
          placeholder="https://learn.microsoft.com/…"
          onChange={(event) => setLearnUrl(event.target.value)}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          className="check"
          checked={targetSet}
          onChange={(event) => setTargetSet(event.target.checked)}
        />
        Soll-Wert festlegen
      </label>
      {targetSet && (
        <>
          <label>
            Soll-Wert
            <textarea
              className="mono"
              value={target}
              rows={4}
              aria-describedby={targetHintId}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <p className="hint" id={targetHintId}>
            Einfacher Text oder JSON, so wie der Wert oben angezeigt wird. Weicht der gelesene Wert
            davon ab, wird die Einstellung markiert.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="filter-actions">
        <button type="submit" className="button button-primary" disabled={saving}>
          Speichern
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
