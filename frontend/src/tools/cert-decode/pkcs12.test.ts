import { describe, expect, it } from "vitest";
import { parseDerStrict } from "./asn1";
import { buildP7b, chainFrom, loadSources, webserverZip } from "./bundle";
import { fromBase64 } from "./der";
import { intermediatePem, leafPem, rootPem } from "./fixtures";
import { decryptPkcs8, detectKeyDer, keyFromDer, keyToEncryptedPem, keyToTraditionalPem, PasswordError, publicKeyId } from "./keys";
import { pfxBer, pfxLegacy, pfxModern, pfxWindows3des, ecCertPem, ecKeyEncryptedPem, ecKeyPem, rsaKeyPem } from "./pfx-fixtures";
import { buildPfx, looksLikePfx, parsePfx } from "./pkcs12";
import { decodeDer, parseCertificate } from "./x509";

const pemBody = (text: string) => fromBase64(text.replace(/-----[^-]+-----/g, ""));
const ecCert = parseCertificate(pemBody(ecCertPem));
const text = (s: string) => ({ name: "Eingabe", bytes: new TextEncoder().encode(s) });

async function expectPasswordError(p: Promise<unknown>, missing: boolean) {
  try {
    await p;
  } catch (e) {
    expect(e instanceof PasswordError).toBe(true);
    expect((e as PasswordError).missing).toBe(missing);
    return;
  }
  throw new Error("PasswordError erwartet");
}

describe("PFX lesen", () => {
  const cases = [
    ["OpenSSL 3 (AES-256)", pfxModern, /AES-256/],
    ["OpenSSL -legacy (RC2-40 + 3DES)", pfxLegacy, /RC2-40/],
    ["Windows-Stil (3DES)", pfxWindows3des, /3DES/],
    ["BER-kodiert", pfxBer, /AES-256/],
  ] as const;

  for (const [name, bytes, encryption] of cases) {
    it(name, async () => {
      expect(looksLikePfx(bytes)).toBe(true);
      const r = await parsePfx(bytes, "Test123");
      expect(r.certs.length).toBe(1);
      expect(r.keys.length).toBe(1);
      expect(r.certs[0]!.der).toEqual(ecCert.der);
      expect(r.details.map((d) => d.value).join(" ")).toMatch(encryption);
      const { key } = await keyFromDer(r.keys[0]!.der, "pkcs8", "");
      expect(publicKeyId(key.spki!)).toBe(publicKeyId(ecCert.spki));
    });
  }

  it("liest den Anzeigenamen", async () => {
    const r = await parsePfx(pfxModern, "Test123");
    expect(r.certs[0]!.friendlyName).toBe("PFX Test");
    expect(r.keys[0]!.localKeyId).toBe(r.certs[0]!.localKeyId);
  });

  it("warnt vor RC2", async () => {
    const r = await parsePfx(pfxLegacy, "Test123");
    expect(r.warnings.join(" ")).toMatch(/veraltete Verschlüsselung/);
  });

  it("erkennt fehlendes und falsches Kennwort", async () => {
    await expectPasswordError(parsePfx(pfxModern, ""), true);
    await expectPasswordError(parsePfx(pfxModern, "falsch"), false);
    await expectPasswordError(parsePfx(pfxLegacy, "falsch"), false);
  });
});

describe("PFX erzeugen", () => {
  for (const mode of ["aes", "3des"] as const) {
    it(`Rundreise ${mode}`, async () => {
      const { key } = await keyFromDer(pemBody(ecKeyPem), "sec1", "");
      const pfx = await buildPfx({ key: key.pkcs8, certs: [ecCert.der], password: "Grüße!", friendlyName: "Server", mode });
      const r = await parsePfx(pfx, "Grüße!");
      expect(r.certs[0]!.der).toEqual(ecCert.der);
      expect(r.certs[0]!.friendlyName).toBe("Server");
      expect(r.keys[0]!.der).toEqual(key.pkcs8);
      expect(r.details[0]!.value).toMatch(mode === "aes" ? /SHA-256/ : /SHA-1/);
      await expectPasswordError(parsePfx(pfx, "Grüsse!"), false);
    });
  }

  it("auch ohne Schlüssel", async () => {
    const certs = [leafPem, intermediatePem].map((p) => pemBody(p));
    const r = await parsePfx(await buildPfx({ certs, password: "x", mode: "aes" }), "x");
    expect(r.certs.length).toBe(2);
    expect(r.keys.length).toBe(0);
  });
});

