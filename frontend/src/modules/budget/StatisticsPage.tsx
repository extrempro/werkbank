import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { useSearchParam } from "../../router";
import {
  BUDGET_EDITOR_ROLES,
  deleteStatistic,
  fetchBudgetSettings,
  fetchStatistics,
  fetchTags,
  formatEuro,
  niceMax,
  queryStatistic,
  saveStatistic,
  type SavedStatistic,
  type Statistic,
  type StatisticYear,
  type TagCount,
  type TagMode,
} from "./api";
import { BudgetHead, DeleteButton } from "./shared";

const WIDTH = 640;
const HEIGHT = 240;
const LEFT = 8;
const TOP = 22;
const BOTTOM = 30;
const BAR = 30;
const GAP = 2;
const RADIUS = 4;

/** Balken mit runder Oberkante, unten an der Grundlinie verankert. */
function barPath(x: number, base: number, height: number): string {
  const radius = Math.min(RADIUS, height);
  const top = base - height;
  return [
    `M${x},${base}`,
    `V${top + radius}`,
    `Q${x},${top} ${x + radius},${top}`,
    `H${x + BAR - radius}`,
    `Q${x + BAR},${top} ${x + BAR},${top + radius}`,
    `V${base}`,
    "Z",
  ].join(" ");
}

