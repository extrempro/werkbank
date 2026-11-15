/**
 * Kleiner XML-Parser und -Formatierer ohne DOM (funktioniert auch in Tests und Workern).
 * Unterstützt Elemente, Attribute, Text, CDATA, Kommentare, Verarbeitungsanweisungen und DOCTYPE.
 * Keine Entity-Definitionen aus DTDs (sicher gegen „Billion Laughs“).
 */

export type XmlNode = XmlElement | XmlText | XmlOther;

export interface XmlElement {
  kind: "element";
  name: string;
  attrs: { name: string; value: string }[];
  children: XmlNode[];
}
export interface XmlText {
  kind: "text" | "cdata";
  value: string;
}
export interface XmlOther {
  kind: "comment" | "pi" | "doctype";
  value: string;
}

const entities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return entities[e] ?? m;
  });
}

export const escapeXmlText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escapeXmlAttr = (t: string) => escapeXmlText(t).replace(/"/g, "&quot;");

export class XmlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Zeile ${line}: ${message}`);
    this.line = line;
  }
}

export function parseXml(input: string): XmlNode[] {
  const src = input.replace(/^﻿/, "");
  let pos = 0;
  const lineAt = (p: number) => src.slice(0, p).split("\n").length;
  const fail = (msg: string, p = pos): never => {
    throw new XmlError(msg, lineAt(p));
  };
  const root: XmlNode[] = [];
  const stack: XmlElement[] = [];
  const add = (n: XmlNode) => (stack.length ? stack[stack.length - 1]!.children : root).push(n);

  while (pos < src.length) {
    const lt = src.indexOf("<", pos);
    if (lt !== pos) {
      const end = lt < 0 ? src.length : lt;
      const text = src.slice(pos, end);
      if (stack.length) add({ kind: "text", value: decodeXmlEntities(text) });
      else if (text.trim()) fail("Text außerhalb des Wurzelelements");
      pos = end;
      continue;
    }
    if (src.startsWith("<!--", pos)) {
      const end = src.indexOf("-->", pos + 4);
      if (end < 0) fail("Kommentar nicht geschlossen");
      add({ kind: "comment", value: src.slice(pos + 4, end) });
      pos = end + 3;
    } else if (src.startsWith("<![CDATA[", pos)) {
      const end = src.indexOf("]]>", pos);
      if (end < 0) fail("CDATA nicht geschlossen");
      add({ kind: "cdata", value: src.slice(pos + 9, end) });
      pos = end + 3;
    } else if (src.startsWith("<?", pos)) {
      const end = src.indexOf("?>", pos);
      if (end < 0) fail("Verarbeitungsanweisung nicht geschlossen");
      add({ kind: "pi", value: src.slice(pos + 2, end) });
      pos = end + 2;
    } else if (src.startsWith("<!DOCTYPE", pos) || src.startsWith("<!doctype", pos)) {
      let depth = 0;
      let i = pos;
      for (; i < src.length; i++) {
        if (src[i] === "[") depth++;
        else if (src[i] === "]") depth--;
        else if (src[i] === ">" && depth === 0) break;
      }
      add({ kind: "doctype", value: src.slice(pos + 9, i).trim() });
      pos = i + 1;
    } else if (src.startsWith("</", pos)) {
      const end = src.indexOf(">", pos);
      if (end < 0) fail("Endtag nicht geschlossen");
      const name = src.slice(pos + 2, end).trim();
      const open = stack.pop();
      if (!open) fail(`Endtag </${name}> ohne Starttag`);
      if (open!.name !== name) fail(`</${name}> passt nicht zu <${open!.name}>`);
      pos = end + 1;
    } else {
      const m = /^<([A-Za-z_][\w.:-]*)/.exec(src.slice(pos, pos + 256));
      if (!m) fail("Ungültiges Zeichen nach „<“");
      const el: XmlElement = { kind: "element", name: m![1]!, attrs: [], children: [] };
      pos += m![0].length;
      for (;;) {
        while (/\s/.test(src[pos] ?? "")) pos++;
        if (src.startsWith("/>", pos)) {
          add(el);
          pos += 2;
          break;
        }
        if (src[pos] === ">") {
          add(el);
          stack.push(el);
          pos++;
          break;
        }
        const am = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(pos));
        if (!am) fail(pos >= src.length ? `<${el.name}> nicht geschlossen` : `Ungültiges Attribut in <${el.name}>`);
        if (el.attrs.some((a) => a.name === am![1])) fail(`Attribut „${am![1]}“ doppelt`);
        el.attrs.push({ name: am![1]!, value: decodeXmlEntities(am![3] ?? am![4] ?? "") });
        pos += am![0].length;
      }
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1]!.name}> wird nicht geschlossen`, src.length);
  if (!root.some((n) => n.kind === "element")) fail("Kein Wurzelelement gefunden");
  return root;
}

