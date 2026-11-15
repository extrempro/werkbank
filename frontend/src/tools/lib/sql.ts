/** einfacher SQL-Formatierer (Dialekt-neutral: T-SQL, MySQL, PostgreSQL, SQLite) */

type Token = { type: "word" | "string" | "ident" | "number" | "comment" | "punct" | "op" | "ws"; text: string };

const KEYWORDS = new Set(
  (
    "select from where and or not in is null like between exists as on join inner left right full outer cross apply group by order having limit offset top distinct union all " +
    "insert into values update set delete merge using when matched then else end case create table alter drop index view procedure function trigger primary key foreign references " +
    "default constraint unique check with recursive returning asc desc nulls first last fetch next rows only over partition window declare begin commit rollback transaction " +
    "if while return go exec execute cast convert coalesce isnull count sum avg min max varchar nvarchar int bigint bit datetime date text identity truncate except intersect pivot unpivot " +
    "lateral natural escape collate for xml json path"
  ).split(" "),
);

/** Klauseln, die eine neue Zeile auf Grundebene beginnen */
const CLAUSES = [
  "select", "from", "where", "group by", "order by", "having", "limit", "offset", "union", "union all", "except", "intersect", "values", "set",
  "insert into", "update", "delete from", "delete", "returning", "with", "window", "fetch", "merge into", "using", "when matched", "when not matched",
];
const JOINS = ["join", "inner join", "left join", "right join", "full join", "left outer join", "right outer join", "full outer join", "cross join", "cross apply", "outer apply"];

export function tokenizeSql(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\s+/.exec(rest))) out.push({ type: "ws", text: m[0] });
    else if ((m = /^--[^\n]*/.exec(rest)) || (m = /^\/\*[\s\S]*?\*\//.exec(rest)) || (m = /^#[^\n]*/.exec(rest))) out.push({ type: "comment", text: m[0] });
    else if ((m = /^(N?'(?:[^']|'')*')/.exec(rest))) out.push({ type: "string", text: m[0] });
    else if ((m = /^("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\])/.exec(rest))) out.push({ type: "ident", text: m[0] });
    else if ((m = /^(0x[0-9a-f]+|\d+(\.\d+)?(e[+-]?\d+)?)/i.exec(rest))) out.push({ type: "number", text: m[0] });
    else if ((m = /^[@#$:]?[\p{L}_][\p{L}\p{N}_$]*/u.exec(rest))) out.push({ type: "word", text: m[0] });
    else if ((m = /^(<>|!=|<=|>=|::|\|\||[-+*/%=<>!~^&|])/.exec(rest))) out.push({ type: "op", text: m[0] });
    else out.push({ type: "punct", text: rest[0]! });
    i += out[out.length - 1]!.text.length;
  }
  return out;
}

export interface SqlFormatOptions {
  indent: string;
  uppercase: boolean;
}

export function formatSql(sql: string, o: SqlFormatOptions = { indent: "  ", uppercase: true }): string {
  const tokens = tokenizeSql(sql).filter((t) => t.type !== "ws");
  const lines: string[] = [];
  let cur = "";
  let depth = 0;
  const parenStack: { clause: boolean; depth: number }[] = [];
  let clauseIndent = 0;
  const newline = (extra = 0) => {
    if (cur.trim()) lines.push(cur.trimEnd());
    cur = o.indent.repeat(Math.max(0, depth + extra));
  };
  const word = (t: Token) => (t.type === "word" && KEYWORDS.has(t.text.toLowerCase()) ? (o.uppercase ? t.text.toUpperCase() : t.text.toLowerCase()) : t.text);
  const lower = (k: number, n: number) =>
    tokens
      .slice(k, k + n)
      .map((t) => t.text.toLowerCase())
      .join(" ");
  const space = () => {
    if (cur && !/[\s(.]$/.test(cur)) cur += " ";
  };

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    // mehrwortige Schlüsselwörter erkennen (längste zuerst)
    let matched: string | undefined;
    let isJoin = false;
    for (const n of [3, 2, 1]) {
      const phrase = lower(k, n);
      if (JOINS.includes(phrase)) {
        matched = phrase;
        isJoin = true;
        break;
      }
      if (CLAUSES.includes(phrase)) {
        matched = phrase;
        break;
      }
    }
    if (matched && t.type === "word") {
      const n = matched.split(" ").length;
      depth = clauseIndent;
      newline();
      cur += (o.uppercase ? matched.toUpperCase() : matched) + " ";
      if (!isJoin && ["select", "set", "values", "group by", "order by", "where", "having"].includes(matched)) {
        // Inhalt der Klausel eingerückt in die nächsten Zeilen
        depth = clauseIndent + 1;
        newline();
      }
      k += n - 1;
      continue;
    }
    if (t.type === "word" && /^(and|or)$/i.test(t.text) && depth > clauseIndent) {
      // BETWEEN … AND nicht umbrechen
      const prev = tokens.slice(Math.max(0, k - 4), k).some((x) => x.text.toLowerCase() === "between");
      if (!prev) {
        newline();
        cur += `${word(t)} `;
        continue;
      }
    }
    if (t.type === "word" && t.text.toLowerCase() === "on" && depth === clauseIndent) {
      depth = clauseIndent + 1;
      newline();
      cur += `${word(t)} `;
      continue;
    }
    if (t.text === "(") {
      // Unterabfrage?
      const sub = tokens[k + 1]?.text.toLowerCase() === "select" || tokens[k + 1]?.text.toLowerCase() === "with";
      const prev = tokens[k - 1];
      // Funktionsaufruf wie COUNT(*) ohne Leerzeichen, nach IN/VALUES/AS … mit
      const call = prev && (prev.type === "word" || prev.type === "ident") && !/^(in|values|exists|as|on|from|join|using|into|and|or|not|where|when|then|else|over|select|set|by|having|table|with|recursive|returning)$/i.test(prev.text);
      if (!call) space();
      cur += "(";
      parenStack.push({ clause: sub, depth: clauseIndent });
      if (sub) {
        clauseIndent = depth + 1;
        depth = clauseIndent;
      }
      continue;
    }
    if (t.text === ")") {
      const p = parenStack.pop();
      if (p?.clause) {
        clauseIndent = p.depth;
        depth = clauseIndent + 1;
        newline();
      }
      cur = cur.trimEnd() + ")";
      continue;
    }
    if (t.text === ",") {
      cur = cur.trimEnd() + ",";
      if (parenStack.length === 0 || parenStack[parenStack.length - 1]!.clause) newline();
      else cur += " ";
      continue;
    }
    if (t.text === ";") {
      cur = cur.trimEnd() + ";";
      depth = 0;
      clauseIndent = 0;
      newline();
      lines.push("");
      continue;
    }
    if (t.type === "comment") {
      if (t.text.startsWith("--") || t.text.startsWith("#")) {
        space();
        cur += t.text;
        newline();
      } else {
        space();
        cur += t.text;
      }
      continue;
    }
    if (t.text === ".") {
      cur = cur.trimEnd() + ".";
      continue;
    }
    space();
    cur += word(t);
  }
  newline();
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function minifySql(sql: string): string {
  return tokenizeSql(sql)
    .filter((t) => t.type !== "comment" || t.text.startsWith("/*!"))
    .map((t) => (t.type === "ws" ? " " : t.text))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),;])\s*/g, "$1")
    .replace(/,/g, ", ")
    .trim();
}
