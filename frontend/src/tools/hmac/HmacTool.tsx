import { FixedChoice } from "../../components/ListChoice";
import { useEffect, useState } from "react";
import { decodeKey, hmac, matches, toB64, toHex, type KeyEncoding } from "../hash/hash";
import { useToolParams } from "../params";
import { ErrorBox, InfoTable } from "../ui";

const ALGS = ["SHA-256", "SHA-1", "SHA-384", "SHA-512"] as const;
const ENCODINGS: KeyEncoding[] = ["text", "hex", "base64"];
type Computed = { key: string; mac: Uint8Array } | { key: string; error: string };

export default function HmacTool() {
  const [params, setParams] = useToolParams({ algorithmus: "SHA-256", schluessel: "text" });
  const alg = ALGS.find((entry) => entry === params.algorithmus) ?? "SHA-256";
  const encoding = ENCODINGS.find((entry) => entry === params.schluessel) ?? "text";
  // Schlüssel und Nachricht bleiben im Browser und stehen nie in der Adresszeile.
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [expected, setExpected] = useState("");
  const [computed, setComputed] = useState<Computed | null>(null);
  const key = JSON.stringify([alg, encoding, secret, message]);

  useEffect(() => {
    let active = true;
    const run = async (): Promise<Computed> => {
      try {
        const mac = await hmac(alg, decodeKey(secret, encoding), new TextEncoder().encode(message));
        return { key, mac };
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
  }, [alg, encoding, secret, message, key]);

  const current = computed?.key === key ? computed : null;
  const mac = current && "mac" in current ? current.mac : null;
  // Übliche Präfixe wie „sha256=“ abschneiden.
  const wanted = expected.trim().replace(/^(sha(1|256|384|512)|v\d)=/i, "");

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <FixedChoice
          label="Algorithmus"
          value={String(alg)}
          options={[...ALGS.map((entry) => ({ value: String(entry), label: `HMAC-${entry}` }))]}
          onChange={(value) => setParams({ algorithmus: value })}
        />
        <FixedChoice
          label="Schlüssel als"
          value={encoding}
          options={[
            { value: "text", label: "Text" },
            { value: "hex", label: "Hex" },
            { value: "base64", label: "Base64" },
          ]}
          onChange={(value) => setParams({ schluessel: value })}
        />
      </div>
      <label>
        Geheimer Schlüssel
        <input
          type="password"
          className="mono"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      <div className="tool-field">
        <label>
          Nachricht
          <textarea
            rows={6}
            spellCheck={false}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <p className="small">Zum Beispiel der Request-Body, exakt wie empfangen.</p>
      </div>
      {current && "error" in current && <ErrorBox>{current.error}</ErrorBox>}
      {mac && (
        <InfoTable
          caption="HMAC"
          rows={[
            { label: "Hex", value: toHex(mac), copy: toHex(mac) },
            { label: "Base64", value: toB64(mac), copy: toB64(mac) },
          ]}
        />
      )}
      <div className="tool-field">
        <label>
          Erwartete Signatur (freiwillig)
          <input
            type="text"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
        </label>
        <p className="small">Zum Beispiel sha256=… aus dem Header X-Hub-Signature-256.</p>
        <p role="status">
          {wanted &&
            mac &&
            (matches(wanted, mac) ? (
              <span className="pill pill-ok">Signatur stimmt</span>
            ) : (
              <span className="pill pill-bad">Signatur stimmt nicht</span>
            ))}
        </p>
      </div>
      <p className="small">
        Schon ein zusätzlicher Zeilenumbruch oder umformatiertes JSON ändert die Signatur. Schlüssel
        und Nachricht bleiben im Browser.
      </p>
    </div>
  );
}
