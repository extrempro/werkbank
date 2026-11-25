import { FixedChoice } from "../../components/ListChoice";
import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { CopyButton, ErrorBox } from "../ui";
import { diffLines, diffWords, sideBySide, unifiedDiff, type LineDiff, type Row } from "./diff";

function Words({ before, after, side }: { before: string; after: string; side: "left" | "right" }) {
  const wanted = side === "left" ? "delete" : "insert";
  return (
    <>
      {diffWords(before, after).map((part, index) =>
        part.type === "equal" ? (
          <span key={index}>{part.text}</span>
        ) : part.type === wanted ? (
          <mark key={index} className="diff-word">
            {part.text}
          </mark>
        ) : null,
      )}
    </>
  );
}

const CELL: Record<Row["type"], [string, string]> = {
  equal: ["", ""],
  change: ["diff-del", "diff-add"],
  delete: ["diff-del", "diff-none"],
  insert: ["diff-none", "diff-add"],
};

function lineClass(line: string): string | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "tool-line diff-add";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "tool-line diff-del";
  }
  return line.startsWith("@@") ? "tool-line diff-hunk" : "tool-line";
}

type Result = { diff: LineDiff; rows: Row[]; unified: string } | { error: string } | null;

export default function DiffTool() {
  const [params, setParams] = useToolParams({
    ansicht: "nebeneinander",
    leerraum: "0",
    gross: "0",
    nur: "0",
  });
  const unified = params.ansicht === "unified";
  const ignoreWhitespace = params.leerraum === "1";
  const ignoreCase = params.gross === "1";
  const onlyChanges = params.nur === "1";
  // Die Texte bleiben nur auf dieser Seite.
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");

  const result = useMemo((): Result => {
    if (!left && !right) {
      return null;
    }
    try {
      const diff = diffLines(left, right, { ignoreWhitespace, ignoreCase });
      return { diff, rows: sideBySide(diff.ops), unified: unifiedDiff(diff.ops) };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [left, right, ignoreWhitespace, ignoreCase]);

  const check = (key: "leerraum" | "gross" | "nur", label: string) => (
    <label className="check-label">
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
  );

  return (
    <div className="tool-body settings-form">
      <div className="tool-columns">
        <label>
          Vorher
          <textarea rows={10} value={left} onChange={(event) => setLeft(event.target.value)} />
        </label>
        <label>
          Nachher
          <textarea rows={10} value={right} onChange={(event) => setRight(event.target.value)} />
        </label>
      </div>
      <FixedChoice
        label="Ansicht"
        value={unified ? "unified" : "nebeneinander"}
        options={[
          { value: "nebeneinander", label: "Nebeneinander" },
          { value: "unified", label: "Unified-Diff" },
        ]}
        onChange={(value) => setParams({ ansicht: value })}
      />
      <fieldset className="tool-options">
        <legend>Optionen</legend>
        {check("leerraum", "Leerraum ignorieren")}
        {check("gross", "Groß/klein ignorieren")}
        {!unified && check("nur", "Nur Änderungen zeigen")}
      </fieldset>
      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {result && "diff" in result && (
        <>
          <p className="badges" role="status">
            {result.diff.added + result.diff.removed === 0 ? (
              <span className="pill pill-ok">identisch</span>
            ) : (
              <>
                <span className="pill pill-bad">{result.diff.removed} entfernt</span>
                <span className="pill pill-ok">{result.diff.added} hinzugefügt</span>
              </>
            )}
          </p>
          {unified ? (
            <div className="tool-output">
              <div className="section-head">
                <h2>Unified-Diff</h2>
                {result.unified !== "" && (
                  <CopyButton value={result.unified} label="Unified-Diff kopieren" />
                )}
              </div>
              <pre
                className="value-block tool-scroll"
                tabIndex={0}
                role="region"
                aria-label="Unified-Diff"
              >
                {result.unified.split("\n").map((line, index) => (
                  <span key={index} className={lineClass(line)}>
                    {line || " "}
                  </span>
                ))}
              </pre>
            </div>
          ) : (
            <div
              className="table-wrap tool-scroll"
              tabIndex={0}
              role="region"
              aria-label="Vergleich"
            >
              <table className="diff-table mono">
                <caption className="visually-hidden">Vergleich Zeile für Zeile</caption>
                <thead className="visually-hidden">
                  <tr>
                    <th scope="col">Zeile vorher</th>
                    <th scope="col">Vorher</th>
                    <th scope="col">Zeile nachher</th>
                    <th scope="col">Nachher</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows
                    .filter((row) => !onlyChanges || row.type !== "equal")
                    .map((row, index) => (
                      <tr key={index}>
                        <td className="diff-no">{row.left?.no}</td>
                        <td className={CELL[row.type][0]}>
                          {row.type === "change" && row.left && row.right ? (
                            <Words before={row.left.text} after={row.right.text} side="left" />
                          ) : (
                            row.left?.text
                          )}
                        </td>
                        <td className="diff-no">{row.right?.no}</td>
                        <td className={CELL[row.type][1]}>
                          {row.type === "change" && row.left && row.right ? (
                            <Words before={row.left.text} after={row.right.text} side="right" />
                          ) : (
                            row.right?.text
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
