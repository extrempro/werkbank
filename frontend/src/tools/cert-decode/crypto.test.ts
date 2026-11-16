import { describe, expect, it } from "vitest";
import { cbcDecrypt, cbcEncrypt, tripleDes, tripleDesCipher } from "./des";
import { RC2_PITABLE, rc2 } from "./rc2";

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("3DES", () => {
  it("entspricht dem DES-Referenzvektor (K1 = K2 = K3)", () => {
    // klassischer Testvektor: Schlüssel 133457799BBCDFF1, Klartext 0123456789ABCDEF → 85E813540F0AB405
    const k = hex("133457799bbcdff1");
    const des = tripleDes(new Uint8Array([...k, ...k, ...k]));
    expect(toHex(des.encryptBlock(hex("0123456789abcdef")))).toBe("85e813540f0ab405");
    expect(toHex(des.decryptBlock(hex("85e813540f0ab405")))).toBe("0123456789abcdef");
  });

  it("verschlüsselt und entschlüsselt CBC mit Auffüllung", () => {
    const c = tripleDesCipher(hex("0123456789abcdef23456789abcdef01456789abcdef0123"));
    const iv = hex("0011223344556677");
    const plain = new TextEncoder().encode("Grüße aus der IT – 3DES");
    expect(new TextDecoder().decode(cbcDecrypt(c, iv, cbcEncrypt(c, iv, plain)))).toBe(
      "Grüße aus der IT – 3DES",
    );
  });

  it("erkennt falsche Schlüssel an der Auffüllung", () => {
    const c = tripleDesCipher(hex("0123456789abcdef23456789abcdef01456789abcdef0123"));
    const wrong = tripleDesCipher(hex("1123456789abcdef23456789abcdef01456789abcdef0123"));
    const iv = hex("0011223344556677");
    const enc = cbcEncrypt(c, iv, new TextEncoder().encode("geheim geheim geheim"));
    expect(() => cbcDecrypt(wrong, iv, enc)).toThrow(/Kennwort/);
  });
});

describe("RC2", () => {
  it("hat eine gültige PITABLE (Permutation von 0–255)", () => {
    expect(new Set(RC2_PITABLE).size).toBe(256);
  });

  it("entspricht den Testvektoren aus RFC 2268", () => {
    expect(toHex(rc2(hex("0000000000000000"), 63).encryptBlock(hex("0000000000000000")))).toBe(
      "ebb773f993278eff",
    );
    expect(toHex(rc2(hex("ffffffffffffffff"), 64).encryptBlock(hex("ffffffffffffffff")))).toBe(
      "278b27e42e2f0d49",
    );
    expect(toHex(rc2(hex("3000000000000000"), 64).encryptBlock(hex("1000000000000001")))).toBe(
      "30649edf9be7d2c2",
    );
    expect(
      toHex(
        rc2(hex("88bca90e90875a7f0f79c384627bafb2"), 128).encryptBlock(hex("0000000000000000")),
      ),
    ).toBe("2269552ab0f85ca6");
  });

  it("entschlüsselt, was es verschlüsselt", () => {
    const c = rc2(hex("0102030405"), 40);
    const block = hex("0011223344556677");
    expect(toHex(c.decryptBlock(c.encryptBlock(block)))).toBe("0011223344556677");
  });
});
