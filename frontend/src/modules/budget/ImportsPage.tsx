import { useEffect, useState, type ChangeEvent } from "react";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { FilterBar } from "../../components/FilterBar";
import { errorText, formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import { navigate } from "../../router";
import { formatEuro, type AccountKind } from "./api";
import {
  deleteImport,
  fetchImport,
  fetchImports,
  FILE_MAX_MB,
  IMPORT_STATUS_LABELS,
  importPath,
  percent,
  startImport,
  uploadImport,
  type ImportDetail,
  type ImportStatus,
  type ImportSummary,
} from "./imports";
import { BudgetHead } from "./shared";
import { Feedback } from "../../components/Feedback";
import { ShowMore, useShowMore } from "../../components/ShowMore";

/** So viele Vorgänge stehen zuerst da; ältere mit „Weitere anzeigen“. */
const IMPORTS_STEP = 20;

type View = "arbeit" | "fertig" | "alle";

const PILLS: Record<ImportStatus, string> = {
  entwurf: "pill pill-neutral",
  offen: "pill pill-todo",
  abgeschlossen: "pill pill-ok",
  abgebrochen: "pill pill-neutral",
};

/** Schritt 2: Was die Werkbank in der Datei erkannt hat; mit „Vorgang anlegen“ geht es los. */
function DraftReview({ draft, onCancel }: { draft: ImportDetail; onCancel: () => void }) {
  const [year, setYear] = useState(draft.year);
  const [kinds, setKinds] = useState<Record<string, AccountKind>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const years = [draft.year - 2, draft.year - 1, draft.year, draft.year + 1];

  const onStart = () => {
    setBusy(true);
    setError(null);
    startImport(draft.id, year, draft.tax_rate_bp, kinds)
      .then((result) => navigate(importPath(result.id)))
      .catch((problem: unknown) => {
        setError(errorText(problem, "Der Vorgang konnte nicht angelegt werden."));
        setBusy(false);
      });
  };

  const onDiscard = () =>
    deleteImport(draft.id)
      .then(onCancel)
      .catch(() => onCancel());

  return (
    <section className="panel" aria-labelledby="import-pruefen">
      <div className="panel-head">
        <h2 id="import-pruefen">Erkanntes prüfen: {draft.file_name}</h2>
      </div>
      <div className="detail-body settings-form">
        <div className="form-grid">
          <label>
            {draft.year_label}
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === draft.year ? `${entry} (aus der Datei erkannt)` : entry}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="small">
          Die Beträge in der Datei sind brutto. Jede übernommene Zeile wird ein Budgetposten mit
          Partner; Rechnungen legt der Import nicht an.
        </p>
        <dl className="kpis">
          <div className="kpi">
            <dt>Zeilen mit Betrag</dt>
            <dd>
              <span className="kpi-number">{draft.rows}</span>
              {draft.skipped_rows > 0 && (
                <span className="small">{draft.skipped_rows} Zeilen ohne Betrag übergangen</span>
              )}
            </dd>
          </div>
          <div className="kpi">
            <dt>Firmen</dt>
            <dd>
              <span className="kpi-number">{draft.firms}</span>
              <span className="small">{draft.new_firms} noch nicht als Partner</span>
            </dd>
          </div>
          <div className="kpi">
            <dt>Mit Hinweis</dt>
            <dd>
              <span className="kpi-number">{draft.hints}</span>
            </dd>
          </div>
        </dl>
      </div>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Konten und Budget">
        <table>
          <caption className="visually-hidden">Konten aus der Datei</caption>
          <thead>
            <tr>
              <th scope="col">Konto</th>
              <th scope="col">Bezeichnung</th>
              <th scope="col">In der Werkbank</th>
              <th scope="col" className="betrag">
                Budget laut Datei
              </th>
              <th scope="col">Zeilen</th>
            </tr>
          </thead>
          <tbody>
            {draft.accounts.map((account) => (
              <tr key={account.number}>
                <th scope="row" className="mono">
                  {account.number}
                </th>
                <td>{account.name}</td>
                <td>
                  {account.account_id ? (
                    <span className="pill pill-ok">vorhanden</span>
                  ) : (
                    <label className="import-kind">
                      <span className="pill pill-todo">neu anlegen als</span>
                      <select
                        aria-label={`Art des Kontos ${account.number}`}
                        value={kinds[account.number] ?? "laufend"}
                        onChange={(event) =>
                          setKinds({
                            ...kinds,
                            [account.number]: event.target.value as AccountKind,
                          })
                        }
                      >
                        <option value="laufend">laufende Kosten</option>
                        <option value="investition">Investition</option>
                      </select>
                    </label>
                  )}
                </td>
                <td className="betrag">
                  {account.budget_cents === null ? "–" : formatEuro(account.budget_cents)}
                </td>
                <td>{account.rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="detail-body">
        <p className="hint-box">
          Fehlende Konten legt der Import an. Budgetposten entstehen erst beim Übernehmen: je Zeile
          ein eigener Posten mit dem Betrag als erwarteten Kosten. Das Budget je Konto aus der Datei
          wird nicht übernommen. Die Spalten „Kostenstelle“ und „Projekte“ werden nicht übernommen.
        </p>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        <div className="budget-toolbar">
          <button type="button" className="button button-primary" disabled={busy} onClick={onStart}>
            Vorgang anlegen und Zeilen abarbeiten
          </button>
          <ConfirmButton
            className="button button-secondary"
            confirm={{
              title: "Datei verwerfen?",
              text: `Die Vorschau von „${draft.file_name}“ wird verworfen, es wird nichts übernommen. Du kannst die Datei danach neu hochladen.`,
              action: "Verwerfen",
            }}
            onConfirm={onDiscard}
          >
            Verwerfen
          </ConfirmButton>
        </div>
      </div>
    </section>
  );
}

/** IT-Budget › Import: Vorgänge aus Excel-Dateien, Datei hochladen. */
export function ImportsPage() {
  const [imports, setImports] = useState<ImportSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("arbeit");
  const paging = useShowMore(IMPORTS_STEP, view);
  const [draft, setDraft] = useState<ImportDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    fetchImports().then(
      (result) => active && setImports(result),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [round]);

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > FILE_MAX_MB * 1024 * 1024) {
      setMessage(`Die Datei ist größer als ${FILE_MAX_MB} MB.`);
      return;
    }
    setBusy(true);
    setMessage(null);
    uploadImport(file)
      .then((result) => setDraft(result))
      .catch((problem: unknown) =>
        setMessage(errorText(problem, "Die Datei konnte nicht gelesen werden.")),
      )
      .finally(() => setBusy(false));
  };

  const openDraft = (imports ?? []).find((entry) => entry.status === "entwurf");
  const shown = (imports ?? []).filter(
    (entry) =>
      entry.status !== "entwurf" &&
      (view === "alle" ||
        (view === "fertig"
          ? entry.status === "abgeschlossen" || entry.status === "abgebrochen"
          : entry.status === "offen")),
  );

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Import aus Excel"
        sub="Alte Budgetdateien Zeile für Zeile übernehmen. Jede Datei ist ein Vorgang; jede Zeile prüfst du einzeln."
      />

      {!draft && openDraft && (
        <p className="hint-box">
          Die Datei {openDraft.file_name} ist hochgeladen, aber noch nicht geprüft.{" "}
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              fetchImport(openDraft.id)
                .then(setDraft)
                .catch(() => setMessage("Der Entwurf konnte nicht geladen werden."))
            }
          >
            Weiter prüfen
          </button>
        </p>
      )}

      {!draft && (
        <section className="panel" aria-labelledby="import-datei">
          <div className="panel-head">
            <h2 id="import-datei">Datei importieren</h2>
          </div>
          <div className="detail-body settings-form">
            <label>
              Excel-Datei (.xlsx, bis {FILE_MAX_MB} MB)
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={onPick}
              />
            </label>
            <p className="small">
              Gelesen wird das erste Blatt: Überschrift mit dem Geschäftsjahr, die Tabelle mit
              Rech.Nr., Firma, Kosten, Datum, RE, Bezeichnung, den Kontospalten und „Jährlich“ und
              darunter die Konten mit ihrem Budget. Die Datei selbst wird nicht gespeichert.
            </p>
            {busy && <p role="status">Die Datei wird gelesen …</p>}
            <Feedback
              message={message ? { kind: "alert", text: message } : null}
              onClose={() => setMessage(null)}
            />
          </div>
        </section>
      )}

      {draft && (
        <DraftReview
          draft={draft}
          onCancel={() => {
            setDraft(null);
            setRound(round + 1);
          }}
        />
      )}

      <section className="panel" aria-labelledby="import-vorgaenge">
        <div className="panel-head">
          <h2 id="import-vorgaenge">Vorgänge</h2>
        </div>
        <FilterBar
          plain
          status={{
            label: "Stand",
            value: view,
            onChange: setView,
            options: [
              { value: "arbeit", label: "In Arbeit" },
              { value: "fertig", label: "Abgeschlossen" },
              { value: "alle", label: "Alle" },
            ],
          }}
        />
        {failed && (
          <p role="alert" className="detail-body">
            Die Vorgänge konnten nicht geladen werden.
          </p>
        )}
        {!failed && !imports && (
          <p role="status" className="detail-body">
            Wird geladen …
          </p>
        )}
        {imports && shown.length === 0 && (
          <p className="detail-body small">Keine Vorgänge für diese Auswahl.</p>
        )}
        {shown.length > 0 && (
          <div
            className="table-wrap card-wrap"
            tabIndex={0}
            role="region"
            aria-label="Import-Vorgänge"
          >
            <table className="table-cards">
              <caption className="visually-hidden">Vorgänge aus Excel-Dateien</caption>
              <thead>
                <tr>
                  <th scope="col">Datei</th>
                  <th scope="col">Geschäftsjahr</th>
                  <th scope="col">Stand</th>
                  <th scope="col">Zeilen</th>
                  <th scope="col">Offen</th>
                  <th scope="col">Übernommen</th>
                  <th scope="col">Übersprungen</th>
                  <th scope="col">Fortschritt</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, paging.limit).map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      <Link to={importPath(entry.id)}>{entry.file_name}</Link>
                      <span className="small tenant-part">
                        {formatDateTime(entry.created_at)}
                        {entry.created_by ? ` von ${entry.created_by}` : ""}
                      </span>
                    </th>
                    <td data-label="Geschäftsjahr">{entry.year_name}</td>
                    <td data-label="Stand">
                      <span className={PILLS[entry.status]}>
                        {IMPORT_STATUS_LABELS[entry.status]}
                      </span>
                    </td>
                    <td data-label="Zeilen">{entry.rows}</td>
                    <td data-label="Offen">{entry.open}</td>
                    <td data-label="Übernommen">{entry.taken}</td>
                    <td data-label="Übersprungen">{entry.skipped}</td>
                    <td data-label="Fortschritt">
                      <span
                        className="import-progress"
                        role="img"
                        aria-label={`${percent(entry.taken + entry.skipped, entry.rows)} % erledigt`}
                      >
                        <span
                          className="import-progress-taken"
                          style={{ width: `${percent(entry.taken, entry.rows)}%` }}
                        />
                        <span
                          className="import-progress-skipped"
                          style={{ width: `${percent(entry.skipped, entry.rows)}%` }}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ShowMore
          shown={Math.min(paging.limit, shown.length)}
          total={shown.length}
          onMore={paging.more}
        />
      </section>
      <p className="hint-box">
        Ein Vorgang lässt sich jederzeit unterbrechen und später weiter bearbeiten. Offene Vorgänge
        stehen als Aufgabe auf der Startseite.
      </p>
    </div>
  );
}
