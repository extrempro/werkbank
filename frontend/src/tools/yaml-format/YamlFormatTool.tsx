import { useMemo, useState } from "react";
import { parseYaml, toYaml } from "../lib/yaml";
import { useToolParams } from "../params";
import { ErrorBox, Output } from "../ui";

export default function YamlFormatTool() {
  const [params, setParams] = useToolParams({ einrueckung: "2" });
  const indent = params.einrueckung === "4" ? 4 : 2;
  // Der Inhalt bleibt nur auf dieser Seite (Konfigurationen enthalten oft Zugangsdaten).
  const [text, setText] = useState("");

  const result = useMemo(():
    | { output: string; documents: number }
    | { error: string }
    | null => {
    if (!text.trim()) {
      return null;
    }
    try {
      const { value, documents } = parseYaml(text);
      const docs = documents > 1 ? (value as unknown[]) : [value];
      return {
        output: docs.map((doc) => toYaml(doc, indent)).join("---\n"),
        documents,
      };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [text, indent]);

  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Einrückung
        <select
          value={String(indent)}
          onChange={(event) => setParams({ einrueckung: event.target.value })}
        >
          <option value="2">2 Leerzeichen</option>
          <option value="4">4 Leerzeichen</option>
        </select>
      </label>
      <label>
        Eingabe
        <textarea rows={12} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {result && "output" in result && (
        <>
          <p role="status">
            <span className="pill pill-ok">
              gültig{result.documents > 1 ? ` · ${result.documents} Dokumente` : ""}
            </span>
          </p>
          <Output value={result.output} label="Formatiert" />
          <p className="small">
            Kommentare und Anker gehen beim Neuformatieren verloren. Werte wie yes/no/on/off werden
            in Anführungszeichen gesetzt, damit ältere Parser sie nicht als Ja/Nein lesen.
          </p>
        </>
      )}
    </div>
  );
}
