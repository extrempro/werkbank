import { FixedChoice } from "../../components/ListChoice";
import { useToolParams } from "../params";
import { ErrorBox, InfoTable, ToolSection } from "../ui";
import { fmt, parseNumber, unitById, units, type Unit } from "./units";

const FALLBACK = units.find((unit) => unit.id === "TB") ?? units[0];

export default function DataUnitsTool() {
  const [params, setParams] = useToolParams({ wert: "1", einheit: "TB" });
  const unit = unitById(params.einheit) ?? FALLBACK;
  const value = parseNumber(params.wert);
  const bits = value === null || !unit ? null : value * unit.bits;
  const bytes = bits === null ? null : bits / 8;

  const table = (system: Unit["system"], title: string) => (
    <ToolSection title={title}>
      <InfoTable
        caption={title}
        rows={units
          .filter((entry) => entry.system === system)
          .map((entry) => {
            const text = bits === null ? "" : fmt(bits / entry.bits, 6);
            return {
              label: entry.id === unit?.id ? `${entry.id} (Eingabe)` : entry.id,
              value: text || "–",
              copy: text || undefined,
            };
          })}
      />
    </ToolSection>
  );

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Wert
          <input
            type="text"
            className="mono"
            inputMode="decimal"
            autoComplete="off"
            value={params.wert}
            onChange={(event) => setParams({ wert: event.target.value })}
          />
        </label>
        <FixedChoice
          label="Einheit"
          value={String(unit?.id ?? "TB")}
          options={[
            ...units.map((entry) => ({ value: String(entry.id), label: String(entry.label) })),
          ]}
          onChange={(value) => setParams({ einheit: value })}
        />
      </div>
      {value === null && <ErrorBox>Bitte gib eine Zahl ein.</ErrorBox>}
      {table("dezimal", "Dezimal (Hersteller, macOS, Netzwerk), Faktor 1000")}
      {table("binär", "Binär (Windows, RAM, Linux-Tools), Faktor 1024")}
      {table("bit", "Bit (Bandbreite)")}
      {bytes !== null && bytes > 0 && (
        <p>
          Windows rechnet binär, schreibt aber „GB“ und „TB“: {fmt(bytes / 1e12, 4)} TB vom
          Hersteller zeigt der Explorer als{" "}
          <strong>
            {fmt(bytes / 1024 ** 4 >= 1 ? bytes / 1024 ** 4 : bytes / 1024 ** 3, 4)}{" "}
            {bytes / 1024 ** 4 >= 1 ? "TB" : "GB"}
          </strong>{" "}
          an. Der Unterschied ist kein Verlust, nur eine andere Einheit.
        </p>
      )}
    </div>
  );
}
