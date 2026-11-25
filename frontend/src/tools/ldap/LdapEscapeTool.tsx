import { FixedChoice } from "../../components/ListChoice";
import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { Output } from "../ui";
import { escapeDnValue, escapeFilterValue, unescapeFilterValue } from "./ldap";

const MODES = ["filter", "dn", "zurueck"] as const;
const HINTS: Record<(typeof MODES)[number], string> = {
  filter:
    "Maskiert * ( ) \\ und NUL, z. B. für (cn=Muster \\28IT\\29). Jede Zeile wird einzeln behandelt.",
  dn: 'Maskiert , + " \\ < > ; = sowie # und Leerzeichen am Anfang und Ende, für einen einzelnen Wert wie CN=Muster\\, Max.',
  zurueck: "Wandelt \\2a, \\28 usw. (auch UTF-8-Folgen wie \\c3\\bc) zurück.",
};

export default function LdapEscapeTool() {
  const [params, setParams] = useToolParams({ modus: "filter", umlaute: "0" });
  const mode = MODES.find((entry) => entry === params.modus) ?? "filter";
  const nonAscii = params.umlaute === "1";
  // Die Werte selbst bleiben nur auf dieser Seite.
  const [text, setText] = useState("");

  const output = useMemo(() => {
    if (!text) {
      return "";
    }
    const convert =
      mode === "filter"
        ? (line: string) => escapeFilterValue(line, nonAscii)
        : mode === "dn"
          ? escapeDnValue
          : unescapeFilterValue;
    return text.split("\n").map(convert).join("\n");
  }, [text, mode, nonAscii]);

  return (
    <div className="tool-body settings-form">
      <div className="tool-field">
        <FixedChoice
          label="Modus"
          value={mode}
          options={[
            { value: "filter", label: "Für LDAP-Filter" },
            { value: "dn", label: "Für DN" },
            { value: "zurueck", label: "Filter-Wert zurückwandeln" },
          ]}
          onChange={(value) => setParams({ modus: value })}
        />
        <p className="small">{HINTS[mode]}</p>
      </div>
      <label>
        Eingabe
        <textarea
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Muster (IT) *"
        />
      </label>
      {mode === "filter" && (
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={nonAscii}
            onChange={(event) => setParams({ umlaute: event.target.checked ? "1" : "0" })}
          />
          Umlaute und andere Zeichen außerhalb von ASCII ebenfalls maskieren
        </label>
      )}
      <Output value={output} />
    </div>
  );
}
