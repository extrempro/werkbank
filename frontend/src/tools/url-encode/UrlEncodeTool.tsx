import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { ErrorBox, InfoTable, numberDuplicates, Output, type InfoRow } from "../ui";
import { parseUrl, urlDecode, urlEncode, type UrlMode } from "./url";

const MODES = ["kodieren", "dekodieren", "zerlegen"] as const;
const KINDS: UrlMode[] = ["component", "form", "uri"];

export default function UrlEncodeTool() {
  const [params, setParams] = useToolParams({ modus: "kodieren", art: "component", plus: "1" });
  const mode = MODES.find((entry) => entry === params.modus) ?? "kodieren";
  const kind = KINDS.find((entry) => entry === params.art) ?? "component";
  const plus = params.plus === "1";
  // Texte und Adressen bleiben nur auf dieser Seite (sie können Zugangsdaten enthalten).
  const [text, setText] = useState("");

  const result = useMemo(() => {
    if (!text || mode === "zerlegen") {
      return { output: "", error: null };
    }
    try {
      return {
        output: mode === "kodieren" ? urlEncode(text, kind) : urlDecode(text, plus),
        error: null,
      };
    } catch (caught) {
      return { output: "", error: (caught as Error).message };
    }
  }, [text, mode, kind, plus]);
  const parts = mode === "zerlegen" && text.trim() ? parseUrl(text) : null;

  const partRows: InfoRow[] = parts
    ? [
        { label: "Protokoll", value: parts.protocol },
        ...(parts.username ? [{ label: "Benutzer", value: parts.username }] : []),
        ...(parts.password
          ? [{ label: "Kennwort", value: "steht in der URL (nicht angezeigt)", plain: true }]
          : []),
        { label: "Host", value: parts.host, copy: parts.host },
        ...(parts.port ? [{ label: "Port", value: parts.port }] : []),
        { label: "Pfad", value: parts.path, copy: parts.path },
        ...(parts.hash ? [{ label: "Anker (#)", value: parts.hash }] : []),
      ]
    : [];

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Modus
          <select value={mode} onChange={(event) => setParams({ modus: event.target.value })}>
            <option value="kodieren">Kodieren</option>
            <option value="dekodieren">Dekodieren</option>
            <option value="zerlegen">URL zerlegen</option>
          </select>
        </label>
        {mode === "kodieren" && (
          <label>
            Art
            <select value={kind} onChange={(event) => setParams({ art: event.target.value })}>
              <option value="component">
                Parameterwert (alles außer A–Z, 0–9, - _ . ! ~ * &apos; ( ))
              </option>
              <option value="form">Formular (Leerzeichen als +)</option>
              <option value="uri">Ganze URL (/, ?, &amp;, = bleiben)</option>
            </select>
          </label>
        )}
      </div>
      {mode === "dekodieren" && (
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={plus}
            onChange={(event) => setParams({ plus: event.target.checked ? "1" : "0" })}
          />
          „+“ als Leerzeichen lesen (Formulare, Query-Strings)
        </label>
      )}
      <label>
        {mode === "zerlegen" ? "URL" : "Eingabe"}
        <textarea
          rows={mode === "zerlegen" ? 3 : 6}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {result.error && <ErrorBox>{result.error}</ErrorBox>}
      {mode !== "zerlegen" && !result.error && <Output value={result.output} />}
      {mode === "zerlegen" && text.trim() && !parts && (
        <ErrorBox>Keine vollständige URL (mit https:// …)</ErrorBox>
      )}
      {parts && (
        <>
          <InfoTable caption="Bestandteile der URL" rows={partRows} />
          {parts.params.length > 0 && (
            <InfoTable
              caption="Parameter"
              rows={numberDuplicates(
                parts.params.map((param) => ({
                  label: param.key || "(ohne Name)",
                  value: param.value || "(leer)",
                  copy: param.value,
                })),
              )}
            />
          )}
        </>
      )}
    </div>
  );
}
