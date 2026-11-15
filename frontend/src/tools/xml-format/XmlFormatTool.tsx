import { useMemo, useState } from "react";
import { formatXml, minifyXml, parseXml, walk } from "../lib/xml";
import { useToolParams } from "../params";
import { ErrorBox, Output } from "../ui";

export default function XmlFormatTool() {
  const [params, setParams] = useToolParams({ ausgabe: "2" });
  const mode = ["2", "4", "tab", "minify"].includes(params.ausgabe) ? params.ausgabe : "2";
  // Der Inhalt bleibt nur auf dieser Seite.
  const [text, setText] = useState("");

  const result = useMemo(() => {
    if (!text.trim()) {
      return null;
    }
    try {
      const nodes = parseXml(text);
      const output =
        mode === "minify"
          ? minifyXml(nodes)
          : formatXml(nodes, {
              indent: mode === "tab" ? "\t" : " ".repeat(Number(mode)),
              stripWhitespace: true,
            });
      return { output, elements: [...walk(nodes)].length };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [text, mode]);

  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Ausgabe
        <select value={mode} onChange={(event) => setParams({ ausgabe: event.target.value })}>
          <option value="2">2 Leerzeichen</option>
          <option value="4">4 Leerzeichen</option>
          <option value="tab">Tab</option>
          <option value="minify">Minimieren</option>
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
            <span className="pill pill-ok">wohlgeformt · {result.elements} Elemente</span>
          </p>
          <Output value={result.output} label="Formatiert" />
        </>
      )}
    </div>
  );
}
