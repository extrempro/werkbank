import { useState } from "react";
import { clampInt, useToolParams } from "../params";
import { Output } from "../ui";
import { lorem } from "./lorem";

type Kind = "paragraphs" | "sentences" | "words";
const KIND_PARAM: Record<string, Kind> = {
  absaetze: "paragraphs",
  saetze: "sentences",
  woerter: "words",
};

export default function LoremTool() {
  const [params, setParams] = useToolParams({ einheit: "absaetze", anzahl: "3", klassisch: "1" });
  const kind = KIND_PARAM[params.einheit] ?? "paragraphs";
  const count = clampInt(params.anzahl, 1, 200, 3);
  const classic = params.klassisch === "1";
  const key = `${kind}|${count}|${classic}`;
  const make = () => ({ key, text: lorem(kind, count, classic) });
  const [made, setMade] = useState(make);
  // Geänderte Einstellungen: gleich beim Zeichnen neuen Text erzeugen.
  if (made.key !== key) {
    setMade(make());
  }
  const text = made.text;
  const html =
    kind === "paragraphs"
      ? text
          .split("\n\n")
          .map((paragraph) => `<p>${paragraph}</p>`)
          .join("\n")
      : `<p>${text}</p>`;
  const words = text.split(/\s+/).filter(Boolean).length;

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Einheit
          <select
            value={params.einheit in KIND_PARAM ? params.einheit : "absaetze"}
            onChange={(event) => setParams({ einheit: event.target.value })}
          >
            <option value="absaetze">Absätze</option>
            <option value="saetze">Sätze</option>
            <option value="woerter">Wörter</option>
          </select>
        </label>
        <label className="narrow">
          Anzahl
          <input
            type="number"
            min={1}
            max={200}
            value={params.anzahl}
            onChange={(event) => setParams({ anzahl: event.target.value })}
          />
        </label>
        <button type="button" className="button button-secondary" onClick={() => setMade(make())}>
          Neu erzeugen
        </button>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          className="check"
          checked={classic}
          onChange={(event) => setParams({ klassisch: event.target.checked ? "1" : "0" })}
        />
        Mit „Lorem ipsum dolor sit amet …“ beginnen
      </label>
      <p className="small" role="status">
        {words} Wörter, {text.length} Zeichen
      </p>
      <Output value={text} label="Text" />
      <Output value={html} label="Als HTML" />
    </div>
  );
}
