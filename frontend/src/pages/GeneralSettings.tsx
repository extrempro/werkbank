import { useId, useState, type FormEvent } from "react";
import {
  errorText,
  saveAuditRetention,
  saveSmtpSettings,
  sendTestMail,
  type AdminSettings,
  type SmtpUpdate,
} from "../api";
import { CredentialWarnSettings } from "./CredentialWarnSettings";
import { NetboxSettings } from "./NetboxSettings";
import { PushSettings } from "./PushSettings";
import { TeamsSettings } from "./TeamsSettings";
import { ToolsInternetSettings } from "./ToolsInternetSettings";

type Message = { kind: "status" | "alert"; text: string };

const SECURITY_OPTIONS = [
  { value: "starttls", label: "STARTTLS (üblich auf Port 587)" },
  { value: "tls", label: "TLS von Anfang an (üblich auf Port 465)" },
  { value: "none", label: "Keine Verschlüsselung (nur internes Relay ohne Anmeldung)" },
];

/** Teile, die eine Seite der Verwaltung zeigt. */
export type SettingsPart =
  | "smtp"
  | "aufbewahrung"
  | "teams"
  | "push"
  | "ablauf"
  | "netbox"
  | "internet";

const ALL_PARTS: SettingsPart[] = [
  "smtp",
  "aufbewahrung",
  "teams",
  "push",
  "ablauf",
  "netbox",
  "internet",
];

interface GeneralSettingsProps {
  settings: AdminSettings;
  onChange: (settings: AdminSettings) => void;
  /** Ohne Angabe alle Teile. */
  parts?: SettingsPart[];
}

