import { FixedChoice } from "../../components/ListChoice";
import { useState } from "react";
import { DataTable, Tile, Tiles, intParam, num, percent } from "../calc";
import { humanSize, parseNumber } from "../data-units/units";
import { useToolParams } from "../params";
import { durationText } from "../transfer/transfer";
import { ErrorBox, InfoTable, ToolSection } from "../ui";
import { arrayState, disksNeeded, survival, type ArrayState } from "./plan";
import { calcRaid, levelInfo, type RaidLevel } from "./raid";

const LEVELS = Object.keys(levelInfo) as RaidLevel[];
const PLAN_LEVELS: RaidLevel[] = ["0", "1", "5", "6", "10", "50", "60", "z1", "z2", "z3"];
const unitFactor = (unit: string) => (unit === "GB" ? 1e9 : 1e12);
const pct = (value: number) => `${Math.round(value * 100)} %`;
const times = (value: number) => `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })}×`;

const DEFAULTS = {
  bereich: "kapazitaet",
  level: "6",
  platten: "6",
  groesse: "8",
  einheit: "TB",
  gruppen: "2",
  rebuild: "100",
  bedarf: "40",
  bedarfeinheit: "TB",
};
type Params = typeof DEFAULTS;
type Change = (patch: Partial<Params>) => void;

function UnitSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <FixedChoice
      label="Einheit"
      value={value === "GB" ? "GB" : "TB"}
      options={[
        { value: "TB", label: "TB" },
        { value: "GB", label: "GB" },
      ]}
      onChange={onChange}
    />
  );
}

