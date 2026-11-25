import { FixedChoice } from "../../components/ListChoice";
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
      <FixedChoice
        label="Richtung"
        value={decode ? "dekodieren" : "kodieren"}
        options={[
          { value: "kodieren", label: "Text → Base64" },
          { value: "dekodieren", label: "Base64 → Text" },
        ]}
        onChange={(value) => setParams({ modus: value })}
      />
      <label>
        Eingabe
        <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {error ? <ErrorBox>{error}</ErrorBox> : <Output value={output} />}
    </div>
  );
}
