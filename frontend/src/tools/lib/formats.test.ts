import { describe, expect, it } from "vitest";
import { csvToJson, detectDelimiter, jsonToCsv, parseCsv } from "./csv";
import { asSigned, parseNumber, twosComplement } from "./number";
import { formatSql, minifySql } from "./sql";
import { isoWeek, parseTimestamp, wallTimeToDate, zoneOffset } from "./time";
import { parseToml, toToml } from "./toml";

describe("TOML", () => {
  it("liest und schreibt", () => {
    const t = `title = "Beispiel" # Kommentar
[server]
host = "0.0.0.0"
port = 8_080
tls = true
paths = ["/a", '/b']
[server.limits]
max = 1.5e3
[[users]]
name = "anna"
[[users]]
name = "ben"
roles = { admin = true }
date = 2026-11-07T10:00:00Z
`;
    const v = parseToml(t);
    expect(v).toEqual({
      title: "Beispiel",
      server: {
        host: "0.0.0.0",
        port: 8080,
        tls: true,
        paths: ["/a", "/b"],
        limits: { max: 1500 },
      },
      users: [
        { name: "anna" },
        { name: "ben", roles: { admin: true }, date: "2026-11-07T10:00:00Z" },
      ],
    });
    expect(parseToml(toToml(v))).toEqual(v);
    expect(() => parseToml("a = 1\na = 2")).toThrow(/doppelt/);
    expect(toToml({ a: null, b: 1 })).toBe("b = 1\n");
  });
});

describe("CSV", () => {
  it("erkennt Trennzeichen und Anführungszeichen", () => {
    const text = 'Name;Ort;Anzahl\n"Müller; Hans";Köln;3\nB;"Zeile\nzwei";4\n';
    expect(detectDelimiter(text)).toBe(";");
    expect(parseCsv(text, ";")[1]).toEqual(["Müller; Hans", "Köln", "3"]);
    const r = csvToJson(text, { header: true, types: true });
    expect(r.data).toEqual([
      { Name: "Müller; Hans", Ort: "Köln", Anzahl: 3 },
      { Name: "B", Ort: "Zeile\nzwei", Anzahl: 4 },
    ]);
  });
  it("JSON → CSV mit Verschachtelung", () => {
    expect(
      jsonToCsv(
        [
          { a: 1, b: { c: "x;y" } },
          { a: 2, d: true },
        ],
        ";",
        true,
      ),
    ).toBe('a;b.c;d\r\n1;"x;y";\r\n2;;true');
  });
});

describe("SQL", () => {
  it("formatiert", () => {
    const f = formatSql(
      "select a, b from t1 inner join t2 on t1.id = t2.id where a = 1 and b between 2 and 3 order by a desc;",
    );
    expect(f).toBe(
      [
        "SELECT",
        "  a,",
        "  b",
        "FROM t1",
        "INNER JOIN t2",
        "  ON t1.id = t2.id",
        "WHERE",
        "  a = 1",
        "  AND b BETWEEN 2 AND 3",
        "ORDER BY",
        "  a DESC;",
      ].join("\n"),
    );
    expect(formatSql("select x from (select y from z) s")).toContain(
      "FROM (\n  SELECT\n    y\n  FROM z\n) s",
    );
    expect(formatSql("select count(*) from t where id in (1, 2)")).toBe(
      "SELECT\n  COUNT(*)\nFROM t\nWHERE\n  id IN (1, 2)",
    );
    expect(minifySql("SELECT a,\n  b -- c\nFROM t")).toBe("SELECT a, b FROM t");
  });
});

describe("Zeit", () => {
  it("Zeitstempel", () => {
    expect(parseTimestamp("1762516800").date.toISOString()).toBe("2025-11-07T12:00:00.000Z");
    expect(parseTimestamp("1762516800123").unit).toBe("ms");
    expect(parseTimestamp("1762516800123456789").unit).toBe("ns");
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
  });
  it("Zeitzonen inkl. Sommerzeit", () => {
    expect(zoneOffset("Europe/Berlin", new Date("2026-01-15T12:00:00Z"))).toBe(60);
    expect(zoneOffset("Europe/Berlin", new Date("2026-07-15T12:00:00Z"))).toBe(120);
    expect(zoneOffset("Asia/Kolkata", new Date("2026-07-15T12:00:00Z"))).toBe(330);
    expect(wallTimeToDate("2026-07-15T14:30", "Europe/Berlin").toISOString()).toBe(
      "2026-07-15T12:30:00.000Z",
    );
    expect(wallTimeToDate("2026-01-15T09:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });
});

describe("Zahlensysteme", () => {
  it("liest Präfixe und rechnet Zweierkomplement", () => {
    expect(parseNumber("0xFF").value).toBe(255n);
    expect(parseNumber("0b1010").value).toBe(10n);
    expect(parseNumber("1F").base).toBe(16);
    expect(parseNumber("-5").value).toBe(-5n);
    expect(twosComplement(-1n, 8)).toBe(255n);
    expect(twosComplement(-129n, 8)).toBeNull();
    expect(asSigned(0xffffffffn, 32)).toBe(-1n);
    expect(() => parseNumber("0b102")).toThrow();
  });
});
