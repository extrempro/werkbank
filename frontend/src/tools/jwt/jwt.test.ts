// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeJwt, tokenStatus, verifyJwt } from "./jwt";

// Öffentliche Beispiel-Token, keine echten Zugangsdaten.
const HS = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"; // gitleaks:allow
const ES = "eyJhbGciOiJFUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ4IiwiZXhwIjo0MTAyNDQ0ODAwfQ.4Xy9agF4iqVOWPOdD17dG6U92Wr414R_wPzoK6yA0wEl5oIf8nJoOdUDaWgzLgKftrft54oQwtsTHwPNtB0_zA"; // gitleaks:allow
const ES_PEM = "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjAXPs8pbUDxbRdtw800jnf6lWJlD\nMKkattiFKTAmt95MinfVg3c1/OOXofaaQTxr+WrJO4SXZCuVsJNUmVn84w==\n-----END PUBLIC KEY-----\n";

describe("JWT", () => {
  it("dekodiert Header und Payload", () => {
    const j = decodeJwt(`Bearer ${HS}`);
    expect(j.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(j.payload).toEqual({ sub: "1234567890", name: "John Doe", iat: 1516239022 });
    expect(() => decodeJwt("a.b")).toThrow(/3/);
    expect(() => decodeJwt("a.b.c.d.e")).toThrow(/JWE/);
  });

  it("Gültigkeit", () => {
    expect(tokenStatus({ exp: 100 }, 200).state).toBe("expired");
    expect(tokenStatus({ exp: 300, nbf: 250 }, 200).state).toBe("notyet");
    expect(tokenStatus({ exp: 300 }, 200).state).toBe("valid");
  });

  it("prüft HS256 und ES256", async () => {
    expect(await verifyJwt(decodeJwt(HS), "your-256-bit-secret")).toBe(true);
    expect(await verifyJwt(decodeJwt(HS), "falsch")).toBe(false);
    expect(await verifyJwt(decodeJwt(ES), ES_PEM)).toBe(true);
    const forged = btoa(JSON.stringify({ sub: "admin", exp: 4102444800 })).replace(/=+$/, "");
    const tampered = ES.replace(/\.[^.]+\./, `.${forged}.`);
    expect(await verifyJwt(decodeJwt(tampered), ES_PEM)).toBe(false);
  });
});
