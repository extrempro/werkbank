import { useEffect, useId, useState, type FormEvent } from "react";
import { FixedChoice, ListChoice } from "../components/ListChoice";
import { errorText } from "../api";
import {
  fetchNetboxSettings,
  saveNetboxSettings,
  testNetbox,
  type NetboxSettings as Settings,
  type NetboxTest,
  type NetboxUpdate,
} from "../modules/monitoring/api";
import { Feedback } from "../components/Feedback";

type Message = { kind: "status" | "alert"; text: string };

/** Verwaltung › Allgemein: NetBox für den DNS-Abgleich im IT-Monitoring. */
export function NetboxSettings() {
  const [stored, setStored] = useState<{ settings: Settings; version: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<Message | null>(null);

  useEffect(() => {
    let active = true;
    fetchNetboxSettings().then(
      (settings) => {
        if (!active) {
          return;
        }
        // Ältere Server kennen die Anbindung noch nicht
        if (Array.isArray(settings.resolvers)) {
          setStored({ settings, version: 0 });
        } else {
          setFailed(true);
        }
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="hint-box hint-bad">Die Anbindung an NetBox konnte nicht geladen werden.</p>
    );
  }
  if (!stored) {
    return null;
  }
  // Nach dem Speichern neu aufbauen, damit das Formular den gespeicherten Stand zeigt
  return (
    <NetboxForm
      key={stored.version}
      stored={stored.settings}
      initialMessage={saved}
      onSaved={(settings) => {
        setSaved({ kind: "status", text: "Die Anbindung an NetBox ist gespeichert." });
        setStored({ settings, version: stored.version + 1 });
      }}
    />
  );
}

function NetboxForm({
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
  const [viewId, setViewId] = useState<number | null>(stored.view_id);
  const [resolver, setResolver] = useState(stored.resolver);
  const [compareTtl, setCompareTtl] = useState(stored.compare_ttl);
  const [tested, setTested] = useState<NetboxTest | null>(null);
  const [message, setMessage] = useState<Message | null>(initialMessage);
  const [busy, setBusy] = useState(false);
  const tokenHint = useId();
  const caHint = useId();

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const update: NetboxUpdate = {
      enabled,
      url: url.trim(),
      view_id: viewId,
      resolver,
      compare_ttl: compareTtl,
    };
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
    saveNetboxSettings(update)
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
    testNetbox()
      .then((result) => {
        setTested(result);
        setMessage({
          kind: "status",
          text: `Verbindung in Ordnung: NetBox ${result.version}, Plugin netbox-dns ${result.dns_plugin ?? "?"}, ${result.zones} ${result.zones === 1 ? "Zone" : "Zonen"}.`,
        });
      })
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: `NetBox ist nicht erreichbar: ${errorText(error, "unbekannter Fehler")}`,
        }),
      )
      .finally(() => setBusy(false));
  };

  const ready = stored.enabled && stored.token_set && stored.url !== "";
  const views = tested?.views ?? [];

  return (
    <section className="panel" aria-labelledby="netbox-titel">
      <div className="panel-head">
        <h3 id="netbox-titel">NetBox (IT-Monitoring)</h3>
        <span className={ready ? "pill pill-ok" : "pill pill-neutral"}>
          {ready ? "eingeschaltet" : stored.token_set ? "ausgeschaltet" : "nicht eingerichtet"}
        </span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave}>
        <p className="small">
          Für den DNS-Abgleich im Bereich IT-Monitoring liest die Werkbank alle 4 Stunden die
          DNS-Einträge aus NetBox (Plugin netbox-dns) und prüft sie im öffentlichen DNS. Der Token
          braucht nur Leserecht.
        </p>
        <label>
          Adresse von NetBox
          <input
            type="url"
            value={url}
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://netbox.example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label>
          {stored.token_set ? "Neuer API-Token" : "API-Token"}
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
              ? "Ein Token ist gespeichert und wird nie angezeigt. Leer lassen, um ihn zu behalten."
              : "Der Token liegt verschlüsselt in der Datenbank und wird nie angezeigt."}
        </p>
        {stored.token_set && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={removeToken}
              onChange={(event) => setRemoveToken(event.target.checked)}
            />
            Gespeicherten Token löschen
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
          Nur nötig, wenn das Zertifikat von NetBox aus einer eigenen Zertifizierungsstelle stammt.
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
        <ListChoice
          label="View"
          none="Alle Views"
          unit="Views"
          placeholder="Name der View …"
          hint="Die Liste der Views füllt „Verbindung prüfen“."
          options={[
            ...(viewId !== null && !views.some((view) => view.id === viewId)
              ? [{ id: viewId, label: `View ${viewId}` }]
              : []),
            ...views.map((view) => ({ id: view.id, label: view.name })),
          ]}
          value={viewId === null ? "" : String(viewId)}
          onChange={(value) => setViewId(value === "" ? null : Number(value))}
        />
        <FixedChoice
          label="Öffentlicher Resolver"
          wide
          value={resolver}
          options={stored.resolvers.map((entry) => ({ value: entry.id, label: entry.name }))}
          onChange={setResolver}
        />
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={compareTtl}
            onChange={(event) => setCompareTtl(event.target.checked)}
          />
          TTL vergleichen (öffentlich größer als in NetBox gilt als Abweichung)
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          DNS-Abgleich einschalten
        </label>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            NetBox speichern
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
        <Feedback message={message} onClose={() => setMessage(null)} />
      </form>
    </section>
  );
}
