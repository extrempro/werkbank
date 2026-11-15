/** HTML-Entities kodieren und dekodieren (ohne DOM) */

const named: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  micro: "µ",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  shy: "\u00ad",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  agrave: "à",
  aacute: "á",
  ccedil: "ç",
  ntilde: "ñ",
  oslash: "ø",
  aring: "å",
  aelig: "æ",
  iexcl: "¡",
  iquest: "¿",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup2: "²",
  sup3: "³",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  rArr: "⇒",
  hArr: "⇔",
  check: "✓",
  infin: "∞",
  ne: "≠",
  le: "≤",
  ge: "≥",
  asymp: "≈",
  zwj: "\u200d",
  zwnj: "\u200c",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
};
const reverse = new Map(
  Object.entries(named)
    .filter(([k]) => !["apos"].includes(k))
    .map(([k, v]) => [v, k]),
);

export type EncodeMode = "minimal" | "named" | "numeric";

/** minimal: nur & < > " '; named: zusätzlich bekannte Namen (z. B. &auml;); numeric: alles außerhalb ASCII als &#…; */
export function htmlEncode(text: string, mode: EncodeMode): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else if (cp > 0x7e && mode !== "minimal") {
      const name = mode === "named" ? reverse.get(ch) : undefined;
      out += name ? `&${name};` : `&#${cp};`;
    } else out += ch;
  }
  return out;
}

export function htmlDecode(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return named[e] ?? m;
  });
}
