import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { ErrorBox, Output, ToolSection } from "../ui";
import { cleanFlags, runRegex, type RegexResult } from "./regex";

const FLAGS: [string, string][] = [
  ["g", "alle Treffer"],
  ["i", "Groß/klein egal"],
  ["m", "^ $ je Zeile"],
  ["s", ". trifft auch Zeilenumbruch"],
  ["u", "Unicode"],
];

const EXAMPLES: [string, string][] = [
  ["IPv4", String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b`],
  ["E-Mail", String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`],
  ["MAC", String.raw`\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b`],
  ["GUID", String.raw`\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\b`],
  ["Datum", String.raw`\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b`],
];

const SHOWN_ROWS = 200;

export default function RegexTool() {
  // Der Ausdruck steht in der Adresszeile (teilbar), der Testtext nicht.
  const [params, setParams] = useToolParams({ ausdruck: "", schalter: "g" });
  const pattern = params.ausdruck;
  const flags = cleanFlags(params.schalter);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState("");
  const [useReplace, setUseReplace] = useState(false);

  const result = useMemo((): RegexResult | { error: string } | null => {
    if (!pattern) {
      return null;
    }
    return runRegex(pattern, flags, text, useReplace ? replace : null);
  }, [pattern, flags, text, replace, useReplace]);

  const toggleFlag = (flag: string) =>
    setParams({ schalter: flags.includes(flag) ? flags.replace(flag, "") : flags + flag });
  const groupCount = result && "matches" in result ? (result.matches[0]?.length ?? 1) - 1 : 0;

  return (
    <div className="tool-body settings-form">
      <label>
        Ausdruck
        <input
          type="text"
          className="mono"
          value={pattern}
          onChange={(event) => setParams({ ausdruck: event.target.value })}
          placeholder={String.raw`(\d+)\.(\d+)`}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <fieldset className="tool-options">
        <legend>Schalter</legend>
        {FLAGS.map(([flag, label]) => (
          <label key={flag} className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={flags.includes(flag)}
              onChange={() => toggleFlag(flag)}
            />
            <span>
              <span className="mono">{flag}</span> – {label}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="tool-row">
        <span className="small">Beispiele:</span>
        {EXAMPLES.map(([label, example]) => (
          <button
            key={label}
            type="button"
            className="button button-secondary"
            onClick={() => setParams({ ausdruck: example })}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        Testtext
        <textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {result && "matches" in result && (
        <>
          <p role="status">
            <span className={`pill ${result.matches.length > 0 ? "pill-ok" : "pill-neutral"}`}>
              {result.matches.length} Treffer
            </span>
          </p>
          <pre className="value-block tool-scroll" tabIndex={0} aria-label="Text mit Treffern">
            {result.parts.map((part, index) =>
              part.hit === undefined ? (
                <span key={index}>{part.text}</span>
              ) : (
                <mark
                  key={index}
                  className={part.hit % 2 ? "regex-hit regex-hit-alt" : "regex-hit"}
                >
                  {part.text}
                </mark>
              ),
            )}
          </pre>
          {groupCount > 0 && (
            <ToolSection title="Gruppen">
              <div
                className="table-wrap tool-scroll"
                tabIndex={0}
                role="region"
                aria-label="Gruppen"
              >
                <table>
                  <caption className="visually-hidden">Gruppen je Treffer</caption>
                  <thead>
                    <tr>
                      <th scope="col">Nr.</th>
                      <th scope="col">Treffer</th>
                      {Array.from({ length: groupCount }, (_, group) => (
                        <th key={group} scope="col">
                          ${group + 1}
                          {result.groupNames[group + 1] ? ` (${result.groupNames[group + 1]})` : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.matches.slice(0, SHOWN_ROWS).map((match, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td className="mono">{match[0]}</td>
                        {match.slice(1).map((group, position) => (
                          <td key={position} className="mono">
                            {group ?? "–"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.matches.length > SHOWN_ROWS && (
                <p className="small">Die Tabelle zeigt die ersten {SHOWN_ROWS} Treffer.</p>
              )}
            </ToolSection>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={useReplace}
              onChange={(event) => setUseReplace(event.target.checked)}
            />
            Ersetzen ausprobieren ($1, $2, $&lt;name&gt;)
          </label>
          {useReplace && (
            <>
              <label>
                Ersetzen durch
                <input
                  type="text"
                  className="mono"
                  value={replace}
                  onChange={(event) => setReplace(event.target.value)}
                  placeholder="$2.$1"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <Output value={result.replaced ?? ""} />
            </>
          )}
        </>
      )}
      <p className="small">
        JavaScript-Syntax, weitgehend gleich zu .NET/PowerShell und PCRE; Lookbehind und benannte
        Gruppen (?&lt;name&gt;…) gehen.
      </p>
    </div>
  );
}
