import { FixedChoice } from "../../components/ListChoice";
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
        <FixedChoice
          label="Richtung"
          value={decode ? "dekodieren" : "kodieren"}
          options={[
            { value: "kodieren", label: "Text → Entities" },
            { value: "dekodieren", label: "Entities → Text" },
          ]}
          onChange={(value) => setParams({ modus: value })}
        />
        {!decode && (
          <FixedChoice
            label="Umfang"
            value={level}
            options={[
              { value: "minimal", label: "Nur &lt; &gt; &amp; &quot; &apos;" },
              { value: "named", label: "Zusätzlich Umlaute als Namen" },
              { value: "numeric", label: "Zusätzlich alles außerhalb von ASCII als Nummer" },
            ]}
            onChange={(value) => setParams({ umfang: value })}
          />
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
