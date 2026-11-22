import { useState } from "react";
import { errorText, saveToolsInternet, type AdminSettings } from "../api";
import { Feedback } from "../components/Feedback";

interface Props {
  settings: AdminSettings;
  onChange: (settings: AdminSettings) => void;
}

/** Verwaltung › Allgemein: Dürfen die IT-Tools über den Server ins Internet fragen? */
export function ToolsInternetSettings({ settings, onChange }: Props) {
  const enabled = settings.tools_internet ?? true;
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (next: boolean) => {
    setBusy(true);
    setMessage(null);
    saveToolsInternet(next)
      .then((result) => {
        onChange(result);
        setMessage({
          kind: "status",
          text: next
            ? "Die IT-Tools dürfen wieder ins Internet fragen."
            : "Die IT-Tools fragen nicht mehr ins Internet.",
        });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellung konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="tools-internet-titel">
      <div className="panel-head">
        <h3 id="tools-internet-titel">IT-Tools: Abfragen ins Internet</h3>
        <span className={enabled ? "pill pill-ok" : "pill pill-neutral"}>
          {enabled ? "erlaubt" : "ausgeschaltet"}
        </span>
      </div>
      <div className="detail-body settings-form">
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={enabled}
            disabled={busy}
            onChange={(event) => toggle(event.target.checked)}
          />
          IT-Tools dürfen über die Werkbank ins Internet fragen
        </label>
        <p className="small">
          Betrifft DNS Lookup und DNS-/Mail-Check (Cloudflare, Google, Quad9), RDAP (IANA und die
          zuständigen Registrys), Passwort prüfen (Have I Been Pwned, nur die ersten fünf Zeichen
          des Hashs) und die Subdomain-Suche (crt.sh). Der Server ruft nur diese Ziele auf, nur über
          https und nie interne Adressen. Angefragte Namen werden nicht gespeichert.
        </p>
        <Feedback message={message} onClose={() => setMessage(null)} />
      </div>
    </section>
  );
}
