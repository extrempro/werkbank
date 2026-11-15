// @vitest-environment node
import { describe, expect, it } from "vitest";
import { detectFormat, makeHash, splitLine, verifyHash } from "./hashes";

describe("Passwort-Hashes", () => {
  it("bekannte Hashes prüfen", async () => {
    expect(await verifyHash("password", "$apr1$abcdefgh$FBwExRW4dCc8aL.OvjpIE1")).toBe(true);
    expect(await verifyHash("falsch", "$apr1$abcdefgh$FBwExRW4dCc8aL.OvjpIE1")).toBe(false);
    expect(
      await verifyHash("Hello world!", "$5$saltstring$5B8vYYiY.CVt1RlTTf8KbXBH3hsxY/GNooZaBBGWEc5"),
    ).toBe(true);
    expect(
      await verifyHash(
        "Hello world!",
        "$6$rounds=10000$saltstringsaltst$OW1/O6BYHV6BcXZu8QVeXbDWra3Oeqh0sbHbbMCVNSnCM/UrjmM0Dp8vOuZeHBy/YTBmSK6H9qs/y3RnOaw5v.",
      ),
    ).toBe(true);
    expect(
      await verifyHash("abc", "$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i"),
    ).toBe(true);
    expect(await verifyHash("password", "{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=")).toBe(true);
  });
  it("erzeugte Hashes lassen sich prüfen", async () => {
    for (const f of ["bcrypt", "sha512", "sha256", "apr1", "md5", "sha1"] as const) {
      const h = await makeHash("Geheim!1", f, { cost: 4, rounds: 5000 });
      expect(detectFormat(h)).toBe(f);
      expect(await verifyHash("Geheim!1", h)).toBe(true);
      expect(await verifyHash("geheim!1", h)).toBe(false);
    }
  });
  it("Zeilen zerlegen", () => {
    expect(splitLine("admin:$apr1$x$y")).toEqual({ user: "admin", hash: "$apr1$x$y" });
    expect(splitLine("root:$6$s$h:19000:0:99999:7:::").hash).toBe("$6$s$h");
  });
});
