import { FixedChoice } from "../../components/ListChoice";
import { useMemo, useState } from "react";
import { parseToml, toToml } from "../lib/toml";
import { parseYaml, toYaml } from "../lib/yaml";
import { useToolParams } from "../params";
import { ErrorBox, Output } from "../ui";

type Format = "json" | "yaml" | "toml";
const FORMATS: Format[] = ["json", "yaml", "toml"];

function detect(text: string): Format {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // vielleicht YAML in Kurzschreibweise oder eine TOML-Tabelle
    }
  }
  if (/^\s*\[[\w."-]+\]\s*$/m.test(trimmed) || /^\s*[\w."-]+\s*=\s*\S/m.test(trimmed)) {
    return "toml";
  }
  return "yaml";
}

type Result = { source: Format; output: string } | { source: Format; error: string } | null;

export default function DataConvertTool() {
  const [params, setParams] = useToolParams({ von: "auto", nach: "yaml" });
  const from = FORMATS.find((entry) => entry === params.von) ?? "auto";
  const to = FORMATS.find((entry) => entry === params.nach) ?? "yaml";
  // Der Inhalt bleibt nur auf dieser Seite (Konfigurationen enthalten oft Zugangsdaten).
  const [text, setText] = useState("");

  const result = useMemo((): Result => {
    if (!text.trim()) {
      return null;
    }
    const source = from === "auto" ? detect(text) : from;
    try {
      const value: unknown =
        source === "json"
          ? JSON.parse(text)
          : source === "yaml"
            ? parseYaml(text).value
            : parseToml(text);
      const output =
        to === "json"
          ? JSON.stringify(
              value,
              (_key, entry: unknown) =>
                typeof entry === "number" && !Number.isFinite(entry) ? String(entry) : entry,
              2,
            )
          : to === "yaml"
            ? toYaml(value)
            : toToml(value);
      return { source, output };
    } catch (caught) {
      return { source, error: `${source.toUpperCase()}: ${(caught as Error).message}` };
    }
  }, [text, from, to]);

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <FixedChoice
          label="Von"
          value={from}
          options={[
            { value: "auto", label: "automatisch" },
            { value: "json", label: "JSON" },
            { value: "yaml", label: "YAML" },
            { value: "toml", label: "TOML" },
          ]}
          onChange={(value) => setParams({ von: value })}
        />
        <FixedChoice
          label="Nach"
          value={to}
          options={[
            { value: "json", label: "JSON" },
            { value: "yaml", label: "YAML" },
            { value: "toml", label: "TOML" },
          ]}
          onChange={(value) => setParams({ nach: value })}
        />
      </div>
      <label>
        Eingabe
        <textarea rows={12} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {result && from === "auto" && (
        <p role="status">
          <span className="pill pill-neutral">erkannt: {result.source.toUpperCase()}</span>
        </p>
      )}
      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {result && "output" in result && <Output value={result.output} />}
      <p className="small">
        Kommentare gehen verloren. TOML kennt kein null; solche Werte werden ausgelassen.
      </p>
    </div>
  );
}
