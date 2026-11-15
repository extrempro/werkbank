import { describe, expect, it } from "vitest";
import { base64Decode, base64Encode } from "./encoding";
import { uuidV4 } from "../uuid/uuid";

describe("base64", () => {
  it("kodiert und dekodiert UTF-8 inkl. Umlauten", () => {
    const text = "Grüße aus der IT 👋";
    expect(base64Decode(base64Encode(text))).toBe(text);
  });

  it("dekodiert URL-safe Base64 ohne Padding", () => {
    expect(base64Decode("aGFsbG8_")).toBe("hallo?");
  });

  it("wirft bei ungültiger Eingabe", () => {
    expect(() => base64Decode("%%%")).toThrow();
  });
});

describe("uuidV4", () => {
  it("erzeugt gültige v4-UUIDs", () => {
    expect(uuidV4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
