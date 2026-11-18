import { useId, useState, type FormEvent } from "react";
import {
  errorText,
  saveAiSettings,
  testAiConnection,
  type AdminSettings,
  type AiProvider,
  type AiSettings as AiSettingsData,
  type AiUpdate,
} from "../api";

type Message = { kind: "status" | "alert"; text: string };

const ANTHROPIC_URL = "https://api.anthropic.com/v1";

interface AiSettingsProps {
  ai: AiSettingsData;
  onChange: (settings: AdminSettings) => void;
}

/** Verwaltung › Allgemein: Anbieter für KI-Texte (OpenAI-kompatibel oder Anthropic). */
export function AiSettings({ ai, onChange }: AiSettingsProps) {
  const [enabled, setEnabled] = useState(ai.enabled);
  const [provider, setProvider] = useState<AiProvider>(ai.provider);
  const [baseUrl, setBaseUrl] = useState(ai.base_url);
  const [model, setModel] = useState(ai.model);
  const [rate, setRate] = useState(String(ai.texts_per_hour));
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const keyHint = useId();
  const rateHint = useId();
  const urlHint = useId();

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const update: AiUpdate = {
      enabled,
      provider,
      base_url: baseUrl.trim(),
      model: model.trim(),
      texts_per_hour: Number(rate),
    };
    if (removeKey) {
      update.api_key = "";
    } else if (apiKey !== "") {
      update.api_key = apiKey;
    }
    setBusy(true);
    setMessage(null);
    saveAiSettings(update)
      .then((result) => {
        onChange(result);
        setApiKey("");
        setRemoveKey(false);
        setMessage({ kind: "status", text: "Die KI-Einstellungen sind gespeichert." });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Angaben konnten nicht gespeichert werden. Bitte prüfen."),
        });
      })
      .finally(() => setBusy(false));
  };

  const onTest = () => {
    setBusy(true);
    setMessage(null);
    testAiConnection()
      .then((result) => {
        setMessage({
          kind: "status",
          text: `Die Verbindung funktioniert. Das Modell ${result.model} hat geantwortet.`,
        });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: `Die Verbindung funktioniert nicht: ${errorText(error, "unbekannter Fehler")}`,
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="ki-titel">
      <div className="panel-head">
        <h3 id="ki-titel">KI-Texte</h3>
        <span className={ai.enabled ? "pill pill-ok" : "pill pill-neutral"}>
          {ai.enabled ? "eingeschaltet" : "ausgeschaltet"}
        </span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave}>
        <p className="small">
          Die Werkbank lässt für Einstellungen ohne eigene Beschreibung einen kurzen Text erzeugen.
          An den Anbieter gehen nur Dienst, Bereich und Name der Eigenschaft, nie Werte, Namen oder
          andere Daten aus dem Tenant. Jeder Text ist als „KI-generiert, ungeprüft“ gekennzeichnet,
          bis ihn jemand mit der Rolle Reviewer freigibt.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          KI-Texte einschalten
        </label>
        <div className="form-grid">
          <label>
            Art der Schnittstelle
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value === "anthropic" ? "anthropic" : "openai";
                setProvider(next);
                if (next === "anthropic" && baseUrl.trim() === "") {
                  setBaseUrl(ANTHROPIC_URL);
                }
              }}
            >
              <option value="openai">OpenAI-kompatibel</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </label>
          <label>
            Adresse der Schnittstelle
            <input
              type="url"
              value={baseUrl}
              maxLength={300}
              autoComplete="off"
              placeholder={provider === "anthropic" ? ANTHROPIC_URL : "https://ki.example.com/v1"}
              aria-describedby={urlHint}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label>
            Modell
            <input
              type="text"
              value={model}
              maxLength={100}
              autoComplete="off"
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label>
            {ai.api_key_set ? "Neuer Schlüssel" : "Schlüssel (freiwillig)"}
            <input
              type="password"
              value={apiKey}
              maxLength={500}
              autoComplete="new-password"
              aria-describedby={keyHint}
              disabled={!ai.key_storage_available || removeKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label>
            Neue Texte je Stunde (höchstens)
            <input
              type="number"
              value={rate}
              required
              min={ai.texts_per_hour_min}
              max={ai.texts_per_hour_max}
              aria-describedby={rateHint}
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
        </div>
        <p className="small" id={urlHint}>
          {provider === "anthropic"
            ? `Schnittstelle von Anthropic (Messages-API), Adresse ${ANTHROPIC_URL}. Für die kurzen Texte denkt das Modell nur wenig mit (geringer Aufwand).`
            : "Jeder Anbieter mit OpenAI-kompatibler Schnittstelle, auch ein eigener Dienst im internen Netz. Die Adresse endet meist auf /v1."}
        </p>
        <p className="small" id={keyHint}>
          {!ai.key_storage_available
            ? "Auf dem Server fehlt die Schlüsseldatei „settings_key“. Ohne sie kann kein Schlüssel gespeichert werden (siehe Deployment-Anleitung)."
            : ai.api_key_set
              ? "Ein Schlüssel ist gespeichert und wird nie angezeigt. Leer lassen, um ihn zu behalten."
              : "Der Schlüssel liegt verschlüsselt in der Datenbank und wird nie angezeigt. Mit Schlüssel muss die Adresse mit https:// beginnen."}
        </p>
        <p className="small" id={rateHint}>
          Begrenzt die Kosten beim Anbieter. Erlaubt sind {ai.texts_per_hour_min} bis{" "}
          {ai.texts_per_hour_max}. Für gleichartige Einstellungen entsteht nur ein Text.
        </p>
        {ai.api_key_set && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={removeKey}
              onChange={(event) => setRemoveKey(event.target.checked)}
            />
            Gespeicherten Schlüssel löschen
          </label>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            KI-Einstellungen speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || !ai.base_url || !ai.model}
            onClick={onTest}
          >
            Verbindung testen
          </button>
        </div>
        {(!ai.base_url || !ai.model) && (
          <p className="small">Der Test geht erst, wenn Adresse und Modell gespeichert sind.</p>
        )}
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
