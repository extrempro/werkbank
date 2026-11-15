import { describe, expect, it } from "vitest";
import { dateToFileTime, dateToGeneralizedTime, NEVER, parseAdTime, relativeTime } from "./ad-time";

describe("parseAdTime", () => {
  it("wandelt FILETIME in ein Datum", () => {
    // 2024-01-01T00:00:00Z
    const r = parseAdTime("133485408000000000");
    expect(r.kind).toBe("filetime");
    expect(r.date?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("erkennt Sonderwerte", () => {
    expect(parseAdTime("0")).toMatchObject({ date: null });
    expect(parseAdTime(NEVER.toString()).special).toMatch(/nie ab/);
    expect(parseAdTime("-1").special).toMatch(/pwdLastSet/);
  });

  it("liest Generalized Time inkl. Zeitzone", () => {
    expect(parseAdTime("20231015123045.0Z").date?.toISOString()).toBe("2023-10-15T12:30:45.000Z");
    expect(parseAdTime("20231015143045.0+0200").date?.toISOString()).toBe(
      "2023-10-15T12:30:45.000Z",
    );
  });

  it("lehnt ungültige Werte ab", () => {
    expect(() => parseAdTime("gestern")).toThrow();
    expect(() => parseAdTime("-5")).toThrow();
  });
});

describe("Gegenrichtung", () => {
  it("rechnet ein Datum in FILETIME und Generalized Time um", () => {
    const d = new Date("2024-01-01T00:00:00Z");
    expect(dateToFileTime(d)).toBe(133485408000000000n);
    expect(dateToGeneralizedTime(d)).toBe("20240101000000.0Z");
  });
});

describe("relativeTime", () => {
  it("formuliert auf Deutsch", () => {
    const now = new Date("2024-01-10T00:00:00Z");
    expect(relativeTime(new Date("2024-01-07T00:00:00Z"), now)).toBe("vor 3 Tagen");
  });
});
