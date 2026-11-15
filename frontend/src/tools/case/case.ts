/** Schreibweisen umwandeln */

export function words(text: string): string[] {
  return text
    .replace(/([a-zäöü0-9])([A-ZÄÖÜ])/g, "$1 $2")
    .replace(/([A-ZÄÖÜ]+)([A-ZÄÖÜ][a-zäöü])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export const conversions: { id: string; label: string; fn: (t: string) => string }[] = [
  { id: "upper", label: "GROSSBUCHSTABEN", fn: (t) => t.toLocaleUpperCase("de") },
  { id: "lower", label: "kleinbuchstaben", fn: (t) => t.toLocaleLowerCase("de") },
  {
    id: "title",
    label: "Jedes Wort Groß",
    fn: (t) =>
      t
        .toLocaleLowerCase("de")
        .replace(
          /(^|[\s\-(„"'])(\p{L})/gu,
          (_, a: string, b: string) => a + b.toLocaleUpperCase("de"),
        ),
  },
  {
    id: "sentence",
    label: "Satzanfang groß",
    fn: (t) =>
      t
        .toLocaleLowerCase("de")
        .replace(
          /(^\s*|[.!?]\s+)(\p{L})/gu,
          (_, a: string, b: string) => a + b.toLocaleUpperCase("de"),
        ),
  },
  {
    id: "camel",
    label: "camelCase",
    fn: (t) =>
      words(t)
        .map((w, i) => (i ? cap(w) : w.toLowerCase()))
        .join(""),
  },
  { id: "pascal", label: "PascalCase", fn: (t) => words(t).map(cap).join("") },
  {
    id: "snake",
    label: "snake_case",
    fn: (t) =>
      words(t)
        .map((w) => w.toLowerCase())
        .join("_"),
  },
  {
    id: "constant",
    label: "CONSTANT_CASE",
    fn: (t) =>
      words(t)
        .map((w) => w.toUpperCase())
        .join("_"),
  },
  {
    id: "kebab",
    label: "kebab-case",
    fn: (t) =>
      words(t)
        .map((w) => w.toLowerCase())
        .join("-"),
  },
  {
    id: "dot",
    label: "dot.case",
    fn: (t) =>
      words(t)
        .map((w) => w.toLowerCase())
        .join("."),
  },
  {
    id: "invert",
    label: "uMKEHREN",
    fn: (t) =>
      [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(""),
  },
  {
    id: "ascii",
    label: "Umlaute ersetzen (ä→ae)",
    fn: (t) =>
      t
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/Ä/g, "Ae")
        .replace(/Ö/g, "Oe")
        .replace(/Ü/g, "Ue")
        .replace(/ß/g, "ss")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""),
  },
];
