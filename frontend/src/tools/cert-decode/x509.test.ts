import { describe, expect, it } from "vitest";
import { intermediatePem, leafCsrPem, leafPem, rootPem } from "./fixtures";
import {
  analyzeChain,
  decodeText,
  fingerprints,
  validityStatus,
  type CertificateInfo,
  type CsrInfo,
} from "./x509";

const cert = (pem: string) => decodeText(pem).items[0] as CertificateInfo;

describe("Zertifikat", () => {
  const leaf = cert(leafPem);

  it("liest Antragsteller, Aussteller und Seriennummer", () => {
    expect(leaf.subject.text).toBe(
      "CN=intranet.example.com, OU=IT, O=Beispiel GmbH, L=München, ST=Bayern, C=DE",
    );
    expect(leaf.issuer.text).toBe("CN=Beispiel Issuing CA, O=Beispiel GmbH, C=DE");
    expect(leaf.serial).toBe("FB7F6AFB6E68466FD9F4B1C58FD821AB0C69BF6F");
    expect(leaf.version).toBe(3);
  });

  it("liest Gültigkeit, Schlüssel und Signatur", () => {
    expect(leaf.notBefore.toISOString()).toBe("2026-11-06T21:46:18.000Z");
    expect(leaf.notAfter.toISOString()).toBe("2027-12-08T21:46:18.000Z");
    expect(leaf.publicKey).toEqual({ algorithm: "RSA", bits: 3072 });
    expect(leaf.signatureAlgorithm).toBe("ECDSA mit SHA-256");
  });

  it("liest alle SAN-Typen inkl. UPN und IPv6", () => {
    expect(leaf.san).toEqual([
      { type: "DNS", value: "intranet.example.com" },
      { type: "DNS", value: "*.example.com" },
      { type: "IP", value: "192.0.2.5" },
      { type: "IP", value: "2001:db8::1" },
      { type: "E-Mail", value: "it@example.com" },
      { type: "UPN", value: "admin@example.com" },
    ]);
  });

  it("liest Erweiterungen", () => {
    expect(leaf.keyUsage).toEqual(["Digitale Signatur", "Schlüsselverschlüsselung"]);
    expect(leaf.extKeyUsage[0]).toContain("Serverauthentifizierung");
    expect(leaf.basicConstraints).toEqual({ ca: false, pathLength: undefined });
    expect(leaf.subjectKeyId).toBe("F5:49:90:68:01:4E:E8:57:E5:5D:50:59:76:05:E0:04:85:81:23:20");
    expect(leaf.authorityKeyId).toBe("F7:4F:DF:51:5B:5D:F3:6D:2E:86:45:C1:E1:41:9A:7F:86:85:4A:8B");
    expect(leaf.crlUrls).toEqual(["http://pki.example.com/issuing.crl"]);
    expect(leaf.ocspUrls).toEqual(["http://ocsp.example.com"]);
    expect(leaf.caIssuerUrls).toEqual(["http://pki.example.com/issuing.crt"]);
  });

  it("berechnet Fingerprints wie OpenSSL", async () => {
    expect(await fingerprints(leaf.der)).toEqual({
      sha1: "48:97:D6:DA:24:EF:65:F7:17:7D:C6:E8:93:C5:2C:5D:C2:DF:4E:97",
      sha256:
        "6A:30:FE:26:44:ED:0F:AF:D8:5E:2F:45:E4:9F:F5:16:17:9F:31:B2:FF:6E:6C:BB:D4:53:93:12:64:D1:F6:4B",
    });
  });

  it("bewertet die Gültigkeit", () => {
    expect(validityStatus(leaf, new Date("2027-06-01T00:00:00Z")).tone).toBe("ok");
    expect(validityStatus(leaf, new Date("2027-12-01T00:00:00Z")).tone).toBe("warn");
    expect(validityStatus(leaf, new Date("2028-01-01T00:00:00Z")).text).toMatch(/abgelaufen/);
  });

  it("liest Base64 ohne PEM-Kopfzeilen", () => {
    expect(decodeText(leafPem.replace(/-----[^-]+-----/g, "")).items[0]!.kind).toBe("certificate");
  });
});

describe("CA-Zertifikate", () => {
  it("erkennt EC-Schlüssel und Basic Constraints", () => {
    const int = cert(intermediatePem);
    expect(int.publicKey).toEqual({ algorithm: "ECDSA", curve: "P-256", bits: 256 });
    expect(int.basicConstraints).toEqual({ ca: true, pathLength: 0 });
    expect(int.selfSigned).toBe(false);
  });

  it("erkennt selbstsignierte Root", () => {
    expect(cert(rootPem).selfSigned).toBe(true);
  });
});

describe("CSR", () => {
  it("liest Antragsteller, Schlüssel und angefragte SANs", () => {
    const csr = decodeText(leafCsrPem).items[0] as CsrInfo;
    expect(csr.kind).toBe("csr");
    expect(csr.subject.text).toContain("CN=intranet.example.com");
    expect(csr.publicKey.bits).toBe(3072);
    expect(csr.san.map((s) => s.type)).toEqual(["DNS", "DNS", "IP", "IP", "E-Mail", "UPN"]);
  });
});

describe("Kette", () => {
  it("akzeptiert die richtige Reihenfolge", () => {
    const a = analyzeChain([cert(leafPem), cert(intermediatePem), cert(rootPem)])!;
    expect(a.inOrder).toBe(true);
    expect(a.issues).toHaveLength(1); // nur der Hinweis zur mitgelieferten Root
  });

  it("erkennt falsche Reihenfolge und schlägt die richtige vor", () => {
    const a = analyzeChain([cert(rootPem), cert(leafPem), cert(intermediatePem)])!;
    expect(a.inOrder).toBe(false);
    expect(a.ordered.map((c) => c.subject.attrs.at(-1)!.value)).toEqual([
      "intranet.example.com",
      "Beispiel Issuing CA",
      "Beispiel Root CA",
    ]);
  });

  it("meldet ein fehlendes Zwischenzertifikat", () => {
    const a = analyzeChain([cert(leafPem), cert(rootPem)])!;
    expect(a.issues[0]).toMatch(/fehlt/);
  });
});

describe("Sicherheit", () => {
  it("ignoriert private Schlüssel mit Warnung", () => {
    const r = decodeText("-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----");
    expect(r.items).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/privater Schlüssel/);
  });
});
