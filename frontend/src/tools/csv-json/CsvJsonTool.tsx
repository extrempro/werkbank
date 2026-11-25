import { FixedChoice } from "../../components/ListChoice";
import { useMemo, useState } from "react";
import { csvToJson, jsonToCsv, type Delimiter } from "../lib/csv";
import { useToolParams } from "../params";
import { ErrorBox, Output } from "../ui";

const DELIMITERS: [string, Delimiter | null, string][] = [
  ["auto", null, "automatisch"],
  ["semikolon", ";", "Semikolon ; (Excel DE)"],
  ["komma", ",", "Komma ,"],
  ["tab", "\t", "Tab"],
  ["strich", "|", "Senkrechtstrich |"],
];

type Result = { output: string; info: string } | { error: string } | null;

export default function CsvJsonTool() {
  const [params, setParams] = useToolParams({
    richtung: "csv-json",
    trenner: "auto",
    kopf: "1",
    typen: "1",
    flach: "1",
  });
  const toJson = params.richtung !== "json-csv";
  const delimiter = DELIMITERS.find(([key]) => key === params.trenner)?.[1] ?? null;
  // Der Inhalt bleibt nur auf dieser Seite.
  const [text, setText] = useState("");

  const result = useMemo((): Result => {
    if (!text.trim()) {
      return null;
    }
    try {
      if (toJson) {
        const parsed = csvToJson(text, {
          delimiter: delimiter ?? undefined,
          header: params.kopf === "1",
          types: params.typen === "1",
        });
        const name = parsed.delimiter === "\t" ? "Tab" : parsed.delimiter;
        return {
          output: JSON.stringify(parsed.data, null, 2),
          info: `${parsed.data.length} Zeilen · ${parsed.columns} Spalten · Trennzeichen „${name}“`,
        };
      }
      return {
        output: jsonToCsv(JSON.parse(text) as unknown, delimiter ?? ";", params.flach === "1"),
        info: "",
      };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [text, toJson, delimiter, params.kopf, params.typen, params.flach]);

  const check = (key: "kopf" | "typen" | "flach", label: string) => (
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
          label="Richtung"
          value={toJson ? "csv-json" : "json-csv"}
          options={[
            { value: "csv-json", label: "CSV → JSON" },
            { value: "json-csv", label: "JSON → CSV" },
          ]}
          onChange={(value) => setParams({ richtung: value })}
        />
        <FixedChoice
          label="Trennzeichen"
          value={DELIMITERS.some(([key]) => key === params.trenner) ? params.trenner : "auto"}
          options={DELIMITERS.map(([key, , label]) => ({
            value: key,
            label: key === "auto" && !toJson ? "Semikolon (Standard)" : label,
          }))}
          onChange={(value) => setParams({ trenner: value })}
        />
      </div>
      <fieldset className="tool-options">
        <legend>Optionen</legend>
        {toJson ? (
          <>
            {check("kopf", "Erste Zeile enthält die Spaltennamen")}
            {check("typen", "Zahlen und true/false erkennen")}
          </>
        ) : (
          check("flach", "Verschachtelte Objekte auflösen (a.b)")
        )}
      </fieldset>
      <label>
        {toJson ? "CSV" : "JSON (Array von Objekten)"}
        <textarea rows={10} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {result && "output" in result && (
        <>
          {result.info && (
            <p role="status">
              <span className="pill pill-neutral">{result.info}</span>
            </p>
          )}
          <Output value={result.output} />
        </>
      )}
    </div>
  );
}
