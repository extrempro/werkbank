import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { ErrorBox, Output } from "../ui";
import { base64Decode, base64Encode } from "./encoding";

export default function Base64Tool() {
  const [params, setParams] = useToolParams({ modus: "kodieren" });
  const decode = params.modus === "dekodieren";
  // Der Text selbst bleibt bewusst nur auf dieser Seite (nicht in der Adresszeile).
  const [text, setText] = useState("");

  const { output, error } = useMemo(() => {
    if (!text) {
      return { output: "", error: null };
    }
    try {
      return { output: decode ? base64Decode(text) : base64Encode(text), error: null };
    } catch (caught) {
      return { output: "", error: (caught as Error).message };
    }
  }, [text, decode]);

  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Richtung
        <select
          value={decode ? "dekodieren" : "kodieren"}
          onChange={(event) => setParams({ modus: event.target.value })}
        >
          <option value="kodieren">Text → Base64</option>
          <option value="dekodieren">Base64 → Text</option>
        </select>
      </label>
      <label>
        Eingabe
        <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {error ? <ErrorBox>{error}</ErrorBox> : <Output value={output} />}
    </div>
  );
}
