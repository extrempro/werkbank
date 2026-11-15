import { describe, expect, it } from "vitest";
import { convertGuid } from "./guid";

const guid = "748b2d72-706b-42f8-8b25-82fd8733860f";
const immutableId = "ci2LdGtw+EKLJYL9hzOGDw==";

describe("convertGuid", () => {
  it("rechnet objectGUID in ImmutableID um", () => {
    const r = convertGuid(guid);
    expect(r.detected).toBe("guid");
    expect(r.immutableId).toBe(immutableId);
    expect(r.hex).toBe("72 2d 8b 74 6b 70 f8 42 8b 25 82 fd 87 33 86 0f");
    expect(r.ldapFilter).toBe("\\72\\2d\\8b\\74\\6b\\70\\f8\\42\\8b\\25\\82\\fd\\87\\33\\86\\0f");
  });

  it("rechnet ImmutableID zurück in die GUID", () => {
    const r = convertGuid(immutableId);
    expect(r.detected).toBe("immutableId");
    expect(r.guid).toBe(guid);
  });

  it("akzeptiert GUID mit Klammern, Großbuchstaben oder ohne Bindestriche", () => {
    expect(convertGuid(`{${guid.toUpperCase()}}`).immutableId).toBe(immutableId);
    expect(convertGuid(guid.replace(/-/g, "")).immutableId).toBe(immutableId);
  });

  it("liest LDAP-Form und Hex-Bytes", () => {
    expect(convertGuid("\\72\\2d\\8b\\74\\6b\\70\\f8\\42\\8b\\25\\82\\fd\\87\\33\\86\\0f").guid).toBe(guid);
    expect(convertGuid("72:2D:8B:74:6B:70:F8:42:8B:25:82:FD:87:33:86:0F").guid).toBe(guid);
  });

  it("lehnt Unsinn ab", () => {
    expect(() => convertGuid("hallo")).toThrow();
    expect(() => convertGuid("")).toThrow();
  });
});
