import { useId, useState, type FormEvent } from "react";
import { errorText, saveCredentialWarnDays, type AdminSettings } from "../api";

const DEFAULT_DAYS = [60, 30, 7];
const LABELS = ["Hinweis ab (Tage)", "Warnung ab (Tage)", "Dringend ab (Tage)"];

interface Props {
  settings: AdminSettings;
  onChange: (settings: AdminSettings) => void;
}

/** Verwaltung › Allgemein: Vorlauf, mit dem die Werkbank auf ablaufende Zertifikate hinweist. */
export function CredentialWarnSettings({ settings, onChange }: Props) {
  const stored = settings.credential_warn_days ?? DEFAULT_DAYS;
  const min = settings.credential_warn_min ?? 1;
  const max = settings.credential_warn_max ?? 365;
  const [days, setDays] = useState(() => stored.map(String));
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = useId();

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const values = days.map(Number);
    const [notice = 0, warn = 0, urgent = 0] = values;
    if (
      !values.every(Number.isInteger) ||
      !(max >= notice && notice > warn && warn > urgent && urgent >= min)
    ) {
      setMessage({
        kind: "alert",
        text: `Bitte drei absteigende ganze Zahlen zwischen ${min} und ${max} eintragen, z. B. 60, 30 und 7.`,
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    saveCredentialWarnDays(values)
      .then((result) => {
        onChange(result);
        setMessage({ kind: "status", text: "Der Vorlauf ist gespeichert." });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Vorlauf konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="vorlauf-titel">
      <div className="panel-head">
        <h3 id="vorlauf-titel">Zertifikate und Secrets</h3>
        <span className="small">Vorlauf vor dem Ablauf</span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave} noValidate>
        <div className="tool-row">
          {LABELS.map((label, index) => (
            <label className="narrow" key={label}>
              {label}
              <input
                type="number"
                value={days[index] ?? ""}
                min={min}
                max={max}
                aria-describedby={hint}
                onChange={(event) =>
                  setDays(
                    days.map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
        <p className="small" id={hint}>
          So viele Tage vor dem Ablauf eines Zertifikats oder Secrets im Tenant weist die Werkbank
          hin, warnt und drängt. Ab dem ersten Wert steht der Eintrag als Aufgabe auf der
          Startseite. Die Zahlen müssen absteigend sein, zwischen {min} und {max}.
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Vorlauf speichern
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
