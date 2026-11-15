import { useState } from "react";
import { DataTable, NumField, Tile, Tiles, num } from "../calc";
import { useToolParams } from "../params";
import { durationText } from "../transfer/transfer";
import { ErrorBox, ToolSection } from "../ui";
import { block, downtime, fromMtbf, nines, parseComponents, system } from "./availability";

const CLASSES = [90, 99, 99.5, 99.9, 99.95, 99.99, 99.999];
const pct = (value: number) =>
  `${value.toLocaleString("de-DE", { maximumFractionDigits: value >= 99.99 ? 5 : 3 })} %`;
const EXAMPLE =
  "Internetleitung; 99,5; 2\nFirewall; 99,9; 2\nSwitch; 99,95\nServer; 99,9; 2\nStorage; 99,99";

export default function AvailabilityTool() {
  const [params, setParams] = useToolParams({ prozent: "99,9", mtbf: "8760", mttr: "4" });
  // Die Liste der Komponenten bleibt nur auf dieser Seite (sie kann Namen von Systemen enthalten).
  const [parts, setParts] = useState(EXAMPLE);
  const value = num(params.prozent.replace("%", ""));
  const valid = value > 0 && value <= 100;
  const down = valid ? downtime(value) : null;

  let fromTimes: number | null;
  try {
    const result = fromMtbf(num(params.mtbf), num(params.mttr));
    fromTimes = Number.isNaN(result) ? null : result;
  } catch {
    fromTimes = null;
  }

  const { components, errors } = parseComponents(parts);
  const total = components.length ? system(components) : null;
  const weakest = components.length
    ? components.reduce((worst, entry) => (block(entry) < block(worst) ? entry : worst))
    : null;

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Prozent → Ausfallzeit">
        <NumField
          label="Verfügbarkeit"
          unit="%"
          value={params.prozent}
          onChange={(text) => setParams({ prozent: text })}
        />
        {!valid && <ErrorBox>Verfügbarkeit zwischen 0 und 100 % angeben, z. B. 99,9.</ErrorBox>}
        {down && (
          <Tiles>
            <Tile value={durationText(down.year)} label="Ausfall pro Jahr" tone="ok" />
            <Tile value={durationText(down.month)} label="pro Monat" />
            <Tile value={durationText(down.week)} label="pro Woche" />
            <Tile value={durationText(down.day)} label="pro Tag" />
          </Tiles>
        )}
        <DataTable
          caption="Verfügbarkeitsklassen"
          head={["Verfügbarkeit", "pro Jahr", "pro Monat", "pro Woche"]}
          highlight={(index) => CLASSES[index] === value}
          rows={CLASSES.map((entry) => {
            const time = downtime(entry);
            return [
              pct(entry),
              durationText(time.year),
              durationText(time.month),
              durationText(time.week),
            ];
          })}
        />
        <p className="small">
          Gerechnet mit Betrieb rund um die Uhr (24 × 365). Geplante Wartungsfenster zählen laut
          vielen SLAs nicht als Ausfall.
        </p>
      </ToolSection>

      <ToolSection title="Aus MTBF und MTTR">
        <div className="tool-row">
          <NumField
            label="MTBF, Zeit zwischen Ausfällen"
            unit="h"
            value={params.mtbf}
            onChange={(text) => setParams({ mtbf: text })}
          />
          <NumField
            label="MTTR, Zeit bis zur Reparatur"
            unit="h"
            value={params.mttr}
            onChange={(text) => setParams({ mttr: text })}
          />
        </div>
        <Tiles>
          <Tile
            value={fromTimes !== null ? pct(fromTimes) : "–"}
            label="Verfügbarkeit = MTBF ÷ (MTBF + MTTR)"
            tone="ok"
          />
        </Tiles>
      </ToolSection>

      <ToolSection title="Gesamtsystem aus mehreren Komponenten">
        <label>
          Komponenten
          <textarea rows={6} value={parts} onChange={(event) => setParts(event.target.value)} />
        </label>
        <p className="small">
          Je Zeile: Name; Verfügbarkeit in %; Anzahl redundanter Geräte (freiwillig).
        </p>
        {errors.length > 0 && <ErrorBox>Nicht lesbar: {errors.join(" · ")}</ErrorBox>}
        {total !== null && weakest && (
          <>
            <Tiles>
              <Tile value={pct(total)} label="Gesamtverfügbarkeit" tone="ok" />
              <Tile value={durationText(downtime(total).year)} label="Ausfall pro Jahr" />
              <Tile
                value={Number.isFinite(nines(total)) ? `${nines(total)} Neunen` : "100 %"}
                label="Verfügbarkeitsklasse"
              />
              <Tile value={weakest.name} label="schwächstes Glied" tone="warn" />
            </Tiles>
            <DataTable
              caption="Komponenten des Gesamtsystems"
              head={["Komponente", "einzeln", "redundant", "Baustein", "Ausfall pro Jahr"]}
              rows={components.map((entry) => [
                entry.name,
                pct(entry.availability),
                entry.redundancy > 1 ? `${entry.redundancy}×` : "–",
                pct(block(entry)),
                durationText(downtime(block(entry)).year),
              ])}
            />
            <p className="small">
              Alle Zeilen werden gebraucht (Reihenschaltung): Die Verfügbarkeiten werden
              multipliziert, das Ergebnis ist immer schlechter als das schwächste Glied. Redundante
              Geräte fallen nur gemeinsam aus (Parallelschaltung): 1 − (1 − V)ⁿ. Vorausgesetzt ist,
              dass Ausfälle unabhängig voneinander sind; gemeinsame Ursachen wie Strom, Standort
              oder ein Software-Fehler sind damit nicht erfasst.
            </p>
          </>
        )}
      </ToolSection>
    </div>
  );
}
