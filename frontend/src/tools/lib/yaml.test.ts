import { describe, expect, it } from "vitest";
import { parseYaml, toYaml } from "./yaml";

describe("YAML", () => {
  it("liest typische Konfigurationen", () => {
    const y = `# Kommentar
services:
  web:
    image: "nginx:1.27"
    ports:
      - "8080:80"
      - 443:443
    environment:
      DEBUG: false
      LEVEL: 3
      RATIO: 0.5
      EMPTY:
      NAME: Mein Dienst # Kommentar
    command: [nginx, -g, 'daemon off;']
  db: { image: postgres, restart: always }
list:
- a
- b: 1
  c: 2
- - x
  - y
text: |
  Zeile 1
  Zeile 2
folded: >-
  ein
  Satz
anchor: &base
  x: 1
copy: *base
`;
    expect(parseYaml(y).value).toEqual({
      services: {
        web: {
          image: "nginx:1.27",
          ports: ["8080:80", "443:443"],
          environment: { DEBUG: false, LEVEL: 3, RATIO: 0.5, EMPTY: null, NAME: "Mein Dienst" },
          command: ["nginx", "-g", "daemon off;"],
        },
        db: { image: "postgres", restart: "always" },
      },
      list: ["a", { b: 1, c: 2 }, ["x", "y"]],
      text: "Zeile 1\nZeile 2\n",
      folded: "ein Satz",
      anchor: { x: 1 },
      copy: { x: 1 },
    });
  });

  it("mehrere Dokumente und Fehler", () => {
    expect(parseYaml("a: 1\n---\nb: 2\n").value).toEqual([{ a: 1 }, { b: 2 }]);
    expect(() => parseYaml("a: 1\na: 2")).toThrow(/doppelt/);
    expect(() => parseYaml("a:\n\tb: 1")).toThrow(/Tabulatoren/);
    expect(() => parseYaml("a: [1, 2")).toThrow();
  });

  it("schreibt YAML, das wieder gleich gelesen wird", () => {
    const v = {
      name: "x: y",
      n: "123",
      yes: "yes",
      list: [1, { a: true, b: null }, []],
      multi: "a\nb\n",
      empty: {},
      "key with space": 1,
    };
    const y = toYaml(v);
    expect(y).toContain('name: "x: y"');
    expect(y).toContain('"n": "123"');
    expect(parseYaml(y).value).toEqual(v);
  });
});
