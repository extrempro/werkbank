import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText } from "../api";
import {
  fetchNinjaSettings,
  saveNinjaSettings,
  testNinja,
  type NinjaSettings as Settings,
  type NinjaUpdate,
} from "../modules/inventory/api";

type Message = { kind: "status" | "alert"; text: string };

/** Verwaltung › Verbindungen: NinjaOne für den Abgleich im IT-Bestand. */
export function NinjaSettings() {
  const [stored, setStored] = useState<{ settings: Settings; version: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<Message | null>(null);

  useEffect(() => {
    let active = true;
    fetchNinjaSettings().then(
      (settings) => active && setStored({ settings, version: 0 }),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="hint-box hint-bad">Die Anbindung an NinjaOne konnte nicht geladen werden.</p>
    );
  }
  if (!stored) {
    return null;
  }
  return (
    <NinjaForm
      key={stored.version}
      stored={stored.settings}
      initialMessage={saved}
      onSaved={(settings) => {
        setSaved({ kind: "status", text: "Die Anbindung an NinjaOne ist gespeichert." });
        setStored({ settings, version: stored.version + 1 });
      }}
    />
  );
}

function NinjaForm({
  stored,
  initialMessage,
  onSaved,
}: {
  stored: Settings;
  initialMessage: Message | null;
  onSaved: (settings: Settings) => void;
}) {
  const [enabled, setEnabled] = useState(stored.enabled);
  const [region, setRegion] = useState(stored.region);
  const [clientId, setClientId] = useState(stored.client_id);
  const [secret, setSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [message, setMessage] = useState<Message | null>(initialMessage);
  const [busy, setBusy] = useState(false);
  const secretHint = useId();

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const update: NinjaUpdate = { enabled, region, client_id: clientId.trim() };
    if (removeSecret) {
      update.client_secret = "";
    } else if (secret.trim()) {
      update.client_secret = secret.trim();
    }
    setBusy(true);
    setMessage(null);
    saveNinjaSettings(update)
      .then(onSaved)
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Angaben konnten nicht gespeichert werden. Bitte prüfen."),
        });
        setBusy(false);
      });
  };

  const onTest = () => {
    setBusy(true);
    setMessage(null);
    testNinja()
      .then((result) =>
        setMessage({
          kind: "status",
          text: `Verbindung in Ordnung: ${result.devices} Arbeitsplatzrechner (${result.notebooks} Notebooks, ${result.pcs} PCs).`,
        }),
      )
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: `NinjaOne ist nicht erreichbar: ${errorText(error, "unbekannter Fehler")}`,
        }),
      )
      .finally(() => setBusy(false));
  };

  const ready = stored.enabled && stored.secret_set && stored.client_id !== "";

  return (
    <section className="panel" aria-labelledby="ninja-titel">
      <div className="panel-head">
        <h3 id="ninja-titel">NinjaOne (IT-Bestand)</h3>
        <span className={ready ? "pill pill-ok" : "pill pill-neutral"}>
          {ready ? "eingeschaltet" : stored.secret_set ? "ausgeschaltet" : "nicht eingerichtet"}
        </span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave}>
        <p className="small">
          Für den IT-Bestand liest die Werkbank alle 30 Minuten die Arbeitsplatzrechner aus NinjaOne
          (Windows, macOS, Linux; keine Server). Nötig ist eine API-App in NinjaOne mit dem Typ „API
          Services (machine-to-machine)“, dem Scope „Monitoring“ und der Freigabe „Client
          Credentials“. Die Werkbank liest nur.
        </p>
        <label>
          Region
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            {stored.regions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({entry.host})
              </option>
            ))}
          </select>
        </label>
        <label>
          Client-ID
          <input
            type="text"
            value={clientId}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setClientId(event.target.value)}
          />
        </label>
        <label>
          {stored.secret_set ? "Neues Client-Secret" : "Client-Secret"}
          <input
            type="password"
            value={secret}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={secretHint}
            disabled={!stored.secret_storage_available || removeSecret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        <p className="small" id={secretHint}>
          {!stored.secret_storage_available
            ? "Auf dem Server fehlt die Schlüsseldatei „settings_key“. Ohne sie kann kein Secret gespeichert werden."
            : stored.secret_set
              ? "Ein Secret ist gespeichert und wird nie angezeigt. Leer lassen, um es zu behalten."
              : "Das Secret liegt verschlüsselt in der Datenbank und wird nie angezeigt."}
        </p>
        {stored.secret_set && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={removeSecret}
              onChange={(event) => setRemoveSecret(event.target.checked)}
            />
            Gespeichertes Secret löschen
          </label>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Abgleich mit NinjaOne einschalten
        </label>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            NinjaOne speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || !stored.secret_set || stored.client_id === ""}
            onClick={onTest}
          >
            Verbindung prüfen
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
