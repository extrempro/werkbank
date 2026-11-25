import { FixedChoice } from "../../components/ListChoice";
import { DataTable, NumField, Tile, Tiles, intParam, num } from "../calc";
import { humanSize, parseSize } from "../data-units/units";
import { useToolParams } from "../params";
import { durationText } from "../transfer/transfer";
import { ErrorBox, Segmented, ToolSection } from "../ui";
import {
  backupPlan,
  restoreChain,
  strategyLabels,
  weekdays,
  type BackupInput,
  type BackupPlan,
  type Strategy,
} from "./backup";

const LONG_DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const ABOUT: Record<Strategy, string> = {
  full: "Jede Sicherung enthält alles. Einfachste Wiederherstellung (eine Sicherung), aber größter Speicherbedarf und längste Laufzeit.",
  incremental:
    "Nach der Vollsicherung nur, was sich seit der letzten Sicherung geändert hat. Kleinste Sicherungen; für die Wiederherstellung braucht man aber die ganze Kette.",
  differential:
    "Nach der Vollsicherung alles, was sich seit der Vollsicherung geändert hat. Wächst von Tag zu Tag, dafür reichen zur Wiederherstellung zwei Sicherungen.",
};
const STRATEGIES = Object.keys(strategyLabels) as Strategy[];

