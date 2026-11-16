import { useMemo, useState } from "react";
import { NetNotice } from "../NetNotice";
import { DataTable } from "../calc";
import { ErrorBox, ToolSection } from "../ui";
import { checkStrength, durationText, pwnedCount } from "./strength";

const TONE = ["pill pill-bad", "pill pill-bad", "pill pill-todo", "pill pill-ok", "pill pill-ok"];

export default function PasswordCheckTool() {
  // Das Kennwort bleibt im Speicher der Seite: nicht in der Adresszeile, nicht gespeichert.
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [leak, setLeak] = useState<{ for: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ for: string; text: string } | null>(null);
  const result = useMemo(() => (password ? checkStrength(password) : null), [password]);
  // Ergebnisse gelten nur für das Kennwort, mit dem geprüft wurde.
  const pwned = leak?.for === password ? leak.count : null;
  const leakError = error?.for === password ? error.text : null;

  const checkLeak = () => {
    const checked = password;
    setBusy(true);
    setError(null);
    pwnedCount(checked).then(
      (count) => {
        setLeak({ for: checked, count });
        setBusy(false);
      },
      (caught: unknown) => {
        setError({ for: checked, text: (caught as Error).message });
        setBusy(false);
      },
    );
  };

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label>
          Kennwort
          <input
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button-secondary"
          aria-pressed={show}
          onClick={() => setShow(!show)}
        >
          {show ? "Verbergen" : "Anzeigen"}
        </button>
      </div>

      {result && (
        <>
          <p className="tool-row" role="status">
            <span className={TONE[result.score]}>{result.label}</span>
            <span className="small">
              geschätzt ca. {result.bits} Bit · {password.length} Zeichen
            </span>
          </p>

          <ToolSection title="Auffälligkeiten">
            <ul className="tool-list">
              {result.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          </ToolSection>

          <ToolSection title="Geschätzte Zeit zum Erraten">
            <DataTable
              caption="Geschätzte Zeit zum Erraten"
              head={["Angriff", "Dauer"]}
              rows={result.crackTimes.map((entry) => [entry.label, durationText(entry.seconds)])}
            />
            <p className="small">
              Grobe Schätzung für einen gezielten Angriff (im Schnitt nach der Hälfte der
              Versuche).
            </p>
          </ToolSection>

          <ToolSection title="In Datenlecks bekannt?">
            <NetNotice>
              Fragt Have I Been Pwned mit k-Anonymität über die Werkbank ab: Nur die ersten fünf
              Zeichen des SHA-1-Hashs gehen hinaus, das Kennwort nie. Verglichen wird hier im
              Browser.
            </NetNotice>
            <div className="tool-row">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={checkLeak}
              >
                {busy ? "Prüfe …" : "Jetzt prüfen"}
              </button>
            </div>
            {leakError && <ErrorBox>{leakError}</ErrorBox>}
            {pwned !== null && (
              <p role="status">
                {pwned > 0 ? (
                  <span className="pill pill-bad">
                    {pwned.toLocaleString("de-DE")}× in Datenlecks gefunden, nicht verwenden
                  </span>
                ) : (
                  <span className="pill pill-ok">In keinem bekannten Datenleck gefunden</span>
                )}
              </p>
            )}
          </ToolSection>
        </>
      )}
      <p className="small">Das Kennwort wird nicht gespeichert und steht nie in der Adresszeile.</p>
    </div>
  );
}
