import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FilterBar } from "../../components/FilterBar";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_IMPORT_PATH } from "../../navigation";
import {
  euroInput,
  fetchAccounts,
  fetchItems,
  fetchPartners,
  formatBudgetDay,
  formatEuro,
  parseEuro,
  type Account,
  type Item,
  type Partner,
} from "./api";
import {
  cancelImport,
  deleteImport,
  deleteRow,
  fetchImport,
  filterRows,
  IMPORT_STATUS_LABELS,
  nextOpenRow,
  percent,
  planCandidates,
  planRows,
  reopenRow,
  ROW_STATUS_LABELS,
  ROW_STATUS_PILLS,
  skipRow,
  takeRow,
  type ImportDetail,
  type ImportRow,
  type RowFilter,
  type TakeUpdate,
} from "./imports";
import { BudgetHead, DeleteButton } from "./shared";
import { navigate } from "../../router";

type PartnerChoice = "vorschlag" | "neu" | "andere";

interface EditorProps {
  detail: ImportDetail;
  row: ImportRow;
  accounts: Account[];
  items: Item[];
  partners: Partner[];
  onDone: (detail: ImportDetail, rowId: number, advance: boolean) => void;
}

/**
 * Eine Zeile prüfen: Partner, Bezeichnung, Konto, Betrag. Übernehmen legt einen eigenen
 * Budgetposten mit Partner an (Name aus der Bezeichnung), keine Rechnung.
 */
