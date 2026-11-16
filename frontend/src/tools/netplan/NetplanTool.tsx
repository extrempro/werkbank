import { useState, type ClipboardEvent } from "react";
import { DataTable, dec } from "../calc";
import { useToolParams } from "../params";
import { ErrorBox, ToolSection } from "../ui";
import {
  computePlan,
  formatRows,
  nextId,
  parseActivities,
  parseRows,
  type Node,
  type Row,
} from "./netplan";

const EXAMPLE = [
  "A; Bedarf aufnehmen; 2; ",
  "B; Hardware bestellen; 5; A",
  "C; Image erstellen; 3; A",
  "D; Netzwerkdosen prüfen; 1; A",
  "E; Geräte einrichten; 2; B, C",
  "F; Aufstellen; 1; D, E",
  "G; Übergabe, Doku; 1; F",
].join("\n");
const UNITS = ["Tage", "Stunden", "Wochen"] as const;

export default function NetplanTool() {
  const [params, setParams] = useToolParams({ einheit: "Tage" });
  // Die Vorgänge bleiben im Browser und stehen nicht in der Adresszeile.
  const [text, setText] = useState(EXAMPLE);
  const unit = UNITS.find((entry) => entry === params.einheit) ?? "Tage";
  const rows = parseRows(text);
  const save = (next: Row[]) => setText(formatRows(next));
  const edit = (index: number, patch: Partial<Row>) =>
    save(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const { activities, errors } = parseActivities(formatRows(rows));
  let plan: ReturnType<typeof computePlan> | null = null;
  let error: string | null = null;
  try {
    plan = computePlan(activities);
  } catch (caught) {
    error = (caught as Error).message;
  }

  // Mehrere Zeilen aus Excel oder einer Textdatei einfügen ersetzt die Tabelle.
  const paste = (event: ClipboardEvent) => {
    const text = event.clipboardData.getData("text");
    if (!/\n/.test(text.trim())) {
      return;
    }
    const pasted = parseRows(text);
    if (pasted.length < 2) {
      return;
    }
    event.preventDefault();
    save(pasted);
  };

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Vorgänge">
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Vorgänge bearbeiten"
          onPaste={paste}
        >
          <table className="tool-edit-table">
            <caption className="visually-hidden">Vorgänge mit Dauer und Vorgängern</caption>
            <thead>
              <tr>
                <th scope="col">Nr.</th>
                <th scope="col">Vorgang</th>
                <th scope="col">Dauer ({unit})</th>
                <th scope="col">Vorgänger</th>
                <th scope="col">
                  <span className="visually-hidden">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    <input
                      type="text"
                      className="mono tool-input-short"
                      aria-label={`Nr. Zeile ${index + 1}`}
                      value={row.id}
                      maxLength={6}
                      onChange={(event) => edit(index, { id: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      aria-label={`Vorgang Zeile ${index + 1}`}
                      value={row.name}
                      maxLength={80}
                      onChange={(event) => edit(index, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="mono tool-input-short"
                      inputMode="decimal"
                      aria-label={`Dauer Zeile ${index + 1}`}
                      value={row.duration}
                      maxLength={8}
                      onChange={(event) => edit(index, { duration: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="mono"
                      aria-label={`Vorgänger Zeile ${index + 1}`}
                      placeholder={index === 0 ? "z. B. A, B" : ""}
                      value={row.preds}
                      maxLength={60}
                      onChange={(event) => edit(index, { preds: event.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-label={`Vorgang ${row.id || index + 1} löschen`}
                      onClick={() => save(rows.filter((_, at) => at !== index))}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>Noch keine Vorgänge. Füge den ersten hinzu.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="tool-row">
          <button
            type="button"
            className="button button-secondary"
            disabled={rows.length >= 60}
            onClick={() =>
              save([
                ...rows,
                {
                  id: nextId(rows),
                  name: "",
                  duration: "1",
                  preds: rows[rows.length - 1]?.id ?? "",
                },
              ])
            }
          >
            Vorgang hinzufügen
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setText(EXAMPLE)}
          >
            Beispiel zurücksetzen
          </button>
          <label className="narrow">
            Dauer in
            <select value={unit} onChange={(event) => setParams({ einheit: event.target.value })}>
              {UNITS.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="small">
          Mehrere Zeilen aus Excel (Nr., Vorgang, Dauer, Vorgänger) lassen sich direkt in die
          Tabelle einfügen.
        </p>
      </ToolSection>

      {errors.length > 0 && <ErrorBox>{errors.join(" ")}</ErrorBox>}
      {error && rows.length > 0 && <ErrorBox>{error}</ErrorBox>}
      {plan && (
        <>
          <p className="hint-box">
            <strong>
              Projektdauer: {dec(plan.duration)} {unit}
            </strong>
            <br />
            Kritischer Pfad: {plan.criticalPath.join(" → ")}. Jede Verzögerung dort verschiebt das
            Projektende.
          </p>
          <Diagram nodes={plan.nodes} />
          <ToolSection title="Werte als Tabelle">
            <DataTable
              caption="Netzplan als Tabelle"
              head={["Nr.", "Vorgang", "Dauer", "FAZ", "FEZ", "SAZ", "SEZ", "GP", "FP", ""]}
              numericFrom={2}
              highlight={(index) => plan.nodes[index]?.critical ?? false}
              rows={plan.nodes.map((node) => [
                node.id,
                node.name,
                dec(node.duration),
                dec(node.faz),
                dec(node.fez),
                dec(node.saz),
                dec(node.sez),
                dec(node.gp),
                dec(node.fp),
                node.critical ? <span className="pill pill-bad">kritisch</span> : "",
              ])}
            />
            <p className="small">
              Vorwärts: FAZ = größter FEZ der Vorgänger, FEZ = FAZ + Dauer. Rückwärts: SEZ =
              kleinster SAZ der Nachfolger, SAZ = SEZ − Dauer. Gesamtpuffer GP = SAZ − FAZ, freier
              Puffer FP = kleinster FAZ der Nachfolger − FEZ. Kritisch ist, wer keinen Gesamtpuffer
              hat.
            </p>
          </ToolSection>
        </>
      )}
    </div>
  );
}

const W = 146;
const RH = 20;
const H = RH * 4;
const GX = 40;
const GY = 24;

/** Vorgangsknoten: FAZ|FEZ · Nr.|Vorgang · D|GP|FP · SAZ|SEZ */
function Diagram({ nodes }: { nodes: Node[] }) {
  const columns = new Map<number, Node[]>();
  for (const node of nodes) {
    columns.set(node.rank, [...(columns.get(node.rank) ?? []), node]);
  }
  const rowCount = Math.max(...[...columns.values()].map((column) => column.length));
  const width = columns.size * (W + GX) - GX + 2;
  const height = rowCount * (H + GY) - GY + 2;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [rank, list] of columns) {
    const offset = ((rowCount - list.length) * (H + GY)) / 2;
    list.forEach((node, index) =>
      pos.set(node.id, { x: 1 + rank * (W + GX), y: 1 + offset + index * (H + GY) }),
    );
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const short = (text: string) => (text.length > 17 ? `${text.slice(0, 16)}…` : text);
  const edges = nodes.flatMap((node) =>
    node.preds.flatMap((id) => {
      const before = byId.get(id);
      if (!before) {
        return [];
      }
      return [
        {
          from: id,
          to: node.id,
          far: node.rank - before.rank > 1,
          critical: node.critical && before.critical && Math.abs(before.fez - node.faz) < 1e-9,
        },
      ];
    }),
  );

  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Netzplan als Diagramm">
      <svg
        className="tool-netplan"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Netzplan als Diagramm; die Werte stehen auch in der Tabelle"
      >
        <defs>
          <marker
            id="np-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" className="np-head" />
          </marker>
          <marker
            id="np-arrow-crit"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" className="np-head-crit" />
          </marker>
        </defs>
        {/* Kritische Pfeile zuletzt, damit sie obenauf liegen */}
        {[...edges]
          .sort((a, b) => Number(a.critical) - Number(b.critical))
          .map((edge) => {
            const a = pos.get(edge.from);
            const b = pos.get(edge.to);
            if (!a || !b) {
              return null;
            }
            const x1 = a.x + W;
            const y1 = a.y + H / 2;
            const x2 = b.x;
            const y2 = b.y + H / 2;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                // Pfeile über mehrere Spalten laufen erst waagerecht und biegen kurz vor dem Ziel ab.
                d={
                  edge.far
                    ? `M${x1},${y1} L${x2 - GX},${y1} C${x2 - GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`
                    : `M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`
                }
                fill="none"
                className={edge.critical ? "np-edge-crit" : "np-edge"}
                strokeWidth={edge.critical ? 2 : 1.25}
                markerEnd={`url(#${edge.critical ? "np-arrow-crit" : "np-arrow"})`}
              />
            );
          })}
        {nodes.map((node) => {
          const place = pos.get(node.id);
          if (!place) {
            return null;
          }
          const { x, y } = place;
          const line = node.critical ? "np-line-crit" : "np-line";
          const cell = (cx: number, row: number, label: string, value: number) => (
            <text
              x={x + cx}
              y={y + row * RH + 14}
              textAnchor="middle"
              fontSize="11"
              className="np-text"
            >
              <tspan fontSize="8.5" opacity="0.65">
                {label}{" "}
              </tspan>
              <tspan fontWeight="700">{dec(value)}</tspan>
            </text>
          );
          const divider = (dx: number, row: number) => (
            <line
              x1={x + dx}
              y1={y + row * RH}
              x2={x + dx}
              y2={y + (row + 1) * RH}
              className={line}
            />
          );
          return (
            <g key={node.id}>
              <title>{`${node.id} ${node.name}`}</title>
              <rect
                x={x}
                y={y}
                width={W}
                height={H}
                rx="3"
                strokeWidth={node.critical ? 1.5 : 1}
                className={`${line} ${node.critical ? "np-node-crit" : "np-node"}`}
              />
              {[1, 2, 3].map((row) => (
                <line
                  key={row}
                  x1={x}
                  y1={y + row * RH}
                  x2={x + W}
                  y2={y + row * RH}
                  className={line}
                />
              ))}
              {divider(W / 2, 0)}
              {divider(30, 1)}
              {divider(W / 3, 2)}
              {divider((2 * W) / 3, 2)}
              {divider(W / 2, 3)}
              {cell(W / 4, 0, "FAZ", node.faz)}
              {cell((3 * W) / 4, 0, "FEZ", node.fez)}
              <text
                x={x + 15}
                y={y + RH + 14}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                className="np-text"
              >
                {node.id.slice(0, 3)}
              </text>
              <text x={x + 36} y={y + RH + 14} fontSize="11" fontWeight="600" className="np-text">
                {short(node.name)}
              </text>
              {cell(W / 6, 2, "D", node.duration)}
              {cell(W / 2, 2, "GP", node.gp)}
              {cell((5 * W) / 6, 2, "FP", node.fp)}
              {cell(W / 4, 3, "SAZ", node.saz)}
              {cell((3 * W) / 4, 3, "SEZ", node.sez)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
