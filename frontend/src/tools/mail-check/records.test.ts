import { describe, expect, it } from "vitest";
import { organizationalDomain } from "./check";
import { analyzeDkim, analyzeDmarc, analyzeSpf, mailProvider, parseSpf, rsaBitsFromSpki, type TxtLookup } from "./records";

const KEY_2048 = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjnOwqj4vcaACEu5IBePgqkt+griswdA1YmdgthcWaV+clF7qEtcGaTsTZqePK1eoUY/gDGzRiblbvi7cR0wmjvfht35cX8NHvTlpgY1MUoDDAj4dnUiNxIutrE2CXMLdKcrkyjyBVRLiRYtcik+u7gGF2Txby+7YAdAvlnZZ4K1eT0DNsi2fgt6y7lDCpffmtnygkpXkrOEm1sF+K/r0pCH/wzjlnoPTu9akmVz6PsUxhkfkp1xrejZEKbKuMBlzJYaFJgpqzriDhZfi+nGxT1MWrqsPrnTRVsa4ic/oDJ9AW650R5q9buZ3MdmmIJdOS6FHcyW77jDvsRfAuE5b0QIDAQAB";
const KEY_1024 = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC23B8Ofuvpblz+F+2PPCqIqLGyUF9Ung1akm9biussFeK/6Nut1QpOBfctYBvLpMOKsiElkPfZXSPhgTKtQcdNOjn3ujDUKnXK3qek5eBpmmb3kFymBjLIu4CzAHoWUHOhsj8KBTWjlqFhxRCZzFEMgOWTzqzVIkkFxUuoaWgjawIDAQAB";

const zone: Record<string, string[]> = {
  "example.com": ["v=spf1 include:_spf.example.com include:spf.protection.outlook.com -all", "MS=ms123"],
  "_spf.example.com": ["v=spf1 ip4:192.0.2.0/24 a mx ~all"],
  "spf.protection.outlook.com": ["v=spf1 include:spfa.protection.outlook.com -all"],
  "spfa.protection.outlook.com": ["v=spf1 ip4:40.92.0.0/15 -all"],
  "many.example": ["v=spf1 " + Array.from({ length: 11 }, (_, i) => `include:s${i}.example`).join(" ") + " -all"],
  "broken.example": ["v=spf1 include:nospf.example ip4:999.1.1.1 foo -all"],
  "nospf.example": ["hallo"],
  "two.example": ["v=spf1 -all", "v=spf1 ~all"],
  "plus.example": ["v=spf1 +all"],
};
for (let i = 0; i < 11; i++) zone[`s${i}.example`] = ["v=spf1 ip4:192.0.2.1 -all"];
const lookup: TxtLookup = async (n) => zone[n] ?? null;

describe("SPF", () => {
  it("zählt Lookups über includes", async () => {
    const r = await analyzeSpf("example.com", lookup);
    expect(r.lookups).toBe(5);
    expect(r.tree!.children.map((c) => c.domain)).toEqual(["_spf.example.com", "spf.protection.outlook.com"]);
    expect(r.findings.some((f) => f.level === "error")).toBe(false);
    expect(r.findings.map((f) => f.title)).toContain("5 von 10 DNS-Lookups");
  });

  it("über 10 Lookups ist ein Fehler", async () => {
    const r = await analyzeSpf("many.example", lookup);
    expect(r.lookups).toBe(11);
    expect(r.findings.find((f) => f.title.startsWith("11 DNS-Lookups"))?.level).toBe("error");
  });

  it("meldet Syntaxfehler, include ohne SPF, mehrere Records, +all", async () => {
    const broken = await analyzeSpf("broken.example", lookup);
    const titles = broken.findings.map((f) => f.title).join(" | ");
    expect(titles).toMatch(/nospf.example hat keinen SPF-Record/);
    expect(titles).toMatch(/Ungültige IPv4-Angabe/);
    expect(titles).toMatch(/Ungültiger SPF-Bestandteil „foo“/);
    expect((await analyzeSpf("two.example", lookup)).findings.some((f) => /2 SPF-Records/.test(f.title))).toBe(true);
    expect((await analyzeSpf("plus.example", lookup)).findings.some((f) => f.level === "error" && /\+all/.test(f.title))).toBe(true);
    expect((await analyzeSpf("none.example", lookup)).findings[0]!.title).toBe("Kein SPF-Record");
  });

  it("zerlegt Qualifier und Werte", () => {
    const { terms } = parseSpf("v=spf1 -ip4:192.0.2.1 ~all redirect=_spf.x.de");
    expect(terms.map((t) => [t.qualifier, t.kind, t.value])).toEqual([
      ["-", "ip4", "192.0.2.1"],
      ["~", "all", undefined],
      ["+", "redirect", "_spf.x.de"],
    ]);
  });
});

describe("DMARC", () => {
  it("bewertet die Richtlinie", () => {
    expect(analyzeDmarc(["v=DMARC1; p=reject; rua=mailto:d@example.com"]).findings[0]!.level).toBe("ok");
    expect(analyzeDmarc(["v=DMARC1; p=none"]).findings[0]!.level).toBe("warn");
    expect(analyzeDmarc(["v=DMARC1; p=quarantine; pct=50"]).findings.some((f) => /pct=50/.test(f.title))).toBe(true);
    expect(analyzeDmarc(null).findings[0]!.title).toBe("Kein DMARC-Record");
    expect(analyzeDmarc(["v=DMARC1; p=none", "v=DMARC1; p=reject"]).findings[0]!.level).toBe("error");
  });

  it("nimmt bei Subdomains das DMARC der Hauptdomain", () => {
    const r = analyzeDmarc(null, { domain: "example.com", txt: ["v=DMARC1; p=reject; sp=quarantine"] });
    expect(r.findings[0]!.title).toMatch(/Hauptdomain example.com gilt \(Richtlinie quarantine\)/);
  });
});

describe("DKIM", () => {
  it("liest die Schlüssellänge", () => {
    expect(rsaBitsFromSpki(KEY_2048)).toBe(2048);
    expect(rsaBitsFromSpki(KEY_1024)).toBe(1024);
    expect(analyzeDkim("s1", [`v=DKIM1; k=rsa; p=${KEY_2048}`])!.findings[0]!.level).toBe("ok");
    expect(analyzeDkim("s1", [`v=DKIM1; k=rsa; p=${KEY_1024}`])!.findings[0]!.level).toBe("warn");
    expect(analyzeDkim("s1", ["v=DKIM1; p="])!.revoked).toBe(true);
    expect(analyzeDkim("s1", ["etwas anderes"])).toBeNull();
  });
});

describe("Hilfen", () => {
  it("Hauptdomain und Anbieter", () => {
    expect(organizationalDomain("mail.example.com")).toBe("example.com");
    expect(organizationalDomain("www.example.co.uk")).toBe("example.co.uk");
    expect(mailProvider("example-com.mail.protection.outlook.com.")).toBe("Microsoft 365");
    expect(mailProvider("aspmx.l.google.com")).toBe("Google Workspace");
  });
});
