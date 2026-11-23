import { useId, useState, type FormEvent } from "react";
import {
  errorText,
  saveTeamsSettings,
  sendTestTeams,
  type AdminSettings,
  type TeamsSettings as Teams,
  type TeamsUpdate,
} from "../api";
import { Feedback } from "../components/Feedback";

type Message = { kind: "status" | "alert"; text: string };

interface Props {
  teams: Teams;
  onChange: (settings: AdminSettings) => void;
}

/** Verwaltung › Allgemein: Workflow aus Power Automate für Benachrichtigungen in Teams. */
export function TeamsSettings({ teams, onChange }: Props) {
  const [enabled, setEnabled] = useState(teams.enabled);
  const [url, setUrl] = useState("");
  const [remove, setRemove] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const urlHint = useId();

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const update: TeamsUpdate = { enabled: remove ? false : enabled };
    if (remove) {
      update.url = "";
    } else if (url.trim() !== "") {
      update.url = url.trim();
    }
    setBusy(true);
    setMessage(null);
    saveTeamsSettings(update)
      .then((result) => {
        onChange(result);
        setUrl("");
        setRemove(false);
        setEnabled(result.teams?.enabled ?? false);
        setMessage({ kind: "status", text: "Die Einstellungen für Teams sind gespeichert." });
      })
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Angaben konnten nicht gespeichert werden. Bitte prüf sie."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const onTest = () => {
    setBusy(true);
    setMessage(null);
    sendTestTeams()
      .then((result) =>
        setMessage({
          kind: "status",
          text: `Die Testnachricht ist an ${result.recipient} unterwegs. Bitte sieh im Teams-Chat nach.`,
        }),
      )
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: `Die Testnachricht konnte nicht gesendet werden: ${errorText(error, "unbekannter Fehler")}`,
        }),
      )
      .finally(() => setBusy(false));
  };

  const ready = teams.enabled && teams.url_set;
  return (
    <section className="panel" aria-labelledby="teams-titel">
      <div className="panel-head">
        <h3 id="teams-titel">Benachrichtigungen in Teams</h3>
        <span className={ready ? "pill pill-ok" : "pill pill-neutral"}>
          {ready ? "eingeschaltet" : teams.url_set ? "ausgeschaltet" : "nicht eingerichtet"}
        </span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave}>
        <p className="small">
          Die Werkbank schickt Benachrichtigungen an einen Workflow in Power Automate. Der Workflow
          stellt sie jeder Person in ihren eigenen Teams-Chat zu. Wie du den Workflow anlegst, steht
          in der Anleitung zur Einrichtung. Welche Benachrichtigungen jemand in Teams bekommt,
          stellt jede Person im Konto selbst ein.
        </p>
        <label>
          {teams.url_set ? "Neue Adresse des Workflows" : "Adresse des Workflows"}
          <input
            type="password"
            value={url}
            maxLength={2000}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={urlHint}
            placeholder="https://…logic.azure.com/workflows/…"
            disabled={!teams.url_storage_available || remove}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <p className="small" id={urlHint}>
          {!teams.url_storage_available
            ? "Auf dem Server fehlt die Schlüsseldatei „settings_key“. Ohne sie kann keine Adresse gespeichert werden."
            : teams.url_set
              ? "Eine Adresse ist gespeichert und wird nie angezeigt, weil sie ein Geheimnis enthält. Leer lassen, um sie zu behalten."
              : "Die Adresse enthält ein Geheimnis. Sie liegt verschlüsselt in der Datenbank und wird nie angezeigt."}
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={enabled && !remove}
            disabled={remove}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Benachrichtigungen in Teams einschalten
        </label>
        {teams.url_set && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={remove}
              onChange={(event) => setRemove(event.target.checked)}
            />
            Gespeicherte Adresse löschen
          </label>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Teams speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || !ready}
            onClick={onTest}
          >
            Testnachricht an mich senden
          </button>
        </div>
        <Feedback message={message} onClose={() => setMessage(null)} />
      </form>
    </section>
  );
}
