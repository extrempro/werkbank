import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { fetchBudgetSettings, MONTHS, saveBudgetSettings, type BudgetSettings } from "./api";

function SettingsForm({ initial }: { initial: BudgetSettings }) {
  const [settings, setSettings] = useState(initial);
  const [startMonth, setStartMonth] = useState(initial.start_month);
  const [yearLabel, setYearLabel] = useState(initial.year_label);
  const [costCenter, setCostCenter] = useState(initial.cost_center);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!yearLabel.trim()) {
      setMessage({
        kind: "alert",
        text: "Bitte eine Bezeichnung für das Geschäftsjahr eintragen.",
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    saveBudgetSettings({
      start_month: startMonth,
      year_label: yearLabel.trim(),
      cost_center: costCenter.trim(),
    })
      .then((result) => {
        setSettings(result);
        setMessage({ kind: "status", text: "Die Einstellungen sind gespeichert." });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellungen konnten nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  const endMonth = MONTHS[(startMonth + 10) % 12] ?? "";
  return (
    <section className="panel" aria-labelledby="budget-jahr-titel">
      <div className="panel-head">
        <h2 id="budget-jahr-titel">Geschäftsjahr und Kostenstelle</h2>
        <span className="small">
          Laufend: {settings.year_label} {settings.current_year_name}
        </span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label className="narrow">
            Beginn des Geschäftsjahrs
            <select
              value={startMonth}
              onChange={(event) => setStartMonth(Number(event.target.value))}
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  1. {month}
                </option>
              ))}
            </select>
          </label>
          <label className="narrow">
            Bezeichnung
            <input
              type="text"
              value={yearLabel}
              maxLength={30}
              onChange={(event) => setYearLabel(event.target.value)}
            />
          </label>
          <label className="narrow">
            Kostenstelle (freiwillig)
            <input
              type="text"
              value={costCenter}
              maxLength={40}
              onChange={(event) => setCostCenter(event.target.value)}
            />
          </label>
        </div>
        <p className="small">
          Das Geschäftsjahr dauert zwölf Monate und endet am letzten Tag im {endMonth}. Die
          Bezeichnung erscheint überall, wo die Werkbank das Jahr nennt, z. B. „Geschäftsjahr“ oder
          „Wirtschaftsjahr“. Wer den Beginn ändert, ordnet auch frühere Pläne den neuen Zeiträumen
          zu.
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Einstellungen speichern
          </button>
        </div>
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {message.text}
          </p>
        )}
      </form>
    </section>
  );
}

/** IT-Budget › Einstellungen: Beginn und Bezeichnung des Geschäftsjahrs, Kostenstelle. */
export function BudgetSettingsPage() {
  const [settings, setSettings] = useState<BudgetSettings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBudgetSettings()
      .then((result) => {
        if (active) {
          setSettings(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">IT-Budget</p>
        <h1>Einstellungen</h1>
        <p className="page-sub">Grundlagen des Budgets. Ändern darf sie der Budgetverwalter.</p>
      </header>
      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Einstellungen konnten nicht geladen werden.
        </p>
      )}
      {!failed && !settings && <p role="status">Wird geladen …</p>}
      {settings && <SettingsForm initial={settings} />}
    </div>
  );
}