/** Verwaltung › Allgemein: SMTP-Server, Aufbewahrungsfrist des Audit-Logs, Vorlauf für Abläufe. */
export function GeneralSettings({ settings, onChange, parts = ALL_PARTS }: GeneralSettingsProps) {
  const smtp = settings.smtp;
  const [host, setHost] = useState(smtp.host);
  const [port, setPort] = useState(String(smtp.port));
  const [security, setSecurity] = useState<string>(smtp.security);
  const [username, setUsername] = useState(smtp.username);
  const [senderAddress, setSenderAddress] = useState(smtp.sender_address);
  const [senderName, setSenderName] = useState(smtp.sender_name);
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [smtpMessage, setSmtpMessage] = useState<Message | null>(null);
  const [days, setDays] = useState(String(settings.audit_retention_days));
  const [auditMessage, setAuditMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordHint = useId();
  const daysHint = useId();

  const onSaveSmtp = (event: FormEvent) => {
    event.preventDefault();
    const update: SmtpUpdate = {
      host: host.trim(),
      port: Number(port),
      security,
      username: username.trim(),
      sender_address: senderAddress.trim(),
      sender_name: senderName.trim(),
    };
    if (removePassword) {
      update.password = "";
    } else if (password !== "") {
      update.password = password;
    }
    setBusy(true);
    setSmtpMessage(null);
    saveSmtpSettings(update)
      .then((result) => {
        onChange(result);
        setPassword("");
        setRemovePassword(false);
        setSmtpMessage({ kind: "status", text: "Der SMTP-Server ist gespeichert." });
      })
      .catch((error: unknown) => {
        setSmtpMessage({
          kind: "alert",
          text: errorText(error, "Die Angaben konnten nicht gespeichert werden. Bitte prüfen."),
        });
      })
      .finally(() => setBusy(false));
  };

  const onTest = () => {
    setBusy(true);
    setSmtpMessage(null);
    sendTestMail()
      .then((result) => {
        setSmtpMessage({
          kind: "status",
          text: `Die Testmail ist an ${result.recipient} unterwegs. Bitte im Postfach nachsehen.`,
        });
      })
      .catch((error: unknown) => {
        setSmtpMessage({
          kind: "alert",
          text: `Die Testmail konnte nicht gesendet werden: ${errorText(error, "unbekannter Fehler")}`,
        });
      })
      .finally(() => setBusy(false));
  };

  const onSaveAudit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setAuditMessage(null);
    saveAuditRetention(Number(days))
      .then((result) => {
        onChange(result);
        setAuditMessage({ kind: "status", text: "Die Aufbewahrungsfrist ist gespeichert." });
      })
      .catch((error: unknown) => {
        setAuditMessage({
          kind: "alert",
          text: errorText(
            error,
            `Bitte eine Zahl zwischen ${settings.audit_retention_min} und ${settings.audit_retention_max} eintragen.`,
          ),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      {parts.includes("smtp") && (
        <section className="panel" aria-labelledby="smtp-titel">
          <div className="panel-head">
            <h3 id="smtp-titel">Mailversand (SMTP)</h3>
            <span className={smtp.host ? "pill pill-ok" : "pill pill-neutral"}>
              {smtp.host ? "eingerichtet" : "nicht eingerichtet"}
            </span>
          </div>
          <form className="detail-body settings-form" onSubmit={onSaveSmtp}>
            <p className="small">
              Über diesen Server versendet die Werkbank Mails, auch die Benachrichtigungen. Welche
              Benachrichtigungen jemand per Mail bekommt, stellt jede Person im Konto selbst ein.
            </p>
            <div className="form-grid">
              <label>
                Server
                <input
                  type="text"
                  value={host}
                  required
                  maxLength={253}
                  autoComplete="off"
                  placeholder="smtp.example.com"
                  onChange={(event) => setHost(event.target.value)}
                />
              </label>
              <label>
                Port
                <input
                  type="number"
                  value={port}
                  required
                  min={1}
                  max={65535}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
              <label>
                Verschlüsselung
                <select value={security} onChange={(event) => setSecurity(event.target.value)}>
                  {SECURITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Absenderadresse
                <input
                  type="email"
                  value={senderAddress}
                  required
                  maxLength={320}
                  autoComplete="off"
                  placeholder="werkbank@example.com"
                  onChange={(event) => setSenderAddress(event.target.value)}
                />
              </label>
              <label>
                Absendername (freiwillig)
                <input
                  type="text"
                  value={senderName}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(event) => setSenderName(event.target.value)}
                />
              </label>
              <label>
                Benutzername (freiwillig)
                <input
                  type="text"
                  value={username}
                  maxLength={320}
                  autoComplete="off"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label>
                {smtp.password_set ? "Neues Passwort" : "Passwort (freiwillig)"}
                <input
                  type="password"
                  value={password}
                  maxLength={500}
                  autoComplete="new-password"
                  aria-describedby={passwordHint}
                  disabled={!smtp.password_storage_available || removePassword}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </div>
            <p className="small" id={passwordHint}>
              {!smtp.password_storage_available
                ? "Auf dem Server fehlt die Schlüsseldatei „settings_key“. Ohne sie kann kein Passwort gespeichert werden (siehe Deployment-Anleitung)."
                : smtp.password_set
                  ? "Ein Passwort ist gespeichert und wird nie angezeigt. Leer lassen, um es zu behalten."
                  : "Das Passwort liegt verschlüsselt in der Datenbank und wird nie angezeigt."}
            </p>
            {smtp.password_set && (
              <label className="check-label">
                <input
                  type="checkbox"
                  className="check"
                  checked={removePassword}
                  onChange={(event) => setRemovePassword(event.target.checked)}
                />
                Gespeichertes Passwort löschen
              </label>
            )}
            <div className="actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                SMTP-Server speichern
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || !smtp.host}
                onClick={onTest}
              >
                Testmail an mich senden
              </button>
            </div>
            {!smtp.host && (
              <p className="small">Die Testmail geht erst, wenn ein Server gespeichert ist.</p>
            )}
            {smtpMessage && (
              <p
                role={smtpMessage.kind}
                className={smtpMessage.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
              >
                {smtpMessage.text}
              </p>
            )}
          </form>
        </section>
      )}

      {parts.includes("aufbewahrung") && (
        <section className="panel" aria-labelledby="aufbewahrung-titel">
          <div className="panel-head">
            <h3 id="aufbewahrung-titel">Audit-Log</h3>
            <span className="small">Aufbewahrung</span>
          </div>
          <form className="detail-body settings-form" onSubmit={onSaveAudit}>
            <label className="narrow">
              Einträge löschen nach (Tage)
              <input
                type="number"
                value={days}
                required
                min={settings.audit_retention_min}
                max={settings.audit_retention_max}
                aria-describedby={daysHint}
                onChange={(event) => setDays(event.target.value)}
              />
            </label>
            <p className="small" id={daysHint}>
              Ältere Einträge löscht die Werkbank stündlich und endgültig. Erlaubt sind{" "}
              {settings.audit_retention_min} bis {settings.audit_retention_max} Tage. Das Protokoll
              der Evergreen-Vorgänge ist davon nicht betroffen.
            </p>
            <div className="actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                Aufbewahrung speichern
              </button>
            </div>
            {auditMessage && (
              <p
                role={auditMessage.kind}
                className={auditMessage.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
              >
                {auditMessage.text}
              </p>
            )}
          </form>
        </section>
      )}

      {parts.includes("teams") && settings.teams && (
        <TeamsSettings teams={settings.teams} onChange={onChange} />
      )}
      {parts.includes("push") && settings.push && (
        <PushSettings push={settings.push} onChange={onChange} />
      )}
      {parts.includes("ablauf") && (
        <CredentialWarnSettings settings={settings} onChange={onChange} />
      )}
      {parts.includes("netbox") && <NetboxSettings />}
      {parts.includes("internet") && (
        <ToolsInternetSettings settings={settings} onChange={onChange} />
      )}
    </>
  );
}
