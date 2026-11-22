import { useState } from "react";
import { errorText, savePushSettings, type AdminSettings, type PushAdminSettings } from "../api";
import { Feedback } from "../components/Feedback";

type Message = { kind: "status" | "alert"; text: string };

interface Props {
  push: PushAdminSettings;
  onChange: (settings: AdminSettings) => void;
}

/** Verwaltung › Mail & Teams: Push aufs Handy ein- und ausschalten. */
export function PushSettings({ push, onChange }: Props) {
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const save = (enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    savePushSettings(enabled)
      .then((result) => {
        onChange(result);
        setMessage({
          kind: "status",
          text: enabled
            ? "Push ist eingeschaltet. Jede Person schaltet es im Konto auf ihren Geräten ein."
            : "Push ist ausgeschaltet. Angemeldete Geräte bleiben gespeichert.",
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
    <section className="panel" aria-labelledby="push-titel">
      <div className="panel-head">
        <h3 id="push-titel">Push aufs Handy</h3>
        <span className={push.enabled ? "pill pill-ok" : "pill pill-neutral"}>
          {push.enabled ? "eingeschaltet" : "aus"}
        </span>
      </div>
      <div className="detail-body settings-form">
        <p className="small">
          Push-Nachrichten gehen über die Dienste von Google, Apple, Mozilla und Microsoft an die
          Geräte. Sie sind verschlüsselt und nennen nur Bereich und Anzahl, nie Inhalte. Der Server
          braucht dafür ausgehendes HTTPS zu diesen Diensten. Beim ersten Einschalten entsteht ein
          eigener Schlüssel; er liegt verschlüsselt in der Datenbank.
        </p>
        {!push.key_storage_available && (
          <p className="hint-box hint-bad">
            Auf dem Server fehlt die Schlüsseldatei (settings_key). Ohne sie lässt sich Push nicht
            einschalten.
          </p>
        )}
        <p className="small">Angemeldete Geräte: {push.devices}</p>
        <div className="actions">
          {push.enabled ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => save(false)}
            >
              Push ausschalten
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !push.key_storage_available}
              onClick={() => save(true)}
            >
              Push einschalten
            </button>
          )}
        </div>
        <Feedback message={message} onClose={() => setMessage(null)} />
      </div>
    </section>
  );
}
