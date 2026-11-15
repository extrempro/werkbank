/** TOML 1.0 lesen und schreiben (ohne Abhängigkeiten). Datums-/Zeitwerte werden als Strings gelesen. */

export class TomlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Zeile ${line}: ${message}`);
    this.line = line;
  }
}

type Table = Record<string, unknown>;
const isTable = (v: unknown): v is Table =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseToml(input: string): Table {
  const src = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  let pos = 0;
  let line = 1;
  const root: Table = {};
  let current = root;
  const defined = new Set<Table>();
  const inlineTables = new Set<Table>();
  const fail = (m: string): never => {
    throw new TomlError(m, line);
  };
  const peek = (n = 0) => src[pos + n];
  const skipWs = () => {
    while (pos < src.length && (src[pos] === " " || src[pos] === "\t")) pos++;
  };
  const skipComment = () => {
    if (src[pos] === "#") while (pos < src.length && src[pos] !== "\n") pos++;
  };
  const skipWsNl = () => {
    for (;;) {
      skipWs();
      skipComment();
      if (src[pos] === "\n") {
        pos++;
        line++;
      } else break;
    }
  };
  const expectEol = () => {
    skipWs();
    skipComment();
    if (pos < src.length && src[pos] !== "\n") fail(`Unerwartetes „${src.slice(pos, pos + 10)}“`);
  };

  const basicString = (multi: boolean): string => {
    let out = "";
    for (;;) {
      if (pos >= src.length) fail("String nicht geschlossen");
      const c = src[pos]!;
      if (multi ? src.startsWith('"""', pos) && src[pos + 3] !== '"' : c === '"') {
        pos += multi ? 3 : 1;
        return out;
      }
      if (c === "\n") {
        if (!multi) fail("Zeilenumbruch im String");
        line++;
      }
      if (c === "\\") {
        const e = src[pos + 1]!;
        if (multi && /[ \t\n]/.test(e)) {
          // Zeilenende-Backslash: Leerraum überspringen
          pos++;
          while (/[ \t\n]/.test(src[pos] ?? "")) {
            if (src[pos] === "\n") line++;
            pos++;
          }
          continue;
        }
        const map: Record<string, string> = {
          b: "\b",
          t: "\t",
          n: "\n",
          f: "\f",
          r: "\r",
          '"': '"',
          "\\": "\\",
          e: "\x1b",
        };
        if (map[e] !== undefined) {
          out += map[e];
          pos += 2;
        } else if (e === "u" || e === "U") {
          const len = e === "u" ? 4 : 8;
          const hex = src.slice(pos + 2, pos + 2 + len);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len)
            fail("Ungültige Unicode-Escape-Folge");
          out += String.fromCodePoint(parseInt(hex, 16));
          pos += 2 + len;
        } else fail(`Unbekannte Escape-Folge \\${e}`);
        continue;
      }
      out += c;
      pos++;
    }
  };
  const literalString = (multi: boolean): string => {
    const end = multi ? "'''" : "'";
    const idx = src.indexOf(end, pos);
    if (idx < 0) fail("String nicht geschlossen");
    let s = src.slice(pos, idx);
    if (!multi && s.includes("\n")) fail("Zeilenumbruch im String");
    line += (s.match(/\n/g) ?? []).length;
    pos = idx + end.length;
    while (multi && src[pos] === "'") {
      s += "'";
      pos++;
    }
    return s;
  };
  const key = (): string => {
    skipWs();
    const c = peek();
    if (c === '"') {
      pos++;
      return basicString(false);
    }
    if (c === "'") {
      pos++;
      return literalString(false);
    }
    const m = /^[A-Za-z0-9_-]+/.exec(src.slice(pos));
    if (!m) fail("Schlüssel erwartet");
    pos += m![0].length;
    return m![0];
  };
  const dottedKey = (): string[] => {
    const parts = [key()];
    for (;;) {
      skipWs();
      if (peek() !== ".") return parts;
      pos++;
      parts.push(key());
    }
  };
  const value = (): unknown => {
    skipWs();
    const c = peek();
    if (src.startsWith('"""', pos)) {
      pos += 3;
      if (src[pos] === "\n") (pos++, line++);
      return basicString(true);
    }
    if (src.startsWith("'''", pos)) {
      pos += 3;
      if (src[pos] === "\n") (pos++, line++);
      return literalString(true);
    }
    if (c === '"') {
      pos++;
      return basicString(false);
    }
    if (c === "'") {
      pos++;
      return literalString(false);
    }
    if (c === "[") {
      pos++;
      const arr: unknown[] = [];
      for (;;) {
        skipWsNl();
        if (peek() === "]") {
          pos++;
          return arr;
        }
        arr.push(value());
        skipWsNl();
        if (peek() === ",") pos++;
        else if (peek() === "]") {
          pos++;
          return arr;
        } else fail("In […] fehlt „,“ oder „]“");
      }
    }
    if (c === "{") {
      pos++;
      const t: Table = {};
      skipWs();
      if (peek() === "}") {
        pos++;
        inlineTables.add(t);
        return t;
      }
      for (;;) {
        const k = dottedKey();
        skipWs();
        if (peek() !== "=") fail("„=“ erwartet");
        pos++;
        assign(t, k, value());
        skipWs();
        if (peek() === ",") pos++;
        else if (peek() === "}") {
          pos++;
          inlineTables.add(t);
          return t;
        } else fail("In {…} fehlt „,“ oder „}“");
      }
    }
    const m = /^[^\s,\]}#]+(?: \d{2}:\d{2}[^\s,\]}#]*)?/.exec(src.slice(pos));
    if (!m) fail("Wert erwartet");
    const raw = m![0];
    pos += raw.length;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^[+-]?(inf|nan)$/.test(raw))
      return raw.includes("nan") ? NaN : raw.startsWith("-") ? -Infinity : Infinity;
    if (
      /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$|^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/i.test(
        raw,
      )
    )
      return raw;
    const clean = raw.replace(/_/g, "");
    if (/^[+-]?(0|[1-9]\d*)$/.test(clean) && !/__|^_|_$/.test(raw)) {
      const n = Number(clean);
      return Number.isSafeInteger(n) ? n : clean;
    }
    if (/^0x[0-9a-fA-F]+$/.test(clean)) return parseInt(clean.slice(2), 16);
    if (/^0o[0-7]+$/.test(clean)) return parseInt(clean.slice(2), 8);
    if (/^0b[01]+$/.test(clean)) return parseInt(clean.slice(2), 2);
    if (/^[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(clean) && /[.eE]/.test(clean))
      return Number(clean);
    return fail(`Ungültiger Wert „${raw}“`);
  };
  const assign = (table: Table, keys: string[], v: unknown) => {
    let t = table;
    for (const k of keys.slice(0, -1)) {
      if (t[k] === undefined) t[k] = {};
      else if (!isTable(t[k]) || inlineTables.has(t[k] as Table)) fail(`„${k}“ ist schon ein Wert`);
      t = t[k] as Table;
    }
    const last = keys[keys.length - 1]!;
    if (Object.prototype.hasOwnProperty.call(t, last))
      fail(`Schlüssel „${keys.join(".")}“ doppelt`);
    t[last] = v;
  };

  for (;;) {
    skipWsNl();
    if (pos >= src.length) break;
    if (peek() === "[") {
      const isArray = peek(1) === "[";
      pos += isArray ? 2 : 1;
      const keys = dottedKey();
      skipWs();
      if (!src.startsWith(isArray ? "]]" : "]", pos))
        fail(isArray ? "„]]“ erwartet" : "„]“ erwartet");
      pos += isArray ? 2 : 1;
      let t = root;
      keys.forEach((k, idx) => {
        const lastKey = idx === keys.length - 1;
        if (lastKey && isArray) {
          if (t[k] === undefined) t[k] = [];
          if (!Array.isArray(t[k])) fail(`„${k}“ ist keine Tabellen-Liste`);
          const nt: Table = {};
          (t[k] as Table[]).push(nt);
          t = nt;
          return;
        }
        if (t[k] === undefined) t[k] = {};
        const next = t[k];
        if (Array.isArray(next)) t = next[next.length - 1] as Table;
        else if (isTable(next) && !inlineTables.has(next)) t = next;
        else fail(`„${k}“ ist schon ein Wert`);
      });
      if (!isArray) {
        if (defined.has(t)) fail(`Tabelle [${keys.join(".")}] doppelt`);
        defined.add(t);
      }
      current = t;
      expectEol();
      continue;
    }
    const keys = dottedKey();
    skipWs();
    if (peek() !== "=") fail("„=“ erwartet");
    pos++;
    assign(current, keys, value());
    expectEol();
  }
  return root;
}

// ---------- Schreiben ----------

const bareKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));

function tomlValue(v: unknown, path: string): string {
  if (v === null || v === undefined) throw new Error(`TOML kennt kein null (bei „${path}“)`);
  if (typeof v === "string")
    return v.includes("\n")
      ? `"""\n${v.replace(/\\/g, "\\\\").replace(/"""/g, '""\\"')}"""`
      : JSON.stringify(v);
  if (typeof v === "number")
    return Number.isNaN(v)
      ? "nan"
      : v === Infinity
        ? "inf"
        : v === -Infinity
          ? "-inf"
          : Number.isInteger(v)
            ? String(v)
            : String(v).includes(".") || String(v).includes("e")
              ? String(v)
              : `${v}.0`;
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map((x, i) => tomlValue(x, `${path}[${i}]`)).join(", ")}]`;
  if (isTable(v))
    return `{ ${Object.entries(v)
      .map(([k, x]) => `${bareKey(k)} = ${tomlValue(x, `${path}.${k}`)}`)
      .join(", ")} }`;
  return JSON.stringify(String(v));
}

export function toToml(obj: unknown): string {
  if (!isTable(obj)) throw new Error("TOML braucht als oberste Ebene ein Objekt");
  const out: string[] = [];
  const isTableArray = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(isTable);
  const write = (t: Table, path: string[]) => {
    const simple = Object.entries(t).filter(([, v]) => !isTable(v) && !isTableArray(v));
    const tables = Object.entries(t).filter(([, v]) => isTable(v));
    const arrays = Object.entries(t).filter(([, v]) => isTableArray(v));
    for (const [k, v] of simple) {
      if (v === null || v === undefined) continue;
      out.push(`${bareKey(k)} = ${tomlValue(v, [...path, k].join("."))}`);
    }
    for (const [k, v] of tables) {
      const p = [...path, k];
      out.push("", `[${p.map(bareKey).join(".")}]`);
      write(v as Table, p);
    }
    for (const [k, v] of arrays) {
      const p = [...path, k];
      for (const item of v as Table[]) {
        out.push("", `[[${p.map(bareKey).join(".")}]]`);
        write(item, p);
      }
    }
  };
  write(obj, []);
  return `${out.join("\n").replace(/^\n+/, "")}\n`;
}
