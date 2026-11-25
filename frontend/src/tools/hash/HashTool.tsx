import { FixedChoice } from "../../components/ListChoice";
import { useEffect, useState } from "react";
import { useToolParams } from "../params";
import { CopyButton, ErrorBox } from "../ui";
import { guessAlg, hash, hashAlgs, matches, toB64, toHex, type HashAlg } from "./hash";

type Digests = Partial<Record<HashAlg, Uint8Array>>;
type Computed = { key: string; digests: Digests } | { key: string; error: string };

export default function HashTool() {
  const [params, setParams] = useToolParams({ eingabe: "text", gross: "0" });
  const fileMode = params.eingabe === "datei";
  const upper = params.gross === "1";
  // Text und Datei bleiben im Browser; in der Adresszeile stehen nur Optionen.
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ file: File; number: number } | null>(null);
  const [expected, setExpected] = useState("");
  const [computed, setComputed] = useState<Computed | null>(null);

  const hasInput = !fileMode || picked !== null;
  // Zu welcher Eingabe ein Ergebnis gehört; ältere Ergebnisse werden nicht gezeigt.
  const key = fileMode ? `datei:${picked?.number ?? 0}` : `text:${text}`;
  const file = fileMode ? (picked?.file ?? null) : null;

  useEffect(() => {
    if (fileMode && !file) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<Computed> => {
      try {
        const data = file
          ? new Uint8Array(await file.arrayBuffer())
          : new TextEncoder().encode(text);
        const digests: Digests = {};
        for (const alg of hashAlgs) {
          digests[alg] = await hash(alg, data);
        }
        return { key, digests };
      } catch (caught) {
        return { key, error: (caught as Error).message };
      }
    };
    void run().then((result) => {
      if (active) {
        setComputed(result);
      }
    });
    return () => {
      active = false;
    };
  }, [fileMode, file, text, key]);

  const current = hasInput && computed?.key === key ? computed : null;
  const digests = current && "digests" in current ? current.digests : {};
  const busy = hasInput && current === null;
  const wanted = expected.trim();
  const matchAlg = wanted
    ? hashAlgs.find((alg) => {
        const digest = digests[alg];
        return digest !== undefined && matches(wanted, digest);
      })
    : undefined;
  const guessed = wanted ? guessAlg(wanted) : undefined;

  return (
    <div className="tool-body settings-form">
      <FixedChoice
        label="Eingabe als"
        value={fileMode ? "datei" : "text"}
        options={[
          { value: "text", label: "Text" },
          { value: "datei", label: "Datei" },
        ]}
        onChange={(value) => setParams({ eingabe: value })}
      />
      {fileMode ? (
        <div className="tool-field">
          <label>
            Datei
            <input
              type="file"
              onChange={(event) => {
                const next = event.target.files?.[0];
                setPicked(next ? { file: next, number: (picked?.number ?? 0) + 1 } : null);
              }}
            />
          </label>
          {picked && (
            <p className="small">
              {picked.file.name} · {picked.file.size.toLocaleString("de-DE")} Bytes. Die Datei wird
              nur im Browser gelesen.
            </p>
          )}
        </div>
      ) : (
        <label>
          Text (UTF-8)
          <textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
      )}

      <div className="tool-field">
        <label>
          Erwarteter Wert (freiwillig)
          <input
            type="text"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
        </label>
        <p className="small">Hex oder Base64, z. B. die Prüfsumme vom Hersteller.</p>
        <p role="status">
          {wanted &&
            hasInput &&
            !busy &&
            (matchAlg ? (
              <span className="pill pill-ok">Stimmt überein ({matchAlg})</span>
            ) : (
              <>
                <span className="pill pill-bad">Keine Übereinstimmung</span>
                {guessed && <span className="small"> Die Länge passt zu {guessed}.</span>}
              </>
            ))}
        </p>
      </div>

      {current && "error" in current && <ErrorBox>{current.error}</ErrorBox>}

      {hasInput && (
        <div className="tool-output">
          <div className="section-head">
            <h2>{busy ? "Berechne …" : "Prüfsummen"}</h2>
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={upper}
                onChange={(event) => setParams({ gross: event.target.checked ? "1" : "0" })}
              />
              Großbuchstaben
            </label>
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Prüfsummen">
            <table className="tool-info">
              <caption className="visually-hidden">Prüfsummen</caption>
              <tbody>
                {hashAlgs.map((alg) => {
                  const digest = digests[alg];
                  const value = digest ? (upper ? toHex(digest).toUpperCase() : toHex(digest)) : "";
                  return (
                    <tr key={alg} className={alg === matchAlg ? "tool-hit" : undefined}>
                      <th scope="row">{alg}</th>
                      <td className="mono">{value}</td>
                      <td className="tool-info-copy">
                        {digest && (
                          <>
                            <CopyButton value={value} label={`${alg} als Hex kopieren`} />{" "}
                            <CopyButton
                              value={toB64(digest)}
                              label={`${alg} als Base64 kopieren`}
                            />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small">
            MD5 und SHA-1 taugen nur noch als Prüfsumme gegen Übertragungsfehler, nicht als Schutz
            vor Manipulation. PowerShell:{" "}
            <span className="mono">Get-FileHash datei -Algorithm SHA256</span> · Linux:{" "}
            <span className="mono">sha256sum datei</span>
          </p>
        </div>
      )}
    </div>
  );
}
