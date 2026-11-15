// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeKey, guessAlg, hash, hmac, matches, toHex } from "./hash";

const enc = (s: string) => new TextEncoder().encode(s);

describe("Hashes", () => {
  it("bekannte Werte", async () => {
    expect(toHex(await hash("SHA-256", enc("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(toHex(await hash("MD5", enc("abc")))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(toHex(await hash("CRC32", enc("123456789")))).toBe("cbf43926");
  });
  it("Vergleich", async () => {
    const d = await hash("SHA-1", enc("abc"));
    expect(matches("A9993E36 4706816A BA3E2571 7850C26C 9CD0D89D", d)).toBe(true);
    expect(matches("a9993e36", d)).toBe(false);
    expect(guessAlg("a9993e364706816aba3e25717850c26c9cd0d89d")).toBe("SHA-1");
  });
  it("HMAC (RFC 4231, Testfall 2)", async () => {
    expect(
      toHex(await hmac("SHA-256", decodeKey("Jefe", "text"), enc("what do ya want for nothing?"))),
    ).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    expect(decodeKey("0a0b", "hex")).toEqual(new Uint8Array([10, 11]));
  });
});
