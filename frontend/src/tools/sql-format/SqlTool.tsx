import { useMemo, useState } from "react";
import { formatSql, minifySql } from "../lib/sql";
import { useToolParams } from "../params";
import { ErrorBox, Output, ToolSection } from "../ui";
import {
  join,
  joinInfo,
  joinSql,
  parseTable,
  type JoinResult,
  type JoinType,
  type Table,
} from "./joins";

const JOIN_TYPES = Object.keys(joinInfo) as JoinType[];
const SHOWN_ROWS = 200;

export default function SqlTool() {
  const [params, setParams] = useToolParams({
    bereich: "formatieren",
    modus: "format",
    gross: "1",
    einzug: "2",
    join: "left",
  });
  const joins = params.bereich === "joins";
  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Bereich
        <select
          value={joins ? "joins" : "formatieren"}
          onChange={(event) => setParams({ bereich: event.target.value })}
        >
          <option value="formatieren">Formatieren</option>
          <option value="joins">JOINs ausprobieren</option>
        </select>
      </label>
      {joins ? (
        <SqlJoins
          type={JOIN_TYPES.find((entry) => entry === params.join) ?? "left"}
          onType={(type) => setParams({ join: type })}
        />
      ) : (
        <SqlFormatter
          minify={params.modus === "minify"}
          upper={params.gross === "1"}
          wide={params.einzug === "4"}
          onChange={setParams}
        />
      )}
    </div>
  );
}

function SqlFormatter({
  minify,
  upper,
  wide,
  onChange,
}: {
  minify: boolean;
  upper: boolean;
  wide: boolean;
  onChange: (patch: { modus?: string; gross?: string; einzug?: string }) => void;
}) {
  // Die Abfrage bleibt nur auf dieser Seite.
  const [text, setText] = useState("");
  const output = useMemo(() => {
    if (!text.trim()) {
      return "";
    }
    return minify
      ? minifySql(text)
      : formatSql(text, { indent: wide ? "    " : "  ", uppercase: upper });
  }, [text, minify, upper, wide]);

  return (
    <>
      <label className="narrow">
        Modus
        <select
          value={minify ? "minify" : "format"}
          onChange={(event) => onChange({ modus: event.target.value })}
        >
          <option value="format">Formatieren</option>
          <option value="minify">Eine Zeile</option>
        </select>
      </label>
      {!minify && (
        <fieldset className="tool-options">
          <legend>Optionen</legend>
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={upper}
              onChange={(event) => onChange({ gross: event.target.checked ? "1" : "0" })}
            />
            Schlüsselwörter groß
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={wide}
              onChange={(event) => onChange({ einzug: event.target.checked ? "4" : "2" })}
            />
            4 Leerzeichen einrücken
          </label>
        </fieldset>
      )}
      <label>
        Eingabe
        <textarea
          rows={10}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="select a.name, count(*) from users a join logins l on l.uid = a.id group by a.name"
        />
      </label>
      <Output value={output} label="Formatiert" />
      <p className="small">
        Formatiert nur; die Abfrage wird nicht ausgeführt und nicht auf Fehler geprüft.
      </p>
    </>
  );
}

const cleanName = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 30);

