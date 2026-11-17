import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_ACCOUNTS_PATH, BUDGET_STATISTICS_PATH } from "../../navigation";
import { useSearchParam } from "../../router";
import {
  BUDGET_EDITOR_ROLES,
  createItem,
  deleteItem,
  euroInput,
  fetchAccounts,
  fetchBudgetOverview,
  fetchContracts,
  fetchTags,
  formatEuro,
  hasTag,
  ITEM_STATUS_LABELS,
  itemMatches,
  parseEuro,
  TAGS_MAX,
  rememberedYear,
  rememberYear,
  runtimeText,
  updateItem,
  type Account,
  type Contract,
  type Item,
  type ItemStatus,
  type ItemUpdate,
  type Overview,
  type TagCount,
} from "./api";
import { DeleteButton, ReadOnlyNote, useRevealOnMount } from "./shared";
import { fetchProjectChoices, projectPath, type ProjectChoice } from "../projects/api";

function amount(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

/** Abweichung der Prognose von der Erwartung mit Vorzeichen; mehr ausgegeben ist positiv. */
function deviation(expected: number | null, forecast: number): string {
  const delta = forecast - (expected ?? 0);
  if (delta === 0) {
    return formatEuro(0);
  }
  return `${delta > 0 ? "+" : "−"} ${formatEuro(Math.abs(delta))}`;
}

function deviationClass(expected: number | null, forecast: number): string {
  const delta = forecast - (expected ?? 0);
  return delta > 0 ? "betrag budget-bad" : delta < 0 ? "betrag budget-ok" : "betrag";
}

const STATUS_PILLS: Record<ItemStatus, string> = {
  offen: "pill pill-neutral",
  rechnung: "pill pill-todo",
  abgeschlossen: "pill pill-ok",
};

/** Status als kleines Etikett; ohne Status (Posten läuft im Jahr nicht) ein Strich. */
export function StatusPill({ status }: { status: ItemStatus | null | undefined }) {
  if (!status) {
    return <span className="budget-muted">–</span>;
  }
  return (
    <span className={`${STATUS_PILLS[status]} budget-pill`}>{ITEM_STATUS_LABELS[status]}</span>
  );
}

type Runtime = "einmalig" | "bis" | "offen";

interface FormProps {
  /** null: neuen Budgetposten anlegen. */
  item: Item | null;
  accounts: Account[];
  /** Verträge zur Auswahl; ein Posten hat höchstens einen. */
  contracts: Contract[];
  /** IT-Projekte zur Auswahl; ein Posten gehört höchstens zu einem. */
  projects: ProjectChoice[];
  /** Die Liste der Tags, aus der der Posten wählt. */
  knownTags: TagCount[];
  /** Wählbare Geschäftsjahre, aufsteigend. */
  years: { year: number; name: string }[];
  /** Vorgabe für den Beginn eines neuen Postens: das gerade gezeigte Geschäftsjahr. */
  defaultYear: number;
  yearLabel: string;
  onSaved: (item: Item) => void;
  onCancel: () => void;
}

function ItemForm({
  item,
  accounts,
  contracts,
  projects,
  knownTags,
  years,
  defaultYear,
  yearLabel,
  onSaved,
  onCancel,
}: FormProps) {
  const reveal = useRevealOnMount<HTMLElement>();
  const [accountId, setAccountId] = useState(item ? String(item.account_id) : "");
  const [name, setName] = useState(item?.name ?? "");
  const [cost, setCost] = useState(item ? euroInput(item.amount_cents) : "");
  const [start, setStart] = useState(String(item?.start_year ?? defaultYear));
  const [runtime, setRuntime] = useState<Runtime>(
    !item || item.end_year === item.start_year
      ? "einmalig"
      : item.end_year === null
        ? "offen"
        : "bis",
  );
  const [end, setEnd] = useState(item?.end_year ? String(item.end_year) : "");
  const [contractId, setContractId] = useState(item?.contract_id ? String(item.contract_id) : "");
  const [projectId, setProjectId] = useState(item?.project_id ? String(item.project_id) : "");
  // Abgeschlossene Projekte stehen nur zur Wahl, wenn der Posten schon dazugehört.
  const projectChoices = projects.filter(
    (entry) => entry.status !== "abgeschlossen" || entry.id === item?.project_id,
  );
  const [note, setNote] = useState(item?.note ?? "");
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = accounts.filter((entry) => entry.active || entry.id === item?.account_id);
  const isChosen = (tag: string) => tags.some((entry) => entry.toLowerCase() === tag.toLowerCase());
  const toggleTag = (tag: string) =>
    setTags(
      isChosen(tag)
        ? tags.filter((entry) => entry.toLowerCase() !== tag.toLowerCase())
        : [...tags, tag],
    );
  // Ein Jahr außerhalb der Liste (z. B. ein alter Posten) bleibt wählbar.
  const yearChoices = [...years];
  for (const value of [item?.start_year, item?.end_year]) {
    if (value && !yearChoices.some((entry) => entry.year === value)) {
      yearChoices.push({ year: value, name: String(value) });
    }
  }
  yearChoices.sort((left, right) => left.year - right.year);
  const endChoices = yearChoices.filter((entry) => entry.year > Number(start));
  // Weitere Angaben stehen offen, wenn sie schon etwas enthalten.
  const hasMore = Boolean(item && (item.note || item.tags.length > 0 || !item.active));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const costCents = parseEuro(cost);
    let problem: string | null = null;
    if (!accountId || !name.trim()) {
      problem = "Bitte Konto wählen und eine Bezeichnung eintragen.";
    } else if (costCents === null) {
      problem = "Die erwarteten Kosten sind nicht lesbar. Bitte so eintragen: 15000,00";
    } else if (runtime === "bis" && (!end || Number(end) <= Number(start))) {
      problem = `Bitte wählen, bis zu welchem ${yearLabel} der Posten läuft.`;
    } else if (tags.length > TAGS_MAX) {
      problem = `Es sind höchstens ${TAGS_MAX} Tags je Budgetposten möglich.`;
    }
    if (problem !== null || costCents === null) {
      setError(problem);
      return;
    }
    const update: ItemUpdate = {
      account_id: Number(accountId),
      name: name.trim(),
      amount_cents: costCents,
      start_year: Number(start),
      end_year: runtime === "einmalig" ? Number(start) : runtime === "bis" ? Number(end) : null,
      note: note.trim(),
      tags,
      active,
      contract_id: contractId ? Number(contractId) : null,
      project_id: projectId ? Number(projectId) : null,
    };
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
        <h2 id="posten-formular-titel">{item ? `${item.name} bearbeiten` : "Posten hinzufügen"}</h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <fieldset className="budget-fieldset">
          <legend>Was</legend>
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
            <label>
              Vertrag (freiwillig)
              <select value={contractId} onChange={(event) => setContractId(event.target.value)}>
                <option value="">Kein Vertrag</option>
                {contracts.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} · {entry.partner_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {projectChoices.length > 0 && (
            <div className="tool-row">
              <label>
                Projekt (freiwillig)
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">Kein Projekt</option>
                  {projectChoices.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.status === "abgeschlossen" ? " (abgeschlossen)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <p className="small budget-muted">
            Ein Posten hat höchstens einen Vertrag. Rechnungen buchst du immer auf den Posten.
            {projectChoices.length > 0 &&
              " Gehört der Posten zu einem IT-Projekt, zählen seine Kosten dort mit."}
          </p>
        </fieldset>
        <fieldset className="budget-fieldset">
          <legend>Kosten und Laufzeit</legend>
          <div className="tool-row">
            <label className="narrow">
              Erwartete Kosten je {yearLabel} (brutto, Euro)
              <input
                type="text"
                inputMode="decimal"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
            </label>
            <label className="narrow">
              Ab {yearLabel}
              <select value={start} onChange={(event) => setStart(event.target.value)}>
                {yearChoices.map((entry) => (
                  <option key={entry.year} value={entry.year}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="narrow">
              Laufzeit
              <select
                value={runtime}
                onChange={(event) => setRuntime(event.target.value as Runtime)}
              >
                <option value="einmalig">einmalig</option>
                <option value="bis">mehrere Jahre</option>
                <option value="offen">bis auf Weiteres</option>
              </select>
            </label>
            {runtime === "bis" && (
              <label className="narrow">
                Bis {yearLabel}
                <select value={end} onChange={(event) => setEnd(event.target.value)}>
                  <option value="">Bitte wählen</option>
                  {endChoices.map((entry) => (
                    <option key={entry.year} value={entry.year}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="small budget-muted">
            Die erwarteten Kosten gelten in jedem {yearLabel} der Laufzeit. Der Posten ist offen,
            bis eine Rechnung ihn abschließt.
          </p>
        </fieldset>
        <details className="budget-more" open={hasMore}>
          <summary>Weitere Angaben: Tags, Notiz{item ? ", stilllegen" : ""}</summary>
          <div className="budget-more-body">
            {knownTags.length > 0 ? (
              <div className="chips" role="group" aria-label="Tags (freiwillig)">
                {knownTags.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="chip budget-tag"
                    aria-pressed={isChosen(entry.tag)}
                    onClick={() => toggleTag(entry.tag)}
                  >
                    {entry.tag}
                  </button>
                ))}
              </div>
            ) : (
              <p className="small budget-muted">
                Es gibt noch keine Tags. Der Budgetverwalter legt sie unter Einstellungen an.
              </p>
            )}
            <label>
              Notiz (freiwillig)
              <input
                type="text"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
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
          </div>
        </details>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {item ? "Änderungen speichern" : "Posten speichern"}
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

/** IT-Budget › Budgetposten: Vorhaben mit erwarteten Kosten, Status, Ist und Prognose. */
export function ItemsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const canOpenProjects = roles.includes("Projekte.Reader") || roles.includes("Projekte.Editor");
  const [year, setYear] = useState<number | null>(rememberedYear);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [knownTags, setKnownTags] = useState<TagCount[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  // Suchtext aus der Adresse (Treffer der Suche oben führen mit dem Namen des Postens hierher).
  // Eigene Eingabe gilt, bis ein neuer Suchtext über die Adresse kommt.
  const linked = useSearchParam("suche");
  const [typed, setTyped] = useState({ from: linked, text: linked });
  const search = typed.from === linked ? typed.text : linked;
  const setSearch = (text: string) => setTyped({ from: linked, text });
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ItemStatus | "">("");
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [formRound, setFormRound] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const closeForm = () => {
    setEditing(null);
    setFormOpen(false);
  };
  const [round, setRound] = useState(0);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    // Die Tag-Liste ist eine Zugabe für Filter und Auswahl: Ohne sie bleibt die Seite nutzbar.
    const tagList = fetchTags().catch((): TagCount[] => []);
    // Ebenso die Verträge für die Auswahl im Formular.
    const contractList = fetchContracts()
      .then((list) =>
        [...list.entries].sort((left, right) => left.title.localeCompare(right.title, "de")),
      )
      .catch((): Contract[] => []);
    // Ebenso die IT-Projekte für Auswahl und Filter.
    const projectList = fetchProjectChoices().catch((): ProjectChoice[] => []);
    Promise.all([fetchBudgetOverview(year), fetchAccounts(), tagList, contractList, projectList])
      .then(([result, list, tags, contractEntries, projectEntries]) => {
        if (active) {
          setOverview(result);
          setAccounts(list);
          setKnownTags(tags);
          setContracts(contractEntries);
          setProjects(projectEntries);
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
  const filtered =
    search.trim() !== "" || tagFilter !== "" || statusFilter !== "" || projectFilter !== "";
  const rows = (overview?.items ?? []).filter(
    (row) =>
      itemMatches(row.item, search) &&
      (tagFilter === "" || hasTag(row.item, tagFilter)) &&
      (statusFilter === "" || row.status === statusFilter) &&
      (projectFilter === "" || String(row.item.project_id ?? "") === projectFilter),
  );
  const total = (pick: (row: (typeof rows)[number]) => number | null) =>
    rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
  const sums = {
    expected: total((row) => row.expected_cents),
    actual: total((row) => row.actual_cents),
    forecast: total((row) => row.forecast_cents),
    previous: total((row) => row.previous_cents),
  };
  const yearChoices = [...(overview?.years ?? [])].sort((left, right) => left.year - right.year);

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
            Jeder Posten ist ein Vorhaben mit erwarteten Kosten und Laufzeit. Er bleibt offen, bis
            eine Rechnung ihn abschließt. Prognose: abgeschlossen das Ist, sonst das Höhere aus
            Erwartung und Ist. Alle Beträge sind brutto.
          </p>
        </div>
        {overview && (
          <div className="settings-form">
            <label className="narrow">
              {label}
              <select
                value={overview.year}
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
      {canEdit && overview && accounts.length > 0 && (
        <div className="budget-toolbar">
          <button
            type="button"
            className="button button-primary"
            aria-expanded={formOpen || editing !== null}
            onClick={() => {
              setEditing(null);
              setMessage(null);
              setFormRound(formRound + 1);
              setFormOpen(true);
            }}
          >
            Posten hinzufügen
          </button>
        </div>
      )}
      {canEdit && overview && accounts.length > 0 && (formOpen || editing) && (
        <ItemForm
          key={editing ? `posten-${editing.id}` : `neu-${formRound}`}
          item={editing}
          accounts={accounts}
          contracts={contracts}
          projects={projects}
          knownTags={knownTags}
          years={yearChoices}
          defaultYear={overview.year}
          yearLabel={label}
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
        <p className="panel panel-empty">In {overview.year_name} läuft noch kein Budgetposten.</p>
      )}
      {overview && overview.items.length > 0 && (
        <div className="budget-toolbar budget-filter settings-form">
          <label>
            Budgetposten suchen
            <input
              type="search"
              value={search}
              placeholder="Name, Konto oder Tag"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="narrow">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ItemStatus | "")}
            >
              <option value="">alle</option>
              {(Object.keys(ITEM_STATUS_LABELS) as ItemStatus[]).map((entry) => (
                <option key={entry} value={entry}>
                  {ITEM_STATUS_LABELS[entry]}
                </option>
              ))}
            </select>
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
          {projects.length > 0 && (
            <label className="narrow">
              Projekt
              <select
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="">alle</option>
                {projects.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
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
                setStatusFilter("");
                setProjectFilter("");
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
        <div
          className="table-wrap budget-table"
          tabIndex={0}
          role="region"
          aria-label={`Budgetposten ${overview.year_name}`}
        >
          <table>
            <caption className="visually-hidden">
              Budgetposten im {label} {overview.year_name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Konto</th>
                <th scope="col">Budgetposten</th>
                <th scope="col">Status</th>
                <th scope="col" className="betrag">
                  Erwartet
                </th>
                <th scope="col" className="betrag">
                  Ist
                </th>
                <th scope="col" className="betrag">
                  Prognose
                </th>
                <th scope="col" className="betrag">
                  Abweichung
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
                    <span className="small budget-muted tenant-part">{row.item.account_name}</span>
                  </td>
                  <th scope="row">
                    {row.item.name}
                    {!row.item.active && (
                      <span className="pill pill-neutral budget-pill">stillgelegt</span>
                    )}
                    <span className="small budget-muted tenant-part">
                      {runtimeText(row.item)}
                      {row.item.contract_title ? ` · Vertrag: ${row.item.contract_title}` : ""}
                    </span>
                    {row.item.project_id && row.item.project_name && (
                      <span className="small budget-muted tenant-part">
                        Projekt:{" "}
                        {canOpenProjects ? (
                          <Link to={projectPath(row.item.project_id)}>{row.item.project_name}</Link>
                        ) : (
                          row.item.project_name
                        )}
                      </span>
                    )}
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
                              setTagFilter(tagFilter.toLowerCase() === tag.toLowerCase() ? "" : tag)
                            }
                          >
                            {tag}
                          </button>
                        ))}
                      </span>
                    )}
                  </th>
                  <td>
                    <StatusPill status={row.status} />
                  </td>
                  <td className="betrag">{amount(row.expected_cents)}</td>
                  <td className="betrag">{formatEuro(row.actual_cents)}</td>
                  <td className="betrag">{formatEuro(row.forecast_cents)}</td>
                  <td className={deviationClass(row.expected_cents, row.forecast_cents)}>
                    {deviation(row.expected_cents, row.forecast_cents)}
                  </td>
                  <td className="betrag budget-muted">{amount(row.previous_cents)}</td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={`${row.item.name} bearbeiten`}
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
                <th scope="row" colSpan={3}>
                  {filtered ? "Summe der gezeigten Posten" : "Summe"}
                </th>
                <td className="betrag">{formatEuro(sums.expected)}</td>
                <td className="betrag">{formatEuro(sums.actual)}</td>
                <td className="betrag">{formatEuro(sums.forecast)}</td>
                <td className={deviationClass(sums.expected, sums.forecast)}>
                  {deviation(sums.expected, sums.forecast)}
                </td>
                <td className="betrag budget-muted" colSpan={columns - 7}>
                  {formatEuro(sums.previous)}
                </td>
              </tr>
            </tfoot>
          </table>
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
    </div>
  );
}
