import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { FilterBar } from "../../components/FilterBar";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { INVENTORY_LOANS_PATH } from "../../navigation";
import { navigate } from "../../router";
import { MoreButton, useDebounced, usePagedList } from "./paged";
import { PersonPicker } from "./PersonPicker";
import {
  casePath,
  CASE_KIND_SHORT,
  CASE_STATES,
  changeLoanDue,
  createLoan,
  daysFrom,
  fetchLoan,
  fetchLoanable,
  fetchLoans,
  filterLoanable,
  formatDate,
  formatDay,
  hardwarePath,
  INVENTORY_EDITOR_ROLE,
  LOAN_FILTERS,
  LOAN_STATES,
  loanPath,
  MESSAGE_STATES,
  returnLoanItems,
  today,
  type Loan,
  type LoanableDevice,
  type LoanFilter,
  type LoanSummary,
  type Person,
} from "./api";
import { Feedback } from "../../components/Feedback";

function ErrorText({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="hint-box hint-bad">
      {text}
    </p>
  ) : null;
}

/** Neuer Verleih: Person aus Entra, Rückgabedatum und ein oder mehrere Geräte. */
function NewLoanForm({ onCreated }: { onCreated: (loan: Loan) => void }) {
  const searchId = useId();
  const startId = useId();
  const start = today();
  const [person, setPerson] = useState<Person | null>(null);
  const [startOn, setStartOn] = useState(start);
  const [dueOn, setDueOn] = useState(daysFrom(start, 14));
  const [note, setNote] = useState("");
  const [devices, setDevices] = useState<LoanableDevice[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLoanable().then(
      (result) => active && setDevices(result),
      (problem: unknown) =>
        active && setError(errorText(problem, "Die Geräte konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const toggle = (id: number) =>
    setPicked(picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!person) {
      setError("Bitte wähle die Person, die ausleiht.");
      return;
    }
    if (!startOn || startOn < start) {
      setError("Bitte wähle ein Startdatum ab heute.");
      return;
    }
    if (!dueOn || dueOn < startOn) {
      setError("Bitte wähle ein Rückgabedatum ab dem Startdatum.");
      return;
    }
    if (picked.length === 0) {
      setError("Bitte wähle mindestens ein Gerät.");
      return;
    }
    setBusy(true);
    setError(null);
    createLoan({
      person: { oid: person.oid },
      start_on: startOn,
      due_on: dueOn,
      hardware_ids: picked,
      note,
    }).then(onCreated, (problem: unknown) => {
      setError(errorText(problem, "Der Verleih konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  const shown = devices ? filterLoanable(devices, query) : [];
  return (
    <section className="panel" aria-labelledby="verleih-neu">
      <div className="panel-head">
        <h2 id="verleih-neu">Neuer Verleih</h2>
      </div>
      <form className="detail-body settings-form form-stack" onSubmit={onSubmit} noValidate>
        <PersonPicker
          value={person}
          onChange={setPerson}
          label="Wer leiht aus? (Person aus Entra)"
        />
        <div className="tool-row">
          <div className="field-info">
            <span className="field-info-head">
              <label htmlFor={startId}>Ab</label>
              <InfoTip term="bestand.verleih-start" />
            </span>
            <input
              id={startId}
              type="date"
              value={startOn}
              min={start}
              onChange={(event) => {
                const next = event.target.value;
                setStartOn(next);
                if (next && dueOn < next) {
                  setDueOn(daysFrom(next, 14));
                }
              }}
            />
          </div>
          <label>
            Rückgabe bis
            <input
              type="date"
              value={dueOn}
              min={startOn || start}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </label>
        </div>
        {startOn > start && (
          <p className="hint-box">
            Vorab geplant: Die Geräte sind ab jetzt reserviert. Die Nachricht an die Person geht am{" "}
            {formatDay(startOn)} raus.
          </p>
        )}
        <fieldset className="seg-field">
          <legend>Geräte ({picked.length} gewählt)</legend>
          <label htmlFor={searchId}>Geräte durchsuchen</label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="Name, Art, Seriennummer oder Inventurnummer"
            onChange={(event) => setQuery(event.target.value)}
          />
          {!devices && !error && <p role="status">Geräte werden geladen …</p>}
          {devices && devices.length === 0 && (
            <p className="empty">
              Kein Gerät frei. Verleihen kannst du Geräte, die keiner Stelle und keinem Arbeitsplatz
              zugeordnet und nicht schon verliehen sind.
            </p>
          )}
          {devices && devices.length > 0 && (
            <ul className="link-list">
              {shown.map((item) => (
                <li key={item.id}>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      className="check"
                      checked={picked.includes(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span>
                      {item.name} <span className="small">({item.kind})</span>
                      {item.serial && <span className="small mono"> · SN {item.serial}</span>}
                      {item.inventory_no && (
                        <span className="small mono"> · {item.inventory_no}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="small">Kein Gerät passt zur Suche.</li>}
            </ul>
          )}
        </fieldset>
        <label>
          Notiz (freiwillig)
          <input
            type="text"
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p className="small">
          Die Person bekommt per Mail und Teams eine Nachricht mit Verleihnummer und Rückgabedatum,
          zwei Tage vorher eine Erinnerung und bei Verspätung eine Mahnung. Gerätedaten stehen nicht
          darin.
        </p>
        <ErrorText text={error} />
        <div className="project-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Verleihen
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate(INVENTORY_LOANS_PATH)}
          >
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

/** Ein Verleih: Geräte mit Rückgabe, Rückgabedatum, Vorgänge und Nachrichten. */
function LoanDetail({
  loanId,
  canEdit,
  onChanged,
}: {
  loanId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [loan, setLoan] = useState<Loan | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [dueOn, setDueOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLoan(loanId).then(
      (result) => {
        if (active) {
          setLoan(result);
          setDueOn(result.due_on);
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Der Verleih konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [loanId]);

  if (failed) {
    return <ErrorText text={failed} />;
  }
  if (!loan || loan.id !== loanId) {
    return <p role="status">Wird geladen …</p>;
  }

  const update = (next: Loan, text: string) => {
    setLoan(next);
    setDueOn(next.due_on);
    setPicked([]);
    setError(null);
    setNotice(text);
    setBusy(false);
    onChanged();
  };
  const fail = (problem: unknown) => {
    setError(errorText(problem, "Das hat nicht geklappt."));
    setBusy(false);
  };
  const open = loan.state !== "zurueck";
  const openItems = loan.entries.filter((item) => item.returned_on === null);

  const onReturn = (event: FormEvent) => {
    event.preventDefault();
    if (picked.length === 0) {
      setError("Bitte wähle die Geräte, die zurück sind.");
      return;
    }
    setBusy(true);
    returnLoanItems(loan.id, picked).then(
      (next) =>
        update(
          next,
          next.state === "zurueck"
            ? "Alles zurück. Ein Vorgang zum Prüfen ist angelegt."
            : "Rückgabe eingetragen. Ein Vorgang zum Prüfen ist angelegt.",
        ),
      fail,
    );
  };

  const onDue = (event: FormEvent) => {
    event.preventDefault();
    if (!dueOn || dueOn < today() || dueOn < loan.issued_on) {
      setError("Bitte wähle ein Rückgabedatum ab heute und ab dem Startdatum.");
      return;
    }
    setBusy(true);
    changeLoanDue(loan.id, dueOn).then(
      (next) => update(next, "Das Rückgabedatum ist geändert."),
      fail,
    );
  };

  return (
    <>
      <section className="panel" aria-labelledby="verleih-titel">
        <div className="panel-head case-head">
          <div>
            <p className="small">
              <span className="mono">{loan.number}</span> ·{" "}
              {loan.state === "geplant" ? "geplant ab" : "ausgegeben am"}{" "}
              {formatDay(loan.issued_on)}
            </p>
            <h2 id="verleih-titel">{loan.person_name}</h2>
            <p className="small">
              <span className={`pill ${LOAN_STATES[loan.state].pill}`}>
                {LOAN_STATES[loan.state].label}
              </span>{" "}
              {loan.returned_on
                ? `zurück am ${formatDay(loan.returned_on)}`
                : `Rückgabe bis ${formatDay(loan.due_on)}`}
            </p>
          </div>
        </div>
        <div className="detail-body">
          <Feedback
            message={notice ? { kind: "status", text: notice } : null}
            onClose={() => setNotice(null)}
          />
          {!loan.has_address && (
            <p className="hint-box hint-warn">
              In Entra ist für diese Person keine Mailadresse eingetragen. Nachrichten gehen deshalb
              nicht raus.
            </p>
          )}
          <dl className="facts">
            <div>
              <dt>Anmeldename</dt>
              <dd className="mono">{loan.person_upn || "–"}</dd>
            </div>
            {loan.note && (
              <div>
                <dt>Notiz</dt>
                <dd>{loan.note}</dd>
              </div>
            )}
          </dl>
          <form onSubmit={onReturn} noValidate className="form-stack">
            <fieldset className="seg-field">
              <legend>Geräte</legend>
              <ul className="link-list">
                {loan.entries.map((item) => (
                  <li key={item.hardware_id}>
                    {canEdit && item.returned_on === null ? (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          className="check"
                          checked={picked.includes(item.hardware_id)}
                          onChange={() =>
                            setPicked(
                              picked.includes(item.hardware_id)
                                ? picked.filter((id) => id !== item.hardware_id)
                                : [...picked, item.hardware_id],
                            )
                          }
                        />
                        <span>
                          {item.name} <span className="small">({item.kind})</span>
                        </span>
                      </label>
                    ) : (
                      <span>
                        {item.name} <span className="small">({item.kind})</span>
                      </span>
                    )}{" "}
                    <Link to={hardwarePath(item.hardware_id)}>Gerät öffnen</Link>
                    {item.serial && <span className="small mono"> · SN {item.serial}</span>}
                    {item.returned_on && (
                      <span className="small"> · zurück am {formatDay(item.returned_on)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </fieldset>
            {canEdit && openItems.length > 0 && (
              <div className="project-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setPicked(openItems.map((item) => item.hardware_id))}
                >
                  Alle wählen
                </button>
                {loan.state === "geplant" ? (
                  <ConfirmButton
                    className="button button-primary"
                    disabled={busy || picked.length === 0}
                    confirm={{
                      title: "Reservierung aufheben?",
                      text: "Die gewählten Geräte sind danach wieder frei. Die Person bekommt keine Nachricht, weil der Verleih noch nicht begonnen hat.",
                      action: "Aufheben",
                    }}
                    onConfirm={() =>
                      returnLoanItems(loan.id, picked).then(
                        (next) =>
                          update(
                            next,
                            next.state === "zurueck"
                              ? "Die Reservierung ist aufgehoben."
                              : "Die gewählten Geräte sind wieder frei.",
                          ),
                        fail,
                      )
                    }
                  >
                    Reservierung aufheben
                  </ConfirmButton>
                ) : (
                  <button type="submit" className="button button-primary" disabled={busy}>
                    Rückgabe eintragen
                  </button>
                )}
              </div>
            )}
          </form>
          {canEdit && open && (
            <form onSubmit={onDue} noValidate className="tool-row">
              <label>
                Rückgabe bis
                <input
                  type="date"
                  value={dueOn}
                  min={loan.issued_on > today() ? loan.issued_on : today()}
                  onChange={(event) => setDueOn(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="button button-secondary"
                disabled={busy || dueOn === loan.due_on}
              >
                Datum ändern
              </button>
            </form>
          )}
          <ErrorText text={error} />
          {loan.cases.length > 0 && (
            <>
              <h3 className="sub-head">Vorgänge</h3>
              <ul className="link-list">
                {loan.cases.map((entry) => (
                  <li key={entry.id}>
                    <Link to={casePath(entry.id)}>
                      {entry.number} · {CASE_KIND_SHORT[entry.kind]}
                    </Link>{" "}
                    <span className={`pill ${CASE_STATES[entry.status].pill}`}>
                      {CASE_STATES[entry.status].label}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      <section className="panel" aria-labelledby="verleih-nachrichten">
        <div className="panel-head">
          <h2 id="verleih-nachrichten">Nachrichten an die Person</h2>
        </div>
        <div className="detail-body">
          {loan.messages.length === 0 ? (
            <p className="empty">Noch keine Nachrichten.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Anlass</th>
                    <th scope="col">Weg</th>
                    <th scope="col">Stand</th>
                    <th scope="col">Zeit</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.messages.map((message, index) => (
                    <tr key={`${message.kind}-${message.channel}-${index}`}>
                      <td>{message.kind_label}</td>
                      <td>{message.channel === "mail" ? "Mail" : "Teams"}</td>
                      <td>{MESSAGE_STATES[message.status]}</td>
                      <td>{formatDate(message.sent_at ?? message.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** IT-Bestand › Verleih: ausgeliehene Geräte, Rückgaben und neue Verleihe. */
export function LoansPage({
  loanId,
  roles,
}: {
  loanId: number | "neu" | null;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [filter, setFilter] = useState<LoanFilter>("offen");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const paged = usePagedList<LoanSummary, { open: number; overdue: number }>(
    `${filter}|${query}`,
    reload,
    (offset, limit) =>
      fetchLoans(filter, query, offset, limit).then((result) => ({
        items: result.loans,
        total: result.total,
        extra: { open: result.open, overdue: result.overdue },
      })),
    "Die Verleihe konnten nicht geladen werden.",
  );
  const failed = paged.error;
  const loans = paged.items;
  const counts = paged.extra;

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Verleih</h1>
          <p className="page-sub">
            Geräte, die Personen ausgeliehen haben, mit Rückgabedatum und Erinnerungen.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => navigate(loanPath("neu"))}
          >
            Neuer Verleih
          </button>
        )}
      </header>
      <ErrorText text={failed} />
      <div className={loanId === null ? "case-layout" : "case-layout case-layout-detail"}>
        <nav className="panel case-list" aria-label="Verleihe">
          <div className="case-filters">
            <FilterBar
              plain
              search={{
                label: "Verleihe durchsuchen",
                value: search,
                placeholder: "Nummer, Person, Gerät, Seriennummer …",
                onChange: setSearch,
              }}
              status={{
                label: "Status",
                value: filter,
                onChange: setFilter,
                options: LOAN_FILTERS.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  count:
                    entry.id === "offen" && counts
                      ? counts.open
                      : entry.id === "ueberfaellig" && counts
                        ? counts.overdue
                        : null,
                })),
              }}
            />
          </div>
          <div className="case-scroll">
            {!loans && !failed && <p role="status">Wird geladen …</p>}
            {loans && loans.length === 0 && (
              <p className="empty">
                {query.trim() ? "Kein Verleih passt zur Suche." : "Keine Verleihe in dieser Liste."}
              </p>
            )}
            {loans && loans.length > 0 && (
              <ul>
                {loans.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="case-item"
                      aria-current={entry.id === loanId ? "true" : undefined}
                      onClick={() => navigate(loanPath(entry.id))}
                    >
                      <span className="case-item-head">
                        <span className="mono">{entry.number}</span>
                        <span className={`pill ${LOAN_STATES[entry.state].pill}`}>
                          {LOAN_STATES[entry.state].label}
                        </span>
                      </span>
                      <strong>{entry.person_name}</strong>
                      <span className="small">
                        {entry.items === 1 ? "1 Gerät" : `${entry.items} Geräte`}
                        {entry.items_open > 0 && entry.items_open < entry.items
                          ? `, ${entry.items_open} noch aus`
                          : ""}{" "}
                        ·{" "}
                        {entry.returned_on
                          ? `zurück am ${formatDay(entry.returned_on)}`
                          : `bis ${formatDay(entry.due_on)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {loans && (
              <MoreButton
                shown={loans.length}
                total={paged.total}
                loading={paged.loadingMore}
                onMore={paged.more}
              />
            )}
          </div>
        </nav>
        <div className="case-main">
          {loanId !== null && (
            <a
              className="case-back"
              href={INVENTORY_LOANS_PATH}
              onClick={(event) => {
                event.preventDefault();
                navigate(INVENTORY_LOANS_PATH);
              }}
            >
              ‹ Zur Liste
            </a>
          )}
          {loanId === "neu" && canEdit ? (
            <NewLoanForm
              onCreated={(loan) => {
                setReload(reload + 1);
                navigate(loanPath(loan.id));
              }}
            />
          ) : loanId === null || loanId === "neu" ? (
            <p className="panel panel-empty">Wähle links einen Verleih.</p>
          ) : (
            <LoanDetail
              key={loanId}
              loanId={loanId}
              canEdit={canEdit}
              onChanged={() => setReload(reload + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
