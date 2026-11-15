/**
 * YAML lesen und schreiben (YAML 1.2, Core-Schema) – ohne Abhängigkeiten.
 * Unterstützt: Block-Mappings und -Listen, Flow-Collections, alle Scalar-Arten inkl. | und >,
 * Kommentare, mehrere Dokumente, Anker/Aliase, einfache Tags (!!str, !!int …).
 * Nicht unterstützt: komplexe Schlüssel (? ), Merge-Keys (<<) werden als normale Schlüssel gelesen.
 */

export class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Zeile ${line}: ${message}`);
    this.line = line;
  }
}

interface Line {
  indent: number;
  text: string;
  no: number;
}

type Value = unknown;

/** Kommentar am Zeilenende entfernen (nicht in Anführungszeichen) */
function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) {
        if (quote === "'" && s[i + 1] === "'") i++;
        else quote = null;
      }
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s:[{,\-?]/.test(s[i - 1]!)) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

export function resolveScalar(raw: string): Value {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?[0-9]+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16);
  if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(s)) return Number(s);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(s)) return NaN;
  return s;
}

function unescapeDouble(s: string, line: number): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e: string) => {
    switch (e[0]) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "0": return "\0";
      case "\\": return "\\";
      case '"': return '"';
      case "/": return "/";
      case " ": return " ";
      case "e": return "\x1b";
      case "x":
      case "u":
      case "U": return String.fromCodePoint(parseInt(e.slice(1), 16));
      default: throw new YamlError(`Unbekannte Escape-Folge \\${e}`, line);
    }
  });
}

/** liest einen Flow-Wert ([…], {…}, "…", '…' oder plain) aus `s` ab Position `pos` */
function parseFlow(s: string, line: number, anchors: Map<string, Value>): Value {
  let pos = 0;
  const ws = () => {
    while (pos < s.length && /\s/.test(s[pos]!)) pos++;
  };
  const value = (inFlow: boolean): Value => {
    ws();
    const c = s[pos];
    if (c === "[") {
      pos++;
      const arr: Value[] = [];
      ws();
      if (s[pos] === "]") return pos++, arr;
      for (;;) {
        arr.push(entryOrPair());
        ws();
        if (s[pos] === ",") {
          pos++;
          ws();
          if (s[pos] === "]") return pos++, arr;
          continue;
        }
        if (s[pos] === "]") return pos++, arr;
        throw new YamlError("In […] fehlt „,“ oder „]“", line);
      }
    }
    if (c === "{") {
      pos++;
      const obj: Record<string, Value> = {};
      ws();
      if (s[pos] === "}") return pos++, obj;
      for (;;) {
        const k = value(true);
        ws();
        let v: Value = null;
        if (s[pos] === ":") {
          pos++;
          v = value(true);
        }
        obj[String(k)] = v;
        ws();
        if (s[pos] === ",") {
          pos++;
          ws();
          if (s[pos] === "}") return pos++, obj;
          continue;
        }
        if (s[pos] === "}") return pos++, obj;
        throw new YamlError("In {…} fehlt „,“ oder „}“", line);
      }
    }
    if (c === '"') {
      const end = findQuoteEnd(s, pos, '"');
      if (end < 0) throw new YamlError("Anführungszeichen nicht geschlossen", line);
      const v = unescapeDouble(s.slice(pos + 1, end), line);
      pos = end + 1;
      return v;
    }
    if (c === "'") {
      const end = findQuoteEnd(s, pos, "'");
      if (end < 0) throw new YamlError("Anführungszeichen nicht geschlossen", line);
      const v = s.slice(pos + 1, end).replace(/''/g, "'");
      pos = end + 1;
      return v;
    }
    if (c === "*") {
      const m = /^\*([^\s,[\]{}]+)/.exec(s.slice(pos))!;
      pos += m[0].length;
      if (!anchors.has(m[1]!)) throw new YamlError(`Unbekannter Alias *${m[1]}`, line);
      return anchors.get(m[1]!);
    }
    // plain: bis , ] } oder „: “
    const start = pos;
    while (pos < s.length) {
      const ch = s[pos]!;
      if (inFlow && (ch === "," || ch === "]" || ch === "}")) break;
      if (ch === ":" && (pos + 1 >= s.length || /[\s,\]}]/.test(s[pos + 1]!)) && inFlow) break;
      pos++;
    }
    return resolveScalar(s.slice(start, pos));
  };
  const entryOrPair = (): Value => {
    const v = value(true);
    ws();
    if (s[pos] === ":") {
      pos++;
      return { [String(v)]: value(true) };
    }
    return v;
  };
  const result = value(false);
  ws();
  if (pos < s.length) throw new YamlError(`Unerwartetes „${s.slice(pos, pos + 10)}“`, line);
  return result;
}

function findQuoteEnd(s: string, start: number, q: string): number {
  for (let i = start + 1; i < s.length; i++) {
    if (q === '"' && s[i] === "\\") i++;
    else if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") i++;
      else return i;
    }
  }
  return -1;
}

const flowBalanced = (s: string) => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth <= 0 && !quote;
};

/** findet „key: “ außerhalb von Anführungszeichen; liefert Index des Doppelpunkts */
function mappingColon(text: string): number {
  if (/^[[{]/.test(text)) return -1;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && i === 0) quote = c;
    else if (c === ":" && (i + 1 === text.length || text[i + 1] === " " || text[i + 1] === "\t")) return i;
  }
  return -1;
}

export function parseYaml(input: string): { value: Value; documents: number } {
  const docs: Line[][] = [[]];
  input
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      if (/^---(\s|$)/.test(raw)) {
        if (docs[docs.length - 1]!.length) docs.push([]);
        const rest = raw.slice(3).trim();
        if (rest && !rest.startsWith("#")) docs[docs.length - 1]!.push({ indent: 0, text: rest, no: i + 1 });
        return;
      }
      if (/^\.\.\.(\s|$)/.test(raw)) return;
      if (/^%/.test(raw)) return; // Direktiven
      if (/^\t/.test(raw) && raw.trim()) throw new YamlError("Tabulatoren sind zur Einrückung nicht erlaubt", i + 1);
      docs[docs.length - 1]!.push({ indent: raw.length - raw.trimStart().length, text: raw.trimStart(), no: i + 1 });
    });
  const values = docs.filter((d) => d.some((l) => stripComment(l.text) !== "")).map((d) => new Parser(d).parseDocument());
  if (values.length === 0) return { value: null, documents: 0 };
  return { value: values.length === 1 ? values[0] : values, documents: values.length };
}

class Parser {
  private i = 0;
  private anchors = new Map<string, Value>();
  private lines: Line[];
  constructor(lines: Line[]) {
    this.lines = lines;
  }

  private skipEmpty() {
    while (this.i < this.lines.length && stripComment(this.lines[this.i]!.text) === "") this.i++;
  }

  parseDocument(): Value {
    this.skipEmpty();
    const v = this.parseNode(-1);
    this.skipEmpty();
    if (this.i < this.lines.length) throw new YamlError("Unerwarteter Inhalt (Einrückung?)", this.lines[this.i]!.no);
    return v;
  }

  /** liest einen Knoten, dessen Zeilen weiter eingerückt sind als parentIndent */
  private parseNode(parentIndent: number): Value {
    this.skipEmpty();
    const line = this.lines[this.i];
    if (!line || line.indent <= parentIndent) return null;
    const text = stripComment(line.text);
    if (text === "-" || text.startsWith("- ")) return this.parseSeq(line.indent);
    if (mappingColon(text) > 0 || /^\? /.test(text)) return this.parseMap(line.indent);
    return this.parseInlineValue(text, line.indent, parentIndent);
  }

  private parseSeq(indent: number): Value[] {
    const arr: Value[] = [];
    for (;;) {
      this.skipEmpty();
      const line = this.lines[this.i];
      if (!line || line.indent < indent) break;
      const text = stripComment(line.text);
      if (line.indent > indent) throw new YamlError("Falsche Einrückung in der Liste", line.no);
      if (!(text === "-" || text.startsWith("- "))) break;
      const rest = text.slice(1).trimStart();
      if (!rest) {
        this.i++;
        arr.push(this.parseNode(indent));
        continue;
      }
      // Inhalt nach „- “ als eigene, weiter eingerückte Zeile behandeln
      const col = indent + (text.length - rest.length);
      this.lines[this.i] = { indent: col, text: rest, no: line.no };
      arr.push(this.parseNode(indent));
    }
    return arr;
  }

  private parseMap(indent: number): Record<string, Value> {
    const obj: Record<string, Value> = {};
    for (;;) {
      this.skipEmpty();
      const line = this.lines[this.i];
      if (!line || line.indent < indent) break;
      if (line.indent > indent) throw new YamlError("Falsche Einrückung", line.no);
      const text = stripComment(line.text);
      const colon = mappingColon(text);
      if (colon <= 0) {
        if (text === "-" || text.startsWith("- ")) throw new YamlError("Liste und Schlüssel auf derselben Ebene gemischt", line.no);
        throw new YamlError(`„${text}“ ist kein Schlüssel: Wert`, line.no);
      }
      let keyRaw = text.slice(0, colon).trim();
      let key: string;
      if (keyRaw.startsWith('"')) key = unescapeDouble(keyRaw.slice(1, -1), line.no);
      else if (keyRaw.startsWith("'")) key = keyRaw.slice(1, -1).replace(/''/g, "'");
      else {
        keyRaw = keyRaw.replace(/^!!\w+\s+/, "");
        key = keyRaw;
      }
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw new YamlError(`Schlüssel „${key}“ doppelt`, line.no);
      const rest = text.slice(colon + 1).trim();
      if (!rest) {
        this.i++;
        // Liste darf auf gleicher Einrückung wie der Schlüssel stehen
        this.skipEmpty();
        const next = this.lines[this.i];
        const nt = next ? stripComment(next.text) : "";
        if (next && next.indent === indent && (nt === "-" || nt.startsWith("- "))) obj[key] = this.parseSeq(indent);
        else obj[key] = this.parseNode(indent);
      } else {
        obj[key] = this.parseInlineValue(rest, indent, indent);
      }
    }
    return obj;
  }

  /** Wert, der in derselben Zeile beginnt (nach „key:“ oder „- “); kann über Folgezeilen gehen */
  private parseInlineValue(textIn: string, ownIndent: number, parentIndent: number): Value {
    const line = this.lines[this.i]!;
    let text = textIn;
    let anchor: string | undefined;
    let tag: string | undefined;
    for (;;) {
      const am = /^&([^\s,[\]{}]+)\s*/.exec(text);
      if (am) {
        anchor = am[1];
        text = text.slice(am[0].length);
        continue;
      }
      const tm = /^!(!?[\w:/.-]*)\s*/.exec(text);
      if (tm) {
        tag = tm[1];
        text = text.slice(tm[0].length);
        continue;
      }
      break;
    }
    const store = (v: Value) => {
      if (anchor) this.anchors.set(anchor, v);
      return v;
    };
    if (!text) {
      this.i++;
      return store(this.parseNode(parentIndent));
    }
    // Block-Scalar
    const block = /^([|>])([+-]?)(\d?)([+-]?)$/.exec(text);
    if (block) {
      this.i++;
      return store(this.blockScalar(block[1] as "|" | ">", (block[2] || block[4]) as "" | "+" | "-", block[3] ? parentIndent + Number(block[3]) : undefined, parentIndent));
    }
    if (text.startsWith("*")) {
      this.i++;
      const name = text.slice(1).trim();
      if (!this.anchors.has(name)) throw new YamlError(`Unbekannter Alias *${name}`, line.no);
      return this.anchors.get(name);
    }
    // Flow-Collection über mehrere Zeilen
    if (text.startsWith("[") || text.startsWith("{")) {
      let joined = text;
      this.i++;
      while (!flowBalanced(joined) && this.i < this.lines.length) joined += ` ${stripComment(this.lines[this.i++]!.text)}`;
      return store(parseFlow(joined, line.no, this.anchors));
    }
    // Strings in Anführungszeichen, ggf. über mehrere Zeilen
    if (text.startsWith('"') || text.startsWith("'")) {
      const q = text[0]!;
      let joined = text;
      this.i++;
      while (findQuoteEnd(joined, 0, q) < 0 && this.i < this.lines.length) {
        const nxt = this.lines[this.i++]!.text.trim();
        joined += nxt === "" ? "\n" : joined.endsWith("\n") ? nxt : ` ${nxt}`;
      }
      const end = findQuoteEnd(joined, 0, q);
      if (end < 0) throw new YamlError("Anführungszeichen nicht geschlossen", line.no);
      if (joined.slice(end + 1).trim()) throw new YamlError(`Unerwartetes „${joined.slice(end + 1).trim()}“ nach dem String`, line.no);
      const inner = joined.slice(1, end);
      return store(q === '"' ? unescapeDouble(inner.replace(/\\\n/g, ""), line.no) : inner.replace(/''/g, "'"));
    }
    // Plain-Scalar, Folgezeilen mit größerer Einrückung gehören dazu
    let value = text;
    this.i++;
    while (this.i < this.lines.length) {
      const nxt = this.lines[this.i]!;
      const t = stripComment(nxt.text);
      if (t === "") {
        // Leerzeile innerhalb eines mehrzeiligen Plain-Scalars = Zeilenumbruch
        const after = this.lines.slice(this.i + 1).find((l) => stripComment(l.text) !== "");
        if (after && after.indent > ownIndent && mappingColon(stripComment(after.text)) < 0) {
          value += "\n";
          this.i++;
          continue;
        }
        break;
      }
      if (nxt.indent <= ownIndent || mappingColon(t) > 0 || t.startsWith("- ")) break;
      value += value.endsWith("\n") ? t : ` ${t}`;
      this.i++;
    }
    if (tag === "!str" || tag === "str") return store(value);
    const resolved = resolveScalar(value);
    if (tag === "!int" || tag === "int") return store(parseInt(value, 10));
    if (tag === "!float" || tag === "float") return store(Number(value));
    return store(resolved);
  }

  private blockScalar(style: "|" | ">", chomp: "" | "+" | "-", fixedIndent: number | undefined, parentIndent: number): string {
    const lines: string[] = [];
    let indent = fixedIndent;
    while (this.i < this.lines.length) {
      const l = this.lines[this.i]!;
      if (l.text === "") {
        lines.push("");
        this.i++;
        continue;
      }
      if (indent === undefined) indent = l.indent;
      if (l.indent < indent || l.indent <= parentIndent) break;
      lines.push(" ".repeat(l.indent - indent) + l.text);
      this.i++;
    }
    // nachfolgende Leerzeilen
    let trailing = 0;
    while (lines.length && lines[lines.length - 1] === "") {
      lines.pop();
      trailing++;
    }
    let body: string;
    if (style === "|") body = lines.join("\n");
    else {
      body = "";
      lines.forEach((l, idx) => {
        if (idx === 0) body = l;
        else if (l === "" || l.startsWith(" ") || lines[idx - 1] === "" || lines[idx - 1]!.startsWith(" ")) body += `\n${l}`;
        else body += ` ${l}`;
      });
    }
    if (!lines.length) return chomp === "+" ? "\n".repeat(trailing) : "";
    if (chomp === "-") return body;
    if (chomp === "+") return `${body}\n${"\n".repeat(trailing)}`;
    return `${body}\n`;
  }
}

// ---------- Schreiben ----------

const needsQuote = (s: string) =>
  s === "" ||
  s !== s.trim() ||
  /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
  /: |\s#|:$/.test(s) ||
  typeof resolveScalar(s) !== "string" ||
  /^(yes|no|on|off|y|n)$/i.test(s) ||
  /[\x00-\x08\x0b-\x1f\x7f]/.test(s);

function scalar(v: Value): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return Number.isNaN(v) ? ".nan" : v === Infinity ? ".inf" : v === -Infinity ? "-.inf" : String(v);
  const s = String(v);
  if (!needsQuote(s) && !s.includes("\n")) return s;
  return JSON.stringify(s);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

export function toYaml(value: Value, indent = 2): string {
  const pad = (n: number) => " ".repeat(n);
  const key = (k: string) => (needsQuote(k) || k.includes("\n") ? JSON.stringify(k) : k);
  const multiline = (s: string, depth: number) => {
    const body = s.replace(/\n$/, "");
    const chomp = s.endsWith("\n") ? (s.endsWith("\n\n") ? "+" : "") : "-";
    const indicator = /^\s/.test(s) ? String(indent) : "";
    return `|${indicator}${chomp}\n${body.split("\n").map((l) => (l ? pad(depth) + l : "")).join("\n")}`;
  };
  const emit = (v: Value, depth: number): string => {
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return v
        .map((item) => {
          if (isPlainObject(item) && Object.keys(item).length) {
            const inner = emit(item, depth + indent);
            return `${pad(depth)}- ${inner.slice(depth + indent)}`;
          }
          if (Array.isArray(item) && item.length) return `${pad(depth)}-\n${emit(item, depth + indent)}`;
          return `${pad(depth)}- ${typeof item === "string" && item.includes("\n") ? multiline(item, depth + indent) : emit(item, depth + indent)}`;
        })
        .join("\n");
    }
    if (isPlainObject(v)) {
      const entries = Object.entries(v);
      if (entries.length === 0) return "{}";
      return entries
        .map(([k, val]) => {
          if ((Array.isArray(val) && val.length) || (isPlainObject(val) && Object.keys(val).length)) return `${pad(depth)}${key(k)}:\n${emit(val, Array.isArray(val) ? depth : depth + indent)}`;
          if (typeof val === "string" && val.includes("\n")) return `${pad(depth)}${key(k)}: ${multiline(val, depth + indent)}`;
          return `${pad(depth)}${key(k)}: ${emit(val, depth + indent)}`;
        })
        .join("\n");
    }
    if (v instanceof Date) return v.toISOString();
    return scalar(v);
  };
  const out = emit(value, 0);
  return out.endsWith("\n") ? out : `${out}\n`;
}
