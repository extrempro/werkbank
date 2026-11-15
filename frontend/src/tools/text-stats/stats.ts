/** Zeichen zählen und unsichtbare/auffällige Zeichen finden */

export interface TextStats {
  chars: number;
  charsNoSpaces: number;
  words: number;
  lines: number;
  paragraphs: number;
  bytesUtf8: number;
  utf16Units: number;
  sentences: number;
  readingMinutes: number;
}

export function textStats(text: string): TextStats {
  const graphemes =
    typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter("de", { granularity: "grapheme" }).segment(text)].length
      : [...text].length;
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)?.length ?? 0;
  return {
    chars: graphemes,
    charsNoSpaces: [...text.replace(/\s/g, "")].length,
    words,
    lines: text === "" ? 0 : text.split(/\r\n|\r|\n/).length,
    paragraphs: text.trim() === "" ? 0 : text.trim().split(/\n\s*\n/).length,
    bytesUtf8: new TextEncoder().encode(text).length,
    utf16Units: text.length,
    sentences: text.match(/[^.!?]+[.!?]+/g)?.length ?? (text.trim() ? 1 : 0),
    readingMinutes: Math.max(words ? 1 : 0, Math.round(words / 200)),
  };
}

const special: Record<number, string> = {
  0x00a0: "geschütztes Leerzeichen (NBSP)",
  0x00ad: "weiches Trennzeichen",
  0x200b: "Leerzeichen ohne Breite (ZWSP)",
  0x200c: "Nicht-Verbinder (ZWNJ)",
  0x200d: "Verbinder (ZWJ)",
  0x200e: "Links-nach-rechts-Marke",
  0x200f: "Rechts-nach-links-Marke",
  0x202a: "Richtungssteuerung",
  0x202b: "Richtungssteuerung",
  0x202c: "Richtungssteuerung",
  0x202d: "Richtungssteuerung",
  0x202e: "Richtungsumkehr (RLO)",
  0x2060: "Wortverbinder",
  0xfeff: "Byte Order Mark (BOM)",
  0x2028: "Zeilentrenner",
  0x2029: "Absatztrenner",
  0x0009: "Tabulator",
  0x000d: "Wagenrücklauf (CR)",
  0x2002: "Halbgeviert-Leerzeichen",
  0x2003: "Geviert-Leerzeichen",
  0x2009: "schmales Leerzeichen",
  0x202f: "schmales geschütztes Leerzeichen",
  0x2018: "typografisches Anführungszeichen ‘",
  0x2019: "typografisches Apostroph ’",
  0x201c: "typografisches Anführungszeichen “",
  0x201d: "typografisches Anführungszeichen ”",
  0x201e: "typografisches Anführungszeichen „",
  0x2013: "Halbgeviertstrich –",
  0x2014: "Geviertstrich —",
  0x2212: "Minuszeichen −",
};

export interface SpecialChar {
  char: string;
  code: string;
  name: string;
  count: number;
  /** stört typischerweise in Befehlen, Kennwörtern, Konfigurationsdateien */
  risky: boolean;
}

export function findSpecialChars(text: string): SpecialChar[] {
  const map = new Map<number, number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      special[cp] ||
      (cp < 0x20 && cp !== 0x0a) ||
      (cp >= 0x7f && cp < 0xa0) ||
      (cp >= 0xe000 && cp <= 0xf8ff)
    )
      map.set(cp, (map.get(cp) ?? 0) + 1);
  }
  return [...map].map(([cp, count]) => ({
    char: String.fromCodePoint(cp),
    code: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
    name: special[cp] ?? (cp >= 0xe000 && cp <= 0xf8ff ? "privates Zeichen" : "Steuerzeichen"),
    count,
    risky: cp !== 0x09 && !(cp >= 0x2018 && cp <= 0x201e) && cp !== 0x2013 && cp !== 0x2014,
  }));
}

/** Ersetzt unsichtbare und typografische Zeichen durch einfache Entsprechungen */
export function cleanSpecialChars(text: string): string {
  return text
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00ad]/g, "")
    .replace(/[\u00a0\u2002\u2003\u2009\u202f]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n");
}
