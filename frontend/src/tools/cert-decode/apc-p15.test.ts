import { describe, expect, it } from "vitest";
import { apcCertPem, apcKeyPem, apcReferenceKeyP15, apcReferenceP15 } from "./apc-fixtures";
import {
  APC_HEADER_LENGTH,
  apcHeader,
  buildApcP15,
  checkApcCompatibility,
  crc16Xmodem,
  looksLikeApcP15,
  readApcP15,
} from "./apc-p15";
import { child, parseDerStrict, raw } from "./asn1";
import { integer, seq } from "./der";
import type { PrivateKey } from "./keys";
import { certForKey, loadSources } from "./bundle";
import { ecCertPem, ecKeyPem, rsaKeyPem } from "./pfx-fixtures";

const text = (s: string) => ({ name: "Eingabe", bytes: new TextEncoder().encode(s) });

async function load(...pems: string[]) {
  const r = await loadSources(pems.map(text), "");
  expect(r.errors).toEqual([]);
  const key = r.keys[0]!;
  const cert = certForKey(key, r.certs)!;
  expect(cert).toBeDefined();
  return { cert: cert.info, key: key.key };
}

/** PKCS#15-Objekte unterhalb des Headers: [privater Schlüssel, Zertifikat] */
function objects(file: Uint8Array) {
  const body = file.subarray(APC_HEADER_LENGTH);
  const list = child(child(child(parseDerStrict(body), 1), 0), 1);
  const priv = child(child(child(list, 0), 0), 0);
  const cert = child(child(child(list, 1), 0), 0);
  return { privAttributes: raw(child(priv, 1)), certObject: raw(cert) };
}

describe("CRC-16/XMODEM", () => {
  it("entspricht dem Referenzwert", () => {
    expect(crc16Xmodem(new TextEncoder().encode("123456789"))).toBe(0x31c3);
  });
});

describe("APC-Header", () => {
  it("hat 228 Byte, Länge und Prüfsummen", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const h = apcHeader(data);
    const v = new DataView(h.buffer);
    expect(h.length).toBe(228);
    expect(v.getUint32(0, true)).toBe(1);
    expect(v.getUint32(216, true)).toBe(5);
    expect(new TextDecoder().decode(h.subarray(8, 31))).toBe("NMCSecurityWizardCLI100");
  });

  it("stimmt mit dem Header der Referenzdatei überein", () => {
    const head = apcReferenceP15.subarray(0, APC_HEADER_LENGTH);
    expect(apcHeader(apcReferenceP15.subarray(APC_HEADER_LENGTH))).toEqual(head);
  });
});

describe("APC-.p15 lesen", () => {
  it("liest die Referenzdatei (apc-p15-tool) und stellt den vollständigen Schlüssel wieder her", async () => {
    const { cert, key } = await load(apcKeyPem, apcCertPem);
    const r = await readApcP15(apcReferenceP15);
    expect(r.header).toBe(true);
    expect(r.tool).toBe("NMCSecurityWizardCLI100");
    expect(r.label).toBe("Private key");
    expect(r.certificate).toEqual(cert.der);
    expect(r.rsaPkcs1).toEqual(key.traditional!.der);
    expect(r.protection.iterations).toBe(5000);
  });

  it("liest eine reine Schlüsseldatei ohne Zertifikat", async () => {
    const { key } = await load(apcKeyPem, apcCertPem);
    const r = await readApcP15(apcReferenceKeyP15);
    expect(r.certificate).toBe(undefined);
    expect(r.spki).toEqual(key.spki);
    expect(r.rsaPkcs1).toEqual(key.traditional!.der);
  });

  it("liest auch Dateien ohne APC-Header", async () => {
    const r = await readApcP15(apcReferenceP15.subarray(APC_HEADER_LENGTH));
    expect(r.header).toBe(false);
    expect(r.certificate).toBeDefined();
  });

  it("erkennt .p15-Dateien am Inhalt", () => {
    expect(looksLikeApcP15(apcReferenceP15)).toBe(true);
    expect(looksLikeApcP15(apcReferenceKeyP15.subarray(APC_HEADER_LENGTH))).toBe(true);
    expect(looksLikeApcP15(new Uint8Array(300))).toBe(false);
  });

  it("erkennt beschädigte Dateien", async () => {
    const broken = apcReferenceP15.slice();
    broken[broken.length - 20]! ^= 0xff;
    await expect(readApcP15(broken)).rejects.toThrow(/Prüfsumme/);
  });

  it("erkennt einen veränderten Schlüssel am MAC", async () => {
    const body = apcReferenceP15.slice(APC_HEADER_LENGTH);
    const list = child(child(child(parseDerStrict(body), 1), 0), 1);
    const priv = child(child(child(list, 0), 0), 0);
    const value = priv.children.find((n) => n.cls === 2 && n.tag === 1)!;
    const mac = child(child(child(value, 0), 0), 3);
    body[mac.contentStart]! ^= 0x01;
    await expect(readApcP15(body)).rejects.toThrow(/MAC/);
  });

  it("wird beim Einlesen als Zertifikat und Schlüssel erkannt", async () => {
    const r = await loadSources([{ name: "pdu.p15", bytes: apcReferenceP15 }], "");
    expect(r.errors).toEqual([]);
    expect(r.certs.length).toBe(1);
    expect(r.keys.length).toBe(1);
    expect(r.keys[0]!.format).toBe("APC-.p15 (NMC)");
    expect(certForKey(r.keys[0]!, r.certs)).toBeDefined();
    expect(r.pfx[0]!.kind).toBe("apc");
  });
});

