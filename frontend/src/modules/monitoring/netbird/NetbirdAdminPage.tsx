import { useEffect, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../../api";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { Field, RequiredNote } from "../../../components/Field";
import { InfoTip } from "../../../components/InfoTip";
import { fetchNbAdmin, saveNbAdmin, testNbConnection, type NbAdminSettings } from "./api";

/* Verwaltung › NetBird: Management-URL, API-Token, Ping, Verbindungstest. */

const URL_PATTERN = /^https:\/\/[^/\s?#@]+\/?$/;
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}:\d{1,5}$/;

export function NetbirdAdminPage() {
  const [data, setData] = useState<NbAdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  useEffect(() => {
    let active = true;
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
