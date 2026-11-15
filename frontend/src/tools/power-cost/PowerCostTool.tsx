import { NumField, Tile, Tiles, dec, euro, intParam, num } from "../calc";
import { useToolParams } from "../params";
import { ErrorBox, InfoTable, ToolSection } from "../ui";
import { powerCost, type PowerResult } from "./power";

export default function PowerCostTool() {
  const [params, setParams] = useToolParams({
    watt: "350",
    anzahl: "1",
    stunden: "24",
    tage: "365",
    preis: "32",
    pue: "1",
    co2: "380",
    alternative: "",
  });
  const base = {
    count: intParam(params.anzahl, 1, 100000, 1),
    hoursPerDay: num(params.stunden),
    daysPerYear: num(params.tage),
    price: num(params.preis),
    pue: num(params.pue),
    co2: num(params.co2) || 0,
  };
  let result: PowerResult | null = null;
  let other: PowerResult | null = null;
  let error: string | null = null;
  try {
    const watts = num(params.watt);
    if ([watts, base.hoursPerDay, base.daysPerYear, base.price, base.pue].some(Number.isNaN)) {
      throw new Error("Bitte alle Felder mit Zahlen füllen.");
    }
    result = powerCost({ ...base, watts });
    if (params.alternative.trim() && !Number.isNaN(num(params.alternative))) {
      other = powerCost({ ...base, watts: num(params.alternative) });
    }
  } catch (caught) {
    error = (caught as Error).message;
  }

  return (
    <div className="tool-body settings-form">
      <div className="tool-columns">
        <NumField
          label="Leistungsaufnahme je Gerät"
          unit="W"
          value={params.watt}
          onChange={(text) => setParams({ watt: text })}
          hint="Durchschnitt im Betrieb, nicht die Nennleistung des Netzteils."
        />
        <div className="tool-field">
          <label>
            Anzahl Geräte
            <input
              type="number"
              min={1}
              max={100000}
              value={params.anzahl}
              onChange={(event) => setParams({ anzahl: event.target.value })}
            />
          </label>
        </div>
        <NumField
          label="Strompreis"
          unit="ct/kWh"
          value={params.preis}
          onChange={(text) => setParams({ preis: text })}
        />
        <NumField
          label="Betrieb pro Tag"
          unit="h"
          value={params.stunden}
          onChange={(text) => setParams({ stunden: text })}
        />
        <NumField
          label="Betriebstage pro Jahr"
          unit="Tage"
          value={params.tage}
          onChange={(text) => setParams({ tage: text })}
          hint="Büro-PC: etwa 220 Tage mit 8 bis 9 Stunden."
        />
        <NumField
          label="PUE (Kühlung, USV)"
          value={params.pue}
          onChange={(text) => setParams({ pue: text })}
          hint="1 = ohne Aufschlag. Serverraum mit Klimagerät: etwa 1,5 bis 2."
        />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {result && (
        <>
          <Tiles>
            <Tile value={euro(result.costYear)} label="pro Jahr" tone="ok" />
            <Tile value={euro(result.costMonth)} label="pro Monat" />
            <Tile value={euro(result.costDay)} label="pro Betriebstag" />
            <Tile value={`${dec(result.kwhYear, 0)} kWh`} label="Verbrauch pro Jahr" />
          </Tiles>
          <ToolSection title="Details">
            <NumField
              label="CO₂ je kWh"
              unit="g"
              value={params.co2}
              onChange={(text) => setParams({ co2: text })}
              hint="380 g entspricht grob dem deutschen Strommix der letzten Jahre; bei Ökostrom den Wert des Anbieters eintragen."
            />
            <InfoTable
              caption="Details zu Verbrauch und Kosten"
              rows={[
                { label: "Verbrauch pro Tag", plain: true, value: `${dec(result.kwhDay, 2)} kWh` },
                { label: "Über 3 Jahre", plain: true, value: euro(result.costYear * 3) },
                { label: "Über 5 Jahre", plain: true, value: euro(result.costYear * 5) },
                { label: "CO₂ pro Jahr", plain: true, value: `${dec(result.co2Year, 0)} kg` },
              ]}
            />
          </ToolSection>
          <ToolSection title="Vergleich mit einem sparsameren Gerät">
            <NumField
              label="Leistungsaufnahme der Alternative"
              unit="W"
              value={params.alternative}
              onChange={(text) => setParams({ alternative: text })}
            />
            {other && (
              <Tiles>
                <Tile
                  value={`${euro(Math.abs(result.costYear - other.costYear))} pro Jahr ${
                    other.costYear <= result.costYear ? "gespart" : "mehr"
                  }`}
                  label={`${dec(Math.abs(result.kwhYear - other.kwhYear), 0)} kWh und ${dec(
                    Math.abs(result.co2Year - other.co2Year),
                    0,
                  )} kg CO₂ Unterschied`}
                  tone={other.costYear <= result.costYear ? "ok" : "warn"}
                />
              </Tiles>
            )}
          </ToolSection>
        </>
      )}
    </div>
  );
}
