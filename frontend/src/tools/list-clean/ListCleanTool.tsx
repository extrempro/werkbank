import { FixedChoice } from "../../components/ListChoice";
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
        <FixedChoice
          label="Funktion"
          value={compare ? "vergleichen" : "bereinigen"}
          options={[
            { value: "bereinigen", label: "Bereinigen" },
            { value: "vergleichen", label: "Zwei Listen vergleichen" },
          ]}
          onChange={(value) => setParams({ funktion: value })}
        />
        <FixedChoice
          label="Duplikate"
          value={dedupe}
          options={[
            { value: "none", label: "behalten" },
            { value: "exact", label: "entfernen" },
            { value: "ignoreCase", label: "entfernen (Groß/klein egal)" },
          ]}
          onChange={(value) => setParams({ duplikate: value })}
        />
        <FixedChoice
          label="Sortieren"
          value={sort}
          options={[
            { value: "none", label: "nicht" },
            { value: "natural", label: "A–Z, Zahlen natürlich (srv2 vor srv10)" },
            { value: "asc", label: "A–Z" },
            { value: "desc", label: "Z–A" },
            { value: "length", label: "nach Länge" },
            { value: "reverse", label: "Reihenfolge umkehren" },
          ]}
          onChange={(value) => setParams({ sortieren: value })}
        />
        <FixedChoice
          label="Schreibweise"
          value={caseChange}
          options={[
            { value: "none", label: "unverändert" },
            { value: "lower", label: "klein" },
            { value: "upper", label: "GROSS" },
          ]}
          onChange={(value) => setParams({ schreibweise: value })}
        />
        {!compare && (
          <FixedChoice
            label="Ausgabe"
            value={String(format)}
            options={[
              ...FORMATS.map((entry) => ({
                value: String(entry),
                label: String(outputLabels[entry]),
              })),
            ]}
            onChange={(value) => setParams({ ausgabe: value })}
          />
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
