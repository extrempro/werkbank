import { useEffect, useMemo, useState } from "react";
import { ErrorBox, InfoTable, Output, ToolSection, type InfoRow } from "../ui";
import { claimLabels, decodeJwt, timeClaims, tokenStatus, verifyJwt } from "./jwt";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "medium" });

function relative(seconds: number): string {
  const diff = Math.round(seconds - Date.now() / 1000);
  const abs = Math.abs(diff);
  const text =
    abs < 120
      ? `${abs} s`
      : abs < 7200
        ? `${Math.round(abs / 60)} min`
        : abs < 172800
          ? `${Math.round(abs / 3600)} h`
          : `${Math.round(abs / 86400)} Tagen`;
  return diff >= 0 ? `in ${text}` : `vor ${text}`;
}

type Verdict = { ok: boolean } | { error: string };

export default function JwtTool() {
  // Token und Schlüssel sind Zugangsdaten: nie in die Adresszeile, nie speichern.
  const [token, setToken] = useState("");
  const [key, setKey] = useState("");
  // Das Ergebnis gilt nur für genau die Eingaben, mit denen geprüft wurde.
  const [verdict, setVerdict] = useState<{ token: string; key: string; result: Verdict } | null>(
    null,
  );
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((count) => count + 1), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const decoded = useMemo(() => {
    if (!token.trim()) {
      return null;
    }
    try {
      return { jwt: decodeJwt(token) };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [token]);
  const jwt = decoded && "jwt" in decoded ? decoded.jwt : null;
  const status = jwt ? tokenStatus(jwt.payload) : null;
  const alg = String(jwt?.header.alg ?? "");
  const verify = verdict && verdict.token === token && verdict.key === key ? verdict.result : null;

  const rows: InfoRow[] =
    jwt && typeof jwt.payload === "object"
      ? Object.entries(jwt.payload).map(([name, value]) => {
          const text = typeof value === "string" ? value : JSON.stringify(value);
          const time =
            timeClaims.includes(name) && typeof value === "number"
              ? `${dateFormat.format(new Date(value * 1000))} (${relative(value)})`
              : null;
          return {
            label: claimLabels[name] ? `${name} · ${claimLabels[name]}` : name,
            value: time ?? (Array.isArray(value) ? value.join(", ") : text),
            copy: text,
          };
        })
      : [];

  const onVerify = async () => {
    if (!jwt) {
      return;
    }
    let result: Verdict;
    try {
      result = { ok: await verifyJwt(jwt, key) };
    } catch (caught) {
      result = { error: (caught as Error).message };
    }
    setVerdict({ token, key, result });
  };

  return (
    <div className="tool-body settings-form">
      <label>
        Token
        <textarea
          rows={5}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="eyJhbGciOi…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="small">
        Wird nur hier im Browser dekodiert, nicht gespeichert und nicht in die Adresszeile
        geschrieben.
      </p>
      {decoded && "error" in decoded && <ErrorBox>{decoded.error}</ErrorBox>}
      {jwt && (
        <>
          <p className="badges" role="status">
            <span className="pill pill-neutral">{alg || "ohne alg"}</span>
            {jwt.header.kid !== undefined && (
              <span className="pill pill-neutral">kid {String(jwt.header.kid)}</span>
            )}
            {status && (
              <span
                className={`pill ${
                  status.state === "valid"
                    ? "pill-ok"
                    : status.state === "unknown"
                      ? "pill-neutral"
                      : "pill-bad"
                }`}
              >
                {status.text}
              </span>
            )}
            {alg === "none" && <span className="pill pill-bad">nicht signiert</span>}
          </p>
          <ToolSection title="Claims">
            {rows.length > 0 ? (
              <InfoTable caption="Claims" rows={rows} />
            ) : (
              <pre className="value-block">{String(jwt.payload)}</pre>
            )}
          </ToolSection>
          <div className="tool-columns">
            <Output value={JSON.stringify(jwt.header, null, 2)} label="Header" />
            <Output value={JSON.stringify(jwt.payload, null, 2)} label="Payload" />
          </div>
          <ToolSection title="Signatur prüfen (optional)">
            <label>
              {alg.startsWith("HS")
                ? "Secret"
                : "Öffentlicher Schlüssel (PEM) oder JWKS/JWK (JSON)"}
              <textarea
                rows={4}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={
                  alg.startsWith("HS") ? "geheim" : '-----BEGIN PUBLIC KEY----- … oder {"keys":[…]}'
                }
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="small">
              Entra ID: Die Schlüssel stehen unter
              https://login.microsoftonline.com/&lt;tenant&gt;/discovery/v2.0/keys. Den Inhalt
              hier einfügen; die Werkbank ruft die Adresse nicht selbst ab.
            </p>
            <div className="tool-row">
              <button
                type="button"
                className="button button-secondary"
                disabled={!key.trim()}
                onClick={() => void onVerify()}
              >
                Prüfen
              </button>
              <span role="status">
                {verify && "ok" in verify && (
                  <span className={`pill ${verify.ok ? "pill-ok" : "pill-bad"}`}>
                    {verify.ok ? "Signatur gültig" : "Signatur ungültig"}
                  </span>
                )}
              </span>
            </div>
            {verify && "error" in verify && <ErrorBox>{verify.error}</ErrorBox>}
          </ToolSection>
        </>
      )}
    </div>
  );
}
