import { useEffect, useState } from "react";
import { ApiError, errorText, formatDateTime } from "../api";
import {
  currentSubscription,
  disablePushHere,
  enablePushHere,
  fetchPushState,
  isApple,
  pushSupported,
  removePushDevice,
  runsAsApp,
  sendPushTest,
  type PushState,
} from "../notifications";

type Message = { kind: "status" | "alert"; text: string };

/** Konto: Push auf diesem Gerät ein- und ausschalten, angemeldete Geräte verwalten. */
export function PushDevices() {
  const [state, setState] = useState<PushState | null>(null);
  const [here, setHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const supported = pushSupported();

  useEffect(() => {
    let active = true;
    fetchPushState().then(
      (result) => active && setState(result),
      () => active && setState({ available: false, public_key: null, devices: [] }),
    );
    currentSubscription().then(
      (subscription) => active && setHere(subscription !== null),
      () => active && setHere(false),
    );
    return () => {
      active = false;
    };
  }, []);

  const run = (action: () => Promise<PushState>, done: string, onHere?: boolean) => {
    setBusy(true);
    setMessage(null);
    action()
      .then((result) => {
        setState(result);
        if (onHere !== undefined) {
          setHere(onHere);
        }
        setMessage({ kind: "status", text: done });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text:
            error instanceof ApiError
              ? errorText(error, "Das hat nicht geklappt.")
              : error instanceof Error
                ? error.message
                : "Das hat nicht geklappt.",
        });
      })
      .finally(() => setBusy(false));
  };

  if (!state || !state.available) {
    return null;
  }
  const appleWithoutApp = isApple() && !runsAsApp();

  return (
    <div className="push-devices">
      <h3 className="push-title">Push auf deinen Geräten</h3>
      {!supported || appleWithoutApp ? (
        <p className="small">
          {appleWithoutApp
            ? "Auf iPhone und iPad gibt es Push nur, wenn die Werkbank als App auf dem Home-Bildschirm liegt: in Safari „Teilen“ › „Zum Home-Bildschirm“, dann die Werkbank von dort öffnen."
            : "Dieser Browser kann keine Push-Nachrichten empfangen."}
        </p>
      ) : (
        <div className="actions">
          {here ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => run(disablePushHere, "Push ist auf diesem Gerät aus.", false)}
            >
              Push auf diesem Gerät ausschalten
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !state.public_key}
              onClick={() =>
                run(
                  () => enablePushHere(state.public_key ?? ""),
                  "Push ist auf diesem Gerät eingeschaltet. Wähle unten, wofür.",
                  true,
                )
              }
            >
              Push auf diesem Gerät einschalten
            </button>
          )}
          {state.devices.length > 0 && (
            <button
              type="button"
              className="button button-link"
              disabled={busy}
              onClick={() => run(sendPushTest, "Die Testnachricht ist unterwegs.")}
            >
              Testnachricht senden
            </button>
          )}
        </div>
      )}
      {state.devices.length > 0 && (
        <ul className="push-list" aria-label="Geräte mit Push">
          {state.devices.map((device) => (
            <li key={device.id}>
              <span>
                <strong>{device.label || "Gerät"}</strong>
                <span className="small">
                  {" "}
                  · angemeldet {formatDateTime(device.created_at)}
                  {device.last_success_at &&
                    ` · zuletzt zugestellt ${formatDateTime(device.last_success_at)}`}
                </span>
              </span>
              <button
                type="button"
                className="button button-link"
                disabled={busy}
                onClick={() => run(() => removePushDevice(device.id), "Das Gerät ist entfernt.")}
              >
                Entfernen
                <span className="visually-hidden"> – {device.label || "Gerät"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p
          role={message.kind}
          className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
