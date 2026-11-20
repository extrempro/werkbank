import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { INVENTORY_CASES_PATH as CASES_PATH } from "../../navigation";
import { navigate } from "../../router";
import { LookupPicker } from "./LookupPicker";
import { MoreButton, useDebounced, usePagedList } from "./paged";
import { EventPanel } from "./parts";
import { PersonPicker } from "./PersonPicker";
import {
  addCaseNote,
  CASE_FILTERS,
  CASE_KIND_SHORT,
  CASE_STATES,
  casePath,
  decideCase,
  decisionOptions,
  fetchCase,
  fetchCases,
  fetchSyncStatus,
  formatDate,
  formatDay,
  hardwarePath,
  INVENTORY_EDITOR_ROLE,
  loanPath,
  positionPath,
  ninjaFactRows,
  runSyncNow,
  setCaseStatus,
  takeCase,
  today,
  type Case,
  type CaseFilter,
  type CaseKind,
  type CaseSummary,
  type Person,
  type DecisionInput,
  type LookupItem,
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
      <p className="sync-bar small">
        Der Abgleich mit NinjaOne ist ausgeschaltet. Einschalten kann ihn ein Admin in der
        Verwaltung unter „Verbindungen“.
      </p>
    );
  }
  const last = status.last_run;
  return (
    <div className="sync-bar">
      <p className="small">
        {last ? (
          <>
            NinjaOne: zuletzt {formatMoment(last.started_at)}
            {last.status === "ok"
              ? ` · ${last.devices} Geräte, ${last.new_cases} neu, ${last.missing_cases} fehlen`
              : ""}
          </>
        ) : (
          "Noch kein Abgleich mit NinjaOne."
        )}
        {status.next_run_at && (
          <span className="sync-next"> · nächster: {formatMoment(status.next_run_at)}</span>
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

/** Entscheidung für einen offenen Vorgang; Zusatzfelder je nach Auswahl. */
function DecisionForm({ entry, onDone }: { entry: Case; onDone: (next: Case) => void }) {
  const options = decisionOptions(entry);
  const [choice, setChoice] = useState("");
  // Gewählte Stelle, Arbeitsplatz, Raum oder Gerät (Auswahl mit Suche)
  const [target, setTarget] = useState<LookupItem | null>(null);
  const [dueOn, setDueOn] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        body.position_id = target.id;
      } else if (choice === "arbeitsplatz") {
        body.workplace_id = target.id;
      } else {
        body.hardware_id = target.id;
      }
    }
    if (choice === "lager" && target) {
      body.room_id = target.id;
    }
    if (choice === "nachfolge") {
      if (!person) {
        setError("Bitte die neue Person wählen.");
        return;
      }
      body.person_oid = person.oid;
    }
    if (choice === "verlaengert") {
      if (!dueOn || dueOn < today()) {
        setError("Bitte ein neues Rückgabedatum ab heute wählen.");
        return;
      }
      body.due_on = dueOn;
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
      const hint = entry.hint;
      setTarget({
        id: hint.id,
        label: hint.name,
        detail: [hint.hostname, hint.serial ? `SN ${hint.serial}` : ""].filter(Boolean).join(" · "),
      });
    } else if (id === "arbeitsplatz" && entry.kind === "monitor" && suggested) {
      setTarget({
        id: suggested,
        label: `Arbeitsplatz von ${entry.facts.host ?? "dem Rechner"}`,
        detail: "Vorschlag: dort steht der Rechner, an dem der Monitor hängt",
      });
    } else {
      setTarget(null);
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
              : entry.kind === "person_inaktiv"
                ? "Wie geht es weiter?"
                : entry.kind === "rueckgabe"
                  ? "Wie sind die Geräte zurückgekommen?"
                  : entry.kind === "ueberfaellig"
                    ? "Wie geht es mit dem Verleih weiter?"
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
      {choice === "stelle" && (
        <LookupPicker
          kind="position"
          label="Stelle"
          placeholder="Nummer, Stelle, Person oder Abteilung …"
          value={target}
          onChange={setTarget}
        />
      )}
      {choice === "arbeitsplatz" && (
        <LookupPicker
          kind="workplace"
          label="Arbeitsplatz"
          placeholder="Nummer, Raum oder Person …"
          value={target}
          onChange={setTarget}
        />
      )}
      {choice === "lager" && (
        <LookupPicker
          kind="room"
          label="Raum (freiwillig)"
          placeholder="Raum, Etage oder Standort …"
          value={target}
          onChange={setTarget}
        />
      )}
      {choice === "nachfolge" && (
        <PersonPicker value={person} onChange={setPerson} label="Neue Person (aus Entra)" />
      )}
      {choice === "verlaengert" && (
        <label>
          Neues Rückgabedatum
          <input
            type="date"
            value={dueOn}
            min={today()}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </label>
      )}
      {choice === "gleich" && (
        <LookupPicker
          kind="hardware"
          computers
          label="Vorhandenes Gerät"
          placeholder="Name, Hostname, Seriennummer oder Inventurnummer …"
          value={target}
          onChange={setTarget}
        />
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
  onClose,
}: {
  caseId: number;
  canEdit: boolean;
  onChanged: () => void;
  onClose: () => void;
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
          <button
            type="button"
            className="button button-secondary case-close"
            aria-label="Ansicht schließen"
            onClick={onClose}
          >
            ×
          </button>
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
          {(shown.kind === "rueckgabe" ||
            shown.kind === "ueberfaellig" ||
            shown.kind === "person_inaktiv") && (
            <>
              <h3 className="sub-head">
                {shown.kind === "person_inaktiv" ? "Person und Zuordnung" : "Verleih"}
              </h3>
              <dl className="facts">
                {shown.kind === "person_inaktiv" && shown.facts.reason && (
                  <div>
                    <dt>Konto in Entra</dt>
                    <dd>
                      {shown.facts.reason === "geloescht" ? "nicht mehr vorhanden" : "deaktiviert"}
                    </dd>
                  </div>
                )}
                {shown.kind === "person_inaktiv" && shown.facts.upn && (
                  <div>
                    <dt>Anmeldename</dt>
                    <dd className="mono">{shown.facts.upn}</dd>
                  </div>
                )}
                {shown.facts.position_id !== undefined && (
                  <div>
                    <dt>Stelle</dt>
                    <dd>
                      <Link to={positionPath(shown.facts.position_id)}>
                        {shown.facts.position_number} {shown.facts.position_name}
                      </Link>
                    </dd>
                  </div>
                )}
                {shown.facts.loan_id !== undefined && (
                  <div>
                    <dt>Verleih</dt>
                    <dd>
                      <Link to={loanPath(shown.facts.loan_id)}>
                        {shown.facts.loan_number ?? "öffnen"}
                      </Link>
                    </dd>
                  </div>
                )}
                {shown.facts.person && (
                  <div>
                    <dt>Person</dt>
                    <dd>{shown.facts.person}</dd>
                  </div>
                )}
                {shown.facts.due_on && (
                  <div>
                    <dt>Rückgabe war bis</dt>
                    <dd>{formatDay(shown.facts.due_on)}</dd>
                  </div>
                )}
                {shown.facts.devices && shown.facts.devices.length > 0 && (
                  <div>
                    <dt>Zurückgegeben</dt>
                    <dd>{shown.facts.devices.join(", ")}</dd>
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
            </>
          )}
          {shown.kind !== "rueckgabe" &&
            shown.kind !== "ueberfaellig" &&
            shown.kind !== "person_inaktiv" && (
              <>
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
              </>
            )}
          {canEdit && open && <DecisionForm key={shown.id} entry={shown} onDone={update} />}
          {canEdit && <NoteForm entry={shown} onDone={update} />}
        </div>
      </section>
      <EventPanel id="vorgang-verlauf" events={shown.events} />
    </>
  );
}

/** Zeile der Vorgangstabelle. Die ganze Zeile ist anklickbar, für Tastatur und Screenreader
 *  zählt der Verweis im Titel. */
function CaseRow({ entry, selected }: { entry: CaseSummary; selected: boolean }) {
  const path = casePath(entry.id);
  const open = () => navigate(path);
  return (
    <tr
      className={selected ? "case-row is-selected" : "case-row"}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a")) {
          open();
        }
      }}
    >
      <td className="col-nr mono nowrap">{entry.number}</td>
      <td className="case-title-cell">
        <span className="case-meta small">
          <span className="mono">{entry.number}</span> · {entry.kind_label} ·{" "}
          {formatDate(entry.created_at)}
        </span>
        <a
          href={path}
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
            if (event.button !== 0 || modified) {
              return;
            }
            event.preventDefault();
            open();
          }}
        >
          {entry.title}
        </a>
      </td>
      <td className="col-extra nowrap">{entry.kind_label}</td>
      <td className="col-extra nowrap">{formatDate(entry.created_at)}</td>
      <td className="col-extra">{entry.assignee ?? "–"}</td>
      <td className="nowrap">
        <span className={`pill ${CASE_STATES[entry.status].pill}`}>
          {CASE_STATES[entry.status].label}
        </span>
      </td>
    </tr>
  );
}

