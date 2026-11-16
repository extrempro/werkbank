import { describe, expect, it } from "vitest";
import { fromBase64 } from "../cert-decode/der";
import { parseCsr } from "../cert-decode/x509";
import { createCsr, opensslCommand, parseSans } from "./csr";

const der = (p: string) => fromBase64(p.replace(/-----[^-]+-----/g, ""));

describe("CSR erzeugen", () => {
  it("SANs lesen", () => {
    expect(
      parseSans(
        "www.example.com, example.com 192.0.2.5\n*.example.com 2001:db8::1 admin@example.com foo!",
      ),
    ).toEqual({
      dns: ["www.example.com", "example.com", "*.example.com"],
      ip: ["192.0.2.5", "2001:db8::1"],
      email: ["admin@example.com"],
      invalid: ["foo!"],
    });
  });

  for (const keyType of ["p256", "rsa2048"] as const) {
    it(`erzeugt einen gültigen CSR (${keyType})`, async () => {
      const r = await createCsr({
        keyType,
        subject: { CN: "intranet.example.com", O: "Beispiel GmbH", C: "DE", L: "München" },
        sans: "intranet.example.com intranet 192.0.2.10",
        serverAuth: true,
        clientAuth: false,
      });
      const info = parseCsr(der(r.csrPem));
      expect(info.subject.text).toContain("CN=intranet.example.com");
      expect(info.subject.text).toContain("L=München");
      expect(info.san.map((s) => s.value)).toEqual([
        "intranet.example.com",
        "intranet",
        "192.0.2.10",
      ]);
      expect(info.extKeyUsage.join()).toMatch(/Server/);
      expect(r.keyPem).toContain("BEGIN PRIVATE KEY");
    });
  }

  it("prüft Eingaben und erzeugt den OpenSSL-Befehl", async () => {
    let failed = false;
    try {
      await createCsr({
        keyType: "p256",
        subject: { CN: "" },
        sans: "",
        serverAuth: true,
        clientAuth: false,
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(
      opensslCommand({
        keyType: "p256",
        subject: { CN: "a.example.com", C: "DE" },
        sans: "a.example.com",
        serverAuth: true,
        clientAuth: false,
      }),
    ).toBe(
      "openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout server.key -out server.csr -subj '/C=DE/CN=a.example.com' -addext 'subjectAltName=DNS:a.example.com'",
    );
  });
});

describe("OpenSSL-Befehl", () => {
  it("setzt die Namen in einfache Anführungszeichen", () => {
    const command = opensslCommand({
      keyType: "p256",
      subject: { CN: "www.example.com", O: "O'Beispiel $(id)" },
      sans: "www.example.com",
      serverAuth: true,
      clientAuth: false,
    });
    expect(command).toContain(`-subj '/O=O'"'"'Beispiel $(id)/CN=www.example.com'`);
    expect(command).toContain("-addext 'subjectAltName=DNS:www.example.com'");
    expect(command).toContain("ec_paramgen_curve:P-256");
  });
});
