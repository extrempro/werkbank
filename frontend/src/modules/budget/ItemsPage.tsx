import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_ACCOUNTS_PATH, BUDGET_STATISTICS_PATH } from "../../navigation";
import { useSearchParam } from "../../router";
import {
  BUDGET_EDITOR_ROLES,
  deleteItem,
  BUDGET_MANAGER_ROLE,
  createItem,
  euroInput,
  fetchAccounts,
  fetchBudgetOverview,
  fetchPartners,
  fetchTags,
  hasTag,
  itemMatches,
  parseTags,
  setYearStatus,
  rememberedYear,
  rememberYear,
  formatEuro,
  parseEuro,
  savePlan,
  updateItem,
  type Account,
  type Item,
  type ItemUpdate,
  type Partner,
  type YearStatus,
  type Overview,
  type PlanEntry,
  type TagCount,
} from "./api";
import { DeleteButton, ReadOnlyNote, useRevealOnMount } from "./shared";

function amount(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

interface FormProps {
  /** null: neuen Budgetposten anlegen. */
  item: Item | null;
  accounts: Account[];
  partners: Partner[];
  /** Schon vergebene Tags als Vorschläge. */
  knownTags: TagCount[];
  /** Geschäftsjahr, für das beim Anlegen gleich ein Plan eingetragen werden kann; null: gesperrt. */
  planYear: { year: number; name: string } | null;
  onSaved: (item: Item) => void;
  onCancel: () => void;
}

function ItemForm({ item, accounts, partners, knownTags, planYear, onSaved, onCancel }: FormProps) {
  const reveal = useRevealOnMount<HTMLElement>();
  const [accountId, setAccountId] = useState(item ? String(item.account_id) : "");
  const [name, setName] = useState(item?.name ?? "");
  const [partnerId, setPartnerId] = useState(item?.partner_id ? String(item.partner_id) : "");
  const [plan, setPlan] = useState("");
  const [note, setNote] = useState(item?.note ?? "");
  const [tags, setTags] = useState(item ? item.tags.join(", ") : "");
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = accounts.filter((entry) => entry.active || entry.id === item?.account_id);
  const parsed = parseTags(tags);
  const chosen = typeof parsed === "string" ? [] : parsed;
  // Vorschläge: vergebene Tags, die noch nicht im Feld stehen
  const suggestions = knownTags.filter(
    (entry) => !chosen.some((tag) => tag.toLowerCase() === entry.tag.toLowerCase()),
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!accountId || !name.trim()) {
      setError("Bitte Konto wählen und eine Bezeichnung eintragen.");
      return;
    }
    const planCents = plan.trim() === "" ? null : parseEuro(plan);
    if (plan.trim() !== "" && planCents === null) {
      setError("Der Planbetrag ist nicht lesbar. Bitte so eintragen: 15000,00");
      return;
    }
    const tagList = parseTags(tags);
    if (typeof tagList === "string") {
      setError(tagList);
      return;
    }
    const update: ItemUpdate = {
      account_id: Number(accountId),
      name: name.trim(),
      partner_id: partnerId ? Number(partnerId) : null,
      note: note.trim(),
      tags: tagList,
      active,
    };
    if (!item && planYear && planCents !== null) {
      update.plan_year = planYear.year;
      update.plan_cents = planCents;
    }
    setBusy(true);
    setError(null);
    (item ? updateItem(item.id, update) : createItem(update))
      .then(onSaved)
      .catch((problem: unknown) => {
        setError(errorText(problem, "Der Budgetposten konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  return (
    <section className="panel" aria-labelledby="posten-formular-titel" ref={reveal} tabIndex={-1}>
      <div className="panel-head">
        <h2 id="posten-formular-titel">
          {item ? `${item.name} bearbeiten` : "Budgetposten anlegen"}
        </h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label>
            Konto
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Bitte wählen</option>
              {choices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.number} {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bezeichnung
            <input
              type="text"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <div className="tool-row">
          <label>
            Üblicher Partner (freiwillig)
            <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
              <option value="">ohne Vorgabe</option>
              {partners
                .filter((entry) => entry.active || entry.id === item?.partner_id)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
          {!item && planYear && (
            <label className="narrow">
              Plan {planYear.name} (brutto, Euro, freiwillig)
              <input
                type="text"
                inputMode="decimal"
                value={plan}
                onChange={(event) => setPlan(event.target.value)}
              />
            </label>
          )}
        </div>
        <label>
          Notiz (freiwillig)
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <label>
          Tags (freiwillig, mit Komma getrennt)
          <input
            type="text"
            value={tags}
            aria-describedby="posten-tags-hinweis"
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
        <p id="posten-tags-hinweis" className="small budget-muted">
          Zum Beispiel: Cloud, Lizenzen. Über Tags lassen sich Posten suchen und in der Statistik
          zusammen auswerten.
        </p>
        {suggestions.length > 0 && (
          <div className="chips" role="group" aria-label="Schon vergebene Tags übernehmen">
            {suggestions.map((entry) => (
              <button
                key={entry.tag}
                type="button"
                className="chip budget-tag"
                onClick={() => setTags([...chosen, entry.tag].join(", "))}
              >
                {entry.tag}
              </button>
            ))}
          </div>
        )}
        {item && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Budgetposten ist aktiv
          </label>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {item ? "Änderungen speichern" : "Budgetposten speichern"}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

/** IT-Budget › Budgetposten: Posten je Konto mit Plan, gebunden und frei; hier wird geplant. */
export function ItemsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const canRelease = roles.includes(BUDGET_MANAGER_ROLE);
  const [year, setYear] = useState<number | null>(rememberedYear);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [knownTags, setKnownTags] = useState<TagCount[]>([]);
  // Suchtext aus der Adresse (Treffer der Suche oben führen mit dem Namen des Postens hierher)
  const linked = useSearchParam("suche");
  // Eigene Eingabe gilt, bis ein neuer Suchtext über die Adresse kommt.
  const [typed, setTyped] = useState({ from: linked, text: linked });
  const search = typed.from === linked ? typed.text : linked;
  const setSearch = (text: string) => setTyped({ from: linked, text });
  const [tagFilter, setTagFilter] = useState("");
  const [failed, setFailed] = useState(false);
  // Eingaben im Bearbeitungsmodus je Posten; null: es wird nicht bearbeitet.
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [formRound, setFormRound] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const closeForm = () => {
    setEditing(null);
    setFormOpen(false);
  };
  const [round, setRound] = useState(0);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    // Die Liste der Tags ist eine Zugabe für Filter und Vorschläge: Ohne sie bleibt die Seite nutzbar.
    const tagList = fetchTags().catch((): TagCount[] => []);
    Promise.all([fetchBudgetOverview(year), fetchAccounts(), fetchPartners(), tagList])
      .then(([result, list, firms, tags]) => {
        if (active) {
          setOverview(result);
          setAccounts(list);
          setPartners(firms);
          setKnownTags(tags);
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
  }, [year, round]);

  const label = overview?.settings.year_label ?? "Geschäftsjahr";
  const filtered = search.trim() !== "" || tagFilter !== "";
  const rows = (overview?.items ?? []).filter(
    (row) => itemMatches(row.item, search) && (tagFilter === "" || hasTag(row.item, tagFilter)),
  );
  const total = (pick: (row: (typeof rows)[number]) => number | null) =>
    rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
  const sums = {
    plan: total((row) => row.plan_cents),
    committed: total((row) => row.committed_cents),
    actual: total((row) => row.actual_cents),
    forecast: total((row) => row.forecast_cents),
    previous: total((row) => row.previous_cents),
  };
  // Geplant wird nur, solange das Jahr ein Entwurf ist.
  const draftYear = overview?.year_status === "entwurf";
  const canPlan = canEdit && draftYear;

  const onRelease = (status: YearStatus) => {
    if (!overview) {
      return;
    }
    setBusy(true);
    setYearStatus(overview.year, status)
      .then(() => {
        setMessage({
          kind: "status",
          text:
            status === "freigegeben"
              ? `Der Plan ${overview.year_name} ist freigegeben.`
              : `Die Freigabe für ${overview.year_name} ist aufgehoben.`,
        });
        setRound(round + 1);
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Stand konnte nicht geändert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  const startEdit = () => {
    if (!overview) {
      return;
    }
    setMessage(null);
    setDraft(
      Object.fromEntries(overview.items.map((row) => [row.item.id, euroInput(row.plan_cents)])),
    );
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !draft) {
      return;
    }
    const entries: PlanEntry[] = [];
    for (const row of overview.items) {
      const text = (draft[row.item.id] ?? "").trim();
      const cents = text === "" ? null : parseEuro(text);
      if (text !== "" && cents === null) {
        setMessage({
          kind: "alert",
          text: `Der Betrag für ${row.item.name} ist nicht lesbar. Bitte so eintragen: 11900,00`,
        });
        return;
      }
      if (cents !== row.plan_cents) {
        entries.push({ item_id: row.item.id, amount_cents: cents });
      }
    }
    if (entries.length === 0) {
      setDraft(null);
      return;
    }
    setBusy(true);
    setMessage(null);
    savePlan(overview.year, entries)
      .then((result) => {
        setOverview(result);
        setDraft(null);
        setMessage({ kind: "status", text: "Der Plan ist gespeichert." });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Plan konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  const onItemSaved = (saved: Item) => {
    setMessage({ kind: "status", text: `${saved.name} ist gespeichert.` });
    setEditing(null);
    setFormOpen(false);
    setFormRound(formRound + 1);
    setRound(round + 1);
  };

  const columns = canEdit ? 9 : 8;

  return (
    <div className="page page-wide budget-page">
      <header className="page-head budget-head">
        <div>
          <p className="module-label">IT-Budget</p>
          <h1>Budgetposten</h1>
          <p className="page-sub">
            Wofür das Geld eines Kontos gedacht ist. Geplant wird je Posten; das Konto zeigt die
            Summe. Prognose = Ist plus noch gebunden, Frei = Plan abzüglich Prognose. Alle Beträge
            sind brutto.
          </p>
        </div>
        {overview && (
          <div className="settings-form">
            <label className="narrow">
              {label}
              <select
                value={overview.year}
                disabled={draft !== null}
                onChange={(event) => {
                  setMessage(null);
                  rememberYear(Number(event.target.value));
                  setYear(Number(event.target.value));
                }}
              >
                {overview.years.map((entry) => (
                  <option key={entry.year} value={entry.year}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>
      <ReadOnlyNote roles={roles} />
      {overview && (
        <div className="budget-toolbar budget-toolbar-split">
          <p className="budget-badges">
            <span className={draftYear ? "pill pill-todo" : "pill pill-ok"}>
              Plan {overview.year_name}: {draftYear ? "Entwurf" : "freigegeben"}
            </span>
          </p>
          {canRelease && !draft && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => onRelease(draftYear ? "freigegeben" : "entwurf")}
            >
              {draftYear ? "Plan freigeben" : "Freigabe aufheben"}
            </button>
          )}
        </div>
      )}
      {canEdit && overview && accounts.length > 0 && (
        <div className="budget-toolbar">
          <button
            type="button"
            className="button button-primary"
            aria-expanded={formOpen || editing !== null}
            onClick={() => {
              setEditing(null);
              setFormRound(formRound + 1);
              setFormOpen(true);
            }}
          >
            Budgetposten anlegen
          </button>
        </div>
      )}
      {canEdit && overview && accounts.length > 0 && (formOpen || editing) && (
        <ItemForm
          key={editing ? `posten-${editing.id}` : `neu-${formRound}`}
          item={editing}
          accounts={accounts}
          partners={partners}
          knownTags={knownTags}
          planYear={draftYear ? { year: overview.year, name: overview.year_name } : null}
          onSaved={onItemSaved}
          onCancel={closeForm}
        />
      )}

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Budgetposten konnten nicht geladen werden.
        </p>
      )}
      {!failed && !overview && <p role="status">Wird geladen …</p>}
      {overview && accounts.length === 0 && (
        <p className="panel panel-empty">
          Es sind noch keine Konten angelegt. Budgetposten gehören zu einem Konto.{" "}
          {canEdit && <Link to={BUDGET_ACCOUNTS_PATH}>Konten anlegen</Link>}
        </p>
      )}
      {overview && accounts.length > 0 && overview.items.length === 0 && (
        <p className="panel panel-empty">Es sind noch keine Budgetposten angelegt.</p>
      )}
      {overview && overview.items.length > 0 && (
        <div className="budget-toolbar budget-filter settings-form">
          <label>
            Budgetposten suchen
            <input
              type="search"
              value={search}
              placeholder="Name, Konto, Partner oder Tag"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {knownTags.length > 0 && (
            <label className="narrow">
              Tag
              <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                <option value="">alle</option>
                {knownTags.map((entry) => (
                  <option key={entry.tag} value={entry.tag}>
                    {entry.tag} ({entry.items})
                  </option>
                ))}
              </select>
            </label>
          )}
          {filtered && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setSearch("");
                setTagFilter("");
              }}
            >
              Filter aufheben
            </button>
          )}
          {tagFilter !== "" && (
            <Link to={`${BUDGET_STATISTICS_PATH}?tag=${encodeURIComponent(tagFilter)}`}>
              Statistik zu „{tagFilter}“
            </Link>
          )}
        </div>
      )}
      {overview && overview.items.length > 0 && (
        <p role="status" className="small budget-muted">
          {filtered
            ? `${rows.length} von ${overview.items.length} Budgetposten`
            : `${overview.items.length} Budgetposten`}
        </p>
      )}
      {overview && overview.items.length > 0 && (
        <form onSubmit={onSave} noValidate>
          <div
            className="table-wrap budget-table"
            tabIndex={0}
            role="region"
            aria-label={`Budgetposten ${overview.year_name}`}
          >
            <table>
              <caption className="visually-hidden">
                Budgetposten mit Plan im {label} {overview.year_name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Konto</th>
                  <th scope="col">Budgetposten</th>
                  <th scope="col" className="betrag">
                    Plan
                  </th>
                  <th scope="col" className="betrag">
                    Durch Verträge gebunden
                  </th>
                  <th scope="col" className="betrag">
                    Ist
                  </th>
                  <th scope="col" className="betrag">
                    Prognose
                  </th>
                  <th scope="col" className="betrag">
                    Frei
                  </th>
                  <th scope="col" className="betrag">
                    Vorjahr
                  </th>
                  {canEdit && <th scope="col">Aktion</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.item.id}>
                    <td>
                      <span className="mono">{row.item.account_number}</span>
                      <span className="small budget-muted tenant-part">
                        {row.item.account_name}
                      </span>
                    </td>
                    <th scope="row">
                      {row.item.name}
                      {!row.item.active && (
                        <span className="pill pill-neutral budget-pill">stillgelegt</span>
                      )}
                      <span className="small budget-muted tenant-part">
                        {row.contracts === 0
                          ? "kein Vertrag zugeordnet"
                          : row.contracts === 1
                            ? "1 Vertrag"
                            : `${row.contracts} Verträge`}
                      </span>
                      {row.item.tags.length > 0 && (
                        <span className="budget-tags">
                          {row.item.tags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className="chip budget-tag"
                              aria-pressed={tagFilter.toLowerCase() === tag.toLowerCase()}
                              aria-label={`Nach Tag ${tag} filtern`}
                              onClick={() =>
                                setTagFilter(
                                  tagFilter.toLowerCase() === tag.toLowerCase() ? "" : tag,
                                )
                              }
                            >
                              {tag}
                            </button>
                          ))}
                        </span>
                      )}
                    </th>
                    <td className="betrag">
                      {draft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="budget-input"
                          aria-label={`Plan für ${row.item.name} (${row.item.account_number}) in Euro`}
                          value={draft[row.item.id] ?? ""}
                          onChange={(event) =>
                            setDraft({ ...draft, [row.item.id]: event.target.value })
                          }
                        />
                      ) : (
                        amount(row.plan_cents)
                      )}
                    </td>
                    <td className="betrag">{formatEuro(row.committed_cents)}</td>
                    <td className="betrag">{formatEuro(row.actual_cents)}</td>
                    <td className="betrag">{formatEuro(row.forecast_cents)}</td>
                    <td
                      className={
                        row.plan_cents !== null && row.forecast_cents > row.plan_cents
                          ? "betrag budget-bad"
                          : "betrag"
                      }
                    >
                      {row.plan_cents === null
                        ? "–"
                        : formatEuro(row.plan_cents - row.forecast_cents)}
                    </td>
                    <td className="betrag budget-muted">{amount(row.previous_cents)}</td>
                    {canEdit && (
                      <td>
                        <button
                          type="button"
                          className="button button-secondary"
                          aria-label={`${row.item.name} bearbeiten`}
                          disabled={draft !== null}
                          onClick={() => {
                            setMessage(null);
                            setEditing(row.item);
                          }}
                        >
                          Bearbeiten
                        </button>
                        <DeleteButton
                          what={`Budgetposten ${row.item.name}`}
                          run={() => deleteItem(row.item.id)}
                          onDeleted={() => {
                            closeForm();
                            setMessage({ kind: "status", text: `${row.item.name} ist gelöscht.` });
                            setRound(round + 1);
                          }}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="budget-summe">
                  <th scope="row" colSpan={2}>
                    {filtered ? "Summe der gezeigten Posten" : "Summe"}
                  </th>
                  <td className="betrag">{formatEuro(sums.plan)}</td>
                  <td className="betrag">{formatEuro(sums.committed)}</td>
                  <td className="betrag">{formatEuro(sums.actual)}</td>
                  <td className="betrag">{formatEuro(sums.forecast)}</td>
                  <td className="betrag">{formatEuro(sums.plan - sums.forecast)}</td>
                  <td className="betrag budget-muted" colSpan={columns - 7}>
                    {formatEuro(sums.previous)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Eigene Schlüssel: Sonst verwendet React den Knopf „Plan bearbeiten“ als
              „Plan speichern“ weiter, und derselbe Klick schickt das Formular ab. */}
          {canPlan && (
            <div className="actions budget-actions">
              {draft ? (
                <>
                  <button
                    key="speichern"
                    type="submit"
                    className="button button-primary"
                    disabled={busy}
                  >
                    Plan speichern
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
                </>
              ) : (
                <button
                  key="bearbeiten"
                  type="button"
                  className="button button-secondary"
                  onClick={startEdit}
                >
                  Plan bearbeiten
                </button>
              )}
            </div>
          )}
          {draft && (
            <p className="small">
              Beträge brutto in Euro, z. B. 11900,00. Ein leeres Feld heißt: für diesen Posten ist
              nichts geplant.
            </p>
          )}
        </form>
      )}
      {message && (
        <p
          role={message.kind}
          className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
