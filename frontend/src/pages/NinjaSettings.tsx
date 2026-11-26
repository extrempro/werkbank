import { useEffect, useId, useState, type FormEvent } from "react";
import { FixedChoice } from "../components/ListChoice";
import { errorText } from "../api";
import {
  fetchNinjaOptions,
  fetchNinjaSettings,
  saveNinjaSettings,
  testNinja,
  type NinjaOptions,
  type NinjaSettings as Settings,
  type NinjaUpdate,
} from "../modules/inventory/api";
import { Feedback } from "../components/Feedback";

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
  const [organizationIds, setOrganizationIds] = useState<number[]>(stored.organization_ids);
  const [roleIds, setRoleIds] = useState<number[]>(stored.role_ids);
  const [monitorField, setMonitorField] = useState(stored.monitor_field);
  const [psrefEnabled, setPsrefEnabled] = useState(stored.psref_enabled);
  const [options, setOptions] = useState<NinjaOptions | null>(null);
  const [message, setMessage] = useState<Message | null>(initialMessage);
  const [busy, setBusy] = useState(false);
  const secretHint = useId();

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const update: NinjaUpdate = {
      enabled,
      region,
      client_id: clientId.trim(),
      // Was es in NinjaOne nicht mehr gibt, fällt beim Speichern weg
      organization_ids: options
        ? organizationIds.filter((id) => options.organizations.some((item) => item.id === id))
        : organizationIds,
      role_ids: options
        ? roleIds.filter((id) => options.roles.some((item) => item.id === id))
        : roleIds,
      monitor_field: monitorField.trim(),
      psref_enabled: psrefEnabled,
    };
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
          text: errorText(error, "Die Angaben konnten nicht gespeichert werden. Bitte prüf sie."),
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
          text:
            `Verbindung in Ordnung: ${result.devices} Arbeitsplatzrechner (${result.notebooks} Notebooks, ${result.pcs} PCs), davon ${result.in_scope} in der gespeicherten Auswahl.` +
            (stored.monitor_field ? ` Im Custom Field stehen ${result.monitors} Monitore.` : ""),
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

  const onLoadOptions = () => {
    setBusy(true);
    setMessage(null);
    fetchNinjaOptions()
      .then(setOptions)
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: `Organisationen und Rollen ließen sich nicht laden: ${errorText(error, "unbekannter Fehler")}`,
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
        <FixedChoice
          label="Region"
          value={region}
          options={stored.regions.map((entry) => ({
            value: entry.id,
            label: entry.name,
            hint: entry.host,
          }))}
          onChange={setRegion}
        />
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
        <ScopePicker
          legend="Organisationen"
          empty="Alle Organisationen"
          options={options?.organizations ?? null}
          selected={organizationIds}
          onChange={setOrganizationIds}
        />
        <ScopePicker
          legend="Geräterollen"
          empty="Alle Geräterollen"
          options={options?.roles ?? null}
          selected={roleIds}
          onChange={setRoleIds}
        />
        {!options && (
          <div>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || !stored.secret_set || stored.client_id === ""}
              onClick={onLoadOptions}
            >
              Organisationen und Rollen laden
            </button>
          </div>
        )}
        <p className="small">
          Die Auswahl legt fest, welche neuen Geräte einen Vorgang bekommen. Nichts ausgewählt
          heißt: alle. Geräte, die schon im Bestand verknüpft sind, gleicht die Werkbank weiter ab,
          auch wenn sie nicht mehr zur Auswahl passen.
        </p>
        <label>
          Custom Field mit den Monitoren (freiwillig)
          <input
            type="text"
            value={monitorField}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${secretHint}-monitor`}
            onChange={(event) => setMonitorField(event.target.value)}
          />
        </label>
        <p className="small" id={`${secretHint}-monitor`}>
          Interner Name des mehrzeiligen Textfelds (Buchstaben, Ziffern, Unterstrich). Eine Zeile je
          Monitor: Hersteller|Modell|Seriennummer|ProductCode|Baujahr-KW|Anschluss|ZuletztGesehen.
          Leer lassen, wenn keine Monitore gelesen werden sollen.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={psrefEnabled}
            aria-describedby={`${secretHint}-psref`}
            onChange={(event) => setPsrefEnabled(event.target.checked)}
          />
          Technische Daten aus Lenovo PSREF holen
        </label>
        <p className="small" id={`${secretHint}-psref`}>
          Einmal am Tag fragt die Werkbank für Lenovo-Geräte, deren Modell ein Maschinentyp ist (z.
          B. 10T700BTGE), die technischen Daten über die PSREF-Schnittstelle von Lenovo ab
          (psrefapi.lenovo.com). Gesendet wird nur der Maschinentyp, keine Seriennummer.
        </p>
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
        <Feedback message={message} onClose={() => setMessage(null)} />
      </form>
    </section>
  );
}

/** Mehrfachauswahl für Organisationen oder Geräterollen; leer heißt: alle. */
function ScopePicker({
  legend,
  empty,
  options,
  selected,
  onChange,
}: {
  legend: string;
  empty: string;
  /** null, solange die Liste aus NinjaOne nicht geladen ist */
  options: { id: number; name: string }[] | null;
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const known = new Set(options?.map((option) => option.id) ?? []);
  const unknown = selected.filter((id) => options !== null && !known.has(id));
  return (
    <fieldset className="seg-field">
      <legend>{legend}</legend>
      {options === null ? (
        <p className="small">
          {selected.length === 0
            ? `${empty}.`
            : `${selected.length} ausgewählt. Zum Ändern die Liste aus NinjaOne laden.`}
        </p>
      ) : (
        <>
          {options.length === 0 && <p className="small">NinjaOne liefert keine Einträge.</p>}
          <div className="scope-options">
            {options.map((option) => (
              <label key={option.id} className="check-label">
                <input
                  type="checkbox"
                  className="check"
                  checked={selected.includes(option.id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.id]
                        : selected.filter((id) => id !== option.id),
                    )
                  }
                />
                {option.name}
              </label>
            ))}
          </div>
          {unknown.length > 0 && (
            <p className="hint-box hint-warn">
              {unknown.length} gespeicherte Auswahl gibt es in NinjaOne nicht mehr. Beim Speichern
              entfällt sie.
            </p>
          )}
          <p className="small">
            {selected.filter((id) => known.has(id)).length === 0
              ? `${empty}.`
              : `${selected.filter((id) => known.has(id)).length} ausgewählt.`}
          </p>
        </>
      )}
    </fieldset>
  );
}
