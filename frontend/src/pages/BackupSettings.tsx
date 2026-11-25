import { useEffect, useId, useState, type FormEvent } from "react";
import {
  errorText,
  fetchBackup,
  formatBackupSize,
  formatDateTime,
  saveBackup,
  startBackup,
  type BackupState,
} from "../api";
import { Feedback, type FeedbackMessage } from "../components/Feedback";
import { InfoTip } from "../components/InfoTip";

/** Wie oft die Seite nachfragt, solange eine Sicherung aus der Verwaltung läuft. */
export const BACKUP_POLL_MS = 5000;

const TRIGGERS: Record<BackupState["runs"][number]["trigger"], string> = {
  zeitplan: "Zeitplan",
  verwaltung: "Verwaltung",
  kommando: "Kommando",
};

const RUN_STATUS: Record<BackupState["runs"][number]["status"], [string, string]> = {
  ok: ["erfolgreich", "pill pill-ok"],
  fehler: ["fehlgeschlagen", "pill pill-bad"],
  laeuft: ["läuft", "pill pill-neutral"],
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Verwaltung › Datensicherung: Zeitplan, Aufbewahrung, Zustand, vorhandene Sicherungen. */
export function BackupSettings() {
  const [state, setState] = useState<BackupState | null>(null);
  const [failed, setFailed] = useState(false);
  // Hier statt im Formular: Das Formular wird nach dem Speichern mit den neuen Werten neu
  // aufgebaut, die Rückmeldung soll stehen bleiben.
  const [message, setMessage] = useState<FeedbackMessage | null>(null);

  useEffect(() => {
    let active = true;
    fetchBackup().then(
      (result) => active && setState(result),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  // Solange eine Sicherung wartet oder läuft, den Stand regelmäßig nachladen
  const requested = state?.requested ?? false;
  useEffect(() => {
    if (!requested) {
      return;
    }
    const timer = window.setInterval(() => {
      fetchBackup().then(setState, () => undefined);
    }, BACKUP_POLL_MS);
    return () => window.clearInterval(timer);
  }, [requested]);

  if (failed) {
    return <p className="hint-box hint-bad">Die Datensicherung konnte nicht geladen werden.</p>;
  }
  if (!state) {
    return <p role="status">Wird geladen …</p>;
  }
  return (
    <>
      <BackupForm
        key={`${state.enabled}-${state.hour}-${state.keep}`}
        state={state}
        onChange={setState}
        onMessage={setMessage}
      />
      <BackupLists state={state} />
      <BackupGuide example={state.backups[0]?.name ?? "werkbank-JJJJ-MM-TT-HHMMSS"} />
      <Feedback message={message} onClose={() => setMessage(null)} />
    </>
  );
}

function BackupForm({
  state,
  onChange,
  onMessage: setMessage,
}: {
  state: BackupState;
  onChange: (state: BackupState) => void;
  onMessage: (message: FeedbackMessage | null) => void;
}) {
  const [enabled, setEnabled] = useState(state.enabled);
  const [hour, setHour] = useState(state.hour);
  const [keep, setKeep] = useState(String(state.keep));
  const [busy, setBusy] = useState(false);
  const keepHint = useId();
  const keepId = useId();
  const { readiness } = state;

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const count = Number(keep);
    if (!Number.isInteger(count) || count < state.keep_min || count > state.keep_max) {
      setMessage({
        kind: "alert",
        text: `Bitte eine ganze Zahl von ${state.keep_min} bis ${state.keep_max} eintragen.`,
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    saveBackup({ enabled, hour, keep: count })
      .then((result) => {
        onChange(result);
        setMessage({
          kind: "status",
          text: "Die Einstellungen der Datensicherung sind gespeichert.",
        });
      })
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellungen konnten nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const onStart = () => {
    setBusy(true);
    setMessage(null);
    startBackup()
      .then((result) => {
        onChange(result);
        setMessage({
          kind: "status",
          text: "Die Sicherung ist gestartet. Das Ergebnis steht gleich unten bei den Läufen.",
        });
      })
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Sicherung konnte nicht gestartet werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const pill = !readiness.ready
    ? ["nicht eingerichtet", "pill pill-bad"]
    : state.enabled
      ? ["eingeschaltet", "pill pill-ok"]
      : ["ausgeschaltet", "pill pill-neutral"];

  return (
    <section className="panel" aria-labelledby="sicherung-titel">
      <div className="panel-head">
        <h3 id="sicherung-titel">
          Datensicherung <InfoTip term="verwaltung.sicherung" />
        </h3>
        <span className={pill[1]}>{pill[0]}</span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave}>
        <p className="small">
          Die Werkbank sichert die Datenbank und alle Dateien (Belege, Anhänge, Dokumente)
          verschlüsselt in den Zielordner auf dem Server. Zurückgespielt wird eine Sicherung auf dem
          Server, nicht hier; wie das geht, steht unten in der Anleitung.
        </p>
        <ul className="small" aria-label="Zustand der Einrichtung">
          <li>
            Schlüssel „backup_key“:{" "}
            {readiness.key ? "vorhanden" : "fehlt auf dem Server (Docker-Secret)"}
          </li>
          <li>
            Zielordner: {readiness.folder ? "beschreibbar" : "fehlt oder ist nicht beschreibbar"}
          </li>
          <li>Werkzeuge im Image: {readiness.tools ? "vorhanden" : "fehlen"}</li>
        </ul>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Täglich sichern
        </label>
        <label>
          Uhrzeit
          <select value={hour} onChange={(event) => setHour(Number(event.target.value))}>
            {HOURS.map((value) => (
              <option key={value} value={value}>
                {`${String(value).padStart(2, "0")}:00 Uhr`}
              </option>
            ))}
          </select>
        </label>
        <div className="field-info">
          <span className="field-info-head">
            <label htmlFor={keepId}>Aufbewahren</label>
            <InfoTip term="verwaltung.sicherung_aufbewahren" />
          </span>
          <input
            id={keepId}
            type="number"
            inputMode="numeric"
            value={keep}
            aria-describedby={keepHint}
            onChange={(event) => setKeep(event.target.value)}
          />
        </div>
        <p className="small" id={keepHint}>
          So viele Sicherungen bleiben im Zielordner, ältere löscht die Werkbank nach jeder neuen
          Sicherung.
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Datensicherung speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || !readiness.ready || state.requested}
            onClick={onStart}
          >
            {state.requested ? "Sicherung läuft …" : "Jetzt sichern"}
          </button>
        </div>
      </form>
    </section>
  );
}

function BackupLists({ state }: { state: BackupState }) {
  return (
    <>
      <section className="panel" aria-labelledby="sicherungen-titel">
        <div className="panel-head">
          <h3 id="sicherungen-titel">Vorhandene Sicherungen</h3>
        </div>
        <div className="detail-body">
          {state.backups.length === 0 ? (
            <p className="empty">Im Zielordner liegt noch keine Sicherung.</p>
          ) : (
            <div
              className="table-wrap card-wrap"
              tabIndex={0}
              role="region"
              aria-label="Vorhandene Sicherungen"
            >
              <table className="table-cards">
                <caption className="visually-hidden">
                  Sicherungen im Zielordner, neueste zuerst
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Erstellt</th>
                    <th scope="col">Größe</th>
                    <th scope="col">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {state.backups.map((backup) => (
                    <tr key={backup.name}>
                      <td className="mono" data-label="Name">
                        {backup.name}
                      </td>
                      <td className="nowrap" data-label="Erstellt">
                        {formatDateTime(backup.created_at)}
                      </td>
                      <td className="nowrap" data-label="Größe">
                        {formatBackupSize(backup.size_bytes)}
                      </td>
                      <td data-label="Version">{backup.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className="panel" aria-labelledby="laeufe-titel">
        <div className="panel-head">
          <h3 id="laeufe-titel">Letzte Läufe</h3>
        </div>
        <div className="detail-body">
          {state.runs.length === 0 ? (
            <p className="empty">Bisher ist keine Sicherung gelaufen.</p>
          ) : (
            <div
              className="table-wrap card-wrap"
              tabIndex={0}
              role="region"
              aria-label="Letzte Läufe der Datensicherung"
            >
              <table className="table-cards">
                <caption className="visually-hidden">Letzte Läufe, neueste zuerst</caption>
                <thead>
                  <tr>
                    <th scope="col">Beginn</th>
                    <th scope="col">Anlass</th>
                    <th scope="col">Ergebnis</th>
                    <th scope="col">Größe</th>
                    <th scope="col">Hinweis</th>
                  </tr>
                </thead>
                <tbody>
                  {state.runs.map((run) => {
                    const [label, className] = RUN_STATUS[run.status];
                    return (
                      <tr key={run.id}>
                        <td className="nowrap" data-label="Beginn">
                          {formatDateTime(run.started_at)}
                        </td>
                        <td data-label="Anlass">
                          {TRIGGERS[run.trigger]}
                          {run.started_by ? ` (${run.started_by})` : ""}
                        </td>
                        <td data-label="Ergebnis">
                          <span className={className}>{label}</span>
                        </td>
                        <td className="nowrap" data-label="Größe">
                          {run.size_bytes === null ? "–" : formatBackupSize(run.size_bytes)}
                        </td>
                        <td className="details" data-label="Hinweis">
                          {run.error ?? "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** Ein Befehl zum Abschreiben oder Kopieren. */
function Command({ children }: { children: string }) {
  return (
    // tabIndex: Lange Befehle scrollen waagerecht und müssen per Tastatur erreichbar sein
    <pre className="command-block" tabIndex={0}>
      <code>{children}</code>
    </pre>
  );
}

/**
 * Anleitung auf der Seite: einrichten, zurückspielen, im Notfall ohne Werkbank öffnen.
 * Dieselben Schritte stehen in deploy/README.md (Abschnitt Datensicherung).
 */
function BackupGuide({ example }: { example: string }) {
  return (
    <section className="panel" aria-labelledby="anleitung-titel">
      <div className="panel-head">
        <h3 id="anleitung-titel">Anleitung</h3>
      </div>
      <div className="detail-body backup-guide">
        <p className="small">
          Alle Befehle laufen auf dem Server im Ordner mit der Datei „docker-compose.yml“ der
          Werkbank.
        </p>
        <details>
          <summary>Einrichten auf dem Server</summary>
          <ol>
            <li>
              Schlüssel anlegen, im Ordner mit den anderen Secrets (z. B. „settings_key“):
              <Command>{`openssl rand -base64 48 | tr -d '\\n' > backup_key\nchmod 444 backup_key`}</Command>
              Eine Kopie des Schlüssels getrennt von den Sicherungen aufbewahren, zum Beispiel im
              Passwortmanager. Ohne ihn lässt sich keine Sicherung öffnen.
            </li>
            <li>
              Zielordner festlegen (freiwillig). Ohne Angabe landen die Sicherungen im Docker-Volume
              „backups“. Besser ist ein Ordner, der mitgesichert wird, etwa ein NAS-Mount. In der
              Datei „.env“ eintragen und dem Benutzer der Werkbank (UID 10001) geben:
              <Command>{`WERKBANK_BACKUP_DIR=/mnt/sicherung/werkbank`}</Command>
              <Command>{`sudo mkdir -p /mnt/sicherung/werkbank\nsudo chown 10001:10001 /mnt/sicherung/werkbank\nsudo chmod 700 /mnt/sicherung/werkbank`}</Command>
            </li>
            <li>
              Werkbank neu starten:
              <Command>{`docker compose up -d`}</Command>
              Oben auf dieser Seite steht danach „Schlüssel: vorhanden“ und „Zielordner:
              beschreibbar“. Dann „Täglich sichern“ einschalten und einmal „Jetzt sichern“.
            </li>
          </ol>
        </details>
        <details>
          <summary>Sicherung zurückspielen</summary>
          <p className="hint-box">
            Das Zurückspielen ersetzt die ganze Datenbank und alle Dateien durch den Stand der
            Sicherung. Alles, was danach eingetragen wurde, ist weg. Schlägt das Einspielen der
            Datenbank fehl, bleibt der alte Stand erhalten.
          </p>
          <ol>
            <li>
              Vorhandene Sicherungen anzeigen und die gewünschte prüfen (Prüfsummen und Schlüssel):
              <Command>{`docker compose exec worker python -m werkbank.backup liste\ndocker compose exec worker python -m werkbank.backup pruefen ${example}`}</Command>
            </li>
            <li>
              Werkbank anhalten, die Datenbank läuft weiter:
              <Command>{`docker compose stop web worker`}</Command>
            </li>
            <li>
              Zurückspielen. Der Befehl fragt zur Sicherheit nach dem Namen der Sicherung:
              <Command>{`docker compose run --rm --no-deps worker python -m werkbank.backup wiederherstellen ${example}`}</Command>
            </li>
            <li>
              Werkbank wieder starten. Beim Start bringt sie die Datenbank auf den Stand ihrer
              Version:
              <Command>{`docker compose up -d`}</Command>
            </li>
          </ol>
          <ul className="small">
            <li>
              Die Werkbank muss mindestens die Version haben, mit der die Sicherung erstellt wurde
              (Spalte „Version“ oben). Ist sie älter, bricht der Befehl ab, ohne etwas zu ändern.
            </li>
            <li>
              Auf einem neuen Server: Werkbank wie bei der Inbetriebnahme einrichten, dabei
              dieselben Secrets verwenden, auch „settings_key“. Sonst lassen sich gespeicherte
              Zugangsdaten (SMTP, NetBox usw.) nicht mehr lesen und müssen neu eingetragen werden.
              Den Sicherungsordner in den Zielordner kopieren, dann ab Schritt 2.
            </li>
          </ul>
        </details>
        <details>
          <summary>Im Notfall ohne Werkbank öffnen</summary>
          <p className="small">
            Die Dateien sind mit GnuPG verschlüsselt (AES-256) und lassen sich auf jedem Rechner mit
            gpg und dem Schlüssel öffnen. Die Datenbank liegt danach im Format von pg_dump vor, die
            Dateien als tar-Archiv:
          </p>
          <Command>{`gpg --batch --pinentry-mode loopback --passphrase-file backup_key \\\n  --decrypt datenbank.dump.gpg > datenbank.dump\ngpg --batch --pinentry-mode loopback --passphrase-file backup_key \\\n  --decrypt dateien.tar.gpg | tar -x`}</Command>
        </details>
      </div>
    </section>
  );
}
