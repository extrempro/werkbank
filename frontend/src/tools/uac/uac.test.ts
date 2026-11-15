import { describe, expect, it } from "vitest";
import { decodeUac, ldapBitFilter, parseUac } from "./uac";

describe("userAccountControl", () => {
  it("liest dezimal und hexadezimal", () => {
    expect(parseUac("514")).toBe(514);
    expect(parseUac("0x202")).toBe(514);
    expect(parseUac("202h")).toBe(514);
    expect(() => parseUac("abc")).toThrow();
  });

  it("zerlegt in Flags", () => {
    expect(decodeUac(66050).flags.map((f) => f.name)).toEqual([
      "ACCOUNTDISABLE",
      "NORMAL_ACCOUNT",
      "DONT_EXPIRE_PASSWORD",
    ]);
    expect(decodeUac(532480).flags.map((f) => f.name)).toEqual([
      "SERVER_TRUST_ACCOUNT",
      "TRUSTED_FOR_DELEGATION",
    ]);
    expect(decodeUac(512 + 0x400000).warnings.join()).toMatch(/AS-REP/);
    expect(decodeUac(0x80000000).unknown).toBe(0x80000000);
  });

  it("LDAP-Filter", () => {
    expect(ldapBitFilter(2)).toBe("(userAccountControl:1.2.840.113556.1.4.803:=2)");
  });
});
