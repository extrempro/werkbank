import { useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { Tabs, tabIds } from "../../components/Tabs";
import { useSearchParam } from "../../router";
import {
  BUDGET_EDITOR_ROLES,
  KIND_LABELS,
  deleteStatistic,
  fetchBudgetSettings,
  fetchStatisticCompare,
  fetchStatisticSummary,
  fetchStatistics,
  fetchTags,
  formatEuro,
  queryStatistic,
  saveStatistic,
  type AccountKind,
  type SavedStatistic,
  type Statistic,
  type StatisticCompare,
  type StatisticSummary,
  type StatisticYear,
  type TagCount,
  type TagMode,
} from "./api";
import { BudgetHead, DeleteButton } from "./shared";
import {
  CumulativeChart,
  GroupChart,
  MonthColumns,
  YearChips,
  change,
  type ChartGroup,
  type ChartLayout,
  type ChartYear,
} from "./StatisticsCharts";

type Tab = "ueberblick" | "konten" | "tags";
type Measure = "stichtag" | "ganz";
type Grouping = "konto" | "art";

const TABS: { id: Tab; label: string }[] = [
  { id: "ueberblick", label: "Überblick" },
  { id: "konten", label: "Konten und Partner" },
  { id: "tags", label: "Nach Tags" },
];
const PARTNERS_SHOWN = 5;
const KINDS: AccountKind[] = ["laufend", "investition"];

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  const lower = (tags: readonly string[]) => tags.map((tag) => tag.toLowerCase()).sort();
  return lower(left).join("\n") === lower(right).join("\n");
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)} %` : "–";
}

function day(iso: string): string {
  const [year, month, date] = iso.split("-");
  return `${date}.${month}.${year}`;
}

/** Knopfleiste mit aria-pressed (design.md: „segmented“). */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented stat-segmented" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** IT-Budget › Statistik: Überblick eines Jahres, Jahresvergleich der Konten und Auswertung nach Tags. */
export function StatisticsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const linked = useSearchParam("tag");
  const [tab, setTab] = useState<Tab>(linked ? "tags" : "ueberblick");
  // null, bis das laufende Jahr bekannt ist
  const [year, setYear] = useState<number | null>(null);
  const [compare, setCompare] = useState<number | null | "vorjahr">("vorjahr");
  const [summary, setSummary] = useState<StatisticSummary | null>(null);
  const [comparison, setComparison] = useState<StatisticCompare | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosenYears, setChosenYears] = useState<number[] | null>(null);
  const [measure, setMeasure] = useState<Measure>("stichtag");
  const [grouping, setGrouping] = useState<Grouping>("konto");
  const [layout, setLayout] = useState<ChartLayout>("saeulen");
  const [selected, setSelected] = useState<string | null>(null);
  const [tagSelected, setTagSelected] = useState<string | null>(null);

  // Tags
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [saved, setSaved] = useState<SavedStatistic[]>([]);
  const [chosen, setChosen] = useState<string[]>(linked ? [linked] : []);
  const [mode, setMode] = useState<TagMode>("any");
  const [result, setResult] = useState<Statistic | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  // Erst das laufende Jahr holen; danach gilt: gewähltes Jahr, Vergleich standardmäßig das Vorjahr
  useEffect(() => {
    let active = true;
    fetchBudgetSettings()
      .then((settings) => {
        if (active) {
          setYear((before) => before ?? settings.current_year);
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
  }, []);

  const compareYear = compare === "vorjahr" ? (year !== null ? year - 1 : null) : compare;
  useEffect(() => {
    if (year === null) {
      return;
    }
    let active = true;
    Promise.all([fetchStatisticSummary(year, compareYear), fetchStatisticCompare(year)])
      .then(([first, second]) => {
        if (active) {
          setSummary(first);
          setComparison(second);
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
  }, [year, compareYear]);

  useEffect(() => {
    let active = true;
    Promise.all([fetchTags(), fetchStatistics()])
      .then(([list, statistics]) => {
        if (active) {
          setTags(list);
          setSaved(statistics);
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

  const baseYear = summary?.year ?? null;
  const key = chosen.join("\n");
  useEffect(() => {
    const wanted = key === "" ? [] : key.split("\n");
    if (wanted.length === 0 || baseYear === null) {
      return;
    }
    let active = true;
    queryStatistic(wanted, mode, baseYear - 4)
      .then((statistic) => {
        if (active) {
          setResult(statistic);
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
  }, [key, mode, baseYear]);

  const current = summary?.current_year ?? 0;
  const isCurrent = summary !== null && summary.year === current;
  const part = isCurrent && measure === "stichtag";
  const label = summary?.year_label ?? "Geschäftsjahr";

  // Jahre im Vergleich: das gewählte und bis zu vier davor; Farbe nach Abstand
  const window: ChartYear[] = useMemo(
    () =>
      (comparison?.years ?? [])
        .slice()
        .reverse()
        .map((entry) => ({
          year: entry.year,
          name: entry.name,
          slot: (comparison?.year ?? entry.year) - entry.year,
          plan: !part && entry.year >= current,
        })),
    [comparison, part, current],
  );
  const picked = chosenYears ?? window.slice(0, 2).map((entry) => entry.year);
  const shownYears = window.filter((entry) => entry.slot === 0 || picked.includes(entry.year));
  const toggleYear = (wanted: number) =>
    setChosenYears(
      picked.includes(wanted) ? picked.filter((entry) => entry !== wanted) : [...picked, wanted],
    );

  const pick = (
    entry: { expected_cents: number; actual_cents: number; actual_to_date_cents: number },
    at: number,
  ) =>
    part ? entry.actual_to_date_cents : at >= current ? entry.expected_cents : entry.actual_cents;

  const accountGroups: ChartGroup[] = useMemo(() => {
    if (!comparison) {
      return [];
    }
    const rows = comparison.accounts.map((row) => ({
      key: `konto-${row.account.id}`,
      name: row.account.name,
      kind: row.account.kind,
      values: Object.fromEntries(row.values.map((value) => [value.year, pick(value, value.year)])),
    }));
    if (grouping === "konto") {
      return rows;
    }
    return KINDS.map((kind) => {
      const values: Record<number, number> = {};
      for (const row of rows.filter((entry) => entry.kind === kind)) {
        for (const [at, cents] of Object.entries(row.values)) {
          values[Number(at)] = (values[Number(at)] ?? 0) + cents;
        }
      }
      return { key: `art-${kind}`, name: KIND_LABELS[kind], values };
    });
    // pick hängt an part und current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison, grouping, part, current]);

  const tagRows = (years: StatisticYear[]) =>
    Object.fromEntries(years.map((entry) => [entry.year, pick(entry, entry.year)]));
  const tagGroups: ChartGroup[] =
    chosen.length === 0 || !result
      ? []
      : mode === "all" && result.tags.length > 1
        ? [{ key: "alle", name: result.tags.join(" und "), values: tagRows(result.years) }]
        : result.per_tag.map((entry) => ({
            key: entry.tag,
            name: entry.tag,
            values: tagRows(entry.years),
          }));

  const isChosen = (tag: string) =>
    chosen.some((entry) => entry.toLowerCase() === tag.toLowerCase());
  const toggleTag = (tag: string) => {
    setMessage(null);
    setChosen(
      isChosen(tag)
        ? chosen.filter((entry) => entry.toLowerCase() !== tag.toLowerCase())
        : [...chosen, tag],
    );
  };
  const openSaved = saved.find((entry) => entry.mode === mode && sameTags(entry.tags, chosen));

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setMessage({ kind: "alert", text: "Bitte einen Namen für die Statistik eintragen." });
      return;
    }
    setBusy(true);
    setMessage(null);
    saveStatistic(name.trim(), chosen, mode)
      .then((entry) => {
        setName("");
        setMessage({ kind: "status", text: `Die Statistik „${entry.name}“ ist gespeichert.` });
        setRound(round + 1);
      })
      .catch((problem: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Statistik konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  const measureHint = part
    ? `Gleicher Zeitraum in jedem Jahr: vom Beginn bis ${comparison?.cutoff ? `zum ${day(comparison.cutoff).slice(0, 6)}` : "heute"}`
    : window.some((entry) => entry.plan)
      ? "Laufende und künftige Jahre mit den erwarteten Kosten (gestrichelt), frühere mit dem Ist."
      : "Ganze Jahre, Ist.";

  const months = summary?.months.map((entry) => entry.name) ?? [];
  const actualMonths = summary?.months.map((entry) => entry.actual_cents) ?? [];
  const compareMonths =
    summary && summary.compare !== null
      ? summary.months.map((entry) => entry.compare_cents ?? 0)
      : null;
  const ratio = (entry: { expected_cents: number; actual_cents: number }) =>
    entry.expected_cents > 0 ? entry.actual_cents / entry.expected_cents : 0;
  const topAccounts = summary
    ? summary.accounts
        .filter((entry) => entry.expected_cents > 0)
        .sort((a, b) => ratio(b) - ratio(a))
        .slice(0, 4)
    : [];
  const partnerTotal = summary?.partners.reduce((sum, entry) => sum + entry.actual_cents, 0) ?? 0;
  const partnerRows = summary
    ? [
        ...summary.partners.slice(0, PARTNERS_SHOWN),
        ...(summary.partners.length > PARTNERS_SHOWN
          ? [
              {
                id: 0,
                name: "Weitere",
                actual_cents: summary.partners
                  .slice(PARTNERS_SHOWN)
                  .reduce((sum, entry) => sum + entry.actual_cents, 0),
              },
            ]
          : []),
      ]
    : [];
  const partnerMax = Math.max(
    1,
    ...partnerRows.filter((entry) => entry.id !== 0).map((entry) => entry.actual_cents),
  );
  const timeMark = summary ? (Math.max(0, summary.elapsed_months - 0.5) / 12) * 100 : 0;

  const comparisonControls = (withGrouping: boolean) => (
    <div className="stat-controls">
      {withGrouping && (
        <Segmented
          label="Gruppierung"
          options={[
            ["konto", "Nach Konto"],
            ["art", "Nach Art"],
          ]}
          value={grouping}
          onChange={setGrouping}
        />
      )}
      {isCurrent && (
        <Segmented
          label="Zeitraum"
          options={[
            ["stichtag", "Bis heute"],
            ["ganz", "Ganzes Jahr"],
          ]}
          value={measure}
          onChange={setMeasure}
        />
      )}
      <Segmented
        label="Darstellung"
        options={[
          ["saeulen", "Säulen"],
          ["ueberlappend", "Überlappend"],
          ["nebeneinander", "Nebeneinander"],
        ]}
        value={layout}
        onChange={setLayout}
      />
    </div>
  );

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Statistik"
        sub="Plan und Ist eines Jahres, Vergleich mit früheren Jahren und Auswertung nach Tags. Ist sind gebuchte Rechnungen; alle Beträge sind brutto."
      />
      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Statistik konnte nicht geladen werden.
        </p>
      )}
      {!failed && summary === null && <p role="status">Wird geladen …</p>}
      {summary && (
        <>
          <div className="settings-form stat-picker">
            <label className="narrow">
              {label}
              <select
                value={summary.year}
                onChange={(event) => {
                  setYear(Number(event.target.value));
                  setCompare("vorjahr");
                  setChosenYears(null);
                }}
              >
                {summary.years.map((entry) => (
                  <option key={entry.year} value={entry.year}>
                    {entry.name}
                    {entry.year === current ? " (läuft)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="narrow">
              Vergleich mit
              <select
                value={summary.compare ?? ""}
                onChange={(event) =>
                  setCompare(event.target.value === "" ? null : Number(event.target.value))
                }
              >
                <option value="">keinem Jahr</option>
                {summary.years
                  .filter((entry) => entry.year < summary.year)
                  .map((entry) => (
                    <option key={entry.year} value={entry.year}>
                      {entry.name}
                      {entry.year === summary.year - 1 ? " (Vorjahr)" : ""}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <Tabs
            label="Bereiche der Statistik"
            prefix="statistik"
            tabs={TABS}
            value={tab}
            onChange={setTab}
          />

          {tab === "ueberblick" && (
            <div
              role="tabpanel"
              id={tabIds("statistik", "ueberblick").panel}
              aria-labelledby={tabIds("statistik", "ueberblick").tab}
              className="stat-panel"
            >
              <dl className="budget-cards">
                <div className="panel budget-card">
                  <dt>
                    Geplant <InfoTip term="budget.geplant" />
                  </dt>
                  <dd className="budget-card-value">{formatEuro(summary.expected_cents)}</dd>
                  <dd className="budget-card-sub">Erwartete Kosten aller Posten</dd>
                </div>
                <div className="panel budget-card">
                  <dt>
                    Ist <InfoTip term="budget.ist" />
                  </dt>
                  <dd className="budget-card-value">{formatEuro(summary.actual_cents)}</dd>
                  <dd className="budget-card-sub">
                    {isCurrent
                      ? "gebucht bis heute"
                      : summary.year > current
                        ? "Jahr hat noch nicht begonnen"
                        : "Jahr abgeschlossen"}
                  </dd>
                </div>
                <div className="panel budget-card">
                  <dt>
                    Verfügbar <InfoTip term="budget.verfuegbar" />
                  </dt>
                  <dd className="budget-card-value">
                    {formatEuro(summary.expected_cents - summary.actual_cents)}
                  </dd>
                  <dd
                    className={
                      summary.expected_cents < summary.actual_cents
                        ? "budget-card-sub budget-bad"
                        : "budget-card-sub"
                    }
                  >
                    {summary.expected_cents < summary.actual_cents
                      ? "über dem Plan"
                      : "Plan minus Ist"}
                  </dd>
                </div>
                <div className="panel budget-card">
                  <dt>
                    Ausschöpfung <InfoTip term="budget.ausschoepfung" />
                  </dt>
                  <dd className="budget-card-value">
                    {percent(summary.actual_cents, summary.expected_cents)}
                  </dd>
                  <dd className="budget-card-sub">nach {summary.elapsed_months} von 12 Monaten</dd>
                </div>
                <div className="panel budget-card">
                  <dt>
                    {summary.compare_name ? `Zu ${summary.compare_name}` : "Vergleich"}{" "}
                    <InfoTip term="budget.vergleich" />
                  </dt>
                  <dd className="budget-card-value">
                    {summary.compare_to_date_cents !== null
                      ? change(summary.actual_cents, summary.compare_to_date_cents) || "±0 %"
                      : "–"}
                  </dd>
                  <dd className="budget-card-sub">
                    {summary.compare_to_date_cents !== null
                      ? `Ist im selben Zeitraum: ${formatEuro(summary.compare_to_date_cents)}`
                      : "oben ein Jahr zum Vergleich wählen"}
                  </dd>
                </div>
              </dl>

              <section className="panel budget-section" aria-labelledby="statistik-verlauf">
                <h2 id="statistik-verlauf">Verlauf {summary.year_name}</h2>
                <p className="small budget-muted">Ist aufsummiert je Monat, brutto.</p>
                <CumulativeChart
                  months={months}
                  actual={actualMonths}
                  compare={compareMonths}
                  compareName={summary.compare_name}
                  expected={summary.expected_cents}
                  elapsed={summary.elapsed_months}
                  yearName={summary.year_name}
                />
              </section>

              <div className="stat-cards">
                <section className="panel budget-section" aria-labelledby="statistik-monate">
                  <h2 id="statistik-monate">Ausgaben je Monat</h2>
                  <ul className="stat-keys">
                    <li>
                      <span className="stat-key stat-c0" aria-hidden="true" />
                      {summary.year_name}
                    </li>
                    {summary.compare_name && (
                      <li>
                        <span className="stat-key stat-c1" aria-hidden="true" />
                        {summary.compare_name}
                      </li>
                    )}
                  </ul>
                  <MonthColumns
                    months={months}
                    actual={actualMonths}
                    compare={compareMonths}
                    elapsed={summary.elapsed_months}
                  />
                </section>

                <section className="panel budget-section" aria-labelledby="statistik-ausschoepfung">
                  <div className="stat-section-head">
                    <h2 id="statistik-ausschoepfung">Höchste Ausschöpfung</h2>
                    <button type="button" className="button-link" onClick={() => setTab("konten")}>
                      Alle Konten
                    </button>
                  </div>
                  {topAccounts.length === 0 ? (
                    <p className="small budget-muted">
                      Für dieses Jahr sind keine Kosten erwartet.
                    </p>
                  ) : (
                    <ul className="stat-meters">
                      {topAccounts.map((entry) => (
                        <li key={entry.account.id}>
                          <span className="stat-meter-head">
                            <span>{entry.account.name}</span>
                            <span>
                              {formatEuro(entry.actual_cents)} von{" "}
                              {formatEuro(entry.expected_cents)} ·{" "}
                              <strong>{percent(entry.actual_cents, entry.expected_cents)}</strong>
                            </span>
                          </span>
                          <span className="stat-meter" aria-hidden="true">
                            <span style={{ width: `${Math.min(100, ratio(entry) * 100)}%` }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="panel budget-section" aria-labelledby="statistik-vertraege">
                  <div className="stat-section-head">
                    <h2 id="statistik-vertraege">Verträge</h2>
                    <Link to="/budget/vertraege">Zu den Verträgen</Link>
                  </div>
                  <dl className="stat-facts">
                    <div>
                      <dt>Wiederkehrend pro Jahr</dt>
                      <dd>{formatEuro(summary.contracts.yearly_cents)}</dd>
                    </div>
                    <div>
                      <dt>Kündbar in {summary.contracts.soon_days} Tagen</dt>
                      <dd>
                        {summary.contracts.soon === 1
                          ? "1 Vertrag"
                          : `${summary.contracts.soon} Verträge`}
                      </dd>
                    </div>
                  </dl>
                  {summary.contracts.next.length > 0 && (
                    <>
                      <h3 className="stat-subhead">
                        Nächste Kündigungstermine <InfoTip term="budget.kuendigungstermin" />
                      </h3>
                      <ul className="stat-contracts">
                        {summary.contracts.next.map((entry) => (
                          <li key={entry.id}>
                            <Link to={`/budget/vertraege/${entry.id}`}>{entry.title}</Link>
                            <span>
                              {entry.yearly_cents !== null
                                ? `${formatEuro(entry.yearly_cents)} im Jahr`
                                : "einmalig"}
                            </span>
                            <span className="small budget-muted">{entry.partner_name}</span>
                            <span className="small">bis {day(entry.notice_deadline)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              </div>
            </div>
          )}

          {tab === "konten" && (
            <div
              role="tabpanel"
              id={tabIds("statistik", "konten").panel}
              aria-labelledby={tabIds("statistik", "konten").tab}
              className="stat-panel"
            >
              <section className="panel budget-section" aria-labelledby="statistik-jahresvergleich">
                <h2 id="statistik-jahresvergleich">
                  Jahresvergleich <InfoTip term="budget.jahresvergleich" />
                </h2>
                <p className="small budget-muted">
                  {summary.year_name} und bis zu vier Jahre davor. Weiter zurück: oben ein älteres
                  Jahr wählen.
                </p>
                {comparisonControls(true)}
                <YearChips
                  years={window}
                  chosen={shownYears.map((entry) => entry.year)}
                  onToggle={toggleYear}
                />
                <p className="small budget-muted">{measureHint}</p>
                <div className="stat-split">
                  <div className="stat-split-main">
                    <GroupChart
                      label={`Jahresvergleich ${grouping === "art" ? "nach Art" : "nach Konto"}`}
                      groupHead={grouping === "art" ? "Art" : "Konto"}
                      years={shownYears}
                      groups={accountGroups}
                      layout={layout}
                      selected={selected}
                      onSelect={setSelected}
                    />
                  </div>
                  {(() => {
                    const group =
                      accountGroups.find((entry) => entry.key === selected) ?? accountGroups[0];
                    if (!group) {
                      return null;
                    }
                    const max = Math.max(
                      1,
                      ...window.map((entry) => group.values[entry.year] ?? 0),
                    );
                    const order = window.slice().reverse();
                    return (
                      <aside className="stat-history" aria-label={`${group.name} über fünf Jahre`}>
                        <h3>{group.name}</h3>
                        <p className="small budget-muted">Fünf Jahre; farbig sind die gewählten.</p>
                        <div className="stat-history-bars">
                          {order.map((entry) => {
                            const on = shownYears.some((shown) => shown.year === entry.year);
                            return (
                              <div key={entry.year} className="stat-history-cell">
                                <span
                                  className={`stat-fill ${on ? `stat-c${entry.slot}${entry.plan ? " stat-plan" : ""}` : "stat-off"}`}
                                  style={{
                                    height: `${((group.values[entry.year] ?? 0) / max) * 100}%`,
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <ul className="stat-history-names">
                          {order.map((entry) => (
                            <li key={entry.year}>
                              <strong>{entry.name}</strong>
                              <span>{formatEuro(group.values[entry.year] ?? 0)}</span>
                            </li>
                          ))}
                        </ul>
                      </aside>
                    );
                  })()}
                </div>
              </section>

              <div className="stat-cards stat-cards-two">
                <section className="panel budget-section" aria-labelledby="statistik-plan-ist">
                  <h2 id="statistik-plan-ist">Plan und Ist {summary.year_name}</h2>
                  <p className="small budget-muted">
                    Der Strich zeigt, wie weit das Jahr ist ({summary.elapsed_months} von 12
                    Monaten).
                  </p>
                  <ul className="stat-meters">
                    {summary.accounts.map((entry) => (
                      <li key={entry.account.id}>
                        <span className="stat-meter-head">
                          <span>
                            {entry.account.name}{" "}
                            <span className="pill pill-neutral budget-pill">
                              {KIND_LABELS[entry.account.kind]}
                            </span>
                          </span>
                          <span>
                            {formatEuro(entry.actual_cents)} von {formatEuro(entry.expected_cents)}{" "}
                            · <strong>{percent(entry.actual_cents, entry.expected_cents)}</strong>
                          </span>
                        </span>
                        <span className="stat-meter" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, ratio(entry) * 100)}%` }} />
                          <span className="stat-meter-now" style={{ left: `${timeMark}%` }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="panel budget-section" aria-labelledby="statistik-partner">
                  <h2 id="statistik-partner">Größte Rechnungssteller {summary.year_name}</h2>
                  <p className="small budget-muted">Gebuchte Rechnungen im Jahr.</p>
                  {partnerRows.length === 0 ? (
                    <p className="small budget-muted">Noch keine gebuchten Rechnungen.</p>
                  ) : (
                    <ul className="stat-partners">
                      {partnerRows.map((entry) => (
                        <li key={entry.id}>
                          {entry.id ? (
                            <Link to={`/budget/partner/${entry.id}`}>{entry.name}</Link>
                          ) : (
                            <span>{entry.name}</span>
                          )}
                          <span className="stat-meter" aria-hidden="true">
                            <span
                              style={{
                                width: `${Math.min(100, (entry.actual_cents / partnerMax) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="betrag">
                            {formatEuro(entry.actual_cents)} ·{" "}
                            {percent(entry.actual_cents, partnerTotal)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          )}

          {tab === "tags" && (
            <div
              role="tabpanel"
              id={tabIds("statistik", "tags").panel}
              aria-labelledby={tabIds("statistik", "tags").tab}
              className="stat-panel"
            >
              {tags !== null && tags.length === 0 && (
                <p className="panel panel-empty">
                  Es sind noch keine Tags vergeben. Tags trägst du am Budgetposten ein; danach
                  lassen sie sich hier auswerten.
                </p>
              )}
              {saved.length > 0 && (
                <section className="panel budget-section" aria-labelledby="statistik-gespeichert">
                  <h2 id="statistik-gespeichert">Gespeicherte Statistiken</h2>
                  <ul className="budget-saved">
                    {saved.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="chip chip-filter"
                          aria-pressed={openSaved?.id === entry.id}
                          onClick={() => {
                            setMessage(null);
                            setChosen(entry.tags);
                            setMode(entry.mode);
                          }}
                        >
                          {entry.name}
                        </button>
                        {canEdit && (
                          <DeleteButton
                            what={`Statistik ${entry.name}`}
                            run={() => deleteStatistic(entry.id)}
                            onDeleted={() => {
                              setMessage({
                                kind: "status",
                                text: `Die Statistik „${entry.name}“ ist gelöscht.`,
                              });
                              setRound(round + 1);
                            }}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {tags !== null && tags.length > 0 && (
                <section className="panel budget-section" aria-labelledby="statistik-auswahl">
                  <h2 id="statistik-auswahl">Auswertung nach Tags</h2>
                  <div className="chips" role="group" aria-label="Tags wählen">
                    {tags.map((entry) => (
                      <button
                        key={entry.tag}
                        type="button"
                        className="chip chip-filter"
                        aria-pressed={isChosen(entry.tag)}
                        onClick={() => toggleTag(entry.tag)}
                      >
                        {entry.tag} ({entry.items})
                      </button>
                    ))}
                  </div>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      className="check"
                      checked={mode === "all"}
                      onChange={(event) => setMode(event.target.checked ? "all" : "any")}
                    />
                    Alle gewählten Tags müssen am Posten stehen (sonst je Tag einzeln)
                  </label>
                  {chosen.length === 0 ? (
                    <p className="small budget-muted">Bitte mindestens einen Tag wählen.</p>
                  ) : (
                    <>
                      {comparisonControls(false)}
                      <YearChips
                        years={window}
                        chosen={shownYears.map((entry) => entry.year)}
                        onToggle={toggleYear}
                      />
                      <p className="small budget-muted">{measureHint}</p>
                      {result && (
                        <GroupChart
                          label="Auswertung nach Tags"
                          groupHead="Tag"
                          years={shownYears}
                          groups={tagGroups}
                          layout={layout}
                          selected={tagSelected}
                          onSelect={setTagSelected}
                        />
                      )}
                    </>
                  )}
                </section>
              )}
              {chosen.length > 0 && result && (
                <section className="panel budget-section" aria-labelledby="statistik-posten">
                  <h2 id="statistik-posten">
                    Budgetposten: {result.tags.join(result.mode === "all" ? " und " : " oder ")}
                  </h2>
                  <p role="status" className="small budget-muted">
                    {result.items.length === 1
                      ? "1 Budgetposten"
                      : `${result.items.length} Budgetposten`}{" "}
                    in {result.years[0]?.name} bis {result.years.at(-1)?.name}
                  </p>
                  {result.items.length === 0 ? (
                    <p>Zu dieser Auswahl gibt es keinen Budgetposten.</p>
                  ) : (
                    <div
                      className="table-wrap budget-table"
                      tabIndex={0}
                      role="region"
                      aria-label="Budgetposten der Auswahl"
                    >
                      <table>
                        <caption className="visually-hidden">
                          Budgetposten der Auswahl mit Summen über den Zeitraum
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Konto</th>
                            <th scope="col">Budgetposten</th>
                            <th scope="col">Tags</th>
                            <th scope="col" className="betrag">
                              Erwartet im Zeitraum
                            </th>
                            <th scope="col" className="betrag">
                              Ist im Zeitraum
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.items.map((row) => (
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
                              </th>
                              <td>{row.item.tags.join(", ")}</td>
                              <td className="betrag">{formatEuro(row.expected_cents)}</td>
                              <td className="betrag">{formatEuro(row.actual_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {canEdit && !openSaved && (
                    <form className="budget-merge settings-form" onSubmit={onSave} noValidate>
                      <label>
                        Auswahl speichern unter
                        <input
                          type="text"
                          value={name}
                          maxLength={80}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <button type="submit" className="button button-secondary" disabled={busy}>
                        Statistik speichern
                      </button>
                    </form>
                  )}
                  {openSaved && (
                    <p className="small budget-muted">Gespeichert als „{openSaved.name}“.</p>
                  )}
                </section>
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
          )}
        </>
      )}
    </div>
  );
}
