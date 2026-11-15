import { useMemo, useState } from "react";
import { Output, ToolSection } from "../ui";
import { cleanSpecialChars, findSpecialChars, textStats } from "./stats";

export default function TextStatsTool() {
  // Der Text bleibt nur auf dieser Seite.
  const [text, setText] = useState("");
  const stats = useMemo(() => textStats(text), [text]);
  const special = useMemo(() => findSpecialChars(text), [text]);
  const cleaned = useMemo(() => (special.length ? cleanSpecialChars(text) : ""), [text, special]);
  const tiles: [string, number][] = [
    ["Zeichen", stats.chars],
    ["ohne Leerzeichen", stats.charsNoSpaces],
    ["Wörter", stats.words],
    ["Zeilen", stats.lines],
    ["Sätze", stats.sentences],
    ["Absätze", stats.paragraphs],
    ["Bytes (UTF-8)", stats.bytesUtf8],
    ["UTF-16-Einheiten", stats.utf16Units],
  ];

  return (
    <div className="tool-body settings-form">
      <label>
        Eingabe
        <textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <dl className="kpis">
        {tiles.map(([label, value]) => (
          <div className="kpi" key={label}>
            <dt>{label}</dt>
            <dd className="tool-kpi">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="small">
        Zeichen zählen Emojis und Umlaute als je eines. Viele Systeme begrenzen dagegen Bytes (zum
        Beispiel SMS, Datenbankfelder) oder UTF-16-Einheiten (zum Beispiel Active Directory).
        Lesezeit etwa {stats.readingMinutes} min.
      </p>
      <ToolSection title="Unsichtbare und auffällige Zeichen">
        {special.length === 0 ? (
          <p className="small" role="status">
            {text ? "Keine gefunden." : "–"}
          </p>
        ) : (
          <>
            <ul className="tool-list" aria-label="Gefundene Zeichen">
              {special.map((entry) => (
                <li key={entry.code}>
                  <span className={`pill ${entry.risky ? "pill-todo" : "pill-neutral"}`}>
                    {entry.count}×
                  </span>{" "}
                  <span className="mono">{entry.code}</span> {entry.name}
                </li>
              ))}
            </ul>
            <p className="small">
              Solche Zeichen landen oft beim Kopieren aus Textverarbeitung, Chat oder Webseiten in
              Befehlen, Kennwörtern und Konfigurationsdateien.
            </p>
            <Output value={cleaned} label="Bereinigt" />
            <p className="small">
              Unsichtbare Zeichen sind entfernt, typografische Zeichen vereinfacht.
            </p>
            <div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setText(cleaned)}
              >
                Bereinigten Text übernehmen
              </button>
            </div>
          </>
        )}
      </ToolSection>
    </div>
  );
}
