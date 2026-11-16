import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import {
  BUDGET_EDITOR_ROLES,
  euroInput,
  fetchPlanning,
  formatEuro,
  parseEuro,
  savePlan,
  type Planning,
  type PlanEntry,
} from "./api";
import { BudgetHead, ReadOnlyNote } from "./shared";

/** Schlüssel einer Zelle: Posten und Jahr. */
function cell(itemId: number, year: number): string {
  return `${itemId}:${year}`;
}

/** IT-Budget › Mehrjahresplanung: Plan aller Budgetposten für die kommenden Geschäftsjahre. */
export function PlanningPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [data, setData] = useState<Planning | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  // Eingaben je Zelle; null: es wird nicht bearbeitet.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPlanning()
      .then((result) => {
        if (active) {
          setData(result);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [round]);

  const years = data?.years ?? [];
  const rows = data?.rows ?? [];
  const openYears = years.filter((entry) => entry.status === "entwurf");

  const startEdit = () => {
    const values: Record<string, string> = {};
    for (const row of rows) {
      for (const year of openYears) {
        values[cell(row.item.id, year.year)] = euroInput(row.plans[String(year.year)] ?? null);
      }
    }
    setMessage(null);
    setDraft(values);
  };

  /** Füllt leere Felder mit den erwarteten Vertragskosten. Vorhandene Eingaben bleiben. */
  const takeProposals = () => {
    if (!draft) {
      return;
    }
    const values = { ...draft };
    let filled = 0;
    for (const row of rows) {
      for (const year of openYears) {
        const key = cell(row.item.id, year.year);
        const proposal = row.proposals[String(year.year)];
        if (proposal !== undefined && (values[key] ?? "").trim() === "") {
          values[key] = euroInput(proposal);
          filled += 1;
        }
      }
    }
    setDraft(values);
    setMessage({
      kind: "status",
      text:
        filled === 0
          ? "Es gibt keinen Vorschlag für ein leeres Feld."
          : `${filled} ${filled === 1 ? "Feld" : "Felder"} aus den Verträgen gefüllt. Bitte prüfen und speichern.`,
    });
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) {
      return;
    }
    const changes = new Map<number, PlanEntry[]>();
    for (const row of rows) {
      for (const year of openYears) {
        const text = (draft[cell(row.item.id, year.year)] ?? "").trim();
        const cents = text === "" ? null : parseEuro(text);
        if (text !== "" && cents === null) {
          setMessage({
            kind: "alert",
            text: `Der Betrag für ${row.item.name} im ${year.name} ist nicht lesbar. Bitte so eintragen: 11900,00`,
          });
          return;
        }
        if (cents !== (row.plans[String(year.year)] ?? null)) {
          const list = changes.get(year.year) ?? [];
          list.push({ item_id: row.item.id, amount_cents: cents });
          changes.set(year.year, list);
        }
      }
    }
    if (changes.size === 0) {
      setDraft(null);
      setMessage(null);
      return;
    }
    setBusy(true);
    setMessage(null);
    Promise.all([...changes.entries()].map(([year, entries]) => savePlan(year, entries)))
      .then(() => {
        setDraft(null);
        setMessage({ kind: "status", text: "Der Plan ist gespeichert." });
        setRound(round + 1);
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Plan konnte nicht vollständig gespeichert werden."),
        });
        setRound(round + 1);
      })
      .finally(() => setBusy(false));
  };

  const total = (year: number) =>
    rows.reduce((sum, row) => sum + (row.plans[String(year)] ?? 0), 0);

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Mehrjahresplanung"
        sub={
          <>
            Plan je Budgetposten für das laufende und die folgenden fünf Jahre. Unter dem Plan
            steht, was aus Verträgen zu erwarten ist. Freigegebene Jahre lassen sich nicht ändern.
            Alle Beträge sind brutto.
          </>
        }
      />
      <ReadOnlyNote roles={roles} />
      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Planung konnte nicht geladen werden.
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && rows.length === 0 && (
        <p className="panel panel-empty">Es sind noch keine Budgetposten angelegt.</p>
      )}
      {data && rows.length > 0 && (
        <form onSubmit={onSave} noValidate>
          {/* Eigene Schlüssel: Sonst verwendet React „Plan bearbeiten“ als „Plan speichern“
              weiter, und derselbe Klick schickt das Formular ab. */}
          {canEdit && openYears.length > 0 && (
            <div className="budget-toolbar">
              {draft ? (
                <>
                  <button
                    key="vorschlag"
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={takeProposals}
                  >
                    Leere Felder aus Verträgen füllen
                  </button>
                  <button
                    key="abbrechen"
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => {
                      setDraft(null);
                      setMessage(null);
                    }}
                  >
                    Abbrechen
                  </button>
                  <button
                    key="speichern"
                    type="submit"
                    className="button button-primary"
                    disabled={busy}
                  >
                    Plan speichern
                  </button>
                </>
              ) : (
                <button
                  key="bearbeiten"
                  type="button"
                  className="button button-primary"
                  onClick={startEdit}
                >
                  Plan bearbeiten
                </button>
              )}
            </div>
          )}
          {message && (
            <p
              role={message.kind}
              className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
            >
              {message.text}
            </p>
          )}
          <div
            className="table-wrap budget-table"
            tabIndex={0}
            role="region"
            aria-label="Mehrjahresplanung"
          >
            <table>
              <caption className="visually-hidden">
                Plan je Budgetposten und {data.year_label}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Budgetposten</th>
                  {years.map((year) => (
                    <th scope="col" className="betrag" key={year.year}>
                      {year.name}
                      <span
                        className={
                          year.status === "entwurf"
                            ? "pill pill-todo budget-pill"
                            : "pill pill-ok budget-pill"
                        }
                      >
                        {year.status === "entwurf" ? "Entwurf" : "freigegeben"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.item.id}>
                    <th scope="row">
                      {row.item.name}
                      <span className="small budget-muted tenant-part">
                        {row.item.account_number} {row.item.account_name}
                        {row.item.partner_name ? ` · ${row.item.partner_name}` : ""}
                      </span>
                    </th>
                    {years.map((year) => {
                      const plan = row.plans[String(year.year)];
                      const proposal = row.proposals[String(year.year)];
                      const key = cell(row.item.id, year.year);
                      return (
                        <td className="betrag" key={year.year}>
                          {draft && year.status === "entwurf" ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              className="budget-input"
                              aria-label={`Plan für ${row.item.name} im ${year.name} in Euro`}
                              value={draft[key] ?? ""}
                              onChange={(event) =>
                                setDraft({ ...draft, [key]: event.target.value })
                              }
                            />
                          ) : plan === undefined ? (
                            "–"
                          ) : (
                            formatEuro(plan)
                          )}
                          {proposal !== undefined && (
                            <span className="small budget-muted tenant-part">
                              Verträge: {formatEuro(proposal)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="budget-summe">
                  <th scope="row">Summe Plan</th>
                  {years.map((year) => (
                    <td className="betrag" key={year.year}>
                      {formatEuro(total(year.year))}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </form>
      )}
    </div>
  );
}
