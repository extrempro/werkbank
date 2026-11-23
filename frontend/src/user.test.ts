import { describe, expect, it } from "vitest";
import { firstName, greeting, initials, roleLabel } from "./user";

describe("initials", () => {
  it("nimmt den ersten und den letzten Namensteil", () => {
    expect(initials("Erika Beispiel")).toBe("EB");
    expect(initials("Erika Maria Beispiel")).toBe("EB");
    expect(initials("Beispiel, Erika")).toBe("BE");
  });

  it("kommt mit einem Wort, Zusätzen und leeren Namen zurecht", () => {
    expect(initials("erika")).toBe("E");
    expect(initials("Erika Beispiel (IT)")).toBe("EB");
    expect(initials("  ")).toBe("?");
  });
});

describe("roleLabel", () => {
  it("zeigt die wichtigste Rolle", () => {
    expect(roleLabel(["Config.Reader", "Werkbank.Admin"])).toBe("Administration");
    expect(roleLabel(["Evergreen.Reader"])).toBe("Evergreen-Leser");
    expect(roleLabel(["Irgendwas"])).toBeNull();
  });
});

describe("greeting", () => {
  it("richtet sich nach der Tageszeit", () => {
    expect(greeting(new Date(2026, 10, 14, 8, 0))).toBe("Guten Morgen");
    expect(greeting(new Date(2026, 10, 14, 13, 0))).toBe("Hallo");
    expect(greeting(new Date(2026, 10, 14, 19, 30))).toBe("Guten Abend");
    expect(firstName("Ina Beispiel")).toBe("Ina");
    expect(firstName("Beispiel, Ina (IT)")).toBe("Ina");
    expect(firstName("Ina")).toBe("Ina");
  });
});