describe("Schlüssel", () => {
  it("SEC1 → PKCS#8 und zurück", async () => {
    const der = pemBody(ecKeyPem);
    expect(detectKeyDer(parseDerStrict(der))).toBe("sec1");
    const { key } = await keyFromDer(der, "sec1", "");
    expect(key.publicKey.curve).toBe("P-256");
    expect(publicKeyId(key.spki!)).toBe(publicKeyId(ecCert.spki));
    expect(keyToTraditionalPem(key)).toContain("BEGIN EC PRIVATE KEY");
    const again = await keyFromDer(pemBody(keyToTraditionalPem(key)!), "sec1", "");
    expect(again.key.pkcs8).toEqual(key.pkcs8);
  });

  it("PKCS#1 → PKCS#8 und zurück", async () => {
    const der = pemBody(rsaKeyPem);
    expect(detectKeyDer(parseDerStrict(der))).toBe("pkcs1");
    const { key } = await keyFromDer(der, "pkcs1", "");
    expect(key.publicKey).toEqual({ algorithm: "RSA", bits: 1024 });
    expect(key.traditional!.der).toEqual(der);
  });

  it("entschlüsselt PKCS#8 (OpenSSL) und verschlüsselt neu", async () => {
    const der = pemBody(ecKeyEncryptedPem);
    expect(detectKeyDer(parseDerStrict(der))).toBe("pkcs8-encrypted");
    await expectPasswordError(decryptPkcs8(der, ""), true);
    await expectPasswordError(decryptPkcs8(der, "falsch"), false);
    const { key, method } = await keyFromDer(der, "pkcs8-encrypted", "geheim");
    expect(method).toMatch(/AES-256/);
    const reencrypted = await keyToEncryptedPem(key, "neu");
    const back = await decryptPkcs8(pemBody(reencrypted), "neu");
    expect(back.pkcs8).toEqual(key.pkcs8);
  });
});

describe("Laden und Export", () => {
  it("ordnet Schlüssel aus Text und Datei dem Zertifikat zu", async () => {
    const r = await loadSources([text(ecCertPem + ecKeyEncryptedPem)], "geheim");
    expect(r.errors).toEqual([]);
    expect(r.keys[0]!.keyId).toBe(r.certs[0]!.keyId);
    expect(r.keys[0]!.format).toMatch(/verschlüsselt/);
  });

  it("meldet ein fehlendes Kennwort", async () => {
    const r = await loadSources([{ name: "a.pfx", bytes: pfxModern }], "");
    expect(r.password).toBe("missing");
    expect(r.certs.length).toBe(0);
  });

  it("liest PFX als Base64-Text und entfernt Doppelte", async () => {
    let b64 = "";
    for (const b of pfxModern) b64 += String.fromCharCode(b);
    const r = await loadSources([text(btoa(b64)), text(ecCertPem)], "Test123");
    expect(r.certs.length).toBe(1);
    expect(r.keys.length).toBe(1);
    expect(r.pfx.length).toBe(1);
  });

  it("baut P7B und Webserver-Paket", async () => {
    const r = await loadSources([text(rootPem + leafPem + intermediatePem)], "");
    const leaf = r.certs.find((c) => !c.info.basicConstraints?.ca)!.info;
    const chain = chainFrom(leaf, r.certs.map((c) => c.info));
    expect(chain.length).toBe(3);
    const p7b = decodeDer(buildP7b(chain));
    expect(p7b.items.map((i) => i.der)).toEqual(chain.map((c) => c.der));

    const { key } = await keyFromDer(pemBody(ecKeyPem), "sec1", "");
    const zip = new TextDecoder("latin1").decode(webserverZip(chain, key));
    for (const name of ["cert.pem", "chain.pem", "fullchain.pem", "privkey.pem", "combined.pem"]) expect(zip).toContain(name);
    // Root gehört nicht ins Paket
    expect((zip.match(/BEGIN CERTIFICATE/g) ?? []).length).toBe(1 + 1 + 2 + 2);
  });
});
