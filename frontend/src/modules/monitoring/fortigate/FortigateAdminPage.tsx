import { useEffect, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../../api";
import { ConfirmButton, useConfirm } from "../../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { Field, RequiredNote } from "../../../components/Field";
import { InfoTip } from "../../../components/InfoTip";
import {
  createFgDevice,
  deleteFgDevice,
  fetchFgAdmin,
  fetchFgRules,
  fetchRetentionPreview,
  saveFgRules,
  saveFgSettings,
  testFgDevice,
  updateFgDevice,
  type FgAdminDevice,
  type FgAdminSettings,
  type FgRules,
  type FgSettingsUpdate,
} from "./api";

/* Verwaltung › FortiGate: Geräte, Zugang, FortiAnalyzer, Abruf und Aufbewahrung. */

const MONTHS = [1, 2, 3, 6, 9, 12, 18, 24, 36];

function intervalLabel(minutes: number): string {
  if (minutes < 60) {
    return `alle ${minutes} Minuten`;
  }
  return minutes === 60 ? "stündlich" : `alle ${minutes / 60} Stunden`;
}

function monthLabel(months: number): string {
  return months === 1 ? "1 Monat" : `${months} Monate`;
}

export function FortigateAdminPage() {
  const [data, setData] = useState<FgAdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  useEffect(() => {
    let active = true;
    fetchFgAdmin().then(
      (value) => active && setData(value),
      (caught: unknown) =>
        active && setError(errorText(caught, "Die Einstellungen konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <p className="module-label">Verwaltung</p>
          <h1>FortiGate</h1>
          <p className="page-sub">
            Geräte für IT-Monitoring › FortiGate. Die Werkbank liest die Firewalls nur, sie ändert
            nie etwas an ihnen.
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && (
        <>
          <Devices data={data} onChanged={setData} onMessage={setMessage} />
          <SettingsForm
            key={JSON.stringify([
              data.interval_minutes,
              data.retention_months,
              data.ca_set,
              data.analyzer_enabled,
              data.analyzer_url,
              data.analyzer_adom,
              data.analyzer_key_set,
            ])}
            data={data}
            onSaved={setData}
            onMessage={setMessage}
          />
          <RulesSection onMessage={setMessage} />
        </>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}

// --- Geräte -------------------------------------------------------------------------------

function Devices({
  data,
  onChanged,
  onMessage,
}: {
  data: FgAdminSettings;
  onChanged: (data: FgAdminSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [editing, setEditing] = useState<FgAdminDevice | "neu" | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const test = (device: FgAdminDevice) => {
    setBusy(device.id);
    testFgDevice(device.id)
      .then((result) =>
        onMessage({
          kind: "status",
          text: `${device.name}: Verbindung in Ordnung. ${result.model || "FortiGate"} ${result.version}, ${result.policies} Policies lesbar.`,
        }),
      )
      .catch((error: unknown) =>
        onMessage({
          kind: "alert",
          text: `${device.name}: ${errorText(error, "Das Gerät ist nicht erreichbar.")}`,
        }),
      )
      .finally(() => setBusy(null));
  };

  return (
    <section className="panel" aria-labelledby="fg-admin-geraete">
      <div className="panel-head">
        <h2 id="fg-admin-geraete">Geräte</h2>
        <button
          type="button"
          className="button button-secondary"
          disabled={!data.token_storage_available}
          onClick={() => setEditing("neu")}
        >
          Gerät hinzufügen
        </button>
      </div>
      <div className="detail-body">
        <p className="small">
          Je Gerät ein eigener API-Benutzer mit Nur-Lese-Profil und Trusted Hosts, die den Server
          der Werkbank zulassen. Bei einem HA-Cluster die Adresse des Clusters eintragen. Tokens
          liegen verschlüsselt in der Datenbank und werden nie wieder angezeigt.
        </p>
        {!data.token_storage_available && (
          <p className="hint-box hint-bad">
            Auf dem Server fehlt die Schlüsseldatei „settings_key“. Ohne sie kann kein Token
            gespeichert werden.
          </p>
        )}
        {editing === "neu" && (
          <DeviceForm
            device={null}
            onCancel={() => setEditing(null)}
            onSaved={(next, name) => {
              onChanged(next);
              setEditing(null);
              onMessage({ kind: "status", text: `${name} ist angelegt.` });
            }}
          />
        )}
        {data.devices.length === 0 ? (
          <p className="empty">Noch kein Gerät eingetragen.</p>
        ) : (
          <div className="table-wrap card-wrap">
            <table className="table-cards">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Adresse</th>
                  <th scope="col">Abruf</th>
                  <th scope="col">Letzter Abruf</th>
                  <th scope="col">
                    <span className="visually-hidden">Aktionen</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((device) =>
                  editing !== "neu" && editing?.id === device.id ? (
                    <tr key={device.id}>
                      <td colSpan={5}>
                        <DeviceForm
                          device={device}
                          onCancel={() => setEditing(null)}
                          onSaved={(next, name) => {
                            onChanged(next);
                            setEditing(null);
                            onMessage({ kind: "status", text: `${name} ist gespeichert.` });
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={device.id}>
                      <th scope="row">{device.name}</th>
                      <td data-label="Adresse" className="mono">
                        {device.url}
                      </td>
                      <td data-label="Abruf">
                        {device.enabled ? (
                          <span className="pill pill-ok">ein</span>
                        ) : (
                          <span className="pill pill-neutral">aus</span>
                        )}
                      </td>
                      <td data-label="Letzter Abruf">
                        {device.last_run_at ? formatDateTime(device.last_run_at) : "noch keiner"}
                        {device.last_ok === false && (
                          <span className="small fg-error"> {device.last_error}</span>
                        )}
                      </td>
                      <td data-label="Aktionen">
                        <div className="actions fg-row-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busy === device.id}
                            onClick={() => test(device)}
                          >
                            Verbindung prüfen
                          </button>
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => setEditing(device)}
                          >
                            Bearbeiten
                          </button>
                          <ConfirmButton
                            className="button button-secondary"
                            confirm={{
                              title: `${device.name} entfernen?`,
                              text: "Das Gerät wird nicht mehr abgerufen. Alle gespeicherten Konfigurationsstände und Abrufe dieses Geräts werden gelöscht.",
                              action: "Entfernen",
                              danger: true,
                            }}
                            onConfirm={() =>
                              deleteFgDevice(device.id).then(
                                (next) => {
                                  onChanged(next);
                                  onMessage({
                                    kind: "status",
                                    text: `${device.name} ist entfernt.`,
                                  });
                                },
                                (error: unknown) =>
                                  onMessage({
                                    kind: "alert",
                                    text: errorText(
                                      error,
                                      "Das Gerät konnte nicht entfernt werden.",
                                    ),
                                  }),
                              )
                            }
                          >
                            Entfernen
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function DeviceForm({
  device,
  onCancel,
  onSaved,
}: {
  device: FgAdminDevice | null;
  onCancel: () => void;
  onSaved: (data: FgAdminSettings, name: string) => void;
}) {
  const [name, setName] = useState(device?.name ?? "");
  const [url, setUrl] = useState(device?.url ?? "");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(device?.enabled ?? true);
  const [problems, setProblems] = useState<{ name?: string; url?: string; token?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof problems = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name.trim())) {
      found.name = "Nur Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich, z. B. fw-edge.";
    }
    if (!/^https:\/\/[^\s/?#]+\/?$/.test(url.trim())) {
      found.url = "Bitte die https-Adresse der Verwaltung, z. B. https://fw-edge.example.com.";
    }
    if (!device && !token.trim()) {
      found.token = "Das API-Token fehlt.";
    }
    setProblems(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    const input = {
      name: name.trim(),
      url: url.trim(),
      enabled,
      ...(token.trim() ? { token: token.trim() } : {}),
    };
    setBusy(true);
    setFailure(null);
    (device ? updateFgDevice(device.id, input) : createFgDevice(input))
      .then((next) => onSaved(next, input.name))
      .catch((error: unknown) => {
        setFailure(errorText(error, "Das Gerät konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  return (
    <form className="settings-form fg-device-form" onSubmit={submit} noValidate>
      <h3>{device ? `${device.name} bearbeiten` : "Neues Gerät"}</h3>
      <RequiredNote />
      <Field
        label="Name"
        required
        error={problems.name}
        hint="So erscheint das Gerät in den Listen."
      >
        {(control) => (
          <input
            {...control}
            value={name}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            placeholder="fw-edge"
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label="Adresse der Verwaltung" required error={problems.url}>
        {(control) => (
          <input
            {...control}
            type="url"
            value={url}
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://fw-edge.example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
      </Field>
      <Field
        label={device ? "Neues API-Token" : "API-Token"}
        required={!device}
        error={problems.token}
        hint={
          device
            ? "Ein Token ist gespeichert. Leer lassen, um es zu behalten."
            : "Token des REST-API-Benutzers mit Nur-Lese-Profil."
        }
      >
        {(control) => (
          <input
            {...control}
            type="password"
            value={token}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setToken(event.target.value)}
          />
        )}
      </Field>
      <label className="check-label">
        <input
          type="checkbox"
          className="check"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Gerät abrufen
      </label>
      {failure && (
        <p role="alert" className="hint-box hint-bad">
          {failure}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {device ? "Speichern" : "Hinzufügen"}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

// --- Abruf, Aufbewahrung, Zugang, FortiAnalyzer -------------------------------------------

function SettingsForm({
  data,
  onSaved,
  onMessage,
}: {
  data: FgAdminSettings;
  onSaved: (data: FgAdminSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [interval, setInterval] = useState(data.interval_minutes);
  const [months, setMonths] = useState(data.retention_months);
  const [ca, setCa] = useState("");
  const [removeCa, setRemoveCa] = useState(false);
  const [fazEnabled, setFazEnabled] = useState(data.analyzer_enabled);
  const [fazUrl, setFazUrl] = useState(data.analyzer_url);
  const [fazAdom, setFazAdom] = useState(data.analyzer_adom);
  const [fazKey, setFazKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [ask, confirmDialog] = useConfirm();

  const save = () => {
    const update: FgSettingsUpdate = {
      interval_minutes: interval,
      retention_months: months,
      analyzer_enabled: fazEnabled,
      analyzer_url: fazUrl.trim(),
      analyzer_adom: fazAdom.trim() || "root",
    };
    if (removeCa) {
      update.ca_pem = "";
    } else if (ca.trim()) {
      update.ca_pem = ca.trim();
    }
    if (fazKey.trim()) {
      update.analyzer_key = fazKey.trim();
    }
    setBusy(true);
    saveFgSettings(update)
      .then((next) => {
        onSaved(next);
        onMessage({ kind: "status", text: "Die Einstellungen für FortiGate sind gespeichert." });
      })
      .catch((error: unknown) => {
        onMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellungen konnten nicht gespeichert werden."),
        });
        setBusy(false);
      });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (months >= data.retention_months) {
      save();
      return;
    }
    setBusy(true);
    fetchRetentionPreview(months)
      .then((preview) => {
        setBusy(false);
        ask(
          {
            title: `Aufbewahrung auf ${monthLabel(months)} verkürzen?`,
            text:
              preview.runs + preview.snapshots === 0
                ? "Ältere Daten gibt es derzeit nicht. Künftig werden Abrufe und Konfigurationsstände nach dieser Zeit gelöscht."
                : `Beim nächsten Aufräumlauf fallen ${preview.runs} Abrufe und ${preview.snapshots} Konfigurationsstände weg. Der jüngste Stand je Gerät bleibt immer.`,
            action: "Verkürzen",
            danger: preview.runs + preview.snapshots > 0,
          },
          save,
        );
      })
      .catch((error: unknown) => {
        setBusy(false);
        onMessage({
          kind: "alert",
          text: errorText(error, "Es ließ sich nicht prüfen, was wegfallen würde."),
        });
      });
  };

  return (
    <section className="panel" aria-labelledby="fg-admin-einstellungen">
      <div className="panel-head">
        <h2 id="fg-admin-einstellungen">Abruf, Aufbewahrung und Zugang</h2>
      </div>
      <form className="detail-body settings-form" onSubmit={submit}>
        <Field label="Abrufabstand" hint="Wie oft die Werkbank jedes Gerät abfragt.">
          {(control) => (
            <select
              {...control}
              value={interval}
              onChange={(event) => setInterval(Number(event.target.value))}
            >
              {data.intervals.map((value) => (
                <option key={value} value={value}>
                  {intervalLabel(value)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="fg-field-tip">
          <Field
            label="Aufbewahrung"
            hint="Abrufe und Konfigurationsstände werden danach automatisch gelöscht. Der jüngste Stand je Gerät bleibt immer."
          >
            {(control) => (
              <select
                {...control}
                value={months}
                onChange={(event) => setMonths(Number(event.target.value))}
              >
                {MONTHS.map((value) => (
                  <option key={value} value={value}>
                    {monthLabel(value)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <InfoTip term="fortigate.aufbewahrung" />
        </div>
        <Field
          label={data.ca_set ? "Neues CA-Zertifikat (PEM)" : "CA-Zertifikat (PEM, optional)"}
          hint={`Nur nötig, wenn die Zertifikate der FortiGates aus einer eigenen Zertifizierungsstelle stammen. Gilt für alle Geräte und den FortiAnalyzer.${data.ca_set ? " Ein Zertifikat ist gespeichert; leer lassen, um es zu behalten." : ""}`}
        >
          {(control) => (
            <textarea
              {...control}
              rows={4}
              value={ca}
              maxLength={20000}
              spellCheck={false}
              disabled={removeCa}
              placeholder="-----BEGIN CERTIFICATE-----"
              onChange={(event) => setCa(event.target.value)}
            />
          )}
        </Field>
        {data.ca_set && (
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
        <fieldset className="fg-fieldset">
          <legend>FortiAnalyzer (freiwillig)</legend>
          <p className="small">
            Mit dem FortiAnalyzer zeigt der Änderungsverlauf später auch, wer etwas geändert hat
            (aus den Event-Logs). Ohne ihn steht dort nur, was sich geändert hat.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={fazEnabled}
              onChange={(event) => setFazEnabled(event.target.checked)}
            />
            „Geändert von“ aus dem FortiAnalyzer lesen
          </label>
          <Field label="Adresse">
            {(control) => (
              <input
                {...control}
                type="url"
                value={fazUrl}
                maxLength={300}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://faz.example.com"
                onChange={(event) => setFazUrl(event.target.value)}
              />
            )}
          </Field>
          <Field label="ADOM" hint="Meist „root“.">
            {(control) => (
              <input
                {...control}
                value={fazAdom}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setFazAdom(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={data.analyzer_key_set ? "Neuer API-Schlüssel" : "API-Schlüssel"}
            hint={
              data.analyzer_key_set
                ? "Ein Schlüssel ist gespeichert. Leer lassen, um ihn zu behalten."
                : "API-Schlüssel eines Benutzers mit JSON-API-Zugriff „Lesen“."
            }
          >
            {(control) => (
              <input
                {...control}
                type="password"
                value={fazKey}
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
                disabled={!data.token_storage_available}
                onChange={(event) => setFazKey(event.target.value)}
              />
            )}
          </Field>
        </fieldset>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Einstellungen speichern
          </button>
        </div>
        {confirmDialog}
      </form>
    </section>
  );
}

// --- Prüfregeln ---------------------------------------------------------------------------

const SEVERITY_TEXT: Record<string, string> = {
  hoch: "hoch",
  mittel: "mittel",
  hinweis: "Hinweis",
};

function RulesSection({ onMessage }: { onMessage: (message: FeedbackMessage) => void }) {
  const [data, setData] = useState<FgRules | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchFgRules().then(
      (value) => active && setData(value),
      (caught: unknown) =>
        active && setError(errorText(caught, "Die Prüfregeln konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="panel" aria-labelledby="fg-admin-regeln">
      <div className="panel-head">
        <h2 id="fg-admin-regeln">Prüfregeln für Befunde</h2>
      </div>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {data && (
        <RulesForm key={JSON.stringify(data)} data={data} onSaved={setData} onMessage={onMessage} />
      )}
    </section>
  );
}

function RulesForm({
  data,
  onSaved,
  onMessage,
}: {
  data: FgRules;
  onSaved: (data: FgRules) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [active, setActive] = useState<Set<string>>(
    () => new Set(data.rules.filter((rule) => rule.active).map((rule) => rule.code)),
  );
  const [zones, setZones] = useState(data.sensitive.join("\n"));
  const [days, setDays] = useState(data.unused_days);
  const [busy, setBusy] = useState(false);
  const [ask, confirmDialog] = useConfirm();

  const save = () => {
    setBusy(true);
    return saveFgRules({
      disabled: data.rules.filter((rule) => !active.has(rule.code)).map((rule) => rule.code),
      sensitive: zones
        .split(/[\n,]/)
        .map((name) => name.trim())
        .filter(Boolean),
      unused_days: days,
    })
      .then((next) => {
        onSaved(next);
        onMessage({ kind: "status", text: "Die Prüfregeln sind gespeichert." });
      })
      .catch((caught: unknown) => {
        onMessage({
          kind: "alert",
          text: errorText(caught, "Die Prüfregeln konnten nicht gespeichert werden."),
        });
        setBusy(false);
      });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const switchedOff = data.rules.filter((rule) => rule.active && !active.has(rule.code));
    if (switchedOff.length === 0) {
      void save();
      return;
    }
    ask(
      {
        title:
          switchedOff.length === 1
            ? "Prüfregel abschalten?"
            : `${switchedOff.length} Prüfregeln abschalten?`,
        text: `Befunde aus ${switchedOff.map((rule) => `„${rule.title}“`).join(", ")} erscheinen dann für niemanden mehr. Du kannst die Regel jederzeit wieder einschalten.`,
        action: "Abschalten",
      },
      save,
    );
  };

  return (
    <form className="detail-body settings-form" onSubmit={submit}>
      <fieldset className="fg-fieldset">
        <legend>Regeln</legend>
        {data.rules.map((rule) => (
          <label key={rule.code} className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={active.has(rule.code)}
              onChange={(event) =>
                setActive((current) => {
                  const next = new Set(current);
                  if (event.target.checked) {
                    next.add(rule.code);
                  } else {
                    next.delete(rule.code);
                  }
                  return next;
                })
              }
            />
            <span>
              {rule.title} ({SEVERITY_TEXT[rule.severity] ?? rule.severity})
              <span className="fg-sub">{rule.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="fg-field-tip">
        <Field
          label="Schützenswerte Zonen"
          hint="Namen von Interfaces oder Zonen, eine je Zeile, z. B. dmz-server. Gilt auf allen Geräten."
        >
          {(control) => (
            <textarea
              {...control}
              rows={3}
              value={zones}
              spellCheck={false}
              onChange={(event) => setZones(event.target.value)}
            />
          )}
        </Field>
        <InfoTip term="fortigate.schuetzenswert" />
      </div>
      <Field
        label="Zeitraum für „keine Treffer“ und „unbenutzt“"
        hint="Ab dann gibt es einen Hinweis zu Policies ohne Treffer und zu unbenutzten Objekten."
      >
        {(control) => (
          <select
            {...control}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {data.unused_days_options.map((value) => (
              <option key={value} value={value}>
                {value} Tage
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Prüfregeln speichern
        </button>
      </div>
      {confirmDialog}
    </form>
  );
}
