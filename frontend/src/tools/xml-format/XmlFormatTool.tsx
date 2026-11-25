import { FixedChoice } from "../../components/ListChoice";
import { useMemo, useState } from "react";
import { formatXml, minifyXml, parseXml, walk } from "../lib/xml";
import { useToolParams } from "../params";
import { ErrorBox, Output } from "../ui";

export default function XmlFormatTool() {
  const [params, setParams] = useToolParams({ ausgabe: "2" });
  const mode = ["2", "4", "tab", "minify"].includes(params.ausgabe) ? params.ausgabe : "2";
  // Der Inhalt bleibt nur auf dieser Seite.
  const [text, setText] = useState("");

  const result = useMemo((): { output: string; elements: number } | { error: string } | null => {
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
      <FixedChoice
        label="Ausgabe"
        value={mode}
        options={[
          { value: "2", label: "2 Leerzeichen" },
          { value: "4", label: "4 Leerzeichen" },
          { value: "tab", label: "Tab" },
          { value: "minify", label: "Minimieren" },
        ]}
        onChange={(value) => setParams({ ausgabe: value })}
      />
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
