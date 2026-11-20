import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { navigate } from "../../router";
import { EventPanel } from "./parts";
import {
  addCaseNote,
  CASE_FILTERS,
  CASE_STATES,
  casePath,
  decideCase,
  DECISION_OPTIONS,
  fetchAssignees,
  fetchCase,
  fetchCases,
  fetchHardwareList,
  fetchLocations,
  fetchSyncStatus,
  formatDate,
  hardwarePath,
  INVENTORY_EDITOR_ROLE,
  ninjaFactRows,
  roomChoices,
  runSyncNow,
  setCaseStatus,
  takeCase,
  type Assignees,
  type Case,
  type CaseFilter,
  type CaseList,
  type DecisionInput,
  type HardwareSummary,
  type Locations,
  type SyncStatus,
} from "./api";

function formatMoment(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "–"
    : date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

/** Stand des Abgleichs mit NinjaOne und „Jetzt abgleichen“. */
function SyncBar({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchSyncStatus().then(
      (result) => active && setStatus(result),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  if (!status) {
    return null;
  }
  if (!status.enabled) {
    return (
      <p className="hint-box">
        Der Abgleich mit NinjaOne ist ausgeschaltet. Einschalten kann ihn ein Admin in der
        Verwaltung unter „Verbindungen“.
      </p>
    );
  }
  const last = status.last_run;
  return (
    <div className="sync-bar panel">
      <p>
        {last ? (
          <>
            Letzter Abgleich mit NinjaOne: {formatMoment(last.started_at)}
            {last.status === "ok"
              ? ` · ${last.devices} Geräte, ${last.new_cases} neu, ${last.missing_cases} fehlen`
              : ""}
          </>
        ) : (
          "Noch kein Abgleich mit NinjaOne."
        )}
        {status.next_run_at && (
          <span className="small"> · nächster: {formatMoment(status.next_run_at)}</span>
        )}
      </p>
      {last && last.status !== "ok" && (
        <p role="alert" className="hint-box hint-bad">
          Der letzte Abgleich ist fehlgeschlagen: {last.error}
        </p>
      )}
      {canEdit && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() =>
            runSyncNow().then(
              () => setNotice("Der Abgleich startet in Kürze. Lade die Seite danach neu."),
              (problem: unknown) =>
                setNotice(errorText(problem, "Der Abgleich ließ sich nicht starten.")),
            )
          }
        >
          Jetzt abgleichen
        </button>
      )}
      {notice && (
        <p role="status" className="small">
          {notice}
        </p>
      )}
    </div>
  );
}

interface Choices {
  assignees: Assignees;
  locations: Locations;
  hardware: HardwareSummary[];
}

function loadChoices(): Promise<Choices> {
  return Promise.all([fetchAssignees(), fetchLocations(), fetchHardwareList("aktiv")]).then(
    ([assignees, locations, hardware]) => ({ assignees, locations, hardware }),
  );
}

/** Entscheidung für einen offenen Vorgang; Zusatzfelder je nach Auswahl. */
function DecisionForm({ entry, onDone }: { entry: Case; onDone: (next: Case) => void }) {
  const options = DECISION_OPTIONS[entry.kind];
  const [choice, setChoice] = useState("");
  const [choices, setChoices] = useState<Choices | null>(null);
  const [target, setTarget] = useState(entry.hint ? String(entry.hint.id) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entry.kind === "weg") {
      return;
    }
    let active = true;
    loadChoices().then(
      (result) => active && setChoices(result),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [entry.kind]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!choice) {
      setError("Bitte eine Entscheidung wählen.");
      return;
    }
    const body: DecisionInput = { decision: choice };
    if (choice === "stelle" || choice === "arbeitsplatz" || choice === "gleich") {
      if (!target) {
        setError(
          choice === "stelle"
            ? "Bitte eine Stelle wählen."
            : choice === "arbeitsplatz"
              ? "Bitte einen Arbeitsplatz wählen."
              : "Bitte das vorhandene Gerät wählen.",
        );
        return;
      }
      if (choice === "stelle") {
        body.position_id = Number(target);
      } else if (choice === "arbeitsplatz") {
        body.workplace_id = Number(target);
      } else {
        body.hardware_id = Number(target);
      }
    }
    if (choice === "lager" && target) {
      body.room_id = Number(target);
    }
    setBusy(true);
    setError(null);
    decideCase(entry.id, body).then(onDone, (problem: unknown) => {
      setError(errorText(problem, "Die Entscheidung konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  const suggested = entry.facts.suggest_workplace_id;
  const pick = (id: string) => {
    setChoice(id);
    setError(null);
    if (id === "gleich" && entry.hint) {
      setTarget(String(entry.hint.id));
    } else if (id === "arbeitsplatz" && entry.kind === "monitor" && suggested) {
      setTarget(String(suggested));
    } else {
      setTarget("");
    }
  };

  return (
    <form className="settings-form form-stack case-decision" onSubmit={onSubmit} noValidate>
      <fieldset className="seg-field">
        <legend>
          {entry.kind === "neu"
            ? "Was soll mit dem Gerät passieren?"
            : entry.kind === "monitor"
              ? "Wo gehört der Monitor hin?"
              : "Was ist mit dem Gerät?"}
        </legend>
        <div className="case-options">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="case-option"
              aria-pressed={choice === option.id}
              onClick={() => pick(option.id)}
            >
              <strong>{option.label}</strong>
              <span className="small">{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {entry.kind !== "weg" && choice && choice !== "uebergehen" && !choices && (
        <p role="status">Auswahl wird geladen …</p>
      )}
      {choice === "stelle" && choices && (
        <label>
          Stelle
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Bitte wählen</option>
            {choices.assignees.positions.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.number} {item.name}
                {item.person_name ? ` (${item.person_name})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {choice === "arbeitsplatz" && choices && (
        <label>
          {entry.kind === "monitor" && suggested
            ? "Arbeitsplatz (Vorschlag ausgewählt)"
            : "Arbeitsplatz"}
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Bitte wählen</option>
            {choices.assignees.workplaces.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.number} {item.name}
                {item.place ? ` (${item.place})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {choice === "lager" && choices && (
        <label>
          Raum (freiwillig)
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">kein Raum</option>
            {roomChoices(choices.locations).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.rooms.map((room) => (
                  <option key={room.id} value={String(room.id)}>
                    {room.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {choice === "gleich" && choices && (
        <label>
          Vorhandenes Gerät
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Bitte wählen</option>
            {choices.hardware
              .filter((item) => item.kind === "Notebook" || item.kind === "PC")
              .map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                  {item.hostname ? ` · ${item.hostname}` : ""}
                  {item.serial ? ` · SN ${item.serial}` : ""}
                </option>
              ))}
          </select>
        </label>
      )}
      {choice === "ausgemustert" && entry.hardware && entry.hardware.status !== "ausgemustert" && (
        <p className="hint-box hint-warn">
          Das Gerät ist noch im Bestand.{" "}
          <Link to={hardwarePath(entry.hardware.id)}>Gerät öffnen und ausmustern</Link>, danach hier
          abschließen.
        </p>
      )}
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {choice === "pruefen" ? "Übernehmen" : "Übernehmen und abschließen"}
        </button>
      </div>
    </form>
  );
}

function NoteForm({ entry, onDone }: { entry: Case; onDone: (next: Case) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) {
      setError("Bitte einen Text eintragen.");
      return;
    }
    addCaseNote(entry.id, text.trim()).then(
      (next) => {
        setText("");
        setError(null);
        onDone(next);
      },
      (problem: unknown) =>
        setError(errorText(problem, "Die Notiz konnte nicht gespeichert werden.")),
    );
  };
  return (
    <form className="settings-form form-stack" onSubmit={onSubmit} noValidate>
      <div className="tool-row">
        <label>
          Notiz
          <input
            type="text"
            value={text}
            maxLength={300}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <button type="submit" className="button button-secondary">
          Notiz speichern
        </button>
      </div>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </form>
  );
}

function CaseDetail({
  caseId,
  canEdit,
  onChanged,
}: {
  caseId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [entry, setEntry] = useState<Case | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchCase(caseId).then(
      (result) => active && setEntry(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Der Vorgang konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [caseId]);

  const shown = entry && entry.id === caseId ? entry : null;
  const update = (next: Case) => {
    setEntry(next);
    setNotice(null);
    onChanged();
  };

  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!shown) {
    return <p role="status">Wird geladen …</p>;
  }
  const open = shown.status !== "fertig";
  const facts = ninjaFactRows(shown.facts);
  return (
    <>
      <section className="panel" aria-labelledby="vorgang-titel">
        <div className="panel-head case-head">
          <div>
            <p className="small">
              <span className="mono">{shown.number}</span> · {shown.kind_label} ·{" "}
              {formatDate(shown.created_at)}
            </p>
            <h2 id="vorgang-titel">{shown.title}</h2>
            <p className="small">
              <span className={`pill ${CASE_STATES[shown.status].pill}`}>
                {CASE_STATES[shown.status].label}
              </span>{" "}
              Bearbeiter: {shown.assignee ?? "noch niemand"}
            </p>
          </div>
          {canEdit && open && (
            <div className="project-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  takeCase(shown.id).then(update, (problem: unknown) =>
                    setNotice(errorText(problem, "Das hat nicht geklappt.")),
                  )
                }
              >
                Ich übernehme
              </button>
              {shown.status === "arbeit" && (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() =>
                    setCaseStatus(shown.id, "neu").then(update, (problem: unknown) =>
                      setNotice(errorText(problem, "Das hat nicht geklappt.")),
                    )
                  }
                >
                  Zurück auf „Neu“
                </button>
              )}
            </div>
          )}
        </div>
        <div className="detail-body">
          {notice && (
            <p role="alert" className="hint-box hint-bad">
              {notice}
            </p>
          )}
          {shown.hint && (
            <p className="hint-box hint-warn">
              <strong>Möglicherweise dasselbe Gerät.</strong> Der Hostname gehört schon zu{" "}
              <Link to={hardwarePath(shown.hint.id)}>{shown.hint.name}</Link>
              {shown.hint.serial ? ` (SN ${shown.hint.serial})` : ""}. Eine andere Seriennummer
              kommt zum Beispiel nach einem Mainboardtausch vor.
            </p>
          )}
          <h3 className="sub-head">
            {shown.kind === "neu"
              ? "Gerät laut NinjaOne"
              : shown.kind === "monitor"
                ? "Monitor laut Custom Field"
                : "Gerät im Bestand"}
          </h3>
          <dl className="facts">
            {facts.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className={row.mono ? "mono" : undefined}>{row.value}</dd>
              </div>
            ))}
            {shown.hardware && (
              <div>
                <dt>Im Bestand</dt>
                <dd>
                  <Link to={hardwarePath(shown.hardware.id)}>{shown.hardware.name}</Link>
                  {shown.hardware.status === "ausgemustert" ? " (ausgemustert)" : ""}
                </dd>
              </div>
            )}
            {!open && (
              <div>
                <dt>Entscheidung</dt>
                <dd>
                  {shown.decision_label || "–"}
                  {shown.closed_at ? ` · ${formatDate(shown.closed_at)}` : ""}
                </dd>
              </div>
            )}
          </dl>
          {canEdit && open && <DecisionForm key={shown.id} entry={shown} onDone={update} />}
          {canEdit && <NoteForm entry={shown} onDone={update} />}
        </div>
      </section>
      <EventPanel id="vorgang-verlauf" events={shown.events} />
    </>
  );
}

/** IT-Bestand › Vorgänge: Eingang für neue und fehlende Geräte aus NinjaOne. */
export function CasesPage({ caseId, roles }: { caseId: number | null; roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [filter, setFilter] = useState<CaseFilter>("offen");
  const [loaded, setLoaded] = useState<{ filter: CaseFilter; list: CaseList } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const list = loaded && loaded.filter === filter ? loaded.list : null;

  useEffect(() => {
    let active = true;
    fetchCases(filter).then(
      (result) => active && setLoaded({ filter, list: result }),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Vorgänge konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [filter, reload]);

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">IT-Bestand</p>
        <h1>Vorgänge</h1>
        <p className="page-sub">
          Eingang für alle Bearbeiter: neue Geräte aus NinjaOne und Geräte, die dort nicht mehr
          auftauchen.
        </p>
      </header>
      <SyncBar canEdit={canEdit} />
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      <div className="chips" role="group" aria-label="Status">
        {CASE_FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="chip chip-filter"
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
            {entry.id === "offen" && loaded ? ` (${loaded.list.open})` : ""}
          </button>
        ))}
      </div>
      <div className="case-layout">
        <nav className="panel case-list" aria-label="Vorgänge">
          {!list && !failed && <p role="status">Wird geladen …</p>}
          {list && list.cases.length === 0 && (
            <p className="empty">Keine Vorgänge in diesem Status.</p>
          )}
          {list && list.cases.length > 0 && (
            <ul>
              {list.cases.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="case-item"
                    aria-current={entry.id === caseId ? "true" : undefined}
                    onClick={() => navigate(casePath(entry.id))}
                  >
                    <span className="case-item-head">
                      <span className="mono">{entry.number}</span>
                      <span className={`pill ${CASE_STATES[entry.status].pill}`}>
                        {CASE_STATES[entry.status].label}
                      </span>
                    </span>
                    <strong>{entry.title}</strong>
                    <span className="small">
                      {entry.kind_label} · {formatDate(entry.created_at)}
                      {entry.assignee ? ` · ${entry.assignee}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="case-main">
          {caseId === null ? (
            <p className="panel panel-empty">Wähle links einen Vorgang.</p>
          ) : (
            <CaseDetail
              key={caseId}
              caseId={caseId}
              canEdit={canEdit}
              onChanged={() => setReload(reload + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
