// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bcryptVerify, bcryptWithSetting, blowfishEncryptBlock } from "./bcrypt";
import { md5Crypt, shaCrypt, shaHtpasswd } from "./crypt";
import { md5 } from "./md5";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);

describe("MD5", () => {
  it("RFC 1321", () => {
    expect(hex(md5(enc("")))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(hex(md5(enc("abc")))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(hex(md5(enc("12345678901234567890123456789012345678901234567890123456789012345678901234567890")))).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});

describe("Blowfish & bcrypt", () => {
  it("Blowfish-Testvektoren (Schneier)", () => {
    expect(blowfishEncryptBlock(new Uint8Array(8), [0, 0]).map((x) => x.toString(16).padStart(8, "0")).join("")).toBe("4ef997456198dd78");
    expect(blowfishEncryptBlock(new Uint8Array(8).fill(0xff), [0xffffffff, 0xffffffff]).map((x) => x.toString(16).padStart(8, "0")).join("")).toBe("51866fd5b85ecb8a");
  });
  it("bcrypt-Testvektoren (OpenBSD/jBCrypt)", () => {
    expect(bcryptWithSetting("", "$2a$06$DCq7YPn5Rq63x1Lad4cll.")).toBe("$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.");
    expect(bcryptWithSetting("a", "$2a$06$m0CrhHm10qJ3lXRY.5zDGO")).toBe("$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe");
    expect(bcryptWithSetting("abc", "$2a$06$If6bvum7DFjUnE9p2uDeDu")).toBe("$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i");
    expect(bcryptVerify("abc", "$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i")).toBe(true);
    expect(bcryptVerify("abd", "$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i")).toBe(false);
  });
});

describe("crypt-Formate (gegen OpenSSL)", () => {
  it("apr1 und SHA-crypt", async () => {
    expect(md5Crypt("test", "abcdefgh")).toBe("$apr1$abcdefgh$/cesMUEGhga5MgaTGywaW0");
    expect(await shaCrypt("test", "saltsalt", 6)).toBe("$6$saltsalt$JcVDtuB6d1BHhCd5RPBh8g8xX/1CbY8EU2PN0MTaj2/Mypw4P./C6dN4j0HALhzBDTocyW1Jm.gYaTPjFGCV40");
    expect(md5Crypt("test", "abcdefgh", "$1$")).toBe("$1$abcdefgh$irWbblnpmw.5z7wgBnprh0");
    expect(await shaCrypt("test", "saltsalt", 5)).toBe("$5$saltsalt$q6kNPzk9GPb3dpYKO2TUS45z2kiVxsUVz7eWVJcih.0");
    expect(await shaCrypt("Pässwort mit Leerzeichen und mehr als 16 zeichen!!", "longersaltvalue1", 6)).toBe(
      "$6$longersaltvalue1$oWSfikck4SAZFhT8729.E3TJWEICIVQ7WCVwzB7n.s.nnQ4T7A/dd3Vc4tMzX6yzfrxFgH7GQfaC7pVhanMXM0",
    );
    expect(await shaHtpasswd("test")).toBe("{SHA}qUqP5cyxm6YcTAhz05Hph5gvu9M=");
  });
});
