import { useEffect, useId, useState } from "react";
import { errorText } from "../../api";
import { InfoTip } from "../../components/InfoTip";
import type { HelpKey } from "../../help/terms";
import {
  fetchInventoryStatistics,
  percentText,
  type InventoryStatistics,
  type StatChart,
  type StatCount,
  type StatFilterKey,
  type StatFilters,
  type StatOption,
} from "./api";

type ChartForm = "balken" | "tabelle";

const SECTION_KEYS = ["ueberblick", "alter", "orte", "verleih", "ausmusterung", "daten"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const NO_FILTERS: StatFilters = { maker: null, kind: null, site: null, department: null };

const FILTER_LABELS: Record<StatFilterKey, { label: string; all: string }> = {
  maker: { label: "Hersteller", all: "Alle Hersteller" },
  kind: { label: "Art", all: "Alle Arten" },
  site: { label: "Standort", all: "Alle Standorte" },
  department: { label: "Abteilung", all: "Alle Abteilungen" },
};

const OPTIONS_OF: Record<StatFilterKey, keyof InventoryStatistics> = {
  maker: "makers",
  kind: "kinds",
  site: "sites",
  department: "departments",
};

function initialSection(): SectionKey {
  const value = new URLSearchParams(window.location.search).get("bereich");
  return SECTION_KEYS.find((key) => key === value) ?? "ueberblick";
}

/** Waagerechte Balken: Name, Balken, Zahl. Mit Filter ist jeder Balken ein Knopf. */
function Bars({
  items,
  total,
  onPick,
  picked,
}: {
  items: StatCount[];
  total: number;
  onPick: ((item: StatCount) => void) | null;
  picked: number | null;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className="stat-bars">
      {items.map((item) => {
        const content = (
          <>
            <span className="stat-bar-label">
              {item.label}
              {item.warn && <span className="visually-hidden"> (hervorgehoben)</span>}
            </span>
            <span className="stat-bar-track" aria-hidden="true">
              <span
                className={item.warn ? "stat-bar stat-bar-warn" : "stat-bar"}
                style={{ width: `${Math.max(1, (item.count / max) * 100)}%` }}
              />
            </span>
            <span className="stat-bar-value">{item.count}</span>
          </>
        );
        const title = `${item.label}: ${item.count} (${percentText(item.count, total)})`;
        const canPick = onPick !== null && item.value !== null && item.value !== undefined;
        return (
          <li key={item.label} title={title}>
            {canPick ? (
              <button
                type="button"
                className="stat-bar-button"
                aria-pressed={picked === item.value}
                onClick={() => onPick(item)}
              >
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Eine Auswertung: Titel, Umschalter Balken/Tabelle, Hinweis. */
function ChartCard({
  chart,
  form,
  onForm,
  onPick,
  picked,
}: {
  chart: StatChart;
  form: ChartForm;
  onForm: (value: ChartForm) => void;
  onPick: ((item: StatCount) => void) | null;
  picked: number | null;
}) {
  const headingId = useId();
  const total = chart.items.reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="panel stat-card" aria-labelledby={headingId}>
      <div className="panel-head stat-head">
        <h2 id={headingId}>{chart.title}</h2>
        <div className="chips" role="group" aria-label={`Darstellung: ${chart.title}`}>
          {(["balken", "tabelle"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="chip chip-filter"
              aria-pressed={form === value}
              onClick={() => onForm(value)}
            >
              {value === "balken" ? "Balken" : "Tabelle"}
            </button>
          ))}
        </div>
      </div>
      <div className="detail-body">
        {total === 0 ? (
          <p className="empty">Keine Daten.</p>
        ) : form === "balken" ? (
          <Bars items={chart.items} total={total} onPick={onPick} picked={picked} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{chart.title}</th>
                  <th scope="col" className="num">
                    {chart.unit}
                  </th>
                  <th scope="col" className="num">
                    Anteil
                  </th>
                </tr>
              </thead>
              <tbody>
                {chart.items.map((item) => (
                  <tr key={item.label}>
                    <td>
                      {item.label}
                      {item.warn && <span className="pill pill-todo stat-warn">beachten</span>}
                    </td>
                    <td className="num">{item.count}</td>
                    <td className="num">{percentText(item.count, total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {chart.note && <p className="small stat-note">{chart.note}</p>}
      </div>
    </section>
  );
}

interface Kpi {
  label: string;
  value: string;
  sub: string;
  section: SectionKey;
  warn?: boolean;
  term?: HelpKey;
}

/** IT-Bestand › Statistik: Kennzahlen und Auswertungen in Bereichen, mit Filtern. */
export function InventoryStatisticsPage() {
  const [filters, setFilters] = useState<StatFilters>(NO_FILTERS);
  const [section, setSection] = useState<SectionKey>(initialSection);
  const [loaded, setLoaded] = useState<{ key: string; data: InventoryStatistics } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ChartForm>>({});
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let active = true;
    fetchInventoryStatistics(filters).then(
      (result) => {
        if (active) {
          setFailed(null);
          setLoaded({ key: filterKey, data: result });
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Statistik konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Beim Neuladen bleibt der alte Stand stehen, damit die Seite nicht springt
  const data = loaded?.data ?? null;
  const loading = loaded?.key !== filterKey;

  const chooseSection = (key: SectionKey) => {
    setSection(key);
    const url = new URL(window.location.href);
    url.searchParams.set("bereich", key);
    window.history.replaceState(window.history.state, "", url);
  };
  const setFilter = (key: StatFilterKey, value: number | null) =>
    setFilters({ ...filters, [key]: value });
  const active = (Object.keys(filters) as StatFilterKey[]).filter((key) => filters[key] !== null);

  const kpis: Kpi[] = data
    ? [
        {
          label: "Aktive Geräte",
          value: String(data.kpis.total),
          sub: `${data.kpis.new_this_month} neu in diesem Monat`,
          section: "ueberblick",
        },
        {
          label: "Im Lager, frei",
          value: String(data.kpis.free),
          sub: "sofort ausgebbar",
          section: "orte",
        },
        {
          label: "Verliehen",
          value: String(data.kpis.loans_open),
          sub:
            data.kpis.loans_overdue === 1
              ? "1 überfällig"
              : `${data.kpis.loans_overdue} überfällig`,
          section: "verleih",
          warn: data.kpis.loans_overdue > 0,
        },
        {
          label: "Erneuerung fällig",
          value: data.kpis.renewal_due === null ? "–" : String(data.kpis.renewal_due),
          sub:
            data.kpis.renewal_due === null
              ? "Nutzungsdauer fehlt"
              : `${percentText(data.kpis.renewal_due, data.kpis.total)} des Bestands`,
          section: "alter",
          warn: (data.kpis.renewal_due ?? 0) > 0,
          term: "bestand.erneuerung",
        },
        {
          label: "Arbeitsplätze mit Lücke",
          value: String(data.kpis.workplaces_gap),
          sub: "laut Vorlage",
          section: "orte",
        },
        {
          label: "Fehlende Angaben",
          value: String(data.kpis.missing),
          sub: "über alle Felder",
          section: "daten",
        },
      ]
    : [];

  const current = data?.sections.find((entry) => entry.key === section) ?? data?.sections[0];

  return (
    <div className="page page-wide stat-page">
      <header className="page-head stat-page-head">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Statistik</h1>
          <p className="page-sub">
            Wie der Bestand aussieht, was ersetzt werden muss und wo Daten fehlen. Gezählt werden
            aktive Geräte; ausgemusterte nur unter „Ausmusterung“.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary no-print"
          onClick={() => window.print()}
        >
          Drucken oder als PDF
        </button>
      </header>

      {data && (
        <section className="panel stat-filters no-print" aria-label="Filter">
          {(Object.keys(FILTER_LABELS) as StatFilterKey[]).map((key) => (
            <label key={key} className="filter-field">
              {FILTER_LABELS[key].label}
              <select
                value={filters[key] === null ? "" : String(filters[key])}
                onChange={(event) =>
                  setFilter(key, event.target.value === "" ? null : Number(event.target.value))
                }
              >
                <option value="">{FILTER_LABELS[key].all}</option>
                {(data[OPTIONS_OF[key]] as StatOption[]).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          ))}
          {active.length > 0 && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setFilters(NO_FILTERS)}
            >
              Filter aufheben
            </button>
          )}
          <p className="small stat-loading" role="status">
            {loading ? "Wird aktualisiert …" : ""}
          </p>
        </section>
      )}

      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!data && !failed && <p role="status">Wird geladen …</p>}

      {data && current && (
        <>
          <ul className="stat-kpi-grid" aria-label="Kennzahlen">
            {kpis.map((kpi) => (
              <li key={kpi.label}>
                <button
                  type="button"
                  className="stat-kpi"
                  onClick={() => chooseSection(kpi.section)}
                >
                  <span className="stat-kpi-label">
                    {kpi.label}
                    <span className="visually-hidden">: </span>
                  </span>
                  <span className={kpi.warn ? "stat-kpi-value stat-kpi-warn" : "stat-kpi-value"}>
                    {kpi.value}
                    <span className="visually-hidden">, </span>
                  </span>
                  <span className="stat-kpi-sub">{kpi.sub}</span>
                </button>
                {kpi.term && (
                  <span className="stat-kpi-tip">
                    <InfoTip term={kpi.term} />
                  </span>
                )}
              </li>
            ))}
          </ul>

          <nav className="project-tabs no-print" aria-label="Bereiche der Statistik">
            {data.sections.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={entry.key === current.key ? "project-tab project-tab-on" : "project-tab"}
                aria-current={entry.key === current.key ? "page" : undefined}
                onClick={() => chooseSection(entry.key as SectionKey)}
              >
                {entry.title}
              </button>
            ))}
          </nav>
          <h2 className="print-only">{current.title}</h2>
          <p className="stat-intro">{current.intro}</p>

          <div className="stat-cards">
            {current.charts.map((chart) => {
              const key = chart.filter;
              return (
                <ChartCard
                  key={chart.key}
                  chart={chart}
                  form={forms[chart.key] ?? "balken"}
                  onForm={(value) => setForms({ ...forms, [chart.key]: value })}
                  picked={key ? filters[key] : null}
                  onPick={
                    key
                      ? (item) =>
                          setFilter(key, filters[key] === item.value ? null : (item.value ?? null))
                      : null
                  }
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
