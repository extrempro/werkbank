import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { ErrorBox, Output } from "../ui";

export default function JsonFormatTool() {
  const [params, setParams] = useToolParams({ einrueckung: "2" });
  const indent = ["2", "4", "tab", "minify"].includes(params.einrueckung)
    ? params.einrueckung
    : "2";
  // Der Inhalt bleibt nur auf dieser Seite.
  const [text, setText] = useState("");

  const { output, error } = useMemo(() => {
    if (!text.trim()) {
      return { output: "", error: null };
    }
    try {
      const value: unknown = JSON.parse(text);
      const space = indent === "minify" ? undefined : indent === "tab" ? "\t" : Number(indent);
      return { output: JSON.stringify(value, null, space), error: null };
    } catch (caught) {
      return { output: "", error: `Ungültiges JSON: ${(caught as Error).message}` };
    }
  }, [text, indent]);

  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Einrückung
        <select value={indent} onChange={(event) => setParams({ einrueckung: event.target.value })}>
          <option value="2">2 Leerzeichen</option>
          <option value="4">4 Leerzeichen</option>
          <option value="tab">Tab</option>
          <option value="minify">Minifizieren</option>
        </select>
      </label>
      <label>
        Eingabe
        <textarea
          rows={10}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder='{"hallo": "welt"}'
        />
      </label>
      {error ? <ErrorBox>{error}</ErrorBox> : <Output value={output} label="Formatiert" />}
    </div>
  );
}
