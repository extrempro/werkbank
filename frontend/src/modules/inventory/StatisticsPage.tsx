import { InfoTip } from "../../components/InfoTip";
import { useEffect, useId, useState } from "react";
import { errorText } from "../../api";
import {
  fetchInventoryStatistics,
  monthLabel,
  percentText,
  pieSlices,
  type InventoryStatistics,
  type StatChart,
  type StatCount,
} from "./api";

type ChartForm = "balken" | "kreis";

const OTHER = "Andere";

function sliceColor(item: StatCount, index: number): string {
  return item.label === OTHER ? "var(--chart-andere)" : `var(--chart-${(index % 8) + 1})`;
}

/** Waagerechte Balken: Name, Balken, Zahl. Eine Farbe, die Zahl steht daneben. */
function Bars({ items, total }: { items: StatCount[]; total: number }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className="stat-bars">
      {items.map((item) => (
        <li
          key={item.label}
          title={`${item.label}: ${item.count} (${percentText(item.count, total)})`}
        >
          <span className="stat-bar-label">{item.label}</span>
          <span className="stat-bar-track" aria-hidden="true">
            <span
              className="stat-bar"
              style={{ width: `${Math.max(1, (item.count / max) * 100)}%` }}
            />
          </span>
          <span className="stat-bar-value">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Ring mit höchstens acht Stücken; daneben die Legende mit Zahl und Anteil. */
function Pie({ items, total, label }: { items: StatCount[]; total: number; label: string }) {
  const slices = pieSlices(items);
  const radius = 70;
  const width = 26;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 2 : 0;
  const lengths = slices.map((item) => (total > 0 ? (item.count / total) * circumference : 0));
  const offsets = lengths.map((_, index) =>
    lengths.slice(0, index).reduce((sum, value) => sum + value, 0),
  );
  return (
    <div className="stat-pie">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={label}>
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="var(--farbe-trenner)"
          strokeWidth={width}
        />
        {slices.map((item, index) => {
          const dash = Math.max(0, (lengths[index] ?? 0) - gap);
          return (
            <circle
              key={item.label}
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke={sliceColor(item, index)}
              strokeWidth={width}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-(offsets[index] ?? 0)}
              transform="rotate(-90 90 90)"
            >
              <title>{`${item.label}: ${item.count} (${percentText(item.count, total)})`}</title>
            </circle>
          );
        })}
        <text x="90" y="88" textAnchor="middle" className="stat-pie-total">
          {total}
        </text>
        <text x="90" y="106" textAnchor="middle" className="stat-pie-unit">
          gesamt
        </text>
      </svg>
      <ul className="stat-legend">
        {slices.map((item, index) => (
          <li key={item.label}>
            <span
              className="stat-swatch"
              style={{ background: sliceColor(item, index) }}
              aria-hidden="true"
            />
            <span className="stat-legend-label">{item.label}</span>
            <span className="stat-legend-value">
              {item.count} · {percentText(item.count, total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Umschalter Balken/Kreis. */
function FormSwitch({
  value,
  onChange,
}: {
  value: ChartForm;
  onChange: (value: ChartForm) => void;
}) {
  return (
    <div className="chips" role="group" aria-label="Darstellung">
      {(["balken", "kreis"] as const).map((form) => (
        <button
          key={form}
          type="button"
          className="chip chip-filter"
          aria-pressed={value === form}
          onClick={() => onChange(form)}
        >
          {form === "balken" ? "Balken" : "Kreis"}
        </button>
      ))}
    </div>
  );
}

/** Eine Auswertung: Titel, Umschalter, Diagramm und dieselben Zahlen als Tabelle. */
function ChartCard({
  title,
  items,
  form,
  onForm,
  unit = "Geräte",
}: {
  title: string;
  items: StatCount[];
  form: ChartForm;
  onForm: (value: ChartForm) => void;
  unit?: string;
}) {
  const headingId = useId();
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="panel stat-card" aria-labelledby={headingId}>
      <div className="panel-head stat-head">
        <h2 id={headingId}>{title}</h2>
        <FormSwitch value={form} onChange={onForm} />
      </div>
      <div className="detail-body">
        {total === 0 ? (
          <p className="empty">Keine Daten.</p>
        ) : form === "balken" ? (
          <Bars items={items} total={total} />
        ) : (
          <Pie items={items} total={total} label={`${title}: ${total} ${unit}`} />
        )}
        {total > 0 && (
          <details className="stat-table">
            <summary>Als Tabelle</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{title}</th>
                    <th scope="col" className="num">
                      {unit}
                    </th>
                    <th scope="col" className="num">
                      Anteil
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td className="num">{item.count}</td>
                      <td className="num">{percentText(item.count, total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

/** IT-Bestand › Statistik: Zählungen über den aktiven Bestand, auf Wunsch je Hersteller. */
export function InventoryStatisticsPage() {
  const selectId = useId();
  const [maker, setMaker] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<{ maker: number | null; data: InventoryStatistics } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ChartForm>>({});
  const [makers, setMakers] = useState<InventoryStatistics["makers"]>([]);

  useEffect(() => {
    let active = true;
    fetchInventoryStatistics(maker).then(
      (result) => {
        if (active) {
          setFailed(null);
          setLoaded({ maker, data: result });
          if (maker === null) {
            setMakers(result.makers);
          }
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Statistik konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [maker]);

  const data = loaded && loaded.maker === maker ? loaded.data : null;
  const formOf = (key: string): ChartForm => forms[key] ?? "balken";
  const setForm = (key: string) => (value: ChartForm) => setForms({ ...forms, [key]: value });
  const options = makers.length > 0 ? makers : (data?.makers ?? []);

  const charts: StatChart[] = data ? data.charts : [];
  const retiredItems: StatCount[] = data
    ? data.retired.map((year) => ({ label: String(year.year), count: year.count }))
    : [];
  const loanItems: StatCount[] = data
    ? data.loans.months.map((month) => ({ label: monthLabel(month.label), count: month.count }))
    : [];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">IT-Bestand</p>
        <h1>Statistik</h1>
        <p className="page-sub">
          Zahlen zum aktiven Bestand. Ausgemusterte Geräte zählen nur bei „Ausmusterungen je Jahr“.
        </p>
      </header>
      <div className="settings-form stat-filter">
        <label htmlFor={selectId} className="narrow">
          Hersteller
          <select
            id={selectId}
            value={maker === null ? "" : String(maker)}
            onChange={(event) =>
              setMaker(event.target.value === "" ? null : Number(event.target.value))
            }
          >
            <option value="">Alle Hersteller</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.count})
              </option>
            ))}
          </select>
        </label>
        {data && (
          <p className="stat-total" role="status">
            {data.total === 1 ? "1 aktives Gerät" : `${data.total} aktive Geräte`}
          </p>
        )}
      </div>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!data && !failed && <p role="status">Wird geladen …</p>}
      {data && (
        <div className="stat-grid">
          {charts.map((chart) => (
            <ChartCard
              key={chart.key}
              title={chart.title}
              items={chart.items}
              form={formOf(chart.key)}
              onForm={setForm(chart.key)}
            />
          ))}
          <section className="panel stat-card" aria-labelledby="stat-verleih">
            <div className="panel-head stat-head">
              <h2 id="stat-verleih">Verleih</h2>
            </div>
            <div className="detail-body">
              <dl className="kpis stat-kpis">
                <div className="kpi">
                  <dt>Gerade verliehen</dt>
                  <dd>{data.loans.open}</dd>
                </div>
                <div className="kpi">
                  <dt>
                    Davon überfällig <InfoTip term="bestand.ueberfaellig" />
                  </dt>
                  <dd>{data.loans.overdue}</dd>
                </div>
              </dl>
              <h3 className="sub-head">Neue Verleihe je Monat</h3>
              {loanItems.some((item) => item.count > 0) ? (
                <Bars items={loanItems} total={loanItems.reduce((s, i) => s + i.count, 0)} />
              ) : (
                <p className="empty">In den letzten zwölf Monaten nichts verliehen.</p>
              )}
            </div>
          </section>
          <ChartCard
            title="Ausmusterungen je Jahr"
            items={retiredItems}
            form={formOf("ausmusterung")}
            onForm={setForm("ausmusterung")}
          />
          {data.retired.length > 0 && (
            <section className="panel stat-card" aria-labelledby="stat-gruende">
              <div className="panel-head">
                <h2 id="stat-gruende">Gründe der Ausmusterung</h2>
              </div>
              <div className="detail-body">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Jahr</th>
                        <th scope="col">Grund</th>
                        <th scope="col" className="num">
                          Geräte
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.retired.flatMap((year) =>
                        year.reasons.map((reason, index) => (
                          <tr key={`${year.year}-${reason.label}`}>
                            <td>{index === 0 ? year.year : ""}</td>
                            <td>{reason.label}</td>
                            <td className="num">{reason.count}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