export interface FormatOptions {
  indent: string;
  /** Text nur aus Leerraum entfernen */
  stripWhitespace: boolean;
}

export function formatXml(nodes: XmlNode[], opts: FormatOptions = { indent: "  ", stripWhitespace: true }): string {
  const out: string[] = [];
  const attrs = (el: XmlElement) => el.attrs.map((a) => ` ${a.name}="${escapeXmlAttr(a.value)}"`).join("");
  const write = (n: XmlNode, depth: number) => {
    const pad = opts.indent.repeat(depth);
    switch (n.kind) {
      case "element": {
        const kids = opts.stripWhitespace ? n.children.filter((c) => !(c.kind === "text" && !c.value.trim())) : n.children;
        if (kids.length === 0) out.push(`${pad}<${n.name}${attrs(n)}/>`);
        else if (kids.length === 1 && (kids[0]!.kind === "text" || kids[0]!.kind === "cdata")) {
          const k = kids[0]!;
          const inner = k.kind === "cdata" ? `<![CDATA[${k.value}]]>` : escapeXmlText(opts.stripWhitespace ? k.value.trim() : k.value);
          out.push(`${pad}<${n.name}${attrs(n)}>${inner}</${n.name}>`);
        } else {
          out.push(`${pad}<${n.name}${attrs(n)}>`);
          for (const c of kids) write(c, depth + 1);
          out.push(`${pad}</${n.name}>`);
        }
        break;
      }
      case "text":
        if (n.value.trim()) out.push(pad + escapeXmlText(n.value.trim()));
        break;
      case "cdata":
        out.push(`${pad}<![CDATA[${n.value}]]>`);
        break;
      case "comment":
        out.push(`${pad}<!--${n.value}-->`);
        break;
      case "pi":
        out.push(`${pad}<?${n.value}?>`);
        break;
      case "doctype":
        out.push(`${pad}<!DOCTYPE ${n.value}>`);
        break;
    }
  };
  for (const n of nodes) write(n, 0);
  return out.join("\n");
}

export function minifyXml(nodes: XmlNode[]): string {
  return formatXml(nodes, { indent: "", stripWhitespace: true }).replace(/\n/g, "");
}

// ---------- Hilfen zum Auslesen ----------

export const localName = (name: string) => name.slice(name.indexOf(":") + 1);

export function* walk(nodes: XmlNode[]): Generator<XmlElement> {
  for (const n of nodes) {
    if (n.kind === "element") {
      yield n;
      yield* walk(n.children);
    }
  }
}

export const findAll = (nodes: XmlNode[], local: string) => [...walk(nodes)].filter((e) => localName(e.name) === local);
export const find = (nodes: XmlNode[], local: string) => findAll(nodes, local)[0];
export const textOf = (el: XmlElement | undefined): string =>
  el ? el.children.map((c) => (c.kind === "text" || c.kind === "cdata" ? c.value : c.kind === "element" ? textOf(c) : "")).join("") : "";
export const attr = (el: XmlElement | undefined, name: string) => el?.attrs.find((a) => a.name === name || localName(a.name) === name)?.value;