describe("APC-.p15 erzeugen", () => {
  it("lässt sich lesen und enthält Zertifikat und Schlüssel", async () => {
    const { cert, key } = await load(apcKeyPem, apcCertPem);
    const file = await buildApcP15(cert, key);
    const back = await readApcP15(file);
    expect(back.certificate).toEqual(cert.der);
    expect(back.label).toBe("Private key");
    expect(back.rsaPkcs1).toEqual(key.traditional!.der);
  });

  it("ist bis auf Zufallswerte gleich aufgebaut wie die Referenzdatei", async () => {
    const { cert, key } = await load(apcKeyPem, apcCertPem);
    const file = await buildApcP15(cert, key);
    expect(file.length).toBe(apcReferenceP15.length);
    const ours = objects(file);
    const theirs = objects(apcReferenceP15);
    // Zertifikatsobjekt (inkl. aller Schlüssel-IDs) und Schlüsselattribute enthalten keine Zufallswerte
    expect(ours.certObject).toEqual(theirs.certObject);
    expect(ours.privAttributes).toEqual(theirs.privAttributes);
  });

  it("nutzt frische Zufallswerte", async () => {
    const { cert, key } = await load(apcKeyPem, apcCertPem);
    const a = await buildApcP15(cert, key);
    const b = await buildApcP15(cert, key);
    expect(a).not.toEqual(b);
  });

  it("lehnt EC-Schlüssel ab", async () => {
    const { cert, key } = await load(ecKeyPem, ecCertPem);
    await expect(buildApcP15(cert, key)).rejects.toThrow(/nur RSA/);
    expect(checkApcCompatibility(cert, key).some((c) => c.tone === "error")).toBe(true);
  });

  it("lehnt RSA-Schlüssel ab 4096 Bit ab", async () => {
    const { cert } = await load(apcKeyPem, apcCertPem);
    for (const bits of [4096, 8192]) {
      const n = new Uint8Array(bits / 8);
      n[0] = 0x80;
      n[n.length - 1] = 1;
      const big: PrivateKey = {
        pkcs8: new Uint8Array(),
        publicKey: { algorithm: "RSA", bits },
        traditional: {
          label: "RSA PRIVATE KEY",
          der: seq(integer(0), integer(n), ...[3, 5, 7, 11, 13, 17, 19].map((v) => integer(v))),
        },
      };
      const checks = checkApcCompatibility(cert, big);
      expect(checks.some((c) => c.tone === "error" && c.text.includes(`${bits} Bit`))).toBe(true);
      await expect(buildApcP15(cert, big)).rejects.toThrow(new RegExp(`${bits} Bit`));
    }
  });

  it("lehnt einen nicht passenden Schlüssel ab", async () => {
    const { cert } = await load(apcKeyPem, apcCertPem);
    const other = await loadSources([text(rsaKeyPem)], "");
    await expect(buildApcP15(cert, other.keys[0]!.key)).rejects.toThrow(/passen nicht zusammen/);
  });
});

describe("Kompatibilitätsprüfung", () => {
  it("meldet RSA 2048 mit SHA-256 und SAN als passend", async () => {
    const { cert, key } = await load(apcKeyPem, apcCertPem);
    const checks = checkApcCompatibility(cert, key, new Date("2030-01-01"));
    expect(checks.filter((c) => c.tone !== "ok")).toEqual([]);
  });

  it("warnt bei abgelaufenen Zertifikaten und fehlendem Schlüssel", async () => {
    const { cert, key } = await load(apcKeyPem, apcCertPem);
    expect(
      checkApcCompatibility(cert, key, new Date("2200-01-01")).some((c) =>
        /abgelaufen/.test(c.text),
      ),
    ).toBe(true);
    expect(checkApcCompatibility(cert, undefined)[0]!.tone).toBe("error");
  });
});
