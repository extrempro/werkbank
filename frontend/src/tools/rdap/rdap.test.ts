import { describe, expect, it } from "vitest";
import { contacts, detectQuery, ipRangeText, type RdapObject } from "./rdap";

describe("RDAP", () => {
  it("Abfrageart erkennen", () => {
    expect(detectQuery("example.com")).toMatchObject({ kind: "domain", value: "example.com" });
    expect(detectQuery("bürger.example")?.value).toBe("xn--brger-kva.example");
    expect(detectQuery("AS64500")).toMatchObject({ kind: "autnum", value: "64500" });
    expect(detectQuery("192.0.2.1")).toMatchObject({ kind: "ip", ipVersion: 4 });
    expect(detectQuery("2001:db8::/48")).toMatchObject({
      kind: "ip",
      value: "2001:db8::/48",
      ipVersion: 6,
    });
    expect(detectQuery("https://www.example.com/pfad")?.value).toBe("www.example.com");
    expect(detectQuery("kein domain")).toBeNull();
  });
  it("Kontakte und Bereich auslesen", () => {
    const o: RdapObject = {
      startAddress: "192.0.2.0",
      endAddress: "192.0.2.255",
      cidr0_cidrs: [{ v4prefix: "192.0.2.0", length: 24 }],
      entities: [
        {
          roles: ["registrar"],
          publicIds: [{ type: "IANA Registrar ID", identifier: "9999" }],
          vcardArray: [
            "vcard",
            [
              ["version", {}, "text", "4.0"],
              ["fn", {}, "text", "Beispiel Registrar GmbH"],
            ],
          ],
          entities: [
            {
              roles: ["abuse"],
              vcardArray: [
                "vcard",
                [
                  ["email", {}, "text", "abuse@example.com"],
                  ["tel", { type: "voice" }, "uri", "tel:+49.30123456"],
                ],
              ],
            },
          ],
        },
      ],
    };
    expect(ipRangeText(o)).toBe("192.0.2.0/24");
    const c = contacts(o);
    expect(c[0]).toMatchObject({ name: "Beispiel Registrar GmbH", ianaId: "9999" });
    expect(c[1]).toMatchObject({
      roles: ["abuse"],
      email: "abuse@example.com",
      phone: "+49.30123456",
    });
  });
});