function SqlJoins({ type, onType }: { type: JoinType; onType: (type: JoinType) => void }) {
  // Beispieldaten; eigene Tabellen bleiben nur auf dieser Seite.
  const [nameA, setNameA] = useState("kunden");
  const [nameB, setNameB] = useState("bestellungen");
  const [dataA, setDataA] = useState("id;name;ort\n1;Anna;Köln\n2;Ben;Bonn\n3;Cem;Köln\n4;Dana;Aachen");
  const [dataB, setDataB] = useState(
    "nr;kunde_id;artikel\n100;1;Laptop\n101;1;Maus\n102;3;Monitor\n103;7;Kabel",
  );
  const [wantedA, setKeyA] = useState("id");
  const [wantedB, setKeyB] = useState("kunde_id");

  const state = useMemo(() => {
    let a: Table | null = null;
    let b: Table | null = null;
    let keyA = wantedA;
    let keyB = wantedB;
    try {
      if (!nameA || !nameB) {
        throw new Error("Beide Tabellen brauchen einen Namen.");
      }
      if (nameA.toLowerCase() === nameB.toLowerCase()) {
        throw new Error("Die beiden Tabellen brauchen unterschiedliche Namen.");
      }
      a = parseTable(nameA, dataA);
      b = parseTable(nameB, dataB);
      if (!a.columns.includes(keyA)) {
        keyA = a.columns[0] ?? "";
      }
      if (!b.columns.includes(keyB)) {
        keyB = b.columns.find((column) => column === keyA) ?? b.columns[0] ?? "";
      }
      const result: JoinResult = join(a, b, keyA, keyB, type);
      return { a, b, keyA, keyB, result, sql: joinSql(a, b, keyA, keyB, type), error: null };
    } catch (caught) {
      return { a, b, keyA, keyB, result: null, sql: "", error: (caught as Error).message };
    }
  }, [nameA, nameB, dataA, dataB, wantedA, wantedB, type]);
  const leftColumns = state.a?.columns.length ?? 0;

  const tableInput = (
    side: string,
    name: string,
    setName: (value: string) => void,
    table: Table | null,
    key: string,
    setKey: (value: string) => void,
    data: string,
    setData: (value: string) => void,
  ) => (
    <fieldset className="tool-options">
      <legend>{side}</legend>
      <label>
        Name
        <input
          type="text"
          className="mono"
          value={name}
          onChange={(event) => setName(cleanName(event.target.value))}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label>
        Verknüpfen über
        <select
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={!table || type === "cross"}
        >
          {(table?.columns ?? []).map((column) => (
            <option key={column}>{column}</option>
          ))}
        </select>
      </label>
      <label>
        Daten
        <textarea rows={6} value={data} onChange={(event) => setData(event.target.value)} />
      </label>
    </fieldset>
  );

  return (
    <>
      <div className="tool-row">
        <label className="narrow">
          JOIN-Art
          <select value={type} onChange={(event) => onType(event.target.value as JoinType)}>
            {JOIN_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {joinInfo[entry].label}
              </option>
            ))}
          </select>
        </label>
        <Venn type={type} left={nameA} right={nameB} />
      </div>
      <p>{joinInfo[type].text}</p>
      <div className="tool-columns">
        {tableInput("Linke Tabelle", nameA, setNameA, state.a, state.keyA, setKeyA, dataA, setDataA)}
        {tableInput("Rechte Tabelle", nameB, setNameB, state.b, state.keyB, setKeyB, dataB, setDataB)}
      </div>
      <p className="small">
        Erste Zeile sind die Spaltennamen, Trenner Semikolon, Komma oder Tabulator. Ein leeres Feld
        oder NULL gilt als NULL, und NULL passt zu nichts, auch nicht zu NULL.
      </p>
      {state.error && <ErrorBox>{state.error}</ErrorBox>}
      {state.result && (
        <>
          <Output value={state.sql} label="SQL" />
          <ToolSection
            title={`Ergebnis: ${state.result.rows.length} ${state.result.rows.length === 1 ? "Zeile" : "Zeilen"}`}
          >
            <div className="table-wrap tool-scroll" tabIndex={0} role="region" aria-label="Ergebnis">
              <table>
                <caption className="visually-hidden">Ergebnis des JOINs</caption>
                <thead>
                  <tr>
                    {state.result.columns.map((column, index) => (
                      <th
                        key={column}
                        scope="col"
                        className={index === leftColumns ? "mono join-split" : "mono"}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.result.rows.slice(0, SHOWN_ROWS).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((value, index) => (
                        <td key={index} className={index === leftColumns ? "mono join-split" : "mono"}>
                          {value === null ? <span className="pill pill-todo">NULL</span> : value}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {state.result.rows.length === 0 && (
                    <tr>
                      <td colSpan={state.result.columns.length}>
                        Keine Zeilen: Es gibt keine passenden Paare.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {state.result.rows.length > SHOWN_ROWS && (
              <p className="small">Angezeigt werden die ersten {SHOWN_ROWS} Zeilen.</p>
            )}
          </ToolSection>
        </>
      )}
    </>
  );
}

/** Mengendiagramm: Welche Bereiche landen im Ergebnis? */
function Venn({ type, left, right }: { type: JoinType; left: string; right: string }) {
  const leftOn = type === "left" || type === "full" || type === "left-only" || type === "cross";
  const middleOn = type !== "left-only" && type !== "right-only";
  const rightOn = type === "right" || type === "full" || type === "right-only" || type === "cross";
  const area = (on: boolean) => (on ? "venn-area venn-on" : "venn-area");
  return (
    <svg
      className="venn"
      width="210"
      height="112"
      viewBox="0 0 210 112"
      role="img"
      aria-label={`Mengendiagramm ${joinInfo[type].label}`}
    >
      <defs>
        <clipPath id="venn-links">
          <circle cx="78" cy="50" r="44" />
        </clipPath>
        <mask id="venn-ohne-rechts">
          <rect width="210" height="112" fill="white" />
          <circle cx="132" cy="50" r="44" fill="black" />
        </mask>
        <mask id="venn-ohne-links">
          <rect width="210" height="112" fill="white" />
          <circle cx="78" cy="50" r="44" fill="black" />
        </mask>
      </defs>
      <circle cx="78" cy="50" r="44" className={area(leftOn)} mask="url(#venn-ohne-rechts)" />
      <circle cx="132" cy="50" r="44" className={area(rightOn)} mask="url(#venn-ohne-links)" />
      <circle cx="132" cy="50" r="44" className={area(middleOn)} clipPath="url(#venn-links)" />
      <circle cx="78" cy="50" r="44" className="venn-ring" />
      <circle cx="132" cy="50" r="44" className="venn-ring" />
      <text x="60" y="108" textAnchor="middle" className="venn-text">
        {left}
      </text>
      <text x="150" y="108" textAnchor="middle" className="venn-text">
        {right}
      </text>
      {type === "cross" && (
        <text x="105" y="54" textAnchor="middle" className="venn-text venn-cross">
          ×
        </text>
      )}
    </svg>
  );
}
