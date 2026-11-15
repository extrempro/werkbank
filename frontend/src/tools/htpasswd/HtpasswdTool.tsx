import { useState } from "react";
import { clampInt, useToolParams } from "../params";
import { ErrorBox, InfoTable, Output } from "../ui";
import {
  detectFormat,
  formats,
  makeHash,
  splitLine,
  verifyHash,
  type HashFormat,
} from "./hashes";

/** Dem Browser Zeit geben, „Berechne …“ zu zeichnen, bevor bcrypt rechnet. */
const nextFrame = () => new Promise((resolve) => window.setTimeout(resolve, 30));

const TONE = { ok: "pill pill-ok", warn: "pill pill-todo", error: "pill pill-bad" } as const;
const TONE_TEXT = { ok: "gut", warn: "veraltet", error: "unsicher" } as const;

export default function HtpasswdTool() {
  const [params, setParams] = useToolParams({ modus: "erzeugen", format: "bcrypt", kosten: "12" });
  const verify = params.modus === "pruefen";
  const format = formats.find((entry) => entry.id === params.format)?.id ?? "bcrypt";
  const cost = clampInt(params.kosten, 8, 15, 12);
  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Modus
        <select
          value={verify ? "pruefen" : "erzeugen"}
          onChange={(event) => setParams({ modus: event.target.value })}
        >
          <option value="erzeugen">Erzeugen</option>
          <option value="pruefen">Prüfen</option>
        </select>
      </label>
      {verify ? (
        <Verify />
      ) : (
        <Create
          format={format}
          cost={cost}
          onFormat={(next) => setParams({ format: next })}
          onCost={(next) => setParams({ kosten: next })}
        />
      )}
      <p className="small">
        Kennwörter werden nur im Browser verarbeitet, nicht gespeichert und nicht übertragen. Sie
        stehen nie in der Adresszeile.
      </p>
    </div>
  );
}

function Create({
  format,
  cost,
  onFormat,
  onCost,
}: {
  format: HashFormat;
  cost: number;
  onFormat: (format: string) => void;
  onCost: (cost: string) => void;
}) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  // Der Hash gilt nur für die Eingaben, mit denen er erzeugt wurde.
  const [made, setMade] = useState<{ key: string; hash: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = formats.find((entry) => entry.id === format);
  const key = JSON.stringify([format, cost, password]);
  const hash = made?.key === key ? made.hash : "";

  const run = async () => {
    setError(null);
    if (!password) {
      setError("Bitte ein Kennwort eingeben.");
      return;
    }
    if (repeat && password !== repeat) {
      setError("Die Kennwörter stimmen nicht überein.");
      return;
    }
    if (format === "bcrypt" && new TextEncoder().encode(password).length > 72) {
      setError("bcrypt verwendet nur die ersten 72 Bytes. Bitte ein kürzeres Kennwort oder $6$ wählen.");
      return;
    }
    setBusy(true);
    await nextFrame();
    try {
      setMade({ key, hash: await makeHash(password, format, { cost, rounds: 5000 }) });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const name = user.trim();
  const shadow = format === "sha512" || format === "sha256" || format === "md5";
  return (
    <>
      <div className="tool-columns">
        <div className="tool-field">
          <label>
            Format
            <select value={format} onChange={(event) => onFormat(event.target.value)}>
              {formats.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          {info && (
            <p className="small">
              <span className={TONE[info.tone]}>{TONE_TEXT[info.tone]}</span> {info.note}
            </p>
          )}
        </div>
        {format === "bcrypt" && (
          <div className="tool-field">
            <label>
              Kostenfaktor: {cost}
              <input
                type="range"
                min={8}
                max={15}
                value={cost}
                onChange={(event) => onCost(event.target.value)}
              />
            </label>
            <p className="small">
              10 bis 12 ist üblich. Jeder Schritt verdoppelt die Rechenzeit, auch beim Anmelden.
            </p>
          </div>
        )}
      </div>
      <div className="tool-columns">
        <label>
          Benutzername (freiwillig)
          <input
            type="text"
            autoComplete="off"
            value={user}
            onChange={(event) => setUser(event.target.value)}
          />
        </label>
        <label>
          Kennwort
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Kennwort wiederholen (freiwillig)
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </label>
      </div>
      <div>
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? "Berechne …" : "Hash erzeugen"}
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {hash && (
        <>
          <Output value={hash} label="Hash" />
          {name && !shadow && <Output value={`${name}:${hash}`} label="Zeile für .htpasswd" />}
          {shadow && (
            <InfoTable
              caption="Verwendung des Hashs"
              rows={[
                {
                  label: "Benutzer setzen (Linux)",
                  value: `usermod -p '${hash}' ${name || "benutzer"}`,
                  copy: `usermod -p '${hash}' ${name || "benutzer"}`,
                },
                {
                  label: "Ansible (user-Modul)",
                  value: `password: '${hash}'`,
                  copy: `password: '${hash}'`,
                },
                { label: "cloud-init", value: `passwd: '${hash}'`, copy: `passwd: '${hash}'` },
              ]}
            />
          )}
          {format === "bcrypt" && (
            <p className="small">
              nginx: <span className="mono">auth_basic_user_file /etc/nginx/.htpasswd;</span> nginx
              versteht bcrypt nur, wenn die crypt-Bibliothek des Systems es kann (bei Debian und
              Ubuntu ja); sonst $apr1$ nehmen.
            </p>
          )}
        </>
      )}
    </>
  );
}

function Verify() {
  const [line, setLine] = useState("");
  const [password, setPassword] = useState("");
  const [checked, setChecked] = useState<{ key: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, hash } = splitLine(line);
  const format = hash ? detectFormat(hash) : undefined;
  const key = JSON.stringify([line, password]);
  const result = checked?.key === key ? checked.ok : null;

  const run = async () => {
    setError(null);
    setBusy(true);
    await nextFrame();
    try {
      setChecked({ key, ok: await verifyHash(password, hash) });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tool-field">
        <label>
          Hash oder Zeile aus .htpasswd oder /etc/shadow
          <textarea
            rows={2}
            spellCheck={false}
            value={line}
            onChange={(event) => setLine(event.target.value)}
          />
        </label>
        {hash && (
          <p className="small">
            {format
              ? `Format: ${formats.find((entry) => entry.id === format)?.label ?? format}`
              : "Format nicht erkannt"}
            {user && ` · Benutzer: ${user}`}
          </p>
        )}
      </div>
      <label className="narrow">
        Kennwort
        <input
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || !hash || !format}
          onClick={() => void run()}
        >
          {busy ? "Prüfe …" : "Prüfen"}
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <p role="status">
        {result !== null &&
          (result ? (
            <span className="pill pill-ok">Kennwort passt</span>
          ) : (
            <span className="pill pill-bad">Kennwort passt nicht</span>
          ))}
      </p>
    </>
  );
}