function LevelSelect({ level, onChange }: { level: RaidLevel; onChange: (level: string) => void }) {
  return (
    <div className="tool-field">
      <FixedChoice
        label="RAID-Level"
        value={String(level)}
        options={[
          ...LEVELS.map((entry) => ({
            value: String(entry),
            label: String(levelInfo[entry].label),
          })),
        ]}
        onChange={(value) => onChange(value)}
      />
      <p className="small">{levelInfo[level].desc}</p>
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tool-field">
      <label>
        {label}
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

export default function RaidTool() {
  // Level, Plattenzahl, Größe und Gruppen gelten in allen drei Bereichen.
  const [params, setParams] = useToolParams(DEFAULTS);
  const area = ["plattenbedarf", "ausfall"].includes(params.bereich)
    ? params.bereich
    : "kapazitaet";
  const level = LEVELS.find((entry) => entry === params.level) ?? "6";
  return (
    <div className="tool-body settings-form">
      <FixedChoice
        label="Bereich"
        value={area}
        options={[
          { value: "kapazitaet", label: "Kapazität" },
          { value: "plattenbedarf", label: "Plattenbedarf" },
          { value: "ausfall", label: "Ausfall simulieren" },
        ]}
        onChange={(value) => setParams({ bereich: value })}
      />
      {area === "kapazitaet" && <Capacity params={params} level={level} onChange={setParams} />}
      {area === "plattenbedarf" && <DiskPlan params={params} onChange={setParams} />}
      {area === "ausfall" && (
        <Failure
          key={`${level}-${params.platten}-${params.gruppen}`}
          params={params}
          level={level}
          onChange={setParams}
        />
      )}
    </div>
  );
}

function Capacity({
  params,
  level,
  onChange,
}: {
  params: Params;
  level: RaidLevel;
  onChange: Change;
}) {
  const disks = intParam(params.platten, 1, 256, 6);
  const groups = intParam(params.gruppen, 2, 32, 2);
  const rebuild = intParam(params.rebuild, 1, 10000, 100);
  const size = (parseNumber(params.groesse) ?? 0) * unitFactor(params.einheit);
  let result: ReturnType<typeof calcRaid> | null = null;
  let error: string | null = null;
  try {
    result = calcRaid({ level, disks, size, groups });
  } catch (caught) {
    error = (caught as Error).message;
  }
  const grouped = level === "50" || level === "60";

  return (
    <>
      <div className="tool-columns">
        <LevelSelect level={level} onChange={(next) => onChange({ level: next })} />
        <NumberInput
          label="Anzahl Platten"
          min={1}
          max={256}
          value={params.platten}
          onChange={(next) => onChange({ platten: next })}
        />
        <div className="tool-field">
          <div className="tool-row">
            <label>
              Größe je Platte
              <input
                type="text"
                className="mono"
                inputMode="decimal"
                autoComplete="off"
                value={params.groesse}
                onChange={(event) => onChange({ groesse: event.target.value })}
              />
            </label>
            <UnitSelect value={params.einheit} onChange={(next) => onChange({ einheit: next })} />
          </div>
        </div>
        {grouped && (
          <NumberInput
            label="Gruppen (Spans)"
            min={2}
            max={32}
            value={params.gruppen}
            onChange={(next) => onChange({ gruppen: next })}
          />
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {result && (
        <>
          <Tiles>
            <Tile value={humanSize(result.usable, "dezimal")} label="nutzbar (Hersteller-TB)" />
            <Tile value={humanSize(result.usable, "binär")} label="nutzbar (wie Windows anzeigt)" />
            <Tile
              value={pct(result.efficiency)}
              label={`Effizienz (${result.dataDisks} von ${disks} Platten)`}
            />
            <Tile
              value={
                result.tolerates === result.toleratesBest
                  ? String(result.tolerates)
                  : `${result.tolerates}–${result.toleratesBest}`
              }
              label="Plattenausfälle verkraftbar"
              tone={result.tolerates === 0 ? "bad" : "neutral"}
            />
          </Tiles>
          <ToolSection title="Details">
            <InfoTable
              caption="Details zum Verbund"
              rows={[
                {
                  label: "Rohkapazität",
                  value: `${humanSize(result.raw, "dezimal")} (${humanSize(result.raw, "binär")})`,
                },
                {
                  label: "Für Redundanz",
                  value: humanSize(result.raw - result.usable, "dezimal"),
                },
                {
                  label: "Ausfallsicherheit",
                  plain: true,
                  value:
                    result.tolerates === 0
                      ? "keine"
                      : result.tolerates === result.toleratesBest
                        ? `${result.tolerates} beliebige Platte${result.tolerates === 1 ? "" : "n"}`
                        : `${result.tolerates} sicher, bis zu ${result.toleratesBest}, wenn sie in verschiedenen ${
                            level === "10" ? "Spiegelpaaren" : "Gruppen"
                          } liegen`,
                },
                {
                  label: "Schreib-Penalty",
                  plain: true,
                  value: `${result.writePenalty} I/O je Schreibvorgang`,
                },
                {
                  label: "Lesen (Faustregel)",
                  plain: true,
                  value: `${times(result.readFactor)} eine Platte`,
                },
                {
                  label: "Zufälliges Schreiben (Faustregel)",
                  plain: true,
                  value: `${times(result.writeFactor)} eine Platte`,
                },
              ]}
            />
          </ToolSection>
          {result.tolerates > 0 && (
            <ToolSection title="Rebuild nach Plattentausch">
              <NumberInput
                label="Rebuild-Geschwindigkeit (MB/s)"
                min={1}
                max={10000}
                value={params.rebuild}
                onChange={(next) => onChange({ rebuild: next })}
              />
              <p role="status">
                Der Rebuild dauert mindestens{" "}
                <strong>{durationText(size / (rebuild * 1e6))}</strong>.
              </p>
              {(level === "5" || level === "z1" || level === "50") && size >= 4e12 && (
                <p className="hint-box hint-warn">
                  Bei Platten ab etwa 4 TB ist RAID 5 riskant: Während des langen Rebuilds darf kein
                  weiterer Lesefehler auftreten. Besser RAID 6 oder RAID 10.
                </p>
              )}
            </ToolSection>
          )}
        </>
      )}
    </>
  );
}

function DiskPlan({ params, onChange }: { params: Params; onChange: Change }) {
  const groups = intParam(params.gruppen, 2, 32, 2);
  const need = num(params.bedarf) * unitFactor(params.bedarfeinheit);
  const size = num(params.groesse) * unitFactor(params.einheit);
  const valid = need > 0 && size > 0;
  const rows = valid
    ? PLAN_LEVELS.map((level) => {
        const plan = disksNeeded(level, need, size, groups);
        return {
          level,
          plan,
          calc: plan ? calcRaid({ level, disks: plan.disks, size, groups }) : null,
        };
      })
    : [];
  const fewest = Math.min(
    ...rows.flatMap((row) =>
      row.plan && row.calc && row.calc.tolerates > 0 ? [row.plan.disks] : [],
    ),
  );

  return (
    <>
      <div className="tool-columns">
        <div className="tool-field">
          <div className="tool-row">
            <label>
              Gewünschte Nutzkapazität
              <input
                type="text"
                className="mono"
                inputMode="decimal"
                autoComplete="off"
                value={params.bedarf}
                onChange={(event) => onChange({ bedarf: event.target.value })}
              />
            </label>
            <UnitSelect
              value={params.bedarfeinheit}
              onChange={(next) => onChange({ bedarfeinheit: next })}
            />
          </div>
        </div>
        <div className="tool-field">
          <div className="tool-row">
            <label>
              Größe je Platte
              <input
                type="text"
                className="mono"
                inputMode="decimal"
                autoComplete="off"
                value={params.groesse}
                onChange={(event) => onChange({ groesse: event.target.value })}
              />
            </label>
            <UnitSelect value={params.einheit} onChange={(next) => onChange({ einheit: next })} />
          </div>
        </div>
        <NumberInput
          label="Gruppen bei RAID 50 und 60"
          min={2}
          max={32}
          value={params.gruppen}
          onChange={(next) => onChange({ gruppen: next })}
        />
      </div>

      {!valid && <ErrorBox>Nutzkapazität und Plattengröße als Zahl angeben.</ErrorBox>}
      {valid && (
        <ToolSection title="Plattenbedarf je RAID-Level">
          <DataTable
            caption="Plattenbedarf je RAID-Level"
            head={["RAID-Level", "Platten", "nutzbar", "roh", "Effizienz", "Ausfälle verkraftbar"]}
            highlight={(index) => {
              const row = rows[index];
              return Boolean(
                row?.plan && row.calc && row.calc.tolerates > 0 && row.plan.disks === fewest,
              );
            }}
            rows={rows.map(({ level, plan, calc }) =>
              plan && calc
                ? [
                    levelInfo[level].label,
                    <strong key="platten">{plan.disks}</strong>,
                    humanSize(plan.usable, "dezimal"),
                    humanSize(calc.raw, "dezimal"),
                    percent(calc.efficiency * 100, 0),
                    calc.tolerates === 0
                      ? "keine"
                      : calc.tolerates === calc.toleratesBest
                        ? String(calc.tolerates)
                        : `${calc.tolerates}–${calc.toleratesBest}`,
                  ]
                : [levelInfo[level].label, "–", "nicht erreichbar", "–", "–", "–"],
            )}
          />
          <p className="small">
            Hervorgehoben sind die Varianten mit Redundanz, die mit den wenigsten Platten auskommen.
            „Nicht erreichbar“: Ein Spiegel wird nie größer als eine Platte. Gerechnet wird mit
            Hersteller-Einheiten (1 TB = 1000 GB); Windows zeigt dieselbe Kapazität kleiner an
            (TiB). Hot-Spare-Platten kommen zusätzlich dazu.
          </p>
        </ToolSection>
      )}
    </>
  );
}

function Failure({
  params,
  level,
  onChange,
}: {
  params: Params;
  level: RaidLevel;
  onChange: Change;
}) {
  const disks = intParam(params.platten, 1, 48, 6);
  const groups = intParam(params.gruppen, 2, 16, 2);
  // Welche Platten ausgefallen sind, gilt nur auf dieser Seite.
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  let state: ArrayState | null = null;
  let chances: number[] = [];
  let error: string | null = null;
  try {
    state = arrayState(level, disks, groups, new Set(failed));
    chances = survival(level, disks, groups);
  } catch (caught) {
    error = (caught as Error).message;
  }
  const toggle = (disk: number) => {
    const next = new Set(failed);
    if (!next.delete(disk)) {
      next.add(disk);
    }
    setFailed(next);
  };
  const grouped = level === "50" || level === "60";
  const groupCount = state?.groups.length ?? 0;
  const firstZero = chances.findIndex((chance) => chance === 0);
  const shown = chances.slice(0, firstZero < 0 ? chances.length : firstZero + 1);
  const pill =
    state?.state === "ok" ? "pill-ok" : state?.state === "degraded" ? "pill-todo" : "pill-bad";

  return (
    <>
      <div className="tool-columns">
        <LevelSelect level={level} onChange={(next) => onChange({ level: next })} />
        <NumberInput
          label="Anzahl Platten"
          min={1}
          max={48}
          value={params.platten}
          onChange={(next) => onChange({ platten: next })}
        />
        {grouped && (
          <NumberInput
            label="Gruppen (Spans)"
            min={2}
            max={16}
            value={params.gruppen}
            onChange={(next) => onChange({ gruppen: next })}
          />
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {state && (
        <>
          <ToolSection title="Platten: zum Ausfallen anklicken">
            <div className="raid-groups">
              {state.groups.map((group, index) => (
                <div
                  key={index}
                  role="group"
                  aria-label={groupCount > 1 ? `Gruppe ${index + 1}` : "Platten"}
                  className={
                    !group.alive
                      ? "raid-group raid-group-dead"
                      : group.failed
                        ? "raid-group raid-group-hit"
                        : "raid-group"
                  }
                >
                  {group.disks.map((disk) => (
                    <button
                      key={disk}
                      type="button"
                      className="raid-disk"
                      aria-pressed={failed.has(disk)}
                      aria-label={`Platte ${disk + 1}${failed.has(disk) ? " (ausgefallen)" : ""}`}
                      onClick={() => toggle(disk)}
                    >
                      {disk + 1}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <p role="status">
              <span className={`pill ${pill}`}>
                {state.state === "ok"
                  ? "Alles in Ordnung"
                  : state.state === "degraded"
                    ? `Degraded, ${failed.size} ausgefallen`
                    : "Datenverlust"}
              </span>{" "}
              {state.text}
            </p>
            {failed.size > 0 && (
              <div>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setFailed(new Set())}
                >
                  Alle Platten wieder einsetzen
                </button>
              </div>
            )}
          </ToolSection>

          <ToolSection title="Wie viele gleichzeitige Ausfälle übersteht der Verbund?">
            <DataTable
              caption="Überlebenschance je Zahl ausgefallener Platten"
              head={["Ausgefallene Platten", "überlebt in … der Fälle", "Einordnung"]}
              rows={shown.map((chance, index) => [
                `${index + 1}`,
                percent(chance * 100, 1),
                chance === 1 ? "immer" : chance === 0 ? "nie" : "je nach Platte",
              ])}
            />
            <p className="small">
              Gerechnet über alle möglichen Kombinationen ausgefallener Platten. „Je nach Platte“
              heißt: Es kommt darauf an, ob die Ausfälle dasselbe Spiegelpaar oder dieselbe Gruppe
              treffen. Ein RAID ersetzt kein Backup.
            </p>
          </ToolSection>
        </>
      )}
    </>
  );
}