function RowEditor({ detail, row, accounts, items, partners, onDone }: EditorProps) {
  const id = useId();
  const accountOf = (number: string | null) =>
    accounts.find(
      (account) =>
        number !== null &&
        account.number.replace(/^0+/, "") === number.replace(/\s/g, "").replace(/^0+/, ""),
    );
  const suggested = row.partner_match !== "neu" && row.partner_id !== null;
  const [choice, setChoice] = useState<PartnerChoice>(suggested ? "vorschlag" : "neu");
  const [newName, setNewName] = useState(row.firm);
  const [otherId, setOtherId] = useState("");
  const [description, setDescription] = useState(row.description);
  const initialItem = items.find((item) => item.id === row.item_id);
  const [accountId, setAccountId] = useState(
    String(initialItem?.account_id ?? accountOf(row.account_number)?.id ?? ""),
  );
  const [gross, setGross] = useState(euroInput(row.gross_cents < 0 ? 0 : row.gross_cents));
  const [yearly, setYearly] = useState(row.yearly);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = row.status !== "offen";
  const grossCents = parseEuro(gross);
  // Stand nach dem Löschen der Zeile, für die Anzeige danach
  const removed = useRef<ImportDetail | null>(null);

  const onTake = (event: FormEvent) => {
    event.preventDefault();
    let problem: string | null = null;
    if (!accountId) {
      problem = "Bitte ein Konto wählen.";
    } else if (grossCents === null) {
      problem = "Der Betrag ist nicht lesbar. Bitte so eintragen: 1190,00";
    } else if (choice === "neu" && !newName.trim()) {
      problem = "Bitte einen Namen für den neuen Partner eintragen.";
    } else if (choice === "andere" && !otherId) {
      problem = "Bitte einen Partner wählen.";
    }
    if (problem !== null || grossCents === null) {
      setError(problem);
      return;
    }
    const update: TakeUpdate = {
      description: description.trim(),
      account_id: Number(accountId),
      gross_cents: grossCents,
      yearly,
    };
    if (choice === "neu") {
      update.new_partner = newName.trim();
    } else {
      update.partner_id = choice === "vorschlag" ? (row.partner_id ?? 0) : Number(otherId);
    }
    setBusy(true);
    setError(null);
    takeRow(detail.id, row.id, update)
      .then((result) => onDone(result, row.id, true))
      .catch((failure: unknown) => {
        setError(errorText(failure, "Die Zeile konnte nicht übernommen werden."));
        setBusy(false);
      });
  };

  const onSkip = () => {
    setBusy(true);
    skipRow(detail.id, row.id)
      .then((result) => onDone(result, row.id, true))
      .catch((failure: unknown) => {
        setError(errorText(failure, "Die Zeile konnte nicht übersprungen werden."));
        setBusy(false);
      });
  };

  const onReopen = () => {
    setBusy(true);
    reopenRow(detail.id, row.id)
      .then((result) => onDone(result, row.id, false))
      .catch((failure: unknown) => {
        setError(errorText(failure, "Die Zeile konnte nicht zurückgesetzt werden."));
        setBusy(false);
      });
  };

  const matchText =
    row.partner_match === "gefunden"
      ? `Partner „${row.partner_name}“ ist schon angelegt.`
      : row.partner_match === "entschieden"
        ? `Für diese Firma hast du „${row.partner_name}“ gewählt.`
        : `Ähnlicher Partner: „${row.partner_name}“ verwenden`;

  return (
    <form className="detail-body settings-form" onSubmit={onTake} noValidate>
      {row.hints.map((hint) => (
        <p key={hint} className="hint-box hint-warn">
          {hint}
        </p>
      ))}
      {done && (
        <p className="hint-box">
          {row.status === "uebernommen"
            ? "Diese Zeile ist als gebuchte Rechnung übernommen. Ändern oder löschen kannst du sie unter Rechnungen."
            : "Diese Zeile ist übersprungen."}
        </p>
      )}
      <fieldset className="budget-fieldset" disabled={done}>
        <legend>Rechnungssteller „{row.firm || "ohne Namen"}“</legend>
        {suggested && (
          <label className="check-label">
            <input
              type="radio"
              name={`${id}-partner`}
              checked={choice === "vorschlag"}
              onChange={() => setChoice("vorschlag")}
            />
            {matchText}
          </label>
        )}
        <label className="check-label">
          <input
            type="radio"
            name={`${id}-partner`}
            checked={choice === "neu"}
            onChange={() => setChoice("neu")}
          />
          Als neuen Partner anlegen
        </label>
        {choice === "neu" && (
          <label>
            Name des neuen Partners
            <input
              type="text"
              value={newName}
              maxLength={160}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
        )}
        <label className="check-label">
          <input
            type="radio"
            name={`${id}-partner`}
            checked={choice === "andere"}
            onChange={() => setChoice("andere")}
          />
          Anderen vorhandenen Partner wählen
        </label>
        {choice === "andere" && (
          <label>
            Partner
            <select value={otherId} onChange={(event) => setOtherId(event.target.value)}>
              <option value="">Bitte wählen</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="small">Die Entscheidung gilt auch für weitere Zeilen dieser Firma.</p>
      </fieldset>
      <fieldset className="budget-fieldset" disabled={done}>
        <legend>Budgetposten</legend>
        <p className="small">
          Aus der Datei:{" "}
          {[
            row.number || row.internal_number
              ? `Rechnung ${row.number || row.internal_number}`
              : "",
            row.internal_number && row.number ? `interne Nummer ${row.internal_number}` : "",
            row.invoice_date ? `vom ${formatBudgetDay(row.invoice_date)}` : "",
          ]
            .filter(Boolean)
            .join(", ") || "keine Rechnungsangaben"}
          . Das steht in der Notiz des Postens; eine Rechnung legt der Import nicht an.
        </p>
        <div className="form-grid">
          <label>
            Bezeichnung
            <input
              type="text"
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            Konto
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Bitte wählen</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.number} {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Erwartete Kosten brutto (Euro)
            <input
              type="text"
              inputMode="decimal"
              value={gross}
              onChange={(event) => setGross(event.target.value)}
            />
          </label>
        </div>
        <p className="small">
          {done
            ? `Budgetposten: ${row.item_name ?? "–"}`
            : `Übernehmen legt den Budgetposten „${description.trim() || "Name des Partners"}“ mit diesem Partner an, mit dem Betrag als erwarteten Kosten. Gibt es den Namen im Konto schon, bekommt er eine Nummer.`}
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={yearly}
            onChange={(event) => setYearly(event.target.checked)}
          />
          Jährlich (Vorschlag für die Planung des folgenden Jahres)
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <div className="budget-toolbar">
        {!done && (
          <>
            <button type="submit" className="button button-primary" disabled={busy}>
              Übernehmen und weiter
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={onSkip}
            >
              Überspringen
            </button>
          </>
        )}
        {row.status === "uebersprungen" && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onReopen}
          >
            Zurück auf offen
          </button>
        )}
        {row.status !== "uebernommen" && (
          <DeleteButton
            what={`Zeile ${row.row_number}`}
            disabled={busy}
            run={() =>
              deleteRow(detail.id, row.id).then((result) => {
                removed.current = result;
              })
            }
            onDeleted={() => {
              if (removed.current) {
                onDone(removed.current, row.id, true);
              }
            }}
          />
        )}
      </div>
    </form>
  );
}

