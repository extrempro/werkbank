import { describe, expect, it } from "vitest";
import { humanTtl, readable } from "./format";

describe("lesbare DNS-Daten", () => {
  it("TTL in Klartext", () => {
    expect(humanTtl(45)).toBe("45 s");
    expect(humanTtl(300)).toBe("5 min");
    expect(humanTtl(90)).toBe("1 min 30 s");
    expect(humanTtl(3600)).toBe("1 h");
    expect(humanTtl(5400)).toBe("1 h 30 min");
    expect(humanTtl(86400)).toBe("1 d");
    expect(humanTtl(1209600)).toBe("14 d");
  });

  it("MX, Null-MX und SRV", () => {
    expect(readable("MX", "10 mail.example.com.")).toEqual({
      main: "mail.example.com",
      fields: [{ label: "Priorität", value: "10" }],
    });
    expect(readable("MX", "0 .").kind).toBe("Null-MX");
    expect(readable("SRV", "100 1 443 sipdir.online.lync.com.").main).toBe(
      "sipdir.online.lync.com:443",
    );
  });

  it("SOA mit Mailadresse und Zeiten", () => {
    const r = readable("SOA", "ns.icann.org. noc.dns.icann.org. 2024081420 7200 3600 1209600 3600");
    expect(r.main).toBe("ns.icann.org");
    expect(r.fields).toContainEqual({ label: "Verantwortlich", value: "noc@dns.icann.org" });
    expect(r.fields).toContainEqual({ label: "Expire", value: "14 d" });
    expect(readable("SOA", "ns1.x. john\\.doe.example.com. 1 2 3 4 5").fields[0]!.value).toBe(
      "john.doe@example.com",
    );
  });

  it("TXT entpackt und eingeordnet", () => {
    expect(readable("TXT", '"v=spf1 include:spf.protection.outlook.com" " -all"')).toMatchObject({
      main: "v=spf1 include:spf.protection.outlook.com -all",
      kind: "SPF",
    });
    expect(readable("TXT", '"v=DMARC1; p=reject; rua=mailto:d@example.com"')).toMatchObject({
      kind: "DMARC",
      hint: "Richtlinie: abweisen",
    });
    expect(readable("TXT", '"MS=ms12345678"').kind).toBe("Microsoft 365");
    expect(readable("TXT", '"apple-domain-verification=abc"').kind).toBe("Bestätigung");
    expect(readable("TXT", '"hallo welt"').kind).toBeUndefined();
  });

  it("CAA", () => {
    expect(readable("CAA", '0 issue "letsencrypt.org"')).toMatchObject({
      main: "letsencrypt.org",
      hint: "darf Zertifikate ausstellen",
    });
    expect(readable("CAA", '0 issue ";"').main).toBe(";");
  });

  it("Namen ohne Punkt am Ende", () => {
    expect(readable("CNAME", "cdn.example.net.").main).toBe("cdn.example.net");
    expect(readable("A", "192.0.2.1").main).toBe("192.0.2.1");
  });
});
