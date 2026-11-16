import { useState } from "react";
import { Bar, Tile, Tiles, dec } from "../calc";
import { ErrorBox, ToolSection } from "../ui";
import { parseUtility, utilityAnalysis, type UtilityInput, type UtilityResult } from "./utility";

const EXAMPLE = [
  "Kriterium; Gewicht; Anbieter A; Anbieter B; Anbieter C",
  "Preis; 30; 8; 6; 9",
  "Support; 25; 5; 9; 4",
  "Funktionsumfang; 25; 7; 8; 6",
  "Bedienbarkeit; 20; 6; 7; 9",
].join("\n");

export default function UtilityAnalysisTool() {
  // Die Tabelle bleibt im Browser und steht nicht in der Adresszeile (Anbieter, Bewertungen).
  const [table, setTable] = useState(EXAMPLE);
  let input: UtilityInput | null = null;
  let result: UtilityResult | null = null;
  let error: string | null = null;
  try {
    input = parseUtility(table);
    result = utilityAnalysis(input);
  } catch (caught) {
    error = (caught as Error).message;
  }
  const totals = result?.totals ?? [];
  const max = Math.max(...totals, 1e-9);
  const order = totals.map((_, index) => index).sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  const first = order[0];
  const second = order[1];
  const weightsComplete = result ? Math.abs(result.weightSum - 100) < 1e-9 : true;

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Kriterien und Bewertungen">
        <label>
          Tabelle: Kopfzeile Kriterium; Gewicht; Alternativen …, danach je Kriterium eine Zeile
          <textarea
            className="mono"
            rows={7}
            spellCheck={false}
            value={table}
            onChange={(event) => setTable(event.target.value)}
          />
        </label>
        <p className="small">
          Bewertung zum Beispiel von 1 (schlecht) bis 10 (sehr gut). Wichtig ist nur, dass für alle
          Kriterien dieselbe Skala gilt und mehr Punkte besser sind (bei Kosten: günstiger gibt mehr
          Punkte). Trenner Semikolon oder Tabulator, direkt aus Excel einfügbar.
        </p>
      </ToolSection>

      {error && <ErrorBox>{error}</ErrorBox>}
      {input && result && (
        <>
          <Tiles>
            <Tile
              value={result.best.map((index) => input.alternatives[index]).join(" / ")}
              label={result.best.length > 1 ? "Gleichstand an der Spitze" : "Höchster Nutzwert"}
              tone="ok"
            />
            <Tile value={dec(Math.max(...totals))} label="Nutzwert des Siegers" />
            <Tile
              value={
                first !== undefined && second !== undefined
                  ? dec((totals[first] ?? 0) - (totals[second] ?? 0))
                  : "–"
              }
              label="Vorsprung auf Platz 2"
            />
            <Tile
              value={dec(result.weightSum)}
              label={
                weightsComplete ? "Summe der Gewichte" : "Summe der Gewichte, auf 100 % umgerechnet"
              }
              tone={weightsComplete ? "neutral" : "warn"}
            />
          </Tiles>

          <ToolSection title="Rangfolge">
            <ol className="tool-ranking">
              {order.map((index) => (
                <li key={index}>
                  <span className="mono">{result.ranks[index]}.</span>
                  <span>{input.alternatives[index]}</span>
                  <Bar
                    share={((totals[index] ?? 0) / max) * 100}
                    tone={result.ranks[index] === 1 ? "ok" : "neutral"}
                  />
                  <span className="number mono">{dec(totals[index] ?? 0)}</span>
                </li>
              ))}
            </ol>
          </ToolSection>

          <ToolSection title="Bewertungsmatrix">
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Bewertungsmatrix">
              <table>
                <caption className="visually-hidden">
                  Punkte und gewichtete Punkte je Kriterium und Alternative
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Kriterium</th>
                    <th scope="col" className="number">
                      Gewicht
                    </th>
                    {input.alternatives.flatMap((name, index) => [
                      <th key={`p${index}`} scope="col" className="number">
                        {name}: Punkte
                      </th>,
                      <th key={`g${index}`} scope="col" className="number">
                        {name}: gewichtet
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {input.criteria.map((criterion, row) => (
                    <tr key={row}>
                      <th scope="row">{criterion.name}</th>
                      <td className="number">{dec(result.weights[row] ?? 0, 1)} %</td>
                      {criterion.scores.flatMap((score, index) => [
                        <td key={`p${index}`} className="number">
                          {dec(score)}
                        </td>,
                        <td key={`g${index}`} className="number">
                          {dec(result.parts[row]?.[index] ?? 0)}
                        </td>,
                      ])}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Nutzwert</th>
                    <td className="number">100 %</td>
                    {totals.flatMap((total, index) => [
                      <td key={`p${index}`} />,
                      <td key={`g${index}`} className="number">
                        <strong>{dec(total)}</strong>
                        {result.ranks[index] === 1 && (
                          <span className="pill pill-ok tool-pill-gap">Platz 1</span>
                        )}
                      </td>,
                    ])}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="small">
              Gewichtet = Punkte × Gewicht. Der Nutzwert ist die Summe je Alternative. Liegen zwei
              Alternativen dicht beieinander, entscheidet schon eine kleine Änderung an Gewichten
              oder Punkten; dann lohnt ein zweiter Blick auf die Annahmen. Muss-Kriterien gehören
              vor die Nutzwertanalyse: Was sie nicht erfüllt, fällt raus.
            </p>
          </ToolSection>
        </>
      )}
    </div>
  );
}
