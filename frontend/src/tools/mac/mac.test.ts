import { describe, expect, it } from "vitest";
import {
  eui64,
  extractMacs,
  formatMac,
  lookupVendor,
  parseMac,
  parseOuiList,
  specialMac,
} from "./mac";

describe("MAC-Adressen", () => {
  it("Schreibweisen erkennen und umwandeln", () => {
    for (const s of ["00:50:56:ab:cd:ef", "00-50-56-AB-CD-EF", "0050.56ab.cdef", "005056ABCDEF"])
      expect(parseMac(s)?.hex).toBe("005056ABCDEF");
    expect(parseMac("00:50:56-ab:cd:ef")).toBeNull();
    expect(formatMac("005056ABCDEF", "cisco")).toBe("0050.56ab.cdef");
    expect(formatMac("005056ABCDEF", "hyphen")).toBe("00-50-56-AB-CD-EF");
  });
  it("aus Text extrahieren", () => {
    const t =
      "  192.168.1.1          3c-22-fb-12-34-56     dynamisch\n? (10.0.0.2) at 00:1a:2b:3c:4d:5e on en0";
    expect(extractMacs(t).map((m) => m.hex)).toEqual(["3C22FB123456", "001A2B3C4D5E"]);
  });
  it("Bits und Sonderadressen", () => {
    const m = parseMac("da:a1:19:00:00:01")!;
    expect(m.local).toBe(true);
    expect(m.multicast).toBe(false);
    expect(parseMac("01:00:5e:00:00:fb")!.multicast).toBe(true);
    expect(specialMac("00005E000101")).toContain("VRRP");
  });
  it("EUI-64", () => {
    expect(eui64("005056ABCDEF").linkLocal).toBe("fe80::250:56ff:feab:cdef");
    expect(eui64("020000000001").linkLocal).toBe("fe80::ff:fe00:1");
  });
  it("Hersteller nach längstem Präfix", () => {
    const list = parseOuiList(
      "005056\tVMware, Inc.\n70B3D5\tIEEE Registration Authority\n70B3D5123\tKleinfirma GmbH\n",
    );
    expect(lookupVendor(list, "005056ABCDEF")).toBe("VMware, Inc.");
    expect(lookupVendor(list, "70B3D5123456")).toBe("Kleinfirma GmbH");
  });
});
