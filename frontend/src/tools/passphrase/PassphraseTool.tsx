import { useEffect, useState } from "react";
import { clampInt, useToolParams } from "../params";
import { strengthLabel } from "../password/password";
import { CopyButton, ErrorBox } from "../ui";
import { makePassphrase, passphraseBits, type PassphraseOptions } from "./passphrase";

const SEPARATORS: Record<string, string> = {
  bindestrich: "-",
  punkt: ".",
  unterstrich: "_",
  leerzeichen: " ",
  ohne: "",
};
const TONE: Record<string, string> = {
  error: "pill pill-bad",
  warn: "pill pill-todo",
  ok: "pill pill-ok",
};

export default function PassphraseTool() {
  // In der Adresszeile stehen nur die Einstellungen, nie die Passphrasen.
  const [params, setParams] = useToolParams({
    woerter: "5",
    anzahl: "5",
    trenner: "bindestrich",
    gross: "1",
    ziffer: "1",
    sonder: "0",
  });
  const separatorKey = params.trenner in SEPARATORS ? params.trenner : "bindestrich";
  const options: PassphraseOptions = {
    words: clampInt(params.woerter, 3, 12, 5),
    separator: SEPARATORS[separatorKey] ?? "-",
    capitalize: params.gross === "1",
    addNumber: params.ziffer === "1",
    addSymbol: params.sonder === "1",
  };
  const count = clampInt(params.anzahl, 1, 20, 5);
  const [list, setList] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ key: string; phrases: string[] } | null>(null);

  useEffect(() => {
    let active = true;
    // Die Wortliste (etwa 70 KB) wird erst geladen, wenn das Tool geöffnet ist.
    import("./words").then(
      (module) => {
        if (active) {
          setList(module.words);
        }
      },
      (caught: Error) => {
        if (active) {
          setError(`Die Wortliste konnte nicht geladen werden: ${caught.message}`);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const key = `${JSON.stringify(options)}|${count}`;
  const make = (words: string[]) => ({
    key,
    phrases: Array.from({ length: count }, () => makePassphrase(words, options)),
  });
  // Liste geladen oder Einstellungen geändert: gleich beim Zeichnen neu erzeugen.
  if (list && made?.key !== key) {
    setMade(make(list));
  }
  const phrases = made?.phrases ?? [];
  const bits = Math.round(passphraseBits(list?.length ?? 7776, options));
  const strength = strengthLabel(bits);

  const check = (name: "gross" | "ziffer" | "sonder", label: string) => (
    <label className="check-label">
      <input
        type="checkbox"
        className="check"
        checked={params[name] === "1"}
        onChange={(event) =>
          setParams({ [name]: event.target.checked ? "1" : "0" } as Partial<typeof params>)
        }
      />
      {label}
    </label>
  );

  return (
    <div className="tool-body settings-form">
      <div className="tool-columns">
        <div className="settings-form">
          <label>
            Wörter: {options.words}
            <input
              type="range"
              min={3}
              max={12}
              value={options.words}
              onChange={(event) => setParams({ woerter: event.target.value })}
            />
          </label>
          <div className="tool-row">
            <label className="narrow">
              Anzahl
              <input
                type="number"
                min={1}
                max={20}
                value={params.anzahl}
                onChange={(event) => setParams({ anzahl: event.target.value })}
              />
            </label>
            <label className="narrow">
              Trennzeichen
              <select
                value={separatorKey}
                onChange={(event) => setParams({ trenner: event.target.value })}
              >
                <option value="bindestrich">Bindestrich</option>
                <option value="punkt">Punkt</option>
                <option value="unterstrich">Unterstrich</option>
                <option value="leerzeichen">Leerzeichen</option>
                <option value="ohne">ohne</option>
              </select>
            </label>
          </div>
        </div>
        <fieldset className="tool-options">
          <legend>Zusätze</legend>
          {check("gross", "Wörter großschreiben")}
          {check("ziffer", "Eine Ziffer anhängen")}
          {check("sonder", "Ein Sonderzeichen anhängen")}
          <p className="small">
            Ziffer und Sonderzeichen helfen bei Richtlinien, die beides verlangen; die Sicherheit
            kommt aus der Zahl der Wörter.
          </p>
        </fieldset>
      </div>

      <div className="tool-row">
        <button
          type="button"
          className="button button-primary"
          disabled={!list}
          onClick={() => list && setMade(make(list))}
        >
          Neu erzeugen
        </button>
        <span className="small">
          ca. {bits} Bit Entropie · <span className={TONE[strength.tone]}>{strength.text}</span>
        </span>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {!list && !error && <p role="status">Die Wortliste wird geladen …</p>}

      <ul className="rows tool-passwords" aria-label="Erzeugte Passphrasen">
        {phrases.map((phrase, index) => (
          <li key={`${index}-${phrase}`}>
            <code className="row-main mono">{phrase}</code>
            <CopyButton value={phrase} label={`Passphrase ${index + 1} kopieren`} />
          </li>
        ))}
      </ul>

      <p className="small">
        Der Zufall kommt aus <span className="mono">crypto.getRandomValues</span>; nichts wird
        gespeichert oder übertragen. Wortliste: dys2p/wordlists-de (de-7776-v1, gemeinfrei, CC0).
      </p>
    </div>
  );
}