/** Erwartet und Ist je Geschäftsjahr als Balkenpaare. Die Tabelle darunter zeigt dieselben Zahlen. */
function TagChart({ years, label }: { years: StatisticYear[]; label: string }) {
  const max = niceMax(Math.max(...years.flatMap((year) => [year.expected_cents, year.actual_cents])));
  const base = HEIGHT - BOTTOM;
  const plot = base - TOP;
  const slot = (WIDTH - 2 * LEFT) / Math.max(years.length, 1);
  const lines = [0, 0.5, 1];
  return (
    <figure className="budget-chart">
      <ul className="budget-legend">
        <li>
          <span className="budget-dot budget-dot-plan" aria-hidden="true" />
          Erwartet
        </li>
        <li>
          <span className="budget-dot budget-dot-bound" aria-hidden="true" />
          Ist
        </li>
      </ul>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Erwartet und Ist je ${label}. Die Zahlen stehen in der Tabelle darunter.`}
      >
        {lines.map((part) => (
          <g key={part}>
            <line
              className="budget-chart-grid"
              x1={LEFT}
              x2={WIDTH - LEFT}
              y1={base - part * plot}
              y2={base - part * plot}
            />
            {part > 0 && (
              <text className="budget-chart-axis" x={LEFT} y={base - part * plot - 5}>
                {formatEuro(max * part)}
              </text>
            )}
          </g>
        ))}
        {years.map((year, index) => {
          const center = LEFT + slot * index + slot / 2;
          const planHeight = (year.expected_cents / max) * plot;
          const actualHeight = (year.actual_cents / max) * plot;
          return (
            <g key={year.year}>
              {year.expected_cents > 0 && (
                <path
                  className="budget-chart-plan"
                  d={barPath(center - BAR - GAP / 2, base, planHeight)}
                >
                  <title>{`${year.name}: erwartet ${formatEuro(year.expected_cents)}`}</title>
                </path>
              )}
              {year.actual_cents > 0 && (
                <path
                  className="budget-chart-actual"
                  d={barPath(center + GAP / 2, base, actualHeight)}
                >
                  <title>{`${year.name}: Ist ${formatEuro(year.actual_cents)}`}</title>
                </path>
              )}
              <text className="budget-chart-label" x={center} y={HEIGHT - 10} textAnchor="middle">
                {year.name}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  const lower = (tags: readonly string[]) => tags.map((tag) => tag.toLowerCase()).sort();
  return lower(left).join("\n") === lower(right).join("\n");
}

/** IT-Budget › Statistik: erwartete Kosten und Ist der Budgetposten mit bestimmten Tags über fünf Jahre. */
export function StatisticsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const linked = useSearchParam("tag");
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [saved, setSaved] = useState<SavedStatistic[]>([]);
  const [currentYear, setCurrentYear] = useState<number | null>(null);
  const [chosen, setChosen] = useState<string[]>(linked ? [linked] : []);
  const [mode, setMode] = useState<TagMode>("any");
  // Rückblick: die fünf Jahre bis zum laufenden; Ausblick: das laufende und die vier danach
  const [ahead, setAhead] = useState(false);
  const [result, setResult] = useState<Statistic | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([fetchTags(), fetchStatistics(), fetchBudgetSettings()])
      .then(([list, statistics, settings]) => {
        if (active) {
          setTags(list);
          setSaved(statistics);
          setCurrentYear(settings.current_year);
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

  const key = chosen.join("\n");
  useEffect(() => {
    const wanted = key === "" ? [] : key.split("\n");
    if (wanted.length === 0 || currentYear === null) {
      return;
    }
    let active = true;
    queryStatistic(wanted, mode, ahead ? currentYear : null)
      .then((statistic) => {
        if (active) {
          setResult(statistic);
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
  }, [key, mode, ahead, currentYear]);

  const isChosen = (tag: string) =>
    chosen.some((entry) => entry.toLowerCase() === tag.toLowerCase());
  const toggle = (tag: string) => {
    setMessage(null);
    setChosen(
      isChosen(tag)
        ? chosen.filter((entry) => entry.toLowerCase() !== tag.toLowerCase())
        : [...chosen, tag],
    );
  };
  const openSaved = saved.find((entry) => entry.mode === mode && sameTags(entry.tags, chosen));
  const shown = chosen.length > 0 ? result : null;
  const label = shown?.year_label ?? "Geschäftsjahr";
  const planSum = shown ? shown.years.reduce((sum, year) => sum + year.expected_cents, 0) : 0;
  const actualSum = shown ? shown.years.reduce((sum, year) => sum + year.actual_cents, 0) : 0;

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

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Statistik"
        sub="Erwartete Kosten und Ist aller Budgetposten mit bestimmten Tags über fünf Jahre. Ist sind gebuchte Rechnungen; alle Beträge sind brutto."
      />
      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Statistik konnte nicht geladen werden.
        </p>
      )}
      {!failed && tags === null && <p role="status">Wird geladen …</p>}
      {tags !== null && tags.length === 0 && (
        <p className="panel panel-empty">
          Es sind noch keine Tags vergeben. Tags trägst du am Budgetposten ein; danach lassen sie
          sich hier auswerten.
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
          <h2 id="statistik-auswahl">Auswahl</h2>
          <div className="chips" role="group" aria-label="Tags wählen">
            {tags.map((entry) => (
              <button
                key={entry.tag}
                type="button"
                className="chip chip-filter"
                aria-pressed={isChosen(entry.tag)}
                onClick={() => toggle(entry.tag)}
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
            Alle gewählten Tags müssen am Posten stehen (sonst reicht einer)
          </label>
          <div className="chips" role="group" aria-label="Zeitraum">
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={!ahead}
              onClick={() => setAhead(false)}
            >
              Rückblick: letzte fünf Jahre
            </button>
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={ahead}
              onClick={() => setAhead(true)}
            >
              Ausblick: nächste fünf Jahre
            </button>
          </div>
        </section>
      )}
      {tags !== null && tags.length > 0 && chosen.length === 0 && (
        <p className="panel panel-empty">Bitte mindestens einen Tag wählen.</p>
      )}
      {shown && (
        <section className="panel budget-section" aria-labelledby="statistik-ergebnis">
          <h2 id="statistik-ergebnis">
            {shown.tags.join(shown.mode === "all" ? " und " : " oder ")}
          </h2>
          <p role="status" className="small budget-muted">
            {shown.items.length === 1 ? "1 Budgetposten" : `${shown.items.length} Budgetposten`} ·
            Erwartet {formatEuro(planSum)} · Ist {formatEuro(actualSum)}
          </p>
          {shown.items.length === 0 ? (
            <p>Zu dieser Auswahl gibt es keinen Budgetposten.</p>
          ) : (
            <>
              {planSum + actualSum > 0 && <TagChart years={shown.years} label={label} />}
              <div
                className="table-wrap budget-table"
                tabIndex={0}
                role="region"
                aria-label={`Erwartet und Ist je ${label}`}
              >
                <table>
                  <caption className="visually-hidden">Erwartet und Ist je {label}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{label}</th>
                      <th scope="col" className="betrag">
                        Erwartet
                      </th>
                      <th scope="col" className="betrag">
                        Ist
                      </th>
                      <th scope="col" className="betrag">
                        Erwartet abzüglich Ist
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.years.map((year) => (
                      <tr key={year.year}>
                        <th scope="row">
                          {year.name}
                          {year.year === shown.current_year && (
                            <span className="pill pill-neutral budget-pill">läuft</span>
                          )}
                        </th>
                        <td className="betrag">{formatEuro(year.expected_cents)}</td>
                        <td className="betrag">{formatEuro(year.actual_cents)}</td>
                        <td
                          className={
                            year.actual_cents > year.expected_cents ? "betrag budget-bad" : "betrag"
                          }
                        >
                          {formatEuro(year.expected_cents - year.actual_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="budget-summe">
                      <th scope="row">Summe</th>
                      <td className="betrag">{formatEuro(planSum)}</td>
                      <td className="betrag">{formatEuro(actualSum)}</td>
                      <td className="betrag">{formatEuro(planSum - actualSum)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
                    {shown.items.map((row) => (
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
            </>
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
          {openSaved && <p className="small budget-muted">Gespeichert als „{openSaved.name}“.</p>}
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
  );
}