/** IT-Bestand › Vorgänge: Eingang für neue und fehlende Geräte aus NinjaOne.
 *  Breit: Tabelle über die ganze Breite, ein gewählter Vorgang öffnet rechts daneben.
 *  Schmal: erst die Liste, gewählt nur die Ansicht mit „Zur Liste“. */
export function CasesPage({ caseId, roles }: { caseId: number | null; roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [filter, setFilter] = useState<CaseFilter>("offen");
  const [kind, setKind] = useState<CaseKind | "alle">("alle");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const searchId = useId();
  const paged = usePagedList<CaseSummary, { open: number }>(
    `${filter}|${kind}|${query}`,
    reload,
    (offset, limit) =>
      fetchCases(filter, query, offset, limit, kind).then((result) => ({
        items: result.cases,
        total: result.total,
        extra: { open: result.open },
      })),
    "Die Vorgänge konnten nicht geladen werden.",
  );
  const failed = paged.error;
  const cases = paged.items;
  const openCount = paged.extra ? paged.extra.open : null;
  const backToList = () => navigate(CASES_PATH);

  return (
    <div className="page page-wide case-page">
      <header className="page-head case-top">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Vorgänge</h1>
        </div>
        {openCount !== null && <p className="case-count small">{openCount} offen</p>}
        <SyncBar canEdit={canEdit} />
      </header>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      <div className="panel case-toolbar">
        <div className="case-search">
          <label htmlFor={searchId} className="visually-hidden">
            Vorgänge durchsuchen
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            maxLength={100}
            placeholder="Nummer, Titel, Gerät, Seriennummer …"
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
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
              {entry.id === "offen" && openCount !== null ? ` (${openCount})` : ""}
            </button>
          ))}
        </div>
        <label className="case-kind">
          <span className="case-kind-label">Art</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CaseKind | "alle")}
          >
            <option value="alle">Alle Arten</option>
            {(Object.keys(CASE_KIND_SHORT) as CaseKind[]).map((key) => (
              <option key={key} value={key}>
                {CASE_KIND_SHORT[key]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className={
          caseId === null
            ? "case-layout case-layout-table"
            : "case-layout case-layout-table case-layout-detail"
        }
      >
        <div className="panel case-list">
          <div className="case-scroll">
            {!cases && !failed && <p role="status">Wird geladen …</p>}
            {cases && cases.length === 0 && (
              <p className="empty">
                {query.trim()
                  ? "Kein Vorgang passt zur Suche."
                  : "Keine Vorgänge in diesem Status."}
              </p>
            )}
            {cases && cases.length > 0 && (
              <table className="case-table" aria-label="Vorgänge">
                <thead>
                  <tr>
                    <th scope="col" className="col-nr">
                      Nr.
                    </th>
                    <th scope="col">Titel</th>
                    <th scope="col" className="col-extra">
                      Art
                    </th>
                    <th scope="col" className="col-extra">
                      Eingang
                    </th>
                    <th scope="col" className="col-extra">
                      Bearbeitet von
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((entry) => (
                    <CaseRow key={entry.id} entry={entry} selected={entry.id === caseId} />
                  ))}
                </tbody>
              </table>
            )}
            {cases && (
              <MoreButton
                shown={cases.length}
                total={paged.total}
                loading={paged.loadingMore}
                onMore={paged.more}
              />
            )}
          </div>
        </div>
        <div className="case-main">
          {caseId !== null && (
            <>
              <a
                className="case-back"
                href={CASES_PATH}
                onClick={(event) => {
                  event.preventDefault();
                  backToList();
                }}
              >
                ‹ Zur Liste
              </a>
              <CaseDetail
                key={caseId}
                caseId={caseId}
                canEdit={canEdit}
                onChanged={() => setReload(reload + 1)}
                onClose={backToList}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
