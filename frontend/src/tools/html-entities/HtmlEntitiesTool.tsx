import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { Output } from "../ui";
import { htmlDecode, htmlEncode, type EncodeMode } from "./html";

const LEVELS: EncodeMode[] = ["minimal", "named", "numeric"];

export default function HtmlEntitiesTool() {
  const [params, setParams] = useToolParams({ modus: "kodieren", umfang: "minimal" });
  const decode = params.modus === "dekodieren";
  const level = LEVELS.find((entry) => entry === params.umfang) ?? "minimal";
  // Der Text selbst bleibt nur auf dieser Seite.
  const [text, setText] = useState("");
  const output = useMemo(
    () => (decode ? htmlDecode(text) : htmlEncode(text, level)),
    [text, decode, level],
  );

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Richtung
          <select
            value={decode ? "dekodieren" : "kodieren"}
            onChange={(event) => setParams({ modus: event.target.value })}
          >
            <option value="kodieren">Text → Entities</option>
            <option value="dekodieren">Entities → Text</option>
          </select>
        </label>
        {!decode && (
          <label className="narrow">
            Umfang
            <select value={level} onChange={(event) => setParams({ umfang: event.target.value })}>
              <option value="minimal">Nur &lt; &gt; &amp; &quot; &apos;</option>
              <option value="named">Zusätzlich Umlaute als Namen</option>
              <option value="numeric">Zusätzlich alles außerhalb von ASCII als Nummer</option>
            </select>
          </label>
        )}
      </div>
      <label>
        Eingabe
        <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <Output value={output} />
    </div>
  );
}
