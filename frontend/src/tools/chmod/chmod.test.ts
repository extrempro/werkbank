import { describe, expect, it } from "vitest";
import {
  applySymbolic,
  describe as describeMode,
  fromUmask,
  parseMode,
  toChmodSymbolic,
  toOctal,
  toSymbolic,
} from "./chmod";

describe("chmod", () => {
  it("oktal ↔ symbolisch", () => {
    expect(toSymbolic(0o755)).toBe("rwxr-xr-x");
    expect(toSymbolic(0o4755)).toBe("rwsr-xr-x");
    expect(toSymbolic(0o1777)).toBe("rwxrwxrwt");
    expect(toSymbolic(0o2640)).toBe("rw-r-S---");
    expect(parseMode("rwxr-xr-x")).toBe(0o755);
    expect(parseMode("-rwsr-xr-x")).toBe(0o4755);
    expect(parseMode("drwxrwxrwt")).toBe(0o1777);
    expect(parseMode("0644")).toBe(0o644);
    expect(toOctal(0o644)).toBe("644");
    expect(toOctal(0o4755)).toBe("4755");
    expect(toChmodSymbolic(0o750)).toBe("u=rwx,g=rx,o=");
  });

  it("symbolische chmod-Ausdrücke", () => {
    expect(applySymbolic(0o644, "u+x")).toBe(0o744);
    expect(applySymbolic(0o777, "go-w")).toBe(0o755);
    expect(applySymbolic(0o777, "o=")).toBe(0o770);
    expect(applySymbolic(0, "a=r,u+w")).toBe(0o644);
    expect(parseMode("u=rwx,g=rx,o=")).toBe(0o750);
    expect(() => parseMode("abc")).toThrow();
  });

  it("umask und Beschreibung", () => {
    expect(fromUmask(0o022)).toEqual({ file: 0o644, dir: 0o755 });
    expect(describeMode(0o777).at(-1)).toMatch(/Für alle beschreibbar/);
  });
});
