import { useEffect, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../../api";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { useConfirm } from "../../../components/ConfirmDialog";
import { Field, RequiredNote } from "../../../components/Field";
import { InfoTip } from "../../../components/InfoTip";
import {
  fetchNbAdmin,
  fetchNbCrowdSec,
  fetchNbWatch,
  previewNbWatch,
  saveNbWatch,
  saveNbAdmin,
  saveNbCrowdSec,
  testNbConnection,
  testNbCrowdSec,
  type NbAdminSettings,
  type NbCrowdSecSettings,
  type NbNotify,
  type NbWatchInput,
  type NbWatchPreview,
  type NbWatchSettings,
} from "./api";

/* Verwaltung › NetBird: Management-URL, API-Token, Ping, Verbindungstest; CrowdSec. */

const URL_PATTERN = /^https:\/\/[^/\s?#@]+\/?$/;
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}:\d{1,5}$/;
const LAPI_PATTERN = /^https?:\/\/[^/\s?#@]+\/?$/;

export function NetbirdAdminPage() {
  const [data, setData] = useState<NbAdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [crowdsec, setCrowdsec] = useState<NbCrowdSecSettings | null>(null);
  const [watch, setWatch] = useState<NbWatchSettings | null>(null);
  useEffect(() => {
    let active = true;
    fetchNbWatch().then(
      (value) => active && setWatch(value),
      () => undefined,
    );
    fetchNbCrowdSec().then(
      (value) => active && setCrowdsec(value),
      () => undefined,
    );
    fetchNbAdmin().then(
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
          <h1>NetBird</h1>
          <p className="page-sub">
            Zugang für IT-Monitoring › NetBird. Die Werkbank liest NetBird nur. Den Bereich sieht
            nur, wer unter Berechtigungen „NetBird: Lesen“ hat, auch in der Admin-Gruppe.
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
        <AccessForm
          key={JSON.stringify([
            data.url,
            data.token_set,
            data.ping,
            data.signal,
            data.relay,
            data.server_groups,
          ])}
          data={data}
          onSaved={setData}
          onMessage={setMessage}
        />
      )}
      {watch && (
        <WatchForm
          key={JSON.stringify(watch)}
          data={watch}
          onSaved={setWatch}
          onMessage={setMessage}
        />
      )}
      {crowdsec && (
        <CrowdSecForm
          key={JSON.stringify([crowdsec.url, crowdsec.key_set, crowdsec.exempt])}
          data={crowdsec}
          onSaved={setCrowdsec}
          onMessage={setMessage}
        />
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}

function AccessForm({
  data,
  onSaved,
  onMessage,
}: {
  data: NbAdminSettings;
  onSaved: (data: NbAdminSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [url, setUrl] = useState(data.url);
  const [token, setToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [ping, setPing] = useState(data.ping);
  const [signal, setSignal] = useState(data.signal);
  const [relay, setRelay] = useState(data.relay);
  const [serverGroups, setServerGroups] = useState(data.server_groups);
  const [problem, setProblem] = useState<string | null>(null);
  const [targetProblem, setTargetProblem] = useState<{ signal?: string; relay?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    if (value && !URL_PATTERN.test(value)) {
      setProblem("Bitte die https-Adresse ohne Pfad eintragen, z. B. https://netbird.example.com.");
      return;
    }
    setProblem(null);
    const wrong = "Bitte als Host:Port eintragen, z. B. signal.example.com:443.";
    const targets = {
      signal: signal.trim() && !TARGET_PATTERN.test(signal.trim()) ? wrong : undefined,
      relay: relay.trim() && !TARGET_PATTERN.test(relay.trim()) ? wrong : undefined,
    };
    setTargetProblem(targets);
    if (targets.signal || targets.relay) {
      return;
    }
    setBusy(true);
    saveNbAdmin({
      url: value,
      ping,
      signal: signal.trim(),
      relay: relay.trim(),
      server_groups: serverGroups,
      ...(removeToken ? { token: "" } : token.trim() ? { token: token.trim() } : {}),
    })
      .then((next) => {
        onSaved(next);
        onMessage({ kind: "status", text: "Die Einstellungen für NetBird sind gespeichert." });
      })
      .catch((caught: unknown) => {
        onMessage({
          kind: "alert",
          text: errorText(caught, "Die Einstellungen konnten nicht gespeichert werden."),
        });
        setBusy(false);
      });
  };

  const test = () => {
    testNbConnection().then(
      (result) =>
        onMessage({
          kind: "status",
          text: `Die Verbindung klappt: ${result.peers} Peers, ${result.groups} Gruppen${result.policies !== null ? `, ${result.policies} Richtlinien` : ""}.`,
        }),
      (caught: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(caught, "Die Verbindung ließ sich nicht prüfen."),
        }),
    );
  };

  return (
    <section className="panel" aria-labelledby="nb-zugang">
      <div className="panel-head">
        <h2 id="nb-zugang">Zugang zur Management-API</h2>
      </div>
      <form className="detail-body settings-form" noValidate onSubmit={submit}>
        <RequiredNote />
        <Field
          label="Management-URL"
          required
          error={problem}
          hint="Nur https, ohne Pfad. Die Werkbank ruft nur diese Adresse auf."
        >
          {(control) => (
            <input
              {...control}
              type="url"
              value={url}
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://netbird.example.com"
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={data.token_set ? "Neues API-Token" : "API-Token"}
          info={<InfoTip term="netbird.token" />}
          hint={
            data.token_set
              ? "Ein Token ist gespeichert; leer lassen, um es zu behalten. Es wird nie wieder angezeigt."
              : "Token eines Dienstkontos mit Leserecht. Verschlüsselt gespeichert."
          }
        >
          {(control) => (
            <input
              {...control}
              type="password"
              value={token}
              maxLength={500}
              autoComplete="new-password"
              disabled={removeToken || !data.token_storage_available}
              onChange={(event) => setToken(event.target.value)}
            />
          )}
        </Field>
        {!data.token_storage_available && (
          <p className="hint-box hint-warn">
            Auf dem Server fehlt die Schlüsseldatei (settings_key). Ohne sie kann kein Token
            gespeichert werden.
          </p>
        )}
        {data.token_set && (
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
        <Field
          label="Signal (Host:Port)"
          error={targetProblem.signal ?? null}
          hint="Für die Kachel „Signal“ (TCP-Prüfung); leer lassen, um sie auszublenden."
        >
          {(control) => (
            <input
              {...control}
              value={signal}
              maxLength={260}
              autoComplete="off"
              spellCheck={false}
              placeholder="signal.example.com:443"
              onChange={(event) => setSignal(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Relay (Host:Port)"
          error={targetProblem.relay ?? null}
          hint="Für die Kachel „Relay“ (TCP-Prüfung); leer lassen, um sie auszublenden."
        >
          {(control) => (
            <input
              {...control}
              value={relay}
              maxLength={260}
              autoComplete="off"
              spellCheck={false}
              placeholder="relay.example.com:443"
              onChange={(event) => setRelay(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Server-Gruppen"
          info={<InfoTip term="netbird.servergruppen" />}
          hint="Namen der Gruppen in NetBird, mehrere mit Komma. Für die Prüfung „Zugriff auf Server ohne Posture Check“; gilt ab dem nächsten Abruf."
        >
          {(control) => (
            <input
              {...control}
              value={serverGroups}
              maxLength={2000}
              autoComplete="off"
              spellCheck={false}
              placeholder="grp-server, grp-datenbanken"
              onChange={(event) => setServerGroups(event.target.value)}
            />
          )}
        </Field>
        <div className="fg-field-tip">
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={ping}
              onChange={(event) => setPing(event.target.checked)}
            />
            Ping in die Netze
          </label>
          <InfoTip term="netbird.ping" />
        </div>
        <p className="small">
          Vorgabe aus. Braucht einen NetBird-Peer für den Server der Werkbank; ohne Ping folgt
          „erreichbar“ aus dem Status der Routing-Peers.
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!data.url || !data.token_set}
            onClick={test}
          >
            Verbindung prüfen
          </button>
        </div>
        <p className="small">
          Abruf alle 5 Minuten.{" "}
          {data.last_run_at
            ? `Letzter Abruf ${formatDateTime(data.last_run_at)}: ${data.last_ok ? "in Ordnung" : `fehlgeschlagen (${data.last_error ?? ""})`}.`
            : "Noch kein Abruf."}
        </p>
      </form>
    </section>
  );
}

function CrowdSecForm({
  data,
  onSaved,
  onMessage,
}: {
  data: NbCrowdSecSettings;
  onSaved: (data: NbCrowdSecSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [url, setUrl] = useState(data.url);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [exempt, setExempt] = useState(data.exempt);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    if (value && !LAPI_PATTERN.test(value)) {
      setProblem(
        "Bitte die Adresse der Local API ohne Pfad eintragen, z. B. http://crowdsec.example.com:8080.",
      );
      return;
    }
    setProblem(null);
    setBusy(true);
    saveNbCrowdSec({
      url: value,
      exempt,
      ...(removeKey ? { key: "" } : key.trim() ? { key: key.trim() } : {}),
    })
      .then((next) => {
        onSaved(next);
        onMessage({ kind: "status", text: "Die Einstellungen für CrowdSec sind gespeichert." });
      })
      .catch((caught: unknown) => {
        onMessage({
          kind: "alert",
          text: errorText(
            caught,
            "Die Einstellungen für CrowdSec konnten nicht gespeichert werden.",
          ),
        });
        setBusy(false);
      });
  };

  const test = () => {
    testNbCrowdSec().then(
      (result) =>
        onMessage({
          kind: "status",
          text: `Die Local API antwortet: ${result.total} aktive Sperren, davon ${result.own} eigene.`,
        }),
      (caught: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(caught, "Die Local API ließ sich nicht prüfen."),
        }),
    );
  };

  return (
    <section className="panel" aria-labelledby="nb-crowdsec">
      <div className="panel-head">
        <h2 id="nb-crowdsec">
          CrowdSec <InfoTip term="netbird.crowdsec" />
        </h2>
      </div>
      <form className="detail-body settings-form" noValidate onSubmit={submit}>
        <p className="small">
          Ein eigener Bouncer-Schlüssel nur für die Werkbank (z. B. mit „cscli bouncers add
          werkbank“): Er liest nur die Sperren und ändert nichts. Abgewiesene Anfragen je Dienst
          kommen aus dem Zugriffsprotokoll von NetBird, dafür braucht es keinen Zugang zu CrowdSec.
        </p>
        <Field
          label="URL der Local API"
          error={problem}
          hint="http oder https, ohne Pfad. Mit http geht der Schlüssel unverschlüsselt durchs Netz."
        >
          {(control) => (
            <input
              {...control}
              type="url"
              value={url}
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              placeholder="http://crowdsec.example.com:8080"
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={data.key_set ? "Neuer Bouncer-Schlüssel" : "Bouncer-Schlüssel"}
          hint={
            data.key_set
              ? "Ein Schlüssel ist gespeichert; leer lassen, um ihn zu behalten. Er wird nie wieder angezeigt."
              : "Verschlüsselt gespeichert."
          }
        >
          {(control) => (
            <input
              {...control}
              type="password"
              value={key}
              maxLength={500}
              autoComplete="new-password"
              disabled={removeKey || !data.token_storage_available}
              onChange={(event) => setKey(event.target.value)}
            />
          )}
        </Field>
        {data.key_set && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={removeKey}
              onChange={(event) => setRemoveKey(event.target.checked)}
            />
            Gespeicherten Schlüssel entfernen
          </label>
        )}
        <Field
          label="Bewusst ohne CrowdSec"
          info={<InfoTip term="netbird.ohne_crowdsec" />}
          hint="Domains der Dienste, für die es keinen Hinweis „ohne CrowdSec“ geben soll, mehrere mit Komma."
        >
          {(control) => (
            <input
              {...control}
              value={exempt}
              maxLength={4000}
              autoComplete="off"
              spellCheck={false}
              placeholder="login.example.com"
              onChange={(event) => setExempt(event.target.value)}
            />
          )}
        </Field>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!data.url || !data.key_set}
            onClick={test}
          >
            Verbindung prüfen
          </button>
        </div>
      </form>
    </section>
  );
}

const RETENTION_ORDER: NbWatchInput["retention"][] = ["unbegrenzt", "3j", "1j", "90t"];

const NOTIFY_ROWS: [keyof NbNotify, string][] = [
  ["policy_change", "Policy angelegt, geändert, gelöscht"],
  ["policy_toggle", "Policy aktiviert oder deaktiviert"],
  ["group_change", "Gruppe angelegt, umbenannt, gelöscht"],
  ["members_manual", "Mitglieder von Hand geändert"],
  ["members_scim", "Mitglieder über SCIM geändert"],
];

function WatchForm({
  data,
  onSaved,
  onMessage,
}: {
  data: NbWatchSettings;
  onSaved: (data: NbWatchSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [input, setInput] = useState<NbWatchInput>(() => ({
    group_prefixes: data.group_prefixes,
    policy_prefixes: data.policy_prefixes,
    by_prefix: data.by_prefix,
    by_group: data.by_group,
    notify: { ...data.notify },
    critical_mail: data.critical_mail,
    retention: data.retention,
    reminder: data.reminder,
    auto_confirm: data.auto_confirm,
  }));
  const [hits, setHits] = useState<NbWatchPreview>(data.preview);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const set = (next: Partial<NbWatchInput>) => setInput((current) => ({ ...current, ...next }));

  const loadPreview = () => {
    previewNbWatch(input).then(
      (value) => {
        setHits(value);
        setShowPreview(true);
      },
      (caught: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(caught, "Die Vorschau ließ sich nicht laden."),
        }),
    );
  };

  const save = () => {
    setBusy(true);
    return saveNbWatch(input)
      .then((next) => {
        onSaved(next);
        onMessage({
          kind: "status",
          text: "Die Überwachung von Gruppen und Policies ist gespeichert.",
        });
      })
      .catch((caught: unknown) => {
        onMessage({
          kind: "alert",
          text: errorText(caught, "Die Überwachung konnte nicht gespeichert werden."),
        });
        setBusy(false);
      });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (RETENTION_ORDER.indexOf(input.retention) > RETENTION_ORDER.indexOf(data.retention)) {
      ask(
        {
          title: "Aufbewahrung verkürzen?",
          text: "Ältere Änderungen werden beim nächsten Abruf gelöscht und lassen sich nicht wiederherstellen.",
          action: "Verkürzen",
          danger: true,
        },
        save,
      );
      return;
    }
    void save();
  };

  return (
    <section className="panel" aria-labelledby="nb-ueberwachung">
      <div className="panel-head">
        <h2 id="nb-ueberwachung">
          Überwachung von Gruppen und Policies <InfoTip term="netbird.ueberwacht" />
        </h2>
      </div>
      <form className="detail-body settings-form" noValidate onSubmit={submit}>
        <Field
          label="Präfixe für Gruppen"
          hint={`Mehrere mit Komma, Groß-/Kleinschreibung egal · ${hits.groups.length} Treffer`}
        >
          {(control) => (
            <input
              {...control}
              value={input.group_prefixes}
              maxLength={1000}
              autoComplete="off"
              spellCheck={false}
              placeholder="grp-it-"
              onChange={(event) => set({ group_prefixes: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Präfixe für Policies"
          hint={`Mehrere mit Komma · ${hits.policies_by_prefix} Treffer`}
        >
          {(control) => (
            <input
              {...control}
              value={input.policy_prefixes}
              maxLength={1000}
              autoComplete="off"
              spellCheck={false}
              placeholder="pol-it-"
              onChange={(event) => set({ policy_prefixes: event.target.value })}
            />
          )}
        </Field>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={input.by_prefix}
            onChange={(event) => set({ by_prefix: event.target.checked })}
          />
          Policies mit eigenem Präfix überwachen
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={input.by_group}
            onChange={(event) => set({ by_group: event.target.checked })}
          />
          Policies mit überwachter Gruppe als Quelle oder Ziel überwachen (+
          {hits.policies_by_group})
        </label>
        <div className="actions">
          <button type="button" className="button button-secondary" onClick={loadPreview}>
            Vorschau der Treffer
          </button>
        </div>
        {showPreview && (
          <div className="hint-box" role="status">
            <p>
              <strong>{hits.groups.length} Gruppen:</strong> {hits.groups.join(", ") || "keine"}
            </p>
            <p>
              <strong>{hits.policies.length} Policies:</strong>{" "}
              {hits.policies_known
                ? hits.policies.join(", ") || "keine"
                : "NetBird liefert keine Richtlinien."}
            </p>
          </div>
        )}
        <div className="table-wrap">
          <table className="nb-mini-table" aria-label="Was gemeldet wird">
            <caption className="small">Was gemeldet wird (protokolliert wird immer alles)</caption>
            <thead>
              <tr>
                <th scope="col">Änderung</th>
                <th scope="col">Glocke an NetBird-Leser</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFY_ROWS.map(([key, label]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>
                    <input
                      type="checkbox"
                      className="check"
                      aria-label={`${label} melden`}
                      checked={input.notify[key]}
                      onChange={(event) =>
                        set({ notify: { ...input.notify, [key]: event.target.checked } })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={input.critical_mail}
            onChange={(event) => set({ critical_mail: event.target.checked })}
          />
          Kritische Änderungen zusätzlich per Mail und Teams an alle Bestätiger
        </label>
        <p className="small">
          Vorgabe aus. Gilt unabhängig von den Kontoeinstellungen; ohne Inhalte in der Nachricht.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={input.auto_confirm}
            onChange={(event) => set({ auto_confirm: event.target.checked })}
          />
          Nur protokollierte Änderungen automatisch bestätigen
        </label>
        <p className="small">
          Gemeldete bleiben offen, bis jemand mit „NetBird: Bestätigen“ sie bestätigt.
        </p>
        <Field label="Aufbewahrung der Änderungen">
          {(control) => (
            <select
              {...control}
              value={input.retention}
              onChange={(event) =>
                set({ retention: event.target.value as NbWatchInput["retention"] })
              }
            >
              <option value="unbegrenzt">unbegrenzt</option>
              <option value="3j">3 Jahre</option>
              <option value="1j">1 Jahr</option>
              <option value="90t">90 Tage</option>
            </select>
          )}
        </Field>
        <Field label="Erinnerung an offene Änderungen">
          {(control) => (
            <select
              {...control}
              value={input.reminder}
              onChange={(event) =>
                set({ reminder: Number(event.target.value) as NbWatchInput["reminder"] })
              }
            >
              <option value={3}>nach 3 Tagen</option>
              <option value={7}>nach 7 Tagen</option>
              <option value={0}>keine</option>
            </select>
          )}
        </Field>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Überwachung speichern
          </button>
        </div>
      </form>
      {dialog}
    </section>
  );
}
