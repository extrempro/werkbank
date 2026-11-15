import { useEffect, useState } from "react";
import { CopyButton, ErrorBox, InfoTable, numberDuplicates, Output, ToolSection } from "../ui";
import { analyzeSaml, decodeSaml, type SamlInfo } from "./saml";

type Result = { info: SamlInfo; binding: string } | { error: string };

function toPem(certificate: string): string {
  return `-----BEGIN CERTIFICATE-----\n${certificate.replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`;
}

export default function SamlTool() {
  // SAML-Antworten enthalten Personendaten: nur auf dieser Seite, nie in der Adresszeile.
  const [input, setInput] = useState("");
  // Das Ergebnis gehört zu genau einer Eingabe; ältere Ergebnisse werden nicht gezeigt.
  const [decoded, setDecoded] = useState<{ input: string; result: Result } | null>(null);

  useEffect(() => {
    if (!input.trim()) {
      return undefined;
    }
    let active = true;
    decodeSaml(input)
      .then((message): Result => ({ info: analyzeSaml(message.xml), binding: message.binding }))
      .catch((caught: unknown): Result => ({ error: (caught as Error).message }))
      .then((result) => {
        if (active) {
          setDecoded({ input, result });
        }
      });
    return () => {
      active = false;
    };
  }, [input]);

  const result = input.trim() && decoded?.input === input ? decoded.result : null;

  return (
    <div className="tool-body settings-form">
      <label>
        SAMLResponse / SAMLRequest, ganze URL oder XML
        <textarea
          rows={6}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="PHNhbWxwOlJlc3BvbnNl… oder https://login…?SAMLRequest=…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="small">
        Den Wert findet man zum Beispiel in den Entwicklertools des Browsers (Netzwerk → POST an den
        Dienst → Formulardaten). Er wird nur hier im Browser ausgewertet.
      </p>
      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {result && "info" in result && (
        <>
          <p className="badges" role="status">
            <span className="pill pill-neutral">{result.info.type}</span>
            <span className="pill pill-neutral">{result.binding}</span>
            {result.info.signed.message && <span className="pill pill-ok">Nachricht signiert</span>}
            {result.info.signed.assertion && (
              <span className="pill pill-ok">Assertion signiert</span>
            )}
            {!result.info.signed.message && !result.info.signed.assertion && (
              <span className="pill pill-todo">keine Signatur</span>
            )}
            {result.info.encrypted && (
              <span className="pill pill-neutral">Assertion verschlüsselt</span>
            )}
          </p>
          {result.info.rows.length > 0 && (
            <InfoTable
              caption="Angaben der Nachricht"
              rows={numberDuplicates(result.info.rows.map((row) => ({ ...row, copy: row.value })))}
            />
          )}
          {result.info.attributes.length > 0 && (
            <ToolSection title={`Attribute (${result.info.attributes.length})`}>
              <InfoTable
                caption="Attribute"
                rows={numberDuplicates(
                  result.info.attributes.map((attribute) => ({
                    label: attribute.name,
                    value: attribute.values.join(", "),
                    copy: attribute.values.join("\n"),
                  })),
                )}
              />
            </ToolSection>
          )}
          {result.info.certificates.length > 0 && (
            <ToolSection title="Zertifikat">
              <ul className="tool-list tool-certs">
                {result.info.certificates.map((certificate, index) => (
                  <li key={`${index}-${certificate.slice(0, 16)}`}>
                    <code>{certificate.slice(0, 96)}…</code>{" "}
                    <CopyButton
                      value={toPem(certificate)}
                      label={
                        result.info.certificates.length > 1
                          ? `Zertifikat ${index + 1} als PEM kopieren`
                          : "Als PEM kopieren"
                      }
                    />
                  </li>
                ))}
              </ul>
            </ToolSection>
          )}
          <Output value={result.info.pretty} label="XML" />
        </>
      )}
    </div>
  );
}