export default function BackupPlanTool() {
  const [params, setParams] = useToolParams({
    daten: "2 TB",
    aenderung: "5",
    art: "incremental",
    vollTag: "4",
    tage: "5",
    wochen: "4",
    einsparung: "30",
    durchsatz: "100",
    wiederherstellen: "3",
  });
  const strategy: Strategy = STRATEGIES.includes(params.art as Strategy)
    ? (params.art as Strategy)
    : "incremental";
  const days = intParam(params.tage, 5, 7, 5);
  const fullDay = intParam(params.vollTag, 0, days - 1, Math.min(4, days - 1));
  const weeks = intParam(params.wochen, 1, 520, 4);
  const speed = num(params.durchsatz) || 0;
  const size = parseSize(params.daten);
  let plan: BackupPlan | null = null;
  let input: BackupInput | null = null;
  let error: string | null = null;
  try {
    if (!size) {
      throw new Error(
        "Bitte gib die Datenmenge mit Einheit an, zum Beispiel „2 TB“ oder „500 GB“.",
      );
    }
    input = {
      data: size.bits / 8,
      change: num(params.aenderung),
      strategy,
      fullDay,
      daysPerWeek: days,
      weeks,
      savings: num(params.einsparung) || 0,
      throughput: speed,
    };
    plan = backupPlan(input);
  } catch (caught) {
    error = (caught as Error).message;
  }
  const wanted = intParam(params.wiederherstellen, 0, 6, 3);
  const restoreDay =
    plan && plan.days[wanted]?.type !== "–"
      ? wanted
      : (plan?.days.findIndex((day) => day.type !== "–") ?? 0);
  const chain = plan && input ? restoreChain(input, restoreDay) : [];
  const chainSize = plan
    ? chain.reduce((sum, entry) => sum + (plan.days[entry.day]?.size ?? 0), 0)
    : 0;

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Sicherungsart">
        <Segmented
          label="Sicherungsart"
          value={strategy}
          options={STRATEGIES.map((key) => [key, strategyLabels[key]] as const)}
          onChange={(value) => setParams({ art: value })}
        />
        <p className="small">{ABOUT[strategy]}</p>
      </ToolSection>

      <ToolSection title="Daten und Zeitplan">
        <div className="tool-columns">
          <div className="tool-field">
            <label>
              Datenbestand
              <input
                type="text"
                className="mono"
                value={params.daten}
                onChange={(event) => setParams({ daten: event.target.value })}
              />
            </label>
          </div>
          <NumField
            label="Tägliche Änderung"
            unit="%"
            value={params.aenderung}
            onChange={(text) => setParams({ aenderung: text })}
            hint="Fileserver 1 bis 5 %, Datenbanken und Mail oft mehr."
          />
          <NumField
            label="Einsparung durch Komprimierung"
            unit="%"
            value={params.einsparung}
            onChange={(text) => setParams({ einsparung: text })}
          />
          <div className="tool-field">
            <FixedChoice
              label="Sicherungstage pro Woche"
              value={String(days)}
              options={[5, 6, 7].map((count) => ({
                value: String(count),
                label:
                  count === 7
                    ? "täglich (Mo bis So)"
                    : `${count} Tage (Mo bis ${weekdays[count - 1]})`,
              }))}
              onChange={(value) => setParams({ tage: value })}
            />
          </div>
          {strategy !== "full" && (
            <div className="tool-field">
              <FixedChoice
                label="Vollsicherung am"
                value={String(fullDay)}
                options={[
                  ...LONG_DAYS.slice(0, days).map((day, index) => ({
                    value: String(index),
                    label: String(day),
                  })),
                ]}
                onChange={(value) => setParams({ vollTag: value })}
              />
            </div>
          )}
          <div className="tool-field">
            <label>
              Aufbewahrung (Wochen)
              <input
                type="number"
                min={1}
                max={520}
                value={params.wochen}
                onChange={(event) => setParams({ wochen: event.target.value })}
              />
            </label>
          </div>
          <NumField
            label="Durchsatz der Sicherung"
            unit="MB/s"
            value={params.durchsatz}
            onChange={(text) => setParams({ durchsatz: text })}
            hint="1 Gbit/s schafft höchstens etwa 110 MB/s; LTO-9 bis 400 MB/s."
          />
        </div>
      </ToolSection>

      {error && <ErrorBox>{error}</ErrorBox>}
      {plan && (
        <>
          <Tiles>
            <Tile
              value={humanSize(plan.totalStored, "dezimal")}
              label={`Speicherbedarf für ${weeks} ${weeks === 1 ? "Woche" : "Wochen"}`}
              tone="ok"
            />
            <Tile value={humanSize(plan.weekStored, "dezimal")} label="je Woche" />
            <Tile
              value={speed > 0 ? durationText(plan.longestSeconds) : "–"}
              label="Längste Sicherung (Backup-Fenster)"
            />
            <Tile
              value={String(chain.length)}
              label={`Sicherungen für eine Wiederherstellung (${weekdays[restoreDay]})`}
            />
          </Tiles>

          <ToolSection title="Wochenplan">
            <DataTable
              caption="Wochenplan der Sicherungen"
              head={["Tag", "Art", "Gesichert", "Belegt", "Dauer"]}
              numericFrom={2}
              highlight={(index) => chain.some((entry) => entry.day === index)}
              rows={plan.days.map((day) => [
                LONG_DAYS[day.day],
                day.type === "–" ? (
                  <span className="budget-muted">keine Sicherung</span>
                ) : (
                  <span className={day.type === "voll" ? "pill pill-ok" : "pill pill-neutral"}>
                    {day.type}
                  </span>
                ),
                day.type === "–" ? "" : humanSize(day.size, "dezimal"),
                day.type === "–" ? "" : humanSize(day.stored, "dezimal"),
                day.type === "–" || speed <= 0 ? "" : durationText(day.seconds),
              ])}
            />
          </ToolSection>

          <ToolSection title="Wiederherstellung">
            <div className="tool-field">
              <FixedChoice
                label="Stand nach der Sicherung am"
                value={String(restoreDay)}
                options={plan.days
                  .filter((day) => day.type !== "–")
                  .map((day) => ({ value: String(day.day), label: String(LONG_DAYS[day.day]) }))}
                onChange={(value) => setParams({ wiederherstellen: value })}
              />
            </div>
            <p className="small">Dafür werden gebraucht (im Wochenplan hervorgehoben):</p>
            <ol className="tool-list">
              {chain.map((entry, index) => (
                <li key={index}>
                  {LONG_DAYS[entry.day]}:{" "}
                  <strong>
                    {entry.type === "voll" ? "Vollsicherung" : `${entry.type}e Sicherung`}
                  </strong>{" "}
                  ({humanSize(plan.days[entry.day]?.size ?? 0, "dezimal")})
                </li>
              ))}
            </ol>
            <p className="small">
              Zurückzuspielen sind {humanSize(chainSize, "dezimal")}
              {speed > 0
                ? `, bei ${params.durchsatz} MB/s mindestens ${durationText(chainSize / (speed * 1e6))}`
                : ""}
              . Fehlt eine Sicherung der Kette oder ist sie defekt, lässt sich alles danach nicht
              mehr wiederherstellen; deshalb Wiederherstellungen regelmäßig testen. Der Plan ist
              eine Abschätzung: Mehrfach geänderte Dateien zählen bei differenziellen Sicherungen
              nur einmal, der echte Bedarf liegt also eher darunter. Faustregel 3-2-1: drei Kopien,
              zwei Medien, eine außer Haus.
            </p>
          </ToolSection>
        </>
      )}
    </div>
  );
}
