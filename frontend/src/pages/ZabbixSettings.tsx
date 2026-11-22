import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../api";
import {
  fetchZabbixSettings,
  saveZabbixSettings,
  testZabbix,
  type ZabbixSettings as Settings,
  type ZabbixSettingsUpdate,
} from "../modules/monitoring/zabbix/api";

type Message = { kind: "status" | "alert"; text: string };

/** Verwaltung › Verbindungen: Zabbix für den Bereich IT-Monitoring. */
export function ZabbixSettings() {
  const [stored, setStored] = useState<{ settings: Settings; version: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<Message | null>(null);

  useEffect(() => {
    let active = true;
    fetchZabbixSettings().then(
      (settings) => active && setStored({ settings, version: 0 }),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="hint-box hint-bad">Die Anbindung an Zabbix konnte nicht geladen werden.</p>
    );
  }
  if (!stored) {
    return null;
  }
  return (
    <ZabbixForm
      key={stored.version}
      stored={stored.settings}
      initialMessage={saved}
      onSaved={(settings) => {
        setSaved({ kind: "status", text: "Die Anbindung an Zabbix ist gespeichert." });
        setStored({ settings, version: stored.version + 1 });
      }}
    />
  );
}

function ZabbixForm({
  stored,
  initialMessage,
  onSaved,
}: {
  stored: Settings;
  initialMessage: Message | null;
  onSaved: (settings: Settings) => void;
}) {
  const [enabled, setEnabled] = useState(stored.enabled);
  const [url, setUrl] = useState(stored.url);
  const [token, setToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [ca, setCa] = useState("");
  const [removeCa, setRemoveCa] = useState(false);
  const [message, setMessage] = useState<Message | null>(initialMessage);
  const [findings, setFindings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const tokenHint = useId();
  const caHint = useId();

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const update: ZabbixSettingsUpdate = { enabled, url: url.trim() };
    if (removeToken) {
      update.token = "";
    } else if (token.trim()) {
      update.token = token.trim();
    }
    if (removeCa) {
      update.ca_pem = "";
    } else if (ca.trim()) {
      update.ca_pem = ca.trim();
    }
    setBusy(true);
    setMessage(null);
    saveZabbixSettings(update)
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
    setFindings([]);
    testZabbix()
      .then((result) => {
        const expiry = result.token_never_expires
          ? "Das Token läuft nicht ab."
          : result.token_expires_at
            ? `Das Token läuft am ${formatDateTime(result.token_expires_at)} ab.`
            : "";
        setMessage({
          kind: "status",
          text: `Verbindung in Ordnung: Zabbix ${result.version}${result.supported ? "" : " (Version nicht geprüft)"}, ${result.hosts} Hosts${result.role ? `, Rolle „${result.role}“` : ""}. ${expiry}`.trim(),
        });
        setFindings(result.findings);
      })
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: `Zabbix ist nicht erreichbar: ${errorText(error, "unbekannter Fehler")}`,
        }),
      )
      .finally(() => setBusy(false));
  };

  const ready = stored.enabled && stored.token_set && stored.url !== "";

  return (
    <section className="panel" aria-labelledby="zabbix-titel">
      <div className="panel-head">
        <h3 id="zabbix-titel">Zabbix (IT-Monitoring)</h3>
        <span className={ready ? "pill pill-ok" : "pill pill-neutral"}>
          {ready ? "eingeschaltet" : stored.token_set ? "ausgeschaltet" : "nicht eingerichtet"}
        </span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave}>
        <p className="small">
          Die Werkbank liest Probleme, Hosts und Wartungen aus Zabbix, nur lesend. Nur der Server
          spricht mit Zabbix. Das Dienstkonto braucht eine eigene Rolle mit einer Allow-Liste; wie
          das geht, steht im Handbuch unter IT-Monitoring.
        </p>
        <label>
          Adresse von Zabbix
          <input
            type="url"
            value={url}
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://zabbix.example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label>
          {stored.token_set ? "Neues API-Token" : "API-Token"}
          <input
            type="password"
            value={token}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={tokenHint}
            disabled={!stored.token_storage_available || removeToken}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <p className="small" id={tokenHint}>
          {!stored.token_storage_available
            ? "Auf dem Server fehlt die Schlüsseldatei „settings_key“. Ohne sie kann kein Token gespeichert werden."
            : stored.token_set
              ? "Ein Token ist gespeichert und wird nie angezeigt. Leer lassen, um es zu behalten."
              : "Das Token liegt verschlüsselt in der Datenbank und wird nie angezeigt."}
        </p>
        {stored.token_set && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={removeToken}
              onChange={(event) => setRemoveToken(event.target.checked)}
            />
            Gespeichertes Token löschen
          </label>
        )}
        <label>
          {stored.ca_set ? "Neues CA-Zertifikat (PEM)" : "CA-Zertifikat (PEM, optional)"}
          <textarea
            rows={4}
            value={ca}
            maxLength={20000}
            spellCheck={false}
            aria-describedby={caHint}
            disabled={removeCa}
            placeholder="-----BEGIN CERTIFICATE-----"
            onChange={(event) => setCa(event.target.value)}
          />
        </label>
        <p className="small" id={caHint}>
          Nur nötig, wenn das Zertifikat von Zabbix aus einer eigenen Zertifizierungsstelle stammt.
          {stored.ca_set && " Ein Zertifikat ist gespeichert. Leer lassen, um es zu behalten."}
        </p>
        {stored.ca_set && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={removeCa}
              onChange={(event) => setRemoveCa(event.target.checked)}
            />
            Gespeichertes CA-Zertifikat löschen
          </label>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Abfrage von Zabbix einschalten
        </label>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Zabbix speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || !stored.token_set || stored.url === ""}
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
        {findings.length > 0 && (
          <ul className="hint-box hint-warn zbx-findings" aria-label="Hinweise zum Dienstkonto">
            {findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        )}
      </form>
    </section>
  );
}
