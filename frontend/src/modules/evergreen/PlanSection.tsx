import { useState, type FormEvent } from "react";
import { ApiError, formatDateTime } from "../../api";
import { formatValue, parseTargetInput } from "../m365/api";
import {
  addPlanEntry,
  confirmPlanEntry,
  planStatusLabel,
  removePlanEntry,
  searchSettings,
  type ItemDetail,
  type PlanEntry,
  type SettingChoice,
} from "./api";

interface PlanSectionProps {
  detail: ItemDetail;
  onChange: (detail: ItemDetail) => void;
}

/** Geplante Umsetzung: Soll-Werte, die nach dem Beschluss im Tenant gelten sollen. */
export function PlanSection({ detail, onChange }: PlanSectionProps) {
  const itemId = detail.item.id;
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [instruction, setInstruction] = useState("");
  const [provisional, setProvisional] = useState(false);
  const [search, setSearch] = useState("");
  const [choices, setChoices] = useState<SettingChoice[] | null>(null);
  const [setting, setSetting] = useState<SettingChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (failure: unknown, fallback: string) => {
    const text = failure instanceof ApiError ? failure.detail : null;
    setError(text ?? fallback);
  };

  const reset = () => {
    setAdding(false);
    setLabel("");
    setTarget("");
    setInstruction("");
    setProvisional(false);
    setSearch("");
    setChoices(null);
    setSetting(null);
    setError(null);
  };

  const onSearch = () => {
    if (search.trim().length < 2) {
      setError("Bitte mindestens 2 Zeichen für die Suche eingeben.");
      return;
    }
    setError(null);
    searchSettings(search.trim())
      .then(setChoices)
      .catch((failure: unknown) => fail(failure, "Die Suche hat nicht funktioniert."));
  };

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (label.trim().length < 3) {
      setError("Bitte eine Bezeichnung mit mindestens 3 Zeichen eintragen.");
      return;
    }
    if (target.trim() === "") {
      setError("Bitte den Soll-Wert eintragen.");
      return;
    }
    addPlanEntry(itemId, {
      label: label.trim(),
      target_value: parseTargetInput(target),
      instruction: instruction.trim(),
      provisional,
      setting_id: setting ? setting.id : null,
    })
      .then((result) => {
        reset();
        onChange(result);
      })
      .catch((failure: unknown) => fail(failure, "Der Eintrag konnte nicht gespeichert werden."));
  };

  const onRemove = (entry: PlanEntry) => {
    removePlanEntry(itemId, entry.id)
      .then(onChange)
      .catch((failure: unknown) => fail(failure, "Der Eintrag konnte nicht entfernt werden."));
  };

  const onConfirm = (entry: PlanEntry, done: boolean) => {
    confirmPlanEntry(itemId, entry.id, done)
      .then(onChange)
      .catch((failure: unknown) =>
        fail(failure, "Die Bestätigung konnte nicht gespeichert werden."),
      );
  };

  return (
    <section className="setting-section" aria-labelledby="umsetzung-titel">
      <h2 id="umsetzung-titel">Geplante Umsetzung</h2>
      {detail.plan.length === 0 ? (
        <p className="empty">
          {detail.not_controllable
            ? "Nicht steuerbar: Es gibt nichts umzusetzen."
            : "Noch keine Soll-Werte eingetragen."}
        </p>
      ) : (
        <ul className="plan">
          {detail.plan.map((entry) => (
            <li key={entry.id}>
              <h3>
                {entry.label}
                {entry.provisional && <span className="badge">Vorläufig bis zum Beschluss</span>}
              </h3>
              <dl className="facts">
                <div>
                  <dt>Soll-Wert</dt>
                  <dd className="value">{formatValue(entry.target_value)}</dd>
                </div>
                <div>
                  <dt>Stand</dt>
                  <dd>
                    {planStatusLabel(entry.status)}
                    {entry.confirmed_by && (
                      <span className="small path">
                        {entry.confirmed_by}, {formatDateTime(entry.confirmed_at)}
                      </span>
                    )}
                  </dd>
                </div>
                {entry.setting_path && (
                  <div>
                    <dt>Aktueller Wert im Tenant</dt>
                    <dd className="value">{formatValue(entry.current_value)}</dd>
                  </div>
                )}
                {entry.setting_path && (
                  <div>
                    <dt>Überwachte Einstellung</dt>
                    <dd className="mono path">{entry.setting_path}</dd>
                  </div>
                )}
              </dl>
              {entry.instruction && <p className="text">{entry.instruction}</p>}
              {detail.can_plan && (
                <div className="filter-actions actions">
                  {!entry.monitored && entry.status === "unbestaetigt" && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => onConfirm(entry, true)}
                    >
                      Als umgesetzt bestätigen
                      <span className="visually-hidden">: {entry.label}</span>
                    </button>
                  )}
                  {!entry.monitored && entry.status === "bestaetigt" && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => onConfirm(entry, false)}
                    >
                      Bestätigung zurücknehmen
                      <span className="visually-hidden">: {entry.label}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onRemove(entry)}
                  >
                    Entfernen
                    <span className="visually-hidden">: {entry.label}</span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {detail.can_plan && !adding && (
        <p className="actions">
          <button type="button" className="button button-secondary" onClick={() => setAdding(true)}>
            Soll-Wert hinzufügen
          </button>
        </p>
      )}

      {adding && (
        <form
          className="meta-form plan-form"
          onSubmit={onAdd}
          aria-label="Neuer Eintrag der geplanten Umsetzung"
        >
          <label>
            Bezeichnung (verständlich für Betriebsrat und Geschäftsführung)
            <input
              type="text"
              value={label}
              maxLength={300}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label>
            Soll-Wert (einfacher Text oder JSON)
            <textarea
              className="mono"
              value={target}
              rows={2}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <label>
            Anleitung: wo oder mit welchem Befehl wird der Wert gesetzt?
            <textarea
              value={instruction}
              maxLength={8000}
              rows={2}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={provisional}
              onChange={(event) => setProvisional(event.target.checked)}
            />
            Vorläufige Sperre bis zum Beschluss
          </label>

          <fieldset className="plan-link">
            <legend>Überwachte Einstellung verknüpfen (freiwillig)</legend>
            <p className="hint">
              Mit Verknüpfung prüft die Werkbank beim Abruf aus dem Tenant selbst, ob der Wert
              gesetzt ist. Ohne Verknüpfung bestätigt die IT die Umsetzung von Hand.
            </p>
            {setting ? (
              <p>
                Verknüpft: <span className="mono path">{setting.path}</span>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setSetting(null)}
                >
                  Verknüpfung lösen
                </button>
              </p>
            ) : (
              <>
                <label>
                  Suche in Name und Pfad
                  <input
                    type="search"
                    value={search}
                    maxLength={200}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button type="button" className="button button-secondary" onClick={onSearch}>
                  Einstellung suchen
                </button>
                {choices !== null && choices.length === 0 && (
                  <p className="empty">Keine überwachte Einstellung gefunden.</p>
                )}
                {choices !== null && choices.length > 0 && (
                  <ul className="plain choices">
                    {choices.map((choice) => (
                      <li key={choice.id}>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => setSetting(choice)}
                        >
                          {choice.title}
                        </button>
                        <span className="mono small path">
                          {choice.path} · aktuell: {formatValue(choice.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </fieldset>

          <div className="filter-actions">
            <button type="submit" className="button button-primary">
              Eintragen
            </button>
            <button type="button" className="button button-secondary" onClick={reset}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
