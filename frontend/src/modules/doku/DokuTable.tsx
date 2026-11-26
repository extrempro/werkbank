import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Extension, type Editor } from "@tiptap/react";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TableMap } from "@tiptap/pm/tables";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { PHONE_QUERY, useMediaQuery } from "../../components/FilterBar";

/** Größe im Raster beim Einfügen */
const PICK_MAX = 6;

export interface TableSpot {
  table: PmNode;
  /** Position vor der Tabelle */
  pos: number;
  /** Beginn des Inhalts der Tabelle */
  start: number;
  map: TableMap;
  row: number;
  col: number;
  rows: number;
  cols: number;
  /** Erste Zeile ist Kopfzeile */
  header: boolean;
}

/** Wo die Schreibmarke in einer Tabelle steht; `null` außerhalb. */
export function tableSpot(state: EditorState): TableSpot | null {
  const { $from } = state.selection;
  let cellDepth = -1;
  let tableDepth = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role: unknown = $from.node(depth).type.spec.tableRole;
    if (cellDepth < 0 && (role === "cell" || role === "header_cell")) {
      cellDepth = depth;
    }
    if (role === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (cellDepth < 0 || tableDepth < 0) {
    return null;
  }
  const table = $from.node(tableDepth);
  const start = $from.start(tableDepth);
  const map = TableMap.get(table);
  const rect = map.findCell($from.before(cellDepth) - start);
  const first = table.firstChild?.firstChild;
  return {
    table,
    pos: $from.before(tableDepth),
    start,
    map,
    row: rect.top,
    col: rect.left,
    rows: map.height,
    cols: map.width,
    header: first?.type.spec.tableRole === "header_cell",
  };
}

const ACTIVE_KEY = new PluginKey("doku-table-active");

/** Hebt die Zelle mit der Schreibmarke hervor, dazu leicht ihre Zeile und Spalte. */
export const ActiveCell = Extension.create({
  name: "dokuActiveCell",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ACTIVE_KEY,
        props: {
          decorations: (state) => {
            if (!this.editor.isEditable) {
              return null;
            }
            const spot = tableSpot(state);
            if (!spot) {
              return null;
            }
            const seen = new Set<number>();
            const decorations: Decoration[] = [];
            for (const pos of spot.map.map) {
              if (seen.has(pos)) {
                continue;
              }
              seen.add(pos);
              const cell = spot.table.nodeAt(pos);
              if (!cell) {
                continue;
              }
              const rect = spot.map.findCell(pos);
              const inRow = rect.top <= spot.row && spot.row < rect.bottom;
              const inCol = rect.left <= spot.col && spot.col < rect.right;
              const className =
                inRow && inCol ? "doku-cell-active" : inRow || inCol ? "doku-cell-band" : null;
              if (className) {
                const from = spot.start + pos;
                decorations.push(Decoration.node(from, from + cell.nodeSize, { class: className }));
              }
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/** Setzt die Schreibmarke in eine Zelle der aktuellen Tabelle. */
function moveTo(editor: Editor, row: number, col: number): boolean {
  const spot = tableSpot(editor.state);
  if (!spot) {
    return false;
  }
  const r = Math.max(0, Math.min(row, spot.rows - 1));
  const c = Math.max(0, Math.min(col, spot.cols - 1));
  const cellPos = spot.start + (spot.map.map[r * spot.cols + c] ?? 0);
  const tr = editor.state.tr.setSelection(
    TextSelection.near(editor.state.doc.resolve(cellPos + 1)),
  );
  editor.view.dispatch(tr);
  return true;
}

/** Zeile am Ende der Tabelle, die Schreibmarke wandert hinein. */
export function addRowAtEnd(editor: Editor): void {
  const spot = tableSpot(editor.state);
  if (!spot || !moveTo(editor, spot.rows - 1, spot.col)) {
    return;
  }
  editor.chain().focus().addRowAfter().run();
  moveTo(editor, spot.rows, spot.col);
}

/** Spalte am Ende der Tabelle, die Schreibmarke wandert hinein. */
export function addColumnAtEnd(editor: Editor): void {
  const spot = tableSpot(editor.state);
  if (!spot || !moveTo(editor, spot.row, spot.cols - 1)) {
    return;
  }
  editor.chain().focus().addColumnAfter().run();
  moveTo(editor, spot.row, spot.cols);
}

/** Beim Einfügen: Größe im Raster wählen, Kopfzeile ja oder nein. */
export function TablePicker({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [size, setSize] = useState({ rows: 3, cols: 3 });
  const [header, setHeader] = useState(true);
  const headerId = useId();
  const insert = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: header }).run();
    onClose();
  };
  const range = Array.from({ length: PICK_MAX }, (_, index) => index + 1);
  const cells = range.flatMap((row) =>
    range.map((col) => {
      const on = row <= size.rows && col <= size.cols;
      return (
        <button
          key={`${row}-${col}`}
          type="button"
          className={on ? "doku-pick-cell doku-pick-on" : "doku-pick-cell"}
          aria-label={`${row} Zeilen × ${col} Spalten`}
          onMouseEnter={() => setSize({ rows: row, cols: col })}
          onFocus={() => setSize({ rows: row, cols: col })}
          onClick={() => insert(row, col)}
        />
      );
    }),
  );
  return (
    <div
      className="doku-picker doku-table-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          editor.commands.focus();
        }
      }}
    >
      <h2 className="doku-picker-title">Tabelle einfügen</h2>
      <span className="small" aria-live="polite">
        Größe: {size.rows} Zeilen × {size.cols} Spalten
      </span>
      <div className="doku-pick-grid">{cells}</div>
      <label className="check-label" htmlFor={headerId}>
        <input
          id={headerId}
          type="checkbox"
          className="check"
          checked={header}
          onChange={(event) => setHeader(event.target.checked)}
        />
        <span>Erste Zeile ist Kopfzeile</span>
      </label>
      <div className="actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            onClose();
            editor.commands.focus();
          }}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

const DELETE_CONFIRM = {
  title: "Tabelle löschen?",
  text: "Die ganze Tabelle mit allen Inhalten verschwindet aus der Seite. Mit „Rückgängig“ holst du sie zurück.",
  action: "Löschen",
};

function where(spot: TableSpot): string {
  const row = spot.header
    ? spot.row === 0
      ? "Kopfzeile"
      : `Zeile ${spot.row}`
    : `Zeile ${spot.row + 1}`;
  return `${row}, Spalte ${spot.col + 1}`;
}

/** Abstand der Leiste unten zum Fensterrand: über dem Schnellzugriff am Handy. */
function barOffset(): number {
  const bar = document.querySelector<HTMLElement>('nav[aria-label="Schnellzugriff"]');
  // Die Leiste ist „fixed“: offsetParent ist dann immer null, sichtbar heißt hier „hat Fläche“
  if (!bar || bar.getClientRects().length === 0) {
    return 0;
  }
  return Math.max(0, window.innerHeight - bar.getBoundingClientRect().top);
}

/** Werkzeuge für die Tabelle mit der Schreibmarke: am Computer eine Leiste, am Handy unten. */
export function TableTools({ editor, spot }: { editor: Editor; spot: TableSpot }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [sheet, setSheet] = useState(false);
  const [offset, setOffset] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sheet) {
      sheetRef.current?.querySelector("button")?.focus();
    }
  }, [sheet]);
  useLayoutEffect(() => {
    if (!phone) {
      return;
    }
    const update = () => setOffset(barOffset());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [phone]);
  const run = (action: () => void) => () => {
    action();
    setSheet(false);
  };
  const rowAbove = run(() => editor.chain().focus().addRowBefore().run());
  const rowBelow = run(() => editor.chain().focus().addRowAfter().run());
  const rowDelete = run(() => editor.chain().focus().deleteRow().run());
  const colLeft = run(() => editor.chain().focus().addColumnBefore().run());
  const colRight = run(() => editor.chain().focus().addColumnAfter().run());
  const colDelete = run(() => editor.chain().focus().deleteColumn().run());
  const toggleHeader = () => editor.chain().focus().toggleHeaderRow().run();
  const deleteTable = () => {
    setSheet(false);
    editor.chain().focus().deleteTable().run();
  };
  const keep = (event: { preventDefault: () => void }) => event.preventDefault();

  if (phone) {
    return (
      <>
        <div
          className="doku-table-bar"
          role="toolbar"
          aria-label="Tabelle"
          style={{ bottom: offset }}
        >
          <button
            type="button"
            className="button button-secondary"
            onMouseDown={keep}
            onClick={rowBelow}
          >
            Zeile +
          </button>
          <button
            type="button"
            className="button button-secondary"
            onMouseDown={keep}
            onClick={colRight}
          >
            Spalte +
          </button>
          <button
            type="button"
            className="button button-secondary"
            aria-pressed={spot.header}
            onMouseDown={keep}
            onClick={toggleHeader}
          >
            Kopfzeile
          </button>
          <button
            type="button"
            className="button button-primary"
            aria-expanded={sheet}
            onMouseDown={keep}
            onClick={() => setSheet(true)}
          >
            Mehr …
          </button>
        </div>
        {sheet && (
          <div className="doku-sheet-backdrop" onClick={() => setSheet(false)}>
            <div
              className="doku-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`Tabelle bearbeiten, ${where(spot)}`}
              ref={sheetRef}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.key === "Escape" && setSheet(false)}
            >
              <strong>Tabelle · {where(spot)}</strong>
              <button type="button" onClick={rowAbove}>
                Zeile darüber einfügen
              </button>
              <button type="button" onClick={rowBelow}>
                Zeile darunter einfügen
              </button>
              <button type="button" onClick={colLeft}>
                Spalte links einfügen
              </button>
              <button type="button" onClick={colRight}>
                Spalte rechts einfügen
              </button>
              <button
                type="button"
                className="doku-danger"
                disabled={spot.rows <= 1}
                onClick={rowDelete}
              >
                Zeile löschen
              </button>
              <button
                type="button"
                className="doku-danger"
                disabled={spot.cols <= 1}
                onClick={colDelete}
              >
                Spalte löschen
              </button>
              <ConfirmButton
                className="doku-danger"
                confirm={DELETE_CONFIRM}
                onConfirm={deleteTable}
              >
                Tabelle löschen …
              </ConfirmButton>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setSheet(false)}
              >
                Schließen
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="doku-toolbar doku-tabletools" role="toolbar" aria-label="Tabelle">
      <div role="group" aria-label="Zeile" className="doku-table-group">
        <span className="small">Zeile</span>
        <button
          type="button"
          className="button button-secondary"
          onMouseDown={keep}
          onClick={rowAbove}
        >
          ↑ darüber
        </button>
        <button
          type="button"
          className="button button-secondary"
          onMouseDown={keep}
          onClick={rowBelow}
        >
          ↓ darunter
        </button>
        <button
          type="button"
          className="button button-secondary doku-danger"
          disabled={spot.rows <= 1}
          onMouseDown={keep}
          onClick={rowDelete}
          aria-label="Zeile löschen"
        >
          Löschen
        </button>
      </div>
      <div role="group" aria-label="Spalte" className="doku-table-group">
        <span className="small">Spalte</span>
        <button
          type="button"
          className="button button-secondary"
          onMouseDown={keep}
          onClick={colLeft}
        >
          ← links
        </button>
        <button
          type="button"
          className="button button-secondary"
          onMouseDown={keep}
          onClick={colRight}
        >
          → rechts
        </button>
        <button
          type="button"
          className="button button-secondary doku-danger"
          disabled={spot.cols <= 1}
          onMouseDown={keep}
          onClick={colDelete}
          aria-label="Spalte löschen"
        >
          Löschen
        </button>
      </div>
      <button
        type="button"
        className="button button-secondary"
        aria-pressed={spot.header}
        onMouseDown={keep}
        onClick={toggleHeader}
      >
        Kopfzeile
      </button>
      <span className="small doku-table-where" aria-live="polite">
        {where(spot)} · Tab: nächste Zelle
      </span>
      <ConfirmButton
        className="button button-link doku-danger"
        confirm={DELETE_CONFIRM}
        onConfirm={deleteTable}
      >
        Tabelle löschen
      </ConfirmButton>
    </div>
  );
}

/** „+ Zeile“ unter und „+“ rechts neben der Tabelle mit der Schreibmarke. */
export function TableEdges({ editor, spot }: { editor: Editor; spot: TableSpot }) {
  const [box, setBox] = useState<{ row: CSSProperties; col: CSSProperties } | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const pos = spot.pos;
  useLayoutEffect(() => {
    const host = anchor?.offsetParent;
    if (!anchor || !(host instanceof HTMLElement)) {
      return;
    }
    const place = () => {
      const dom = editor.view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) {
        setBox(null);
        return;
      }
      const rect = dom.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const top = rect.top - hostRect.top;
      const left = rect.left - hostRect.left;
      setBox({
        row: { top: top + rect.height + 6, left, width: rect.width },
        col: { top, left: left + rect.width + 6, height: rect.height },
      });
    };
    place();
    window.addEventListener("resize", place);
    editor.on("transaction", place);
    return () => {
      window.removeEventListener("resize", place);
      editor.off("transaction", place);
    };
  }, [anchor, editor, pos]);
  return (
    <div ref={setAnchor} className="doku-table-edges">
      {box && (
        <>
          <button
            type="button"
            className="doku-edge doku-edge-row"
            style={box.row}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => addRowAtEnd(editor)}
          >
            + Zeile hinzufügen
          </button>
          <button
            type="button"
            className="doku-edge doku-edge-col"
            style={box.col}
            aria-label="Spalte am Ende hinzufügen"
            title="Spalte hinzufügen"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => addColumnAtEnd(editor)}
          >
            +
          </button>
        </>
      )}
    </div>
  );
}

/** Tabelle, in der die Schreibmarke steht, neu bei jeder Änderung. */
export function useTableSpot(editor: Editor): TableSpot | null {
  const [spot, setSpot] = useState<TableSpot | null>(() => tableSpot(editor.state));
  useEffect(() => {
    const update = () => setSpot(tableSpot(editor.state));
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);
  return spot;
}
