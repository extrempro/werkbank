import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { Output } from "../ui";
import {
  cleanList,
  compareLists,
  formatList,
  outputLabels,
  type ListOptions,
  type OutputFormat,
} from "./list";

const FORMATS = Object.keys(outputLabels) as OutputFormat[];
const DEDUPE: ListOptions["dedupe"][] = ["none", "exact", "ignoreCase"];
const SORT: ListOptions["sort"][] = ["none", "natural", "asc", "desc", "length", "reverse"];
const CASE: ListOptions["caseChange"][] = ["none", "lower", "upper"];

export default function ListCleanTool() {
  const [params, setParams] = useToolParams({
    funktion: "bereinigen",
    duplikate: "exact",
    sortieren: "none",
    schreibweise: "none",
    ausgabe: "lines",
    rand: "1",
    leer: "1",
    trennen: "0",
  });
  const compare = params.funktion === "vergleichen";
  const format = FORMATS.find((entry) => entry === params.ausgabe) ?? "lines";
  const dedupe = DEDUPE.find((entry) => entry === params.duplikate) ?? "exact";
  const sort = SORT.find((entry) => entry === params.sortieren) ?? "none";
  const caseChange = CASE.find((entry) => entry === params.schreibweise) ?? "none";
  const trim = params.rand === "1";
  const removeEmpty = params.leer === "1";
  const splitAny = params.trennen === "1";
  // Die Listen selbst bleiben nur auf dieser Seite.
  const [text, setText] = useState("");
  const [other, setOther] = useState("");

  const options = useMemo(
    (): ListOptions => ({
      trim,
      removeEmpty,
      dedupe,
      sort,
      splitOn: splitAny ? "any" : "lines",
      caseChange,
    }),
    [trim, removeEmpty, dedupe, sort, splitAny, caseChange],
  );
  const result = useMemo(() => cleanList(text, options), [text, options]);
  const output = useMemo(() => formatList(result.items, format), [result, format]);
  const compared = useMemo(
    () =>
      compare
        ? compareLists(result.items, cleanList(other, options).items, dedupe === "ignoreCase")
        : null,
    [compare, result, other, options, dedupe],
  );

  const check = (key: "rand" | "leer" | "trennen", label: string) => (
    <label className="check-label">
      <input
        type="checkbox"
        className="check"
        checked={params[key] === "1"}
        onChange={(event) =>
          setParams({ [key]: event.target.checked ? "1" : "0" } as Partial<typeof params>)
        }
      />
      {label}
    </label>
  );

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Funktion
          <select
            value={compare ? "vergleichen" : "bereinigen"}
            onChange={(event) => setParams({ funktion: event.target.value })}
          >
            <option value="bereinigen">Bereinigen</option>
            <option value="vergleichen">Zwei Listen vergleichen</option>
          </select>
        </label>
        <label className="narrow">
          Duplikate
          <select value={dedupe} onChange={(event) => setParams({ duplikate: event.target.value })}>
            <option value="none">behalten</option>
            <option value="exact">entfernen</option>
            <option value="ignoreCase">entfernen (Groß/klein egal)</option>
          </select>
        </label>
        <label className="narrow">
          Sortieren
          <select value={sort} onChange={(event) => setParams({ sortieren: event.target.value })}>
            <option value="none">nicht</option>
            <option value="natural">A–Z, Zahlen natürlich (srv2 vor srv10)</option>
            <option value="asc">A–Z</option>
            <option value="desc">Z–A</option>
            <option value="length">nach Länge</option>
            <option value="reverse">Reihenfolge umkehren</option>
          </select>
        </label>
        <label className="narrow">
          Schreibweise
          <select
            value={caseChange}
            onChange={(event) => setParams({ schreibweise: event.target.value })}
          >
            <option value="none">unverändert</option>
            <option value="lower">klein</option>
            <option value="upper">GROSS</option>
          </select>
        </label>
        {!compare && (
          <label className="narrow">
            Ausgabe
            <select value={format} onChange={(event) => setParams({ ausgabe: event.target.value })}>
              {FORMATS.map((entry) => (
                <option key={entry} value={entry}>
                  {outputLabels[entry]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <fieldset className="tool-options">
        <legend>Optionen</legend>
        {check("rand", "Leerzeichen am Rand entfernen")}
        {check("leer", "Leere Zeilen entfernen")}
        {check("trennen", "Auch an Komma, Semikolon und Tab trennen")}
      </fieldset>
      <div className="tool-columns">
        <label>
          {compare ? "Liste A" : "Eingabe"}
          <textarea rows={10} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        {compare && (
          <label>
            Liste B
            <textarea rows={10} value={other} onChange={(event) => setOther(event.target.value)} />
          </label>
        )}
      </div>
      {!compare && (
        <>
          <p className="badges" role="status">
            <span className="pill pill-neutral">{result.items.length} Einträge</span>
            {result.removedDuplicates > 0 && (
              <span className="pill pill-todo">{result.removedDuplicates} Duplikate entfernt</span>
            )}
            {result.removedEmpty > 0 && (
              <span className="pill pill-neutral">{result.removedEmpty} leere entfernt</span>
            )}
          </p>
          <Output value={output} />
        </>
      )}
      {compared && (
        <div className="tool-columns">
          <Output value={compared.onlyA.join("\n")} label={`Nur in A (${compared.onlyA.length})`} />
          <Output value={compared.onlyB.join("\n")} label={`Nur in B (${compared.onlyB.length})`} />
          <Output value={compared.both.join("\n")} label={`In beiden (${compared.both.length})`} />
        </div>
      )}
    </div>
  );
}
