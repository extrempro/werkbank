import { useState } from "react";
import { clampInt, useToolParams } from "../params";
import { CopyButton, ErrorBox } from "../ui";
import {
  entropyBits,
  generatePassword,
  strengthLabel,
  type PasswordOptions,
} from "./password";

const GROUPS = [
  ["klein", "Kleinbuchstaben (a–z)"],
  ["gross", "Großbuchstaben (A–Z)"],
  ["ziffern", "Ziffern (0–9)"],
  ["sonder", "Sonderzeichen (!#$%…)"],
] as const;

interface Generated {
  key: string;
  passwords: string[];
  error: string | null;
}

const TONE: Record<string, string> = { error: "pill pill-bad", warn: "pill pill-todo", ok: "pill pill-ok" };

export default function PasswordTool() {
  // In der Adresszeile stehen nur die Einstellungen, nie die Kennwörter.
  const [params, setParams] = useToolParams({
    laenge: "20",
    anzahl: "5",
    klein: "1",
    gross: "1",
    ziffern: "1",
    sonder: "1",
    eindeutig: "0",
  });
  const length = clampInt(params.laenge, 4, 128, 20);
  const count = clampInt(params.anzahl, 1, 20, 5);
  const options: PasswordOptions = {
    length,
    lower: params.klein === "1",
    upper: params.gross === "1",
    digits: params.ziffern === "1",
    symbols: params.sonder === "1",
    excludeAmbiguous: params.eindeutig === "1",
  };
  const key = `${JSON.stringify(options)}|${count}`;

  const make = (): Generated => {
    try {
      return {
        key,
        passwords: Array.from({ length: count }, () => generatePassword(options)),
        error: null,
      };
    } catch (caught) {
      return { key, passwords: [], error: (caught as Error).message };
    }
  };
  const [generated, setGenerated] = useState(make);
  // Geänderte Einstellungen: gleich beim Zeichnen neue Kennwörter erzeugen (ohne Umweg).
  if (generated.key !== key) {
    setGenerated(make());
  }
  const { passwords, error } = generated;
  const regenerate = () => setGenerated(make());

  const bits = entropyBits(options);
  const strength = strengthLabel(bits);

  return (
    <div className="tool-body settings-form">
      <div className="tool-columns">
        <div className="settings-form">
          <label>
            Länge: {length} Zeichen
            <input
              type="range"
              min={8}
              max={64}
              value={Math.min(Math.max(length, 8), 64)}
              onChange={(event) => setParams({ laenge: event.target.value })}
            />
          </label>
          <div className="tool-row">
            <label className="narrow">
              Länge genau
              <input
                type="number"
                min={4}
                max={128}
                value={length}
                onChange={(event) => setParams({ laenge: event.target.value })}
              />
            </label>
            <label className="narrow">
              Anzahl
              <input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(event) => setParams({ anzahl: event.target.value })}
              />
            </label>
          </div>
        </div>

        <fieldset className="tool-options">
          <legend>Zeichengruppen</legend>
          {GROUPS.map(([key, label]) => (
            <label key={key} className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={params[key] === "1"}
                onChange={(event) =>
                  setParams({ [key]: event.target.checked ? "1" : "0" } as Partial<typeof params>)
                }
              />
              {label}
            </label>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={params.eindeutig === "1"}
              onChange={(event) => setParams({ eindeutig: event.target.checked ? "1" : "0" })}
            />
            Verwechselbare Zeichen weglassen (I, l, 1, O, 0 …)
          </label>
        </fieldset>
      </div>

      <div className="tool-row">
        <button type="button" className="button button-primary" onClick={regenerate}>
          Neu erzeugen
        </button>
        <span className="small">
          ca. {bits} Bit Entropie · <span className={TONE[strength.tone]}>{strength.text}</span>
        </span>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <ul className="rows tool-passwords" aria-label="Erzeugte Kennwörter">
        {passwords.map((password, index) => (
          <li key={`${index}-${password}`}>
            <code className="row-main mono">{password}</code>
            <CopyButton value={password} label={`Kennwort ${index + 1} kopieren`} />
          </li>
        ))}
      </ul>

      <p className="small">
        Die Kennwörter entstehen im Browser (<code>crypto.getRandomValues</code>) und werden
        nirgends gespeichert oder übertragen.
      </p>
    </div>
  );
}