function PlanPanel({
  detail,
  onDone,
}: {
  detail: ImportDetail;
  onDone: (d: ImportDetail) => void;
}) {
  const candidates = planCandidates(detail.rows_detail);
  const [chosen, setChosen] = useState<Record<number, boolean>>({});
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [ongoing, setOngoing] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const nextYear = detail.year + 1;
  const amountOf = (row: ImportRow) =>
    amounts[row.id] ?? euroInput(row.gross_cents < 0 ? 0 : row.gross_cents);

  const onPlan = () => {
    const picked = candidates.filter((row) => chosen[row.id]);
    if (picked.length === 0) {
      setMessage({ kind: "alert", text: "Bitte mindestens eine Zeile auswählen." });
      return;
    }
    const unreadable = picked.find((row) => parseEuro(amountOf(row)) === null);
    if (unreadable) {
      setMessage({
        kind: "alert",
        text: `Der Betrag in Zeile ${unreadable.row_number} ist nicht lesbar. Bitte so eintragen: 1190,00`,
      });
      return;
    }
    const entries = picked.map((row) => ({
      row_id: row.id,
      amount_cents: parseEuro(amountOf(row)) ?? 0,
      ongoing: ongoing[row.id] ?? true,
    }));
    setBusy(true);
    setMessage(null);
    planRows(detail.id, entries)
      .then((result) => {
        setMessage({
          kind: "status",
          text:
            result.extended === 1
              ? "1 Budgetposten läuft jetzt weiter."
              : `${result.extended} Budgetposten laufen jetzt weiter.`,
        });
        onDone(result.detail);
      })
      .catch((failure: unknown) =>
        setMessage({ kind: "alert", text: errorText(failure, "Das hat nicht geklappt.") }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="import-planung">
      <div className="panel-head">
        <h2 id="import-planung">Vorschläge für die Planung</h2>
      </div>
      <div className="detail-body">
        <p className="small">
          Übernommene Zeilen mit „Jährlich“. Der Budgetposten einer ausgewählten Zeile läuft im{" "}
          {detail.year_label} {nextYear} weiter, mit den eingetragenen Kosten je Jahr. Es entsteht
          kein zweiter Posten.
        </p>
      </div>
      {candidates.length === 0 ? (
        <p className="detail-body small">Keine offenen Vorschläge.</p>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Vorschläge">
          <table>
            <caption className="visually-hidden">Vorschläge für die Planung</caption>
            <thead>
              <tr>
                <th scope="col">Übernehmen</th>
                <th scope="col">Zeile</th>
                <th scope="col">Budgetposten</th>
                <th scope="col" className="betrag">
                  Erwartete Kosten je Jahr
                </th>
                <th scope="col">Laufzeit</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Zeile ${row.row_number} übernehmen`}
                      checked={chosen[row.id] ?? false}
                      onChange={(event) => setChosen({ ...chosen, [row.id]: event.target.checked })}
                    />
                  </td>
                  <th scope="row">
                    Zeile {row.row_number}
                    <span className="small tenant-part">{row.firm}</span>
                  </th>
                  <td>{row.item_name ?? row.description}</td>
                  <td className="betrag">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Erwartete Kosten je Jahr für Zeile ${row.row_number}`}
                      value={amountOf(row)}
                      onChange={(event) => setAmounts({ ...amounts, [row.id]: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Laufzeit für Zeile ${row.row_number}`}
                      value={(ongoing[row.id] ?? true) ? "offen" : "einmalig"}
                      onChange={(event) =>
                        setOngoing({ ...ongoing, [row.id]: event.target.value === "offen" })
                      }
                    >
                      <option value="offen">bis auf Weiteres</option>
                      <option value="einmalig">bis {nextYear}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="detail-body">
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {message.text}
          </p>
        )}
        {candidates.length > 0 && (
          <div className="budget-toolbar">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={onPlan}
            >
              Ausgewählte in die Planung übernehmen
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** IT-Budget › Import › Vorgang: Zeilen einzeln übernehmen oder überspringen. */
export function ImportDetailPage({ importId }: { importId: number }) {
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowFilter>("offen");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"zeilen" | "planung">("zeilen");
  const [cancelAsked, setCancelAsked] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([fetchImport(importId), fetchAccounts(), fetchItems(), fetchPartners()]).then(
      ([result, accountList, itemList, partnerList]) => {
        if (active) {
          setDetail(result);
          setAccounts(accountList.filter((account) => account.active));
          setItems(itemList);
          setPartners(partnerList.filter((partner) => partner.active));
        }
      },
      (error: unknown) =>
        active && setFailed(errorText(error, "Der Vorgang konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [importId, round]);

  const head = (
    <BudgetHead
      title={detail ? detail.file_name : "Import"}
      sub={
        detail
          ? `${detail.year_label} ${detail.year_name} · ${IMPORT_STATUS_LABELS[detail.status]}`
          : undefined
      }
    >
      <Link to={BUDGET_IMPORT_PATH}>Alle Vorgänge</Link>
    </BudgetHead>
  );

  if (failed) {
    return (
      <div className="page">
        {head}
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="page">
        {head}
        <p role="status">Wird geladen …</p>
      </div>
    );
  }

  const rows = detail.rows_detail;
  const shown = filterRows(rows, filter);
  const selected =
    rows.find((row) => row.id === selectedId) ?? shown[0] ?? nextOpenRow(rows, null) ?? rows[0];

  const onDone = (result: ImportDetail, rowId: number, advance: boolean) => {
    setDetail(result);
    if (advance) {
      setSelectedId(nextOpenRow(result.rows_detail, rowId)?.id ?? rowId);
    }
    // Neue Partner sollen in der Auswahl der nächsten Zeilen stehen.
    fetchPartners()
      .then((list) => setPartners(list.filter((partner) => partner.active)))
      .catch(() => undefined);
  };

  const done = detail.taken + detail.skipped;
  const candidates = planCandidates(rows).length;
  const canCancel = detail.status !== "abgebrochen" && detail.open + detail.skipped > 0;

  const onCancelImport = () => {
    setCancelBusy(true);
    setCancelError(null);
    cancelImport(detail.id)
      .then((result) => {
        setDetail(result);
        setCancelAsked(false);
      })
      .catch((failure: unknown) =>
        setCancelError(errorText(failure, "Der Import konnte nicht abgebrochen werden.")),
      )
      .finally(() => setCancelBusy(false));
  };

  return (
    <div className="page page-wide budget-page">
      {head}
      <section className="panel" aria-labelledby="import-stand">
        <div className="detail-body">
          <h2 id="import-stand" className="import-stand">
            {detail.taken} übernommen, {detail.skipped} übersprungen, {detail.open} offen
          </h2>
          {detail.status === "abgebrochen" && (
            <p className="hint-box">
              Der Import ist abgebrochen. Offene und übersprungene Zeilen sind gelöscht; die
              übernommenen Zeilen und ihre Budgetposten bleiben.
            </p>
          )}
          {canCancel && !cancelAsked && (
            <p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setCancelAsked(true)}
              >
                Import abbrechen
              </button>
            </p>
          )}
          {canCancel && cancelAsked && (
            <div className="confirm-box" role="group" aria-label="Import abbrechen">
              <p>
                {detail.open + detail.skipped} offene und übersprungene Zeilen werden gelöscht. Die{" "}
                {detail.taken} übernommenen Zeilen und ihre Budgetposten bleiben. Das lässt sich
                nicht rückgängig machen.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="button button-danger"
                  disabled={cancelBusy}
                  onClick={onCancelImport}
                >
                  Import wirklich abbrechen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={cancelBusy}
                  onClick={() => setCancelAsked(false)}
                >
                  Doch nicht
                </button>
              </div>
            </div>
          )}
          {cancelError && (
            <p role="alert" className="hint-box hint-bad">
              {cancelError}
            </p>
          )}
          <span
            className="import-progress import-progress-wide"
            role="img"
            aria-label={`${percent(done, detail.rows)} % erledigt`}
          >
            <span
              className="import-progress-taken"
              style={{ width: `${percent(detail.taken, detail.rows)}%` }}
            />
            <span
              className="import-progress-skipped"
              style={{ width: `${percent(detail.skipped, detail.rows)}%` }}
            />
          </span>
          <div className="chips" role="group" aria-label="Ansicht">
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={view === "zeilen"}
              onClick={() => setView("zeilen")}
            >
              Zeilen
            </button>
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={view === "planung"}
              onClick={() => setView("planung")}
            >
              Vorschläge für die Planung{candidates > 0 ? ` (${candidates})` : ""}
            </button>
          </div>
        </div>
      </section>

      {view === "planung" && <PlanPanel detail={detail} onDone={setDetail} />}

      {view === "zeilen" && (
        <div className="import-split">
          <aside className="import-aside" aria-label="Zeilen">
            <FilterBar
              plain
              status={{
                label: "Filter",
                value: filter,
                onChange: setFilter,
                options: [
                  { value: "offen", label: "Offen" },
                  { value: "hinweis", label: "Mit Hinweis" },
                  { value: "alle", label: "Alle" },
                ],
              }}
            />
            {shown.length === 0 ? (
              <p className="small">
                {filter === "offen"
                  ? "Alle Zeilen sind erledigt."
                  : "Keine Zeilen für diesen Filter."}
              </p>
            ) : (
              <ul className="import-rows">
                {shown.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={
                        row.id === selected?.id ? "import-row import-row-on" : "import-row"
                      }
                      aria-current={row.id === selected?.id ? "true" : undefined}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <span className="import-row-head">
                        <strong>
                          Zeile {row.row_number} · {row.firm || "ohne Firma"}
                        </strong>
                        <span className={ROW_STATUS_PILLS[row.status]}>
                          {ROW_STATUS_LABELS[row.status]}
                        </span>
                      </span>
                      <span className="small">
                        {row.description || "ohne Bezeichnung"} · {formatEuro(row.gross_cents)}
                        {row.invoice_date ? ` · ${formatBudgetDay(row.invoice_date)}` : ""}
                        {row.hints.length > 0 ? " · mit Hinweis" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
          {selected && (
            <section className="panel import-main" aria-labelledby="import-zeile">
              <div className="panel-head">
                <h2 id="import-zeile">
                  Zeile {selected.row_number}: {selected.description || selected.firm}
                </h2>
                <span className={ROW_STATUS_PILLS[selected.status]}>
                  {ROW_STATUS_LABELS[selected.status]}
                </span>
              </div>
              <RowEditor
                key={`${selected.id}-${selected.status}`}
                detail={detail}
                row={selected}
                accounts={accounts}
                items={items}
                partners={partners}
                onDone={onDone}
              />
            </section>
          )}
        </div>
      )}

      <section className="panel" aria-labelledby="import-loeschen">
        <div className="panel-head">
          <h2 id="import-loeschen">Vorgang löschen</h2>
        </div>
        <div className="detail-body">
          <p className="small">
            Löscht nur den Vorgang mit seinen Zeilen. Angelegte Konten, Partner und Budgetposten
            bleiben.
          </p>
          <DeleteButton
            what={`Vorgang ${detail.file_name}`}
            run={() => deleteImport(detail.id)}
            onDeleted={() => navigate(BUDGET_IMPORT_PATH)}
          />
        </div>
      </section>
      <p className="small">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setRound(round + 1)}
        >
          Neu laden
        </button>
      </p>
    </div>
  );
}
