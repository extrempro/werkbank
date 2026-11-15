import { describe, expect, it } from "vitest";
import { analyzeDn, canonicalToDn, escapeDnValue, escapeFilterValue, parseDn, unescapeFilterValue } from "./ldap";

describe("LDAP-Filter", () => {
  it("maskiert nach RFC 4515", () => {
    expect(escapeFilterValue("Müller (IT) *")).toBe("Müller \\28IT\\29 \\2a");
    expect(escapeFilterValue("a\\b")).toBe("a\\5cb");
    expect(escapeFilterValue("Müller", true)).toBe("M\\c3\\bcller");
    expect(unescapeFilterValue("M\\c3\\bcller \\28IT\\29")).toBe("Müller (IT)");
  });
});

describe("DN", () => {
  it("maskiert nach RFC 4514", () => {
    expect(escapeDnValue("Müller, Hans")).toBe("Müller\\, Hans");
    expect(escapeDnValue(" #x ")).toBe("\\ #x\\ ");
    expect(escapeDnValue('a+b"c')).toBe('a\\+b\\"c');
  });

  it("zerlegt auch maskierte und mehrwertige Bestandteile", () => {
    const rdns = parseDn("CN=Müller\\, Hans,OU=IT+L=Berlin,DC=example,DC=com");
    expect(rdns.length).toBe(4);
    expect(rdns[0]!.parts[0]).toMatchObject({ type: "CN", value: "Müller, Hans" });
    expect(rdns[1]!.parts.map((p) => p.value)).toEqual(["IT", "Berlin"]);
    expect(parseDn("CN=Hans\\C3\\BC,DC=x")[0]!.parts[0]!.value).toBe("Hansü");
    expect(() => parseDn("CN=a,,DC=b")).toThrow();
    expect(() => parseDn("Hallo")).toThrow();
  });

  it("canonicalName, Domain und übergeordneter Pfad", () => {
    const info = analyzeDn("CN=Max Muster,OU=Vertrieb,OU=Benutzer,DC=example,DC=com");
    expect(info.domain).toBe("example.com");
    expect(info.canonical).toBe("example.com/Benutzer/Vertrieb/Max Muster");
    expect(info.parent).toBe("OU=Vertrieb,OU=Benutzer,DC=example,DC=com");
    expect(info.name).toBe("Max Muster");
  });

  it("canonicalName → DN", () => {
    expect(canonicalToDn("example.com/Benutzer/Vertrieb/Max Muster")).toBe("CN=Max Muster,OU=Vertrieb,OU=Benutzer,DC=example,DC=com");
    expect(canonicalToDn("example.com/Users/Admin")).toBe("CN=Admin,CN=Users,DC=example,DC=com");
  });
});
