import { DataTable, NumField, Tile, Tiles, euro, intParam, num, percent } from "../calc";
import { useToolParams } from "../params";
import { ErrorBox, ToolSection } from "../ui";
import { amortization, yearsText, type AmortResult } from "./amortization";

export default function AmortizationTool() {
  const [params, setParams] = useToolParams({
    invest: "12000",
    rueckfluss: "4500",
    kosten: "500",
    zins: "0",
    jahre: "5",
  });
  const years = intParam(params.jahre, 1, 50, 5);
  const interest = num(params.zins) || 0;
  const withInterest = interest > 0;
  let result: AmortResult | null = null;
  let error: string | null = null;
  try {
    const returns = num(params.rueckfluss);
    if (Number.isNaN(returns)) {
      throw new Error("Bitte den jährlichen Rückfluss angeben.");
    }
    result = amortization({
      investment: num(params.invest),
      returns,
      costs: num(params.kosten) || 0,
      interest,
      years,
    });
  } catch (caught) {
    error = (caught as Error).message;
  }
  const payback = result ? (withInterest ? result.dynamicYears : result.staticYears) : null;
  const inTime = payback !== null && payback <= years;
  const firstPositive = result
    ? result.rows.findIndex(
        (row) => (withInterest ? row.cumulativeDiscounted : row.cumulative) >= 0,
      )
    : -1;
  const invest = num(params.invest);
  const total = result ? (withInterest ? result.npv : result.surplus) : 0;

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Anschaffung">
        <div className="tool-columns">
          <NumField
            label="Anschaffungskosten"
            unit="€"
            value={params.invest}
            onChange={(text) => setParams({ invest: text })}
            hint="Einmalig: Kauf, Einrichtung, Schulung."
          />
          <NumField
            label="Rückfluss pro Jahr"
            unit="€"
            value={params.rueckfluss}
            onChange={(text) => setParams({ rueckfluss: text })}
            hint="Ersparnis oder Mehrertrag durch die Anschaffung."
          />
          <NumField
            label="Laufende Kosten pro Jahr"
            unit="€"
            value={params.kosten}
            onChange={(text) => setParams({ kosten: text })}
            hint="Wartung, Lizenzen, Strom."
          />
          <NumField
            label="Kalkulationszins"
            unit="%"
            value={params.zins}
            onChange={(text) => setParams({ zins: text })}
            hint="0 heißt statische Rechnung."
          />
          <div className="tool-field">
            <label>
              Nutzungsdauer (Jahre)
              <input
                type="number"
                min={1}
                max={50}
                value={params.jahre}
                onChange={(event) => setParams({ jahre: event.target.value })}
              />
            </label>
          </div>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {result && (
          <>
            <Tiles>
              <Tile
                value={payback === null ? "nie" : yearsText(payback)}
                label={
                  payback === null
                    ? "Die Anschaffung rechnet sich in der Nutzungsdauer nicht"
                    : `Amortisationsdauer${withInterest ? " (mit Zins)" : ""}`
                }
                tone={inTime ? "ok" : "bad"}
              />
              <Tile value={euro(result.rows[0]?.net ?? 0)} label="Überschuss pro Jahr" />
              <Tile
                value={euro(total)}
                label={
                  withInterest
                    ? "Kapitalwert nach der Nutzungsdauer"
                    : `Gewinn nach ${years} ${years === 1 ? "Jahr" : "Jahren"}`
                }
                tone={total >= 0 ? "ok" : "bad"}
              />
              <Tile value={percent(result.roiPercent, 0)} label="Rendite auf die Investition" />
            </Tiles>
            {withInterest && result.staticYears !== null && (
              <p className="small">
                Ohne Zins (statisch) wären es {yearsText(result.staticYears)}. Mit Zins dauert es
                länger, weil spätere Rückflüsse weniger wert sind als heutige.
              </p>
            )}
          </>
        )}
      </ToolSection>

      {result && (
        <ToolSection title="Verlauf">
          <DataTable
            caption="Verlauf je Jahr"
            head={["Jahr", "Überschuss", ...(withInterest ? ["abgezinst"] : []), "Stand"]}
            highlight={(index) => firstPositive >= 0 && index === firstPositive + 1}
            rows={[
              ["0", euro(-invest), ...(withInterest ? [euro(-invest)] : []), euro(-invest)],
              ...result.rows.map((row) => [
                String(row.year),
                euro(row.net),
                ...(withInterest ? [euro(row.discounted)] : []),
                euro(withInterest ? row.cumulativeDiscounted : row.cumulative),
              ]),
            ]}
          />
          <p className="small">
            Formel (statisch): Amortisationsdauer = Anschaffungskosten ÷ jährlicher Überschuss. In
            der Kostenrechnung zählt zum Rückfluss der Gewinn plus die kalkulatorische Abschreibung.
            Hervorgehoben ist das Jahr, in dem die Investition zurückverdient ist.
          </p>
        </ToolSection>
      )}
    </div>
  );
}
