import { useEffect, useState } from "react";
import { errorText } from "../api";
import { surfaceLogo, useBranding } from "../branding";
import { BrandMark } from "../components/Brand";
import {
  confirmPublicIssue,
  fetchPublicIssue,
  type PublicIssue,
} from "../modules/inventory/issuesApi";
import { useTheme } from "../theme";

/**
 * Empfang von Geräten bestätigen, über den Einmal-Link aus der Mail (ohne Anmeldung). Zeigt
 * nur Nummer, Geräte und Nutzungsregeln; nach der Bestätigung gilt der Link nicht mehr.
 */
export function ConfirmIssuePage({ token }: { token: string }) {
  const branding = useBranding();
  const theme = useTheme();
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPublicIssue(token).then(
      (result) => active && setIssue(result),
      (problem: unknown) =>
        active &&
        setFailed(errorText(problem, "Der Link ist abgelaufen oder wurde schon benutzt.")),
    );
    return () => {
      active = false;
    };
  }, [token]);

  const confirm = () => {
    if (!accepted) {
      setError("Bitte setz zuerst das Häkchen.");
      return;
    }
    setBusy(true);
    setError(null);
    confirmPublicIssue(token).then(setIssue, (problem: unknown) => {
      setError(errorText(problem, "Die Bestätigung hat nicht geklappt."));
      setBusy(false);
    });
  };

  return (
    <main className="confirm-page">
      <BrandMark logoUrl={surfaceLogo(branding, theme)} size="large" />
      <h1>Empfang bestätigen</h1>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed} Wende dich bitte an die IT.
        </p>
      )}
      {!issue && !failed && <p role="status">Wird geladen …</p>}
      {issue && issue.confirmed && (
        <p role="status" className="hint-box hint-ok">
          Danke, {issue.person_name}. Du hast den Empfang der Geräte aus {issue.number} bestätigt.
          Du kannst diese Seite schließen.
        </p>
      )}
      {issue && !issue.confirmed && (
        <section className="panel" aria-labelledby="bestaetigen-geraete">
          <div className="detail-body form-stack">
            <p>
              Hallo {issue.person_name}, bitte bestätige, dass du diese Geräte aus der Ausgabe{" "}
              <span className="mono">{issue.number}</span> bekommen hast.
            </p>
            <h2 id="bestaetigen-geraete" className="sub-head">
              Geräte
            </h2>
            <ul className="link-list">
              {issue.entries.map((item) => (
                <li key={item.hardware_id}>
                  {item.name} <span className="small">({item.kind})</span>
                  {item.serial && <span className="small mono"> · SN {item.serial}</span>}
                  {item.accessories.length > 0 && (
                    <span className="small"> · mit {item.accessories.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
            {issue.rules_text && (
              <>
                <h2 className="sub-head">Nutzungsregeln</h2>
                <p className="pre-line">{issue.rules_text}</p>
              </>
            )}
            <label className="check-label issue-check">
              <input
                type="checkbox"
                className="check"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>
                Ich habe die Geräte bekommen
                {issue.rules_text ? " und die Nutzungsregeln gelesen" : ""}.
              </span>
            </label>
            {error && (
              <p role="alert" className="hint-box hint-bad">
                {error}
              </p>
            )}
            <div className="project-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={confirm}
              >
                Empfang bestätigen
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
